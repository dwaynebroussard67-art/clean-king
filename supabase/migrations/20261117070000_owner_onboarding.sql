-- An owner-approved hire starts an onboarding record. It is NOT an active account,
-- employment eligibility verification, training completion, or a scheduled shift.
-- Apply only to a dedicated approved test project; production auth is not implemented.
create table public.employee_onboarding (
  id uuid primary key default gen_random_uuid(),
  applicant_id uuid not null unique references public.applicants(id) on delete restrict,
  started_by uuid not null references auth.users(id) on delete restrict,
  started_at timestamptz not null default now()
);
create table public.onboarding_tasks (
  onboarding_id uuid not null references public.employee_onboarding(id) on delete restrict,
  task_code text not null check (task_code in ('review_documents','plan_training','plan_first_shift')),
  status text not null default 'pending' check (status in ('pending','recorded')),
  recorded_by uuid references auth.users(id) on delete restrict,
  recorded_at timestamptz,
  primary key (onboarding_id, task_code),
  check ((status='pending' and recorded_by is null and recorded_at is null) or
         (status='recorded' and recorded_by is not null and recorded_at is not null))
);
alter table public.employee_onboarding enable row level security;
alter table public.onboarding_tasks enable row level security;
revoke all on public.employee_onboarding, public.onboarding_tasks from public, anon, authenticated, service_role;
grant select (id, applicant_id, started_by, started_at) on public.employee_onboarding to authenticated;
grant select (onboarding_id, task_code, status, recorded_by, recorded_at) on public.onboarding_tasks to authenticated;
create policy "Owner reads onboarding" on public.employee_onboarding for select to authenticated using ((select public.is_business_owner()));
create policy "Owner reads onboarding tasks" on public.onboarding_tasks for select to authenticated using ((select public.is_business_owner()));

-- The previous migration allowed direct status updates; they could create a false hire
-- without an onboarding record. Only the RPCs below may change applicant status now.
revoke update (status) on public.applicants from authenticated;

create function public.set_applicant_status(p_id uuid, p_status text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare affected integer;
begin
  if not public.is_business_owner() then raise exception 'Not authorized' using errcode='42501'; end if;
  if p_id is null or p_status is null or p_status not in ('new','later','screening','passed') then return false; end if;
  -- A hire cannot be undone with an ordinary status button. Separation/reversal needs a deliberate workflow.
  update public.applicants set status=p_status where id=p_id and status <> 'hired';
  get diagnostics affected = row_count;
  return affected=1;
end; $$;
revoke all on function public.set_applicant_status(uuid,text) from public, anon, service_role;
grant execute on function public.set_applicant_status(uuid,text) to authenticated;

create function public.start_employee_onboarding(p_applicant_id uuid)
returns table(result text, onboarding_id uuid)
language plpgsql security definer set search_path = '' as $$
declare applicant_status text; existing_id uuid; new_id uuid; actor uuid := (select auth.uid());
begin
  if not public.is_business_owner() or actor is null then raise exception 'Not authorized' using errcode='42501'; end if;
  if p_applicant_id is null then return query select 'not_found'::text,null::uuid; return; end if;
  -- Serializes competing hire attempts on the same applicant.
  select status into applicant_status from public.applicants where id=p_applicant_id for update;
  if not found then return query select 'not_found'::text,null::uuid; return; end if;
  select id into existing_id from public.employee_onboarding where applicant_id=p_applicant_id;
  if existing_id is not null then
    if applicant_status='hired' then return query select 'existing'::text,existing_id;
    else return query select 'inconsistent'::text,null::uuid; end if;
    return;
  end if;
  if applicant_status='passed' then return query select 'ineligible'::text,null::uuid; return; end if;
  insert into public.employee_onboarding(applicant_id,started_by) values(p_applicant_id,actor) returning id into new_id;
  insert into public.onboarding_tasks(onboarding_id,task_code)
    values(new_id,'review_documents'),(new_id,'plan_training'),(new_id,'plan_first_shift');
  update public.applicants set status='hired' where id=p_applicant_id;
  insert into public.audit_log(actor_id,entity_type,entity_id,action,details)
    values(actor,'onboarding',new_id,'started',jsonb_build_object('applicant_id',p_applicant_id));
  return query select 'created'::text,new_id;
end; $$;
revoke all on function public.start_employee_onboarding(uuid) from public, anon, service_role;
grant execute on function public.start_employee_onboarding(uuid) to authenticated;

create function public.record_onboarding_task(p_onboarding_id uuid, p_task text, p_recorded boolean) returns boolean
language plpgsql security definer set search_path = '' as $$
declare old_status text; new_status text; actor uuid := (select auth.uid());
begin
  if not public.is_business_owner() or actor is null then raise exception 'Not authorized' using errcode='42501'; end if;
  if p_onboarding_id is null or p_recorded is null or p_task is null or p_task not in ('review_documents','plan_training','plan_first_shift') then return false; end if;
  select status into old_status from public.onboarding_tasks where onboarding_id=p_onboarding_id and task_code=p_task for update;
  if not found then return false; end if;
  new_status := case when p_recorded then 'recorded' else 'pending' end;
  if old_status=new_status then return true; end if;
  update public.onboarding_tasks set status=new_status,
    recorded_by=case when p_recorded then actor else null end,
    recorded_at=case when p_recorded then now() else null end
    where onboarding_id=p_onboarding_id and task_code=p_task;
  insert into public.audit_log(actor_id,entity_type,entity_id,action,details)
    values(actor,'onboarding',p_onboarding_id,'task_updated',jsonb_build_object('task',p_task,'old_status',old_status,'new_status',new_status));
  return true;
end; $$;
revoke all on function public.record_onboarding_task(uuid,text,boolean) from public, anon, service_role;
grant execute on function public.record_onboarding_task(uuid,text,boolean) to authenticated;
