-- Allow active employees to revoke unused referral links without revealing applicant data.
-- The same invitation row lock serializes redemption and revocation.
alter table public.referral_invitations add column revoked_at timestamptz;

create function public.my_referral_invitations()
returns table(id uuid, created_at timestamptz, expires_at timestamptz, status text)
language sql stable security definer set search_path = '' as $$
  select i.id, i.created_at, i.expires_at,
    case when i.used_at is not null then 'submitted'
         when i.revoked_at is not null then 'revoked'
         when i.expires_at <= now() then 'expired' else 'active' end
  from public.referral_invitations i
  where i.employee_id = (select auth.uid()) and exists
    (select 1 from public.employee_memberships m where m.user_id=(select auth.uid()) and m.active)
  -- Keep usable links visible ahead of historical ones. The creation limit is ten/day
  -- and links expire after seven days; the hard result bound also protects the page.
  order by (i.used_at is null and i.revoked_at is null and i.expires_at > now()) desc,
    i.created_at desc, i.id desc limit 100;
$$;
revoke all on function public.my_referral_invitations() from public, anon, service_role;
grant execute on function public.my_referral_invitations() to authenticated;

create function public.revoke_my_referral_invitation(p_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); changed uuid;
begin
  if uid is null or p_id is null or not exists
    (select 1 from public.employee_memberships m where m.user_id=uid and m.active) then return false; end if;
  update public.referral_invitations i set revoked_at = now()
    where i.id=p_id and i.employee_id=uid and i.used_at is null
      and i.revoked_at is null and i.expires_at > now()
    returning i.id into changed;
  if changed is null then return false; end if;
  insert into public.audit_log(actor_id,entity_type,entity_id,action,details)
    values(uid,'referral_invitation',changed,'revoked','{}'::jsonb);
  return true;
end; $$;
revoke all on function public.revoke_my_referral_invitation(uuid) from public, anon, service_role;
grant execute on function public.revoke_my_referral_invitation(uuid) to authenticated;

create or replace function public.submit_referred_application(p_row jsonb, p_code_hash text) returns text
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
  if invite.used_at is not null or invite.revoked_at is not null or invite.expires_at <= now() then return 'invalid'; end if;
  insert into public.applicants(request_id,request_hash,first_name,phone,area,shifts,transportation,languages,referrer,sms_consent,sms_consent_version,form_language,consented_at,experience_level,commercial_experience,residential_experience,equipment_experience,training_willingness)
  values (rid,p_row->>'request_hash',p_row->>'first_name',p_row->>'phone',p_row->>'area',
    array(select jsonb_array_elements_text(p_row->'shifts')), (p_row->>'transportation')::boolean,
    array(select jsonb_array_elements_text(p_row->'languages')),p_row->>'referrer',
    (p_row->>'sms_consent')::boolean,p_row->>'sms_consent_version',p_row->>'form_language',nullif(p_row->>'consented_at','')::timestamptz,
    p_row->>'experience_level',p_row->>'commercial_experience',p_row->>'residential_experience',p_row->>'equipment_experience',p_row->>'training_willingness')
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
