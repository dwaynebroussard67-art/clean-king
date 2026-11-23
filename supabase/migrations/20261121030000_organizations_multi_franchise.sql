-- Multi-franchise organization foundation.
-- Adds organization scoping to every table so one Supabase project can run many Jani-KING franchises.
-- Apply in timestamp order after all earlier migrations. This file is written to be re-runnable on an
-- empty or already-migrated database (guards use IF [NOT] EXISTS / CREATE OR REPLACE). It must NOT be
-- applied to a database with rows in the scoped tables until the organization_id backfill described at
-- the bottom of this file has been designed and approved: the NOT NULL column addition will fail fast
-- rather than adopt rows into an arbitrary organization.

-- ---------------------------------------------------------------------------
-- Organizations (one per franchise / business entity)
-- ---------------------------------------------------------------------------
create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  owner_id uuid not null references auth.users(id) on delete restrict,
  origin text check (char_length(origin) between 1 and 255),
  status text not null default 'active' check (status in ('active','suspended','closed')),
  default_language text not null default 'en' check (default_language in ('en','es')),
  created_at timestamptz not null default now()
);
create index if not exists organizations_origin_idx on public.organizations(origin) where origin is not null;
alter table public.organizations enable row level security;
revoke all on public.organizations from anon, authenticated, service_role;
grant select on public.organizations to authenticated;
grant insert, update, delete on public.organizations to service_role;

-- The "Users see their organizations" policy is created further down, after
-- owner_memberships.organization_id exists; policy expressions are validated
-- at creation time.

-- ---------------------------------------------------------------------------
-- Organization-scoped owner memberships (replaces the single-business table)
-- ---------------------------------------------------------------------------
drop policy if exists "Owners can see their own membership" on public.owner_memberships;
-- PostgreSQL has no ADD PRIMARY KEY IF NOT EXISTS. Drop whatever primary key exists
-- (the original single-column key on first run, the composite key on a re-run) and
-- then add the composite key. Fails loudly if the columns/reference are missing.
do $$
declare existing_pkey text;
begin
  select conname into existing_pkey
    from pg_constraint
   where conrelid = 'public.owner_memberships'::regclass and contype = 'p';
  if existing_pkey is not null then
    execute format('alter table public.owner_memberships drop constraint %I', existing_pkey);
  end if;
end $$;
alter table public.owner_memberships add column if not exists organization_id uuid not null references public.organizations(id) on delete restrict;
alter table public.owner_memberships add primary key (user_id, organization_id);
alter table public.owner_memberships add column if not exists role text not null default 'owner' check (role in ('owner','manager'));
alter table public.owner_memberships alter column created_at drop default;
alter table public.owner_memberships alter column created_at set default now();

-- Every authenticated user can see organizations they own or belong to.
-- (Policy expressions are validated at creation time, so this must come after
-- owner_memberships.organization_id exists.)
drop policy if exists "Users see their organizations" on public.organizations;
create policy "Users see their organizations" on public.organizations for select to authenticated
  using (owner_id = (select auth.uid()) or
         exists (select 1 from public.owner_memberships m
                 where m.user_id = (select auth.uid()) and m.organization_id = public.organizations.id));

-- Owner memberships: replace the pre-multi-franchise permissive policy with one
-- that still honors the emergency stop and membership suspension. Permissive
-- policies are OR'd, so leaving both in place would defeat the stop.
drop policy if exists "Owner members see own row" on public.owner_memberships;
drop policy if exists "Active owners see own membership" on public.owner_memberships;
create policy "Active owners see own membership" on public.owner_memberships for select to authenticated
  using (user_id = (select auth.uid()) and (select public.is_business_owner()));
drop policy if exists "Owner members write via service role" on public.owner_memberships;
create policy "Owner members write via service role" on public.owner_memberships for all to service_role using (true);

-- Resolve to the existing zero-argument is_business_owner(). A second overload
-- (is_business_owner(uuid)) was removed deliberately: with a default parameter it
-- made every zero-argument call ambiguous (42725), and it would NOT have honored the
-- emergency stop in owner_access_control. One function, one enforcement point.
-- Organization membership + active flag + suspended-franchise lockout + emergency stop.
create or replace function public.is_business_owner() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.owner_memberships m
    join public.organizations o on o.id = m.organization_id
    join public.owner_access_control c on c.singleton and c.enabled
    where m.user_id = (select auth.uid())
      and m.active
      and o.status = 'active'
  );
$$;
revoke all on function public.is_business_owner() from public, anon, service_role;
grant execute on function public.is_business_owner() to authenticated;

-- Convenience: the organization an OWNER acts in, gated by the same controls as
-- is_business_owner(). Returns NULL when the emergency stop is engaged, the
-- membership is inactive or the organization is suspended/closed. Owners only:
-- employees resolve their organization from employee_memberships instead.
create or replace function public.current_organization_id()
returns uuid
language sql stable security definer set search_path = ''
as $$
  select m.organization_id
  from public.owner_memberships m
  join public.organizations o on o.id = m.organization_id
  join public.owner_access_control c on c.singleton and c.enabled
  where m.user_id = (select auth.uid())
    and m.active
    and o.status = 'active'
  order by m.created_at, m.organization_id
  limit 1;
$$;
revoke all on function public.current_organization_id() from public, anon;
grant execute on function public.current_organization_id() to authenticated;

-- Membership-set authorization: true when the caller is an active owner of the given,
-- non-suspended franchise and the emergency stop is disengaged. RLS policies use this
-- instead of current_organization_id() so a franchise owner who selects one franchise
-- in the UI cannot be shown — or blocked from — rows in another franchise they own.
create or replace function public.owns_organization(p_organization_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.owner_memberships m
    join public.organizations o on o.id = m.organization_id and o.status = 'active'
    join public.owner_access_control c on c.singleton and c.enabled
    where m.user_id = (select auth.uid())
      and m.active
      and m.organization_id = p_organization_id
  );
$$;
revoke all on function public.owns_organization(uuid) from public, anon;
grant execute on function public.owns_organization(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Applicants -> add organization_id
-- ---------------------------------------------------------------------------
alter table public.applicants add column if not exists organization_id uuid not null references public.organizations(id) on delete restrict;
create index if not exists applicants_organization_created_idx on public.applicants(organization_id, created_at desc);

-- Replaces the single-business owner-read policy.
drop policy if exists "Owner reads applicants" on public.applicants;
drop policy if exists "Owner updates applicants" on public.applicants;
drop policy if exists "Owners read own org applicants" on public.applicants;
create policy "Owners read own org applicants" on public.applicants for select to authenticated
  using ((select public.owns_organization(organization_id)));
drop policy if exists "Owners update own org applicants" on public.applicants;
create policy "Owners update own org applicants" on public.applicants for update to authenticated
  using ((select public.owns_organization(organization_id)))
  with check ((select public.owns_organization(organization_id)));
grant update (status, school_cleared, hospital_cleared) on public.applicants to authenticated;

-- ---------------------------------------------------------------------------
-- Leads -> add organization_id
-- ---------------------------------------------------------------------------
alter table public.leads add column if not exists organization_id uuid not null references public.organizations(id) on delete restrict;
create index if not exists leads_organization_created_idx on public.leads(organization_id, created_at desc);

drop policy if exists "Owner reads leads" on public.leads;
drop policy if exists "Owner updates leads" on public.leads;
drop policy if exists "Owners read own org leads" on public.leads;
create policy "Owners read own org leads" on public.leads for select to authenticated
  using ((select public.owns_organization(organization_id)));
drop policy if exists "Owners update own org leads" on public.leads;
create policy "Owners update own org leads" on public.leads for update to authenticated
  using ((select public.owns_organization(organization_id)))
  with check ((select public.owns_organization(organization_id)));
grant update (status) on public.leads to authenticated;

-- ---------------------------------------------------------------------------
-- Audit log -> add organization_id
-- ---------------------------------------------------------------------------
-- organization_id is NULLABLE on audit_log: global (non-franchise) administrative events,
-- such as the emergency-stop toggle, legitimately have no organization. Owner-facing
-- policies filter organization_id = current_organization_id(), so NULL-org (global) rows
-- stay invisible to franchise owners. Tenant-scoped triggers populate the column.
alter table public.audit_log add column if not exists organization_id uuid references public.organizations(id) on delete restrict;
create index if not exists audit_log_organization_created_idx on public.audit_log(organization_id, created_at desc);

drop policy if exists "Owner reads audit log" on public.audit_log;
drop policy if exists "Owners read own org audit log" on public.audit_log;
create policy "Owners read own org audit log" on public.audit_log for select to authenticated
  using ((select public.owns_organization(organization_id)));

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
-- ---------------------------------------------------------------------------
-- NOTE on employee_memberships keys: the single-user primary key on
-- employee_memberships(user_id) is RETAINED. referral_invitations and
-- referral_attributions reference employee_memberships(user_id); Postgres cannot
-- drop a unique constraint that an FK depends on, and one employee per franchise
-- membership is the supported shape today. Multi-franchise employees require
-- re-pointing those FKs to (user_id, organization_id) in the same migration that
-- replaces the key; do not half-apply that change.
-- ---------------------------------------------------------------------------
alter table public.employee_memberships add column if not exists organization_id uuid not null references public.organizations(id) on delete restrict;
create index if not exists employee_memberships_organization_idx on public.employee_memberships(organization_id);

drop policy if exists "Employee sees own membership" on public.employee_memberships;
-- Employees read their own membership rows (they are the subject). They do not
-- carry an owner_memberships row, so scoping this by current_organization_id()
-- (an owner concept) would lock every employee out of their own record.
drop policy if exists "Employees see own membership" on public.employee_memberships;
create policy "Employees see own membership" on public.employee_memberships for select to authenticated
  using (user_id = (select auth.uid()));
grant select (user_id, active, created_at, organization_id) on public.employee_memberships to authenticated;

-- ---------------------------------------------------------------------------
-- Referral invitations -> add organization_id
-- ---------------------------------------------------------------------------
alter table public.referral_invitations add column if not exists organization_id uuid not null references public.organizations(id) on delete restrict;
create index if not exists referral_invitations_organization_created_idx on public.referral_invitations(organization_id, created_at desc);

-- Owners read invitations for their org; service role writes.
drop policy if exists "Owner reads referral invitations" on public.referral_invitations;
drop policy if exists "Owners read own org invitations" on public.referral_invitations;
create policy "Owners read own org invitations" on public.referral_invitations for select to authenticated
  using ((select public.owns_organization(organization_id)));

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
drop policy if exists "Owners read own org attributions" on public.referral_attributions;
grant select (application_id, invitation_id, employee_id, attributed_at, organization_id) on public.referral_attributions to authenticated;
create policy "Owners read own org attributions" on public.referral_attributions for select to authenticated
  using ((select public.owns_organization(organization_id)));

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
  if invite.used_at is not null or invite.revoked_at is not null or invite.expires_at <= now() then return 'invalid'; end if;
  insert into public.applicants(request_id, request_hash, organization_id, first_name, phone, area, shifts, transportation, languages, referrer, sms_consent, sms_consent_version, form_language, consented_at, experience_level, commercial_experience, residential_experience, equipment_experience, training_willingness)
    values (rid, p_row->>'request_hash', p_organization_id, p_row->>'first_name', p_row->>'phone', p_row->>'area',
      array(select jsonb_array_elements_text(p_row->'shifts')), (p_row->>'transportation')::boolean,
      array(select jsonb_array_elements_text(p_row->'languages')), p_row->>'referrer',
      (p_row->>'sms_consent')::boolean, p_row->>'sms_consent_version', p_row->>'form_language', nullif(p_row->>'consented_at','')::timestamptz,
      p_row->>'experience_level', p_row->>'commercial_experience', p_row->>'residential_experience', p_row->>'equipment_experience', p_row->>'training_willingness')
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
-- Re-grant with the new column; column-level grants from the base migration otherwise
-- exclude organization_id and owner reads through the session would fail outright.
grant select (id, applicant_id, status, attempts, last_error, created_at, sent_at, organization_id) on public.application_notifications to authenticated;

-- ---------------------------------------------------------------------------
-- Assistant tables.
-- The assistant subsystems are NOT multi-franchise scoped yet: assistant_settings is a
-- single-row owner workspace table and assistant_runs is the quota ledger. They were
-- incorrectly referenced here as assistant_usage / assistant_quota_settings, which do not
-- exist. Do not add organization_id to them until the read/write paths actually use it;
-- a nullable column nobody reads is false comfort, not tenant isolation.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Backfill is REQUIRED BEFORE this migration can run on a populated database.
-- The organization_id columns above are NOT NULL with no default: on a table that
-- already has rows the ADD COLUMN statements fail fast, by design, rather than
-- silently adopting rows into an arbitrary franchise. The correct order for a
-- populated project is:
--   1. Apply all migrations BEFORE 20261121030000_organizations_multi_franchise.sql.
--   2. Create the first organization row (id, name, slug, owner_id, origin, status).
--   3. Run this file's ADD COLUMN statements as nullable (edit them, or apply the
--      column adds manually), backfill every scoped table to that organization id,
--      then SET NOT NULL and re-apply the remaining statements.
--   4. Verify zero NULL organization_id values, then run the RLS/negative tests.
-- Assistant tables are intentionally not organization-scoped yet (see above).
-- ---------------------------------------------------------------------------
