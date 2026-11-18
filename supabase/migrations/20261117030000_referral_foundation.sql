-- Experimental single-business referral foundation. Apply only to an approved test project.
-- Auth users must be manually enrolled by a trusted administrator; this is not onboarding.
create table public.employee_memberships (
  user_id uuid primary key references auth.users(id) on delete restrict,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.employee_memberships enable row level security;
revoke all on public.employee_memberships from public, anon, authenticated;
grant select (user_id, active, created_at) on public.employee_memberships to authenticated;
create policy "Employee sees own membership" on public.employee_memberships for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_business_owner()));

create table public.referral_invitations (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employee_memberships(user_id) on delete restrict,
  code_hash text not null unique check (code_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  check (expires_at > created_at)
);
create index referral_invitations_employee_created_idx on public.referral_invitations(employee_id, created_at desc);
create table public.referral_attributions (
  application_id uuid primary key references public.applicants(id) on delete restrict,
  invitation_id uuid not null unique references public.referral_invitations(id) on delete restrict,
  employee_id uuid not null references public.employee_memberships(user_id) on delete restrict,
  attributed_at timestamptz not null default now()
);
alter table public.referral_invitations enable row level security;
alter table public.referral_attributions enable row level security;
revoke all on public.referral_invitations, public.referral_attributions from public, anon, authenticated, service_role;
-- Owners can inspect attribution, not bearer-code hashes. Employees see aggregate counts only.
grant select (application_id, invitation_id, employee_id, attributed_at) on public.referral_attributions to authenticated;
create policy "Owner reads referral attribution" on public.referral_attributions for select to authenticated using ((select public.is_business_owner()));

-- Codes are random and generated server-side; only a hash is stored. Limit invitation creation.
create function public.create_employee_invitation(p_employee_id uuid, p_hash text) returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare uid uuid := p_employee_id; expiration timestamptz := now() + interval '7 days';
begin
  if uid is null or p_hash is null or p_hash !~ '^[0-9a-f]{64}$' then return null; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(uid::text, 19231));
  if not exists (select 1 from public.employee_memberships where user_id=uid and active) then return null; end if;
  if (select count(*) from public.referral_invitations where employee_id=uid and created_at > now() - interval '1 day') >= 10 then return null; end if;
  insert into public.referral_invitations(employee_id, code_hash, expires_at) values (uid, p_hash, expiration);
  return expiration;
end; $$;
revoke all on function public.create_employee_invitation(uuid, text) from public, anon, authenticated;
grant execute on function public.create_employee_invitation(uuid, text) to service_role;

create function public.employee_referral_totals() returns table(created bigint, submitted bigint)
language sql stable security definer set search_path = '' as $$
  select count(*), count(*) filter (where i.used_at is not null)
  from public.referral_invitations i
  where i.employee_id = (select auth.uid()) and exists
    (select 1 from public.employee_memberships m where m.user_id=(select auth.uid()) and m.active);
$$;
revoke all on function public.employee_referral_totals() from public, anon, service_role;
grant execute on function public.employee_referral_totals() to authenticated;

-- Only the validated, Turnstile-protected server may call this. All attribution and the
-- existing notification trigger commit atomically with the application. One invite, one use.
create function public.submit_referred_application(p_row jsonb, p_code_hash text) returns text
language plpgsql security definer set search_path = '' as $$
declare invite public.referral_invitations%rowtype; app_id uuid; old_hash text;
  rid uuid := (p_row->>'request_id')::uuid;
begin
  if p_code_hash is null or p_code_hash !~ '^[0-9a-f]{64}$' then return 'invalid'; end if;
  select request_hash into old_hash from public.applicants where request_id=rid;
  if found then
    if old_hash = p_row->>'request_hash' then return 'duplicate'; else return 'conflict'; end if;
  end if;
  select i.* into invite from public.referral_invitations i
    join public.employee_memberships m on m.user_id=i.employee_id and m.active
    where i.code_hash=p_code_hash for update of i;
  if not found then return 'invalid'; end if;
  -- Another retry may have committed while this transaction waited on the invite lock.
  select request_hash into old_hash from public.applicants where request_id=rid;
  if found then
    if old_hash = p_row->>'request_hash' then return 'duplicate'; else return 'conflict'; end if;
  end if;
  if invite.used_at is not null or invite.expires_at <= now() then return 'invalid'; end if;
  insert into public.applicants(request_id,request_hash,first_name,phone,area,shifts,transportation,languages,referrer,sms_consent,sms_consent_version,form_language,consented_at)
  values (rid,p_row->>'request_hash',p_row->>'first_name',p_row->>'phone',p_row->>'area',
    array(select jsonb_array_elements_text(p_row->'shifts')), (p_row->>'transportation')::boolean,
    array(select jsonb_array_elements_text(p_row->'languages')),p_row->>'referrer',
    (p_row->>'sms_consent')::boolean,p_row->>'sms_consent_version',p_row->>'form_language',nullif(p_row->>'consented_at','')::timestamptz)
  on conflict (request_id) do nothing returning id into app_id;
  if app_id is null then
    select request_hash into old_hash from public.applicants where request_id=rid;
    if old_hash=p_row->>'request_hash' then return 'duplicate'; else return 'conflict'; end if;
  end if;
  update public.referral_invitations set used_at=now() where id=invite.id;
  insert into public.referral_attributions(application_id,invitation_id,employee_id) values (app_id,invite.id,invite.employee_id);
  insert into public.audit_log(actor_id,entity_type,entity_id,action,details)
    values (null,'applicant',app_id,'referral_attributed',jsonb_build_object('invitation_id',invite.id,'employee_id',invite.employee_id));
  return 'inserted';
end; $$;
revoke all on function public.submit_referred_application(jsonb, text) from public, anon, authenticated;
grant execute on function public.submit_referred_application(jsonb, text) to service_role;
