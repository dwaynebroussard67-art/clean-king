-- Single-business intake foundation. Run only on a dedicated, approved project.
-- No anonymous table access: public submissions enter through the server after validation and bot verification.
create extension if not exists pgcrypto;

create table public.owner_memberships (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.owner_memberships enable row level security;
revoke all on public.owner_memberships from anon, authenticated;
grant select on public.owner_memberships to authenticated;
create policy "Owners can see their own membership" on public.owner_memberships for select to authenticated using (user_id = (select auth.uid()));

create or replace function public.is_business_owner() returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.owner_memberships where user_id = (select auth.uid())); $$;
revoke all on function public.is_business_owner() from public, anon;
grant execute on function public.is_business_owner() to authenticated;

create table public.applicants (
  id uuid primary key default gen_random_uuid(), request_id uuid not null unique, request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  first_name text not null check (char_length(first_name) between 1 and 80),
  phone text not null check (char_length(phone) between 10 and 25),
  area text not null check (char_length(area) between 1 and 100),
  shifts text[] not null check (cardinality(shifts) between 1 and 3 and shifts <@ array['days','nights','weekends']::text[]),
  transportation boolean not null,
  languages text[] not null check (cardinality(languages) between 1 and 2 and languages <@ array['en','es']::text[]),
  referrer text check (char_length(referrer) <= 100),
  sms_consent boolean not null, sms_consent_version text not null, form_language text not null check (form_language in ('en','es')),
  consented_at timestamptz,
  check ((sms_consent and consented_at is not null) or (not sms_consent and consented_at is null)),
  status text not null default 'new' check (status in ('new','later','screening','hired','passed')),
  school_cleared boolean not null default false, hospital_cleared boolean not null default false,
  created_at timestamptz not null default now()
);
create index applicants_created_at_idx on public.applicants (created_at desc);

create table public.leads (
  id uuid primary key default gen_random_uuid(), request_id uuid not null unique, request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  building_type text not null check (building_type in ('school','clinic','hospital','office','other')),
  size text not null check (char_length(size) between 1 and 80),
  frequency text not null check (frequency in ('daily','weekly','custom','unsure')),
  contact_name text not null check (char_length(contact_name) between 1 and 100),
  phone text not null check (char_length(phone) between 10 and 25),
  email text not null check (char_length(email) between 3 and 254),
  status text not null default 'new' check (status in ('new','contacted','closed')),
  created_at timestamptz not null default now()
);
create index leads_created_at_idx on public.leads (created_at desc);

create table public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id) on delete set null,
  entity_type text not null, entity_id uuid not null, action text not null,
  details jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
create index audit_log_created_at_idx on public.audit_log (created_at desc);

alter table public.applicants enable row level security;
alter table public.leads enable row level security;
alter table public.audit_log enable row level security;
revoke all on public.applicants, public.leads, public.audit_log from anon, authenticated;
grant select on public.applicants, public.leads, public.audit_log to authenticated;
grant insert on public.applicants, public.leads to service_role;
grant select (request_id, request_hash) on public.applicants, public.leads to service_role;
grant update (status, school_cleared, hospital_cleared) on public.applicants to authenticated;
grant update (status) on public.leads to authenticated;
create policy "Owner reads applicants" on public.applicants for select to authenticated using ((select public.is_business_owner()));
create policy "Owner updates applicants" on public.applicants for update to authenticated using ((select public.is_business_owner())) with check ((select public.is_business_owner()));
create policy "Owner reads leads" on public.leads for select to authenticated using ((select public.is_business_owner()));
create policy "Owner updates leads" on public.leads for update to authenticated using ((select public.is_business_owner())) with check ((select public.is_business_owner()));
create policy "Owner reads audit log" on public.audit_log for select to authenticated using ((select public.is_business_owner()));

-- Only status/clearance changes are recorded; no application or contact contents are copied into logs.
create or replace function public.audit_intake_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'applicants' then
    if (old.status, old.school_cleared, old.hospital_cleared) is distinct from (new.status, new.school_cleared, new.hospital_cleared) then
      insert into public.audit_log(actor_id, entity_type, entity_id, action, details)
      values ((select auth.uid()), 'applicant', new.id, 'updated', jsonb_build_object('old_status', old.status, 'new_status', new.status, 'old_school_cleared', old.school_cleared, 'new_school_cleared', new.school_cleared, 'old_hospital_cleared', old.hospital_cleared, 'new_hospital_cleared', new.hospital_cleared));
    end if;
  elsif old.status is distinct from new.status then
    insert into public.audit_log(actor_id, entity_type, entity_id, action, details)
    values ((select auth.uid()), 'lead', new.id, 'updated', jsonb_build_object('old_status', old.status, 'new_status', new.status));
  end if;
  return new;
end; $$;
revoke all on function public.audit_intake_change() from public, anon, authenticated;
create trigger audit_applicant_change after update on public.applicants for each row execute function public.audit_intake_change();
create trigger audit_lead_change after update on public.leads for each row execute function public.audit_intake_change();
