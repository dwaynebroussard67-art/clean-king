-- Multi-franchise organization foundation.
-- Adds organization scoping to every table so one Supabase project can run many Jani-KING franchises.
-- Apply in timestamp order after all earlier migrations.

-- ---------------------------------------------------------------------------
-- Organizations (one per franchise / business entity)
-- ---------------------------------------------------------------------------
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  owner_id uuid not null references auth.users(id) on delete restrict,
  origin text check (char_length(origin) between 1 and 255),
  status text not null default 'active' check (status in ('active','suspended','closed')),
  default_language text not null default 'en' check (default_language in ('en','es')),
  created_at timestamptz not null default now()
);
create index organizations_origin_idx on public.organizations(origin) where origin is not null;
alter table public.organizations enable row level security;
revoke all on public.organizations from anon, authenticated, service_role;
grant select on public.organizations to authenticated;
grant insert, update, delete on public.organizations to service_role;

-- Every authenticated user can see organizations they own or belong to.
create policy "Users see their organizations" on public.organizations for select to authenticated
  using (owner_id = (select auth.uid()) or
         exists (select 1 from public.owner_memberships m
                 where m.user_id = (select auth.uid()) and m.organization_id = public.organizations.id));

-- ---------------------------------------------------------------------------
-- Organization-scoped owner memberships (replaces the single-business table)
-- ---------------------------------------------------------------------------
drop policy if exists "Owners can see their own membership" on public.owner_memberships;
alter table public.owner_memberships drop constraint if exists owner_memberships_pkey;
alter table public.owner_memberships add column if not exists organization_id uuid not null references public.organizations(id) on delete restrict;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'owner_memberships_pkey') then
    alter table public.owner_memberships add primary key (user_id, organization_id);
  end if;
end $$;
alter table public.owner_memberships add column if not exists role text not null default 'owner' check (role in ('owner','manager'));
alter table public.owner_memberships alter column created_at set default now();

-- Re-validate: every owner membership now belongs to an organization.
create policy "Owner members see own row" on public.owner_memberships for select to authenticated
  using (user_id = (select auth.uid()));
create policy "Owner members write via service role" on public.owner_memberships for all to service_role using (true);

-- Update is_business_owner() to be organization-aware.
create or replace function public.is_business_owner(p_organization_id uuid = null)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.owner_memberships m
    where m.user_id = (select auth.uid())
      and m.organization_id = coalesce(p_organization_id, m.organization_id)
  );
$$;
revoke all on function public.is_business_owner(uuid) from public, anon;
grant execute on function public.is_business_owner(uuid) to authenticated;

-- Convenience: current organization from a claim or session helper.
create or replace function public.current_organization_id()
returns uuid
language sql stable security definer set search_path = ''
as $$
  select m.organization_id
  from public.owner_memberships m
  where m.user_id = (select auth.uid())
  limit 1;
$$;
revoke all on function public.current_organization_id() from public, anon;
grant execute on function public.current_organization_id() to authenticated;

-- ---------------------------------------------------------------------------
-- Applicants -> add organization_id
-- ---------------------------------------------------------------------------
alter table public.applicants add column if not exists organization_id uuid not null references public.organizations(id) on delete restrict;
create index if not exists applicants_organization_created_idx on public.applicants(organization_id, created_at desc);

-- Replaces the single-business owner-read policy.
drop policy if exists "Owner reads applicants" on public.applicants;
drop policy if exists "Owner updates applicants" on public.applicants;
create policy "Owners read own org applicants" on public.applicants for select to authenticated
  using (organization_id = (select public.current_organization_id()));
create policy "Owners update own org applicants" on public.applicants for update to authenticated
  using (organization_id = (select public.current_organization_id()))
  with check (organization_id = (select public.current_organization_id()));
grant update (status, school_cleared, hospital_cleared) on public.applicants to authenticated;

-- ---------------------------------------------------------------------------
-- Leads -> add organization_id
-- ---------------------------------------------------------------------------
alter table public.leads add column if not exists organization_id uuid not null references public.organizations(id) on delete restrict;
create index if not exists leads_organization_created_idx on public.leads(organization_id, created_at desc);

drop policy if exists "Owner reads leads" on public.leads;
drop policy if exists "Owner updates leads" on public.leads;
create policy "Owners read own org leads" on public.leads for select to authenticated
  using (organization_id = (select public.current_organization_id()));
create policy "Owners update own org leads" on public.leads for update to authenticated
  using (organization_id = (select public.current_organization_id()))
  with check (organization_id = (select public.current_organization_id()));
grant update (status) on public.leads to authenticated;

-- ---------------------------------------------------------------------------
-- Audit log -> add organization_id
-- ---------------------------------------------------------------------------
alter table public.audit_log add column if not exists organization_id uuid not null references public.organizations(id) on delete restrict;
create index if not exists audit_log_organization_created_idx on public.audit_log(organization_id, created_at desc);

drop policy if exists "Owner reads audit log" on public.audit_log;
create policy "Owners read own org audit log" on public.audit_log for select to authenticated
  using (organization_id = (select public.current_organization_id()));

-- Rewrite the audit trigger to record organization_id.
create or replace function public.audit_intake_change() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare org uuid;
begin
  -- Resolve organization from the new row when possible.
  if tg_table_name = 'applicants' then
    org := new.organization_id;
  elsif tg_table_name = 'leads' then
    org := new.organization_id;
  else
    org := null;
  end if;

  if tg_table_name = 'applicants' then
    if (old.status, old.school_cleared, old.hospital_cleared) is distinct from (new.status, new.school_cleared, new.hospital_cleared) then
      insert into public.audit_log(actor_id, organization_id, entity_type, entity_id, action, details)
        values ((select auth.uid()), org, 'applicant', new.id, 'updated',
          jsonb_build_object('old_status', old.status, 'new_status', new.status,
            'old_school_cleared', old.school_cleared, 'new_school_cleared', new.school_cleared,
            'old_hospital_cleared', old.hospital_cleared, 'new_hospital_cleared', new.hospital_cleared));
    end if;
  elsif old.status is distinct from new.status then
    insert into public.audit_log(actor_id, organization_id, entity_type, entity_id, action, details)
      values ((select auth.uid()), org, 'lead', new.id, 'updated',
        jsonb_build_object('old_status', old.status, 'new_status', new.status));
  end if;
  return new;
end; $$;
revoke all on function public.audit_intake_change() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Employee memberships -> add organization_id
-- ---------------------------------------------------------------------------
alter table public.employee_memberships add column if not exists organization_id uuid not null references public.organizations(id) on delete restrict;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'employee_memberships_pkey') then
    alter table public.employee_memberships add primary key (user_id, organization_id);
  end if;
end $$;
create index if not exists employee_memberships_organization_idx on public.employee_memberships(organization_id);

drop policy if exists "Employee sees own membership" on public.employee_memberships;
create policy "Employees see own membership" on public.employee_memberships for select to authenticated
  using (user_id = (select auth.uid()) and organization_id = (select public.current_organization_id()));
grant select (user_id, active, created_at, organization_id) on public.employee_memberships to authenticated;

-- ---------------------------------------------------------------------------
-- Referral invitations -> add organization_id
-- ---------------------------------------------------------------------------
alter table public.referral_invitations add column if not exists organization_id uuid not null references public.organizations(id) on delete restrict;
create index if not exists referral_invitations_organization_created_idx on public.referral_invitations(organization_id, created_at desc);

-- Owners read invitations for their org; service role writes.
drop policy if exists "Owner reads referral invitations" on public.referral_invitations;
create policy "Owners read own org invitations" on public.referral_invitations for select to authenticated
  using (organization_id = (select public.current_organization_id()));

-- Rewrite create_employee_invitation to scope by organization.
create or replace function public.create_employee_invitation(p_organization_id uuid, p_employee_id uuid, p_hash text)
returns timestamptz
language plpgsql security definer set search_path = ''
as $$
declare uid uuid := p_employee_id; expiration timestamptz := now() + interval '7 days';
begin
  if p_organization_id is null or uid is null or p_hash is null or p_hash !~ '^[0-9a-f]{64}$' then return null; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(uid::text, 19231));
  if not exists (select 1 from public.employee_memberships where user_id=uid and organization_id=p_organization_id and active) then return null; end if;
  if (select count(*) from public.referral_invitations where employee_id=uid and organization_id=p_organization_id and created_at > now() - interval '1 day') >= 10 then return null; end if;
  insert into public.referral_invitations(employee_id, organization_id, code_hash, expires_at) values (uid, p_organization_id, p_hash, expiration);
  return expiration;
end; $$;
revoke all on function public.create_employee_invitation(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.create_employee_invitation(uuid, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- Referral attributions -> add organization_id
-- ---------------------------------------------------------------------------
alter table public.referral_attributions add column if not exists organization_id uuid not null references public.organizations(id) on delete restrict;

drop policy if exists "Owner reads referral attribution" on public.referral_attributions;
create policy "Owners read own org attributions" on public.referral_attributions for select to authenticated
  using (organization_id = (select public.current_organization_id()));

-- Rewrite submit_referred_application to validate organization and record it.
create or replace function public.submit_referred_application(p_row jsonb, p_code_hash text, p_organization_id uuid)
returns text
language plpgsql security definer set search_path = ''
as $$
declare invite public.referral_invitations%rowtype; app_id uuid; old_hash text;
  rid uuid := (p_row->>'request_id')::uuid;
begin
  if p_organization_id is null then return 'invalid'; end if;
  if p_code_hash is null or p_code_hash !~ '^[0-9a-f]{64}$' then return 'invalid'; end if;
  select request_hash into old_hash from public.applicants where request_id=rid;
  if found then
    if old_hash = p_row->>'request_hash' then return 'duplicate'; else return 'conflict'; end if;
  end if;
  select i.* into invite from public.referral_invitations i
    join public.employee_memberships m on m.user_id=i.employee_id and m.active and m.organization_id=i.organization_id
    where i.code_hash=p_code_hash and i.organization_id=p_organization_id
    for update of i;
  if not found then return 'invalid'; end if;
  select request_hash into old_hash from public.applicants where request_id=rid;
  if found then
    if old_hash = p_row->>'request_hash' then return 'duplicate'; else return 'conflict'; end if;
  end if;
  if invite.used_at is not null or invite.expires_at <= now() then return 'invalid'; end if;
  insert into public.applicants(request_id, request_hash, organization_id, first_name, phone, area, shifts, transportation, languages, referrer, sms_consent, sms_consent_version, form_language, consented_at)
    values (rid, p_row->>'request_hash', p_organization_id, p_row->>'first_name', p_row->>'phone', p_row->>'area',
      array(select jsonb_array_elements_text(p_row->'shifts')), (p_row->>'transportation')::boolean,
      array(select jsonb_array_elements_text(p_row->'languages')), p_row->>'referrer',
      (p_row->>'sms_consent')::boolean, p_row->>'sms_consent_version', p_row->>'form_language', nullif(p_row->>'consented_at','')::timestamptz)
    on conflict (request_id) do nothing returning id into app_id;
  if app_id is null then
    select request_hash into old_hash from public.applicants where request_id=rid;
    if old_hash=p_row->>'request_hash' then return 'duplicate'; else return 'conflict'; end if;
  end if;
  update public.referral_invitations set used_at=now() where id=invite.id;
  insert into public.referral_attributions(application_id, invitation_id, employee_id, organization_id)
    values (app_id, invite.id, invite.employee_id, p_organization_id);
  insert into public.audit_log(actor_id, organization_id, entity_type, entity_id, action, details)
    values (null, p_organization_id, 'applicant', app_id, 'referral_attributed',
      jsonb_build_object('invitation_id', invite.id, 'employee_id', invite.employee_id));
  return 'inserted';
end; $$;
revoke all on function public.submit_referred_application(jsonb, text, uuid) from public, anon, authenticated;
grant execute on function public.submit_referred_application(jsonb, text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Application notifications -> add organization_id
-- ---------------------------------------------------------------------------
alter table public.application_notifications add column if not exists organization_id uuid not null references public.organizations(id) on delete restrict;
create index if not exists application_notifications_organization_status_idx on public.application_notifications(organization_id, status, available_at);

-- ---------------------------------------------------------------------------
-- Assistant usage / settings -> add organization_id
-- ---------------------------------------------------------------------------
alter table public.assistant_usage add column if not exists organization_id uuid not null references public.organizations(id) on delete restrict;
alter table public.assistant_settings add column if not exists organization_id uuid not null references public.organizations(id) on delete restrict;
alter table public.assistant_quota_settings add column if not exists organization_id uuid not null references public.organizations(id) on delete restrict;

-- ---------------------------------------------------------------------------
-- Backfill helper for existing rows (run manually after applying).
-- Set organization_id on any pre-existing rows that belong to the first organization.
-- ---------------------------------------------------------------------------
-- Example (operator runs after inserting the first organization):
--   update public.applicants set organization_id = '<ORG UUID>' where organization_id is null;
--   update public.leads set organization_id = '<ORG UUID>' where organization_id is null;
--   update public.audit_log set organization_id = '<ORG UUID>' where organization_id is null;
--   update public.application_notifications set organization_id = '<ORG UUID>' where organization_id is null;
--   update public.employee_memberships set organization_id = '<ORG UUID>' where organization_id is null;
--   update public.referral_invitations set organization_id = '<ORG UUID>' where organization_id is null;
--   update public.referral_attributions set organization_id = '<ORG UUID>' where organization_id is null;
--   update public.assistant_usage set organization_id = '<ORG UUID>' where organization_id is null;
--   update public.assistant_settings set organization_id = '<ORG UUID>' where organization_id is null;
--   update public.assistant_quota_settings set organization_id = '<ORG UUID>' where organization_id is null;
