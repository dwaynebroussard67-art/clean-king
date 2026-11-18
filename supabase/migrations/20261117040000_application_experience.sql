-- Optional job-related experience questions. NULL means not answered, not "no".
alter table public.applicants
  add column experience_level text check (experience_level in ('none','under_one','one_to_three','over_three')),
  add column commercial_experience text check (commercial_experience in ('yes','no')),
  add column residential_experience text check (residential_experience in ('yes','no')),
  add column equipment_experience text check (equipment_experience in ('yes','no')),
  add column training_willingness text check (training_willingness in ('yes','no','unsure'));

-- Preserve transactional invitation attribution and the existing outbox trigger.
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
  if invite.used_at is not null or invite.expires_at <= now() then return 'invalid'; end if;
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
