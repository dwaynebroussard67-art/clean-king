-- Organization-scoped onboarding. Applies after the organizations migration.
-- Adds organization_id to onboarding tables and updates the owner RPCs to enforce
-- that the authenticated owner belongs to the same franchise as the applicant.

-- ---------------------------------------------------------------------------
-- employee_onboarding -> add organization_id
-- ---------------------------------------------------------------------------
alter table public.employee_onboarding add column if not exists organization_id uuid not null references public.organizations(id) on delete restrict;
create index if not exists employee_onboarding_organization_idx on public.employee_onboarding(organization_id);
alter table public.onboarding_tasks add column if not exists organization_id uuid not null references public.organizations(id) on delete restrict;

-- Column-level grants from the base migration no longer cover the new column;
-- without organization_id in the grant set, even owner reads of these tables fail
-- with permission denied. Re-grant with the column included.
grant select (id, applicant_id, started_by, started_at, organization_id) on public.employee_onboarding to authenticated;
grant select (onboarding_id, task_code, status, recorded_by, recorded_at, organization_id) on public.onboarding_tasks to authenticated;

-- Update policies to scope by organization.
drop policy if exists "Owner reads onboarding" on public.employee_onboarding;
drop policy if exists "Owner reads onboarding tasks" on public.onboarding_tasks;
create policy "Owners read own org onboarding" on public.employee_onboarding for select to authenticated
  using ((select public.owns_organization(organization_id)));
create policy "Owners read own org onboarding tasks" on public.onboarding_tasks for select to authenticated
  using ((select public.owns_organization(organization_id)));

-- ---------------------------------------------------------------------------
-- Rewrite set_applicant_status with organization scoping
-- ---------------------------------------------------------------------------
create or replace function public.set_applicant_status(p_id uuid, p_status text)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare affected integer; org uuid;
begin
  if not public.is_business_owner() then raise exception 'Not authorized' using errcode='42501'; end if;
  if p_id is null or p_status is null or p_status not in ('new','later','screening','passed') then return false; end if;
  -- Only allow status changes on applicants belonging to a franchise this owner owns.
  org := null;
  select organization_id into org from public.applicants where id = p_id;
  if org is null or not public.owns_organization(org) then return false; end if;
  update public.applicants set status=p_status
    where id=p_id
      and status <> 'hired'
      and organization_id = org;
  get diagnostics affected = row_count;
  return affected=1;
end; $$;
revoke all on function public.set_applicant_status(uuid,text) from public, anon, service_role;
grant execute on function public.set_applicant_status(uuid,text) to authenticated;

-- ---------------------------------------------------------------------------
-- Rewrite start_employee_onboarding with organization scoping
-- ---------------------------------------------------------------------------
create or replace function public.start_employee_onboarding(p_applicant_id uuid)
returns table(result text, onboarding_id uuid)
language plpgsql security definer set search_path = ''
as $$
declare applicant_status text; existing_id uuid; new_id uuid; actor uuid := (select auth.uid());
  org uuid;
begin
  if not public.is_business_owner() or actor is null then raise exception 'Not authorized' using errcode='42501'; end if;
  if p_applicant_id is null then return query select 'not_found'::text,null::uuid; return; end if;
  -- Serialize competing hire attempts on the same applicant. The franchise is taken
  -- from the applicant row, then authorized against this owner's memberships —
  -- never from a mutable "current selection".
  select organization_id into org from public.applicants where id=p_applicant_id for update;
  if not found then return query select 'not_found'::text,null::uuid; return; end if;
  if not public.owns_organization(org) then return query select 'not_found'::text,null::uuid; return; end if;
  select status into applicant_status from public.applicants where id=p_applicant_id and organization_id=org;
  select id into existing_id from public.employee_onboarding where applicant_id=p_applicant_id;
  if existing_id is not null then
    if applicant_status='hired' then return query select 'existing'::text,existing_id;
    else return query select 'inconsistent'::text,null::uuid; end if;
    return;
  end if;
  if applicant_status='passed' then return query select 'ineligible'::text,null::uuid; return; end if;
  insert into public.employee_onboarding(applicant_id, started_by, organization_id) values(p_applicant_id, actor, org) returning id into new_id;
  insert into public.onboarding_tasks(onboarding_id, task_code, organization_id)
    values(new_id,'review_documents',org),(new_id,'plan_training',org),(new_id,'plan_first_shift',org);
  update public.applicants set status='hired' where id=p_applicant_id;
  insert into public.audit_log(actor_id, organization_id, entity_type, entity_id, action, details)
    values(actor, org, 'onboarding', new_id, 'started', jsonb_build_object('applicant_id',p_applicant_id));
  return query select 'created'::text,new_id;
end; $$;
revoke all on function public.start_employee_onboarding(uuid) from public, anon, service_role;
grant execute on function public.start_employee_onboarding(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Rewrite record_onboarding_task with organization scoping
-- ---------------------------------------------------------------------------
create or replace function public.record_onboarding_task(p_onboarding_id uuid, p_task text, p_recorded boolean)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare old_status text; new_status text; actor uuid := (select auth.uid());
  org uuid;
begin
  if not public.is_business_owner() or actor is null then raise exception 'Not authorized' using errcode='42501'; end if;
  if p_onboarding_id is null or p_recorded is null or p_task is null or p_task not in ('review_documents','plan_training','plan_first_shift') then return false; end if;
  select organization_id into org from public.onboarding_tasks
    where onboarding_id=p_onboarding_id and task_code=p_task for update;
  if not found then return false; end if;
  if not public.owns_organization(org) then return false; end if;
  new_status := case when p_recorded then 'recorded' else 'pending' end;
  if old_status=new_status then return true; end if;
  update public.onboarding_tasks set status=new_status,
    recorded_by=case when p_recorded then actor else null end,
    recorded_at=case when p_recorded then now() else null end
    where onboarding_id=p_onboarding_id and task_code=p_task and organization_id=org;
  insert into public.audit_log(actor_id, organization_id, entity_type, entity_id, action, details)
    values(actor, org, 'onboarding', p_onboarding_id, 'task_updated',
      jsonb_build_object('task',p_task,'old_status',old_status,'new_status',new_status));
  return true;
end; $$;
revoke all on function public.record_onboarding_task(uuid,text,boolean) from public, anon, service_role;
grant execute on function public.record_onboarding_task(uuid,text,boolean) to authenticated;
