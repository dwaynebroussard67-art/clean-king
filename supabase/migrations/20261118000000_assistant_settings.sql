-- One assistant configuration per workspace. No direct client access to settings or secret boxes.
create table public.assistant_settings (
  id boolean primary key default true check (id),
  settings jsonb not null,
  version int not null default 1 check (version >= 1),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table public.assistant_secrets (
  name text primary key check (name in ('anthropic', 'custom')),
  ciphertext text not null,
  last4 text check (last4 is null or char_length(last4) = 4),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- The intake audit is keyed by entity UUID; these records use a singleton and provider names.
create table public.assistant_settings_audit (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null check (action in ('settings_saved', 'secret_set', 'secret_cleared')),
  changed_keys text[] not null default '{}' check (
    changed_keys <@ array['version', 'enabled', 'persona', 'voice', 'capabilities', 'provider', 'limits']::text[]
  ),
  secret_name text check (secret_name in ('anthropic', 'custom')),
  created_at timestamptz not null default now(),
  check (
    (action = 'settings_saved' and secret_name is null) or
    (action <> 'settings_saved' and secret_name is not null and cardinality(changed_keys) = 0)
  )
);

alter table public.assistant_settings enable row level security;
alter table public.assistant_secrets enable row level security;
alter table public.assistant_settings_audit enable row level security;
revoke all on table public.assistant_settings, public.assistant_secrets, public.assistant_settings_audit
  from public, anon, authenticated, service_role;
revoke all on sequence public.assistant_settings_audit_id_seq
  from public, anon, authenticated, service_role;
grant select on public.assistant_settings_audit to authenticated;
create policy "Owners read assistant settings audit" on public.assistant_settings_audit
  for select to authenticated using ((select public.is_business_owner()));

create function public.get_assistant_settings()
returns table(settings jsonb, version int)
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or not public.is_business_owner() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return query select s.settings, s.version from public.assistant_settings s where s.id;
end;
$$;

create function public.save_assistant_settings(p_settings jsonb, p_expected_version int)
returns table(result text, version int)
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  previous_settings jsonb;
  current_version int;
  persona jsonb := p_settings -> 'persona';
  voice jsonb := p_settings -> 'voice';
  capabilities jsonb := p_settings -> 'capabilities';
  provider jsonb := p_settings -> 'provider';
  limits jsonb := p_settings -> 'limits';
begin
  if uid is null or not public.is_business_owner() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  -- Serialize saves even before the singleton exists. Separate from the run-admission lock.
  perform pg_catalog.pg_advisory_xact_lock(1832711046);
  select s.settings, s.version into previous_settings, current_version
    from public.assistant_settings s where s.id;
  current_version := coalesce(current_version, 0);
  if p_expected_version is distinct from current_version then
    return query select 'conflict'::text, current_version;
    return;
  end if;

  -- Sanity-check direct RPC writes. The application schema handles Unicode names and URL syntax.
  if exists (
    select 1 from (values
      (p_settings, array['version', 'enabled', 'persona', 'voice', 'capabilities', 'provider', 'limits']),
      (persona, array['name', 'ownerName', 'tone', 'emoji', 'length']),
      (voice, array['speakReplies', 'rate', 'pitch', 'voiceName']),
      (capabilities, array['counts', 'emailHealth']),
      (provider, array['active', 'anthropicModel', 'customBaseUrl', 'customModel', 'fallbackToCustom']),
      (limits, array['perMinute', 'perMonth', 'maxOutputTokens', 'temperature'])
    ) as section(payload, required_keys)
    where case when jsonb_typeof(section.payload) = 'object' then
      not (section.payload ?& section.required_keys) or
      (section.payload - section.required_keys) <> '{}'::jsonb
    else true end
  ) or (
    p_settings -> 'version' = '1'::jsonb
    and jsonb_typeof(p_settings -> 'enabled') = 'boolean'
    and jsonb_typeof(persona -> 'name') = 'string'
    and char_length(persona ->> 'name') between 1 and 40
    and jsonb_typeof(persona -> 'ownerName') = 'string'
    and char_length(persona ->> 'ownerName') between 1 and 60
    and persona ->> 'tone' in ('bubbly', 'friendly', 'professional', 'concise')
    and persona ->> 'emoji' in ('none', 'light', 'lots')
    and persona ->> 'length' in ('short', 'normal', 'detailed')
    and jsonb_typeof(voice -> 'speakReplies') = 'boolean'
    and (voice -> 'voiceName' = 'null'::jsonb or (
      jsonb_typeof(voice -> 'voiceName') = 'string' and char_length(voice ->> 'voiceName') <= 100
    ))
    and jsonb_typeof(capabilities -> 'counts') = 'boolean'
    and jsonb_typeof(capabilities -> 'emailHealth') = 'boolean'
    and provider ->> 'active' in ('anthropic', 'custom')
    and jsonb_typeof(provider -> 'anthropicModel') = 'string'
    and (provider ->> 'anthropicModel') collate "C" ~ '^[A-Za-z0-9._:/-]{1,100}$'
    and jsonb_typeof(provider -> 'customModel') = 'string'
    and (provider ->> 'customModel' = '' or (provider ->> 'customModel') collate "C" ~ '^[A-Za-z0-9._:/-]{1,100}$')
    and jsonb_typeof(provider -> 'customBaseUrl') = 'string'
    and char_length(provider ->> 'customBaseUrl') <= 200
    and (provider ->> 'customBaseUrl' = '' or provider ->> 'customBaseUrl' like 'https://%')
    and jsonb_typeof(provider -> 'fallbackToCustom') = 'boolean'
  ) is not true or exists (
    select 1 from (values
      (voice -> 'rate', 0.5, 2, false),
      (voice -> 'pitch', 0, 2, false),
      (limits -> 'perMinute', 1, 10, true),
      (limits -> 'perMonth', 1, 1000, true),
      (limits -> 'maxOutputTokens', 50, 800, true),
      (limits -> 'temperature', 0, 1, false)
    ) as bounds(payload, minimum, maximum, whole)
    where case when jsonb_typeof(bounds.payload) = 'number' then
      bounds.payload::numeric not between bounds.minimum and bounds.maximum or
      (bounds.whole and bounds.payload::numeric <> trunc(bounds.payload::numeric))
    else true end
  ) then
    return query select 'invalid'::text, current_version;
    return;
  end if;

  insert into public.assistant_settings (id, settings, version, updated_by)
    values (true, p_settings, current_version + 1, uid)
    on conflict (id) do update set
      settings = excluded.settings, version = excluded.version,
      updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  insert into public.assistant_settings_audit (actor_id, action, changed_keys)
    values (uid, 'settings_saved', array(
      select field.name from jsonb_object_keys(p_settings) as field(name)
      where (previous_settings -> field.name) is distinct from (p_settings -> field.name)
      order by field.name collate "C"
    ));
  return query select 'ok'::text, current_version + 1;
end;
$$;

create function public.get_assistant_secret(p_name text)
returns table(ciphertext text, last4 text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or not public.is_business_owner() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return query select s.ciphertext, s.last4 from public.assistant_secrets s where s.name = p_name;
end;
$$;

create function public.set_assistant_secret(p_name text, p_ciphertext text, p_last4 text)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null or not public.is_business_owner() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  -- The RPC accepts only a v1 envelope; it cannot decrypt or authenticate it.
  if p_name is null or p_name not in ('anthropic', 'custom') or p_ciphertext is null or
     p_ciphertext collate "C" !~ '^v1:[A-Za-z0-9+/]{16}:[A-Za-z0-9+/]{22}==:([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{2}==)?$' or
     (p_last4 is not null and char_length(p_last4) <> 4) then
    return false;
  end if;

  insert into public.assistant_secrets (name, ciphertext, last4, updated_by)
    values (p_name, p_ciphertext, p_last4, uid)
    on conflict (name) do update set
      ciphertext = excluded.ciphertext, last4 = excluded.last4,
      updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  insert into public.assistant_settings_audit (actor_id, action, secret_name)
    values (uid, 'secret_set', p_name);
  return true;
end;
$$;

create function public.clear_assistant_secret(p_name text)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null or not public.is_business_owner() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_name is null or p_name not in ('anthropic', 'custom') then return false; end if;

  delete from public.assistant_secrets s where s.name = p_name;
  if found then
    insert into public.assistant_settings_audit (actor_id, action, secret_name)
      values (uid, 'secret_cleared', p_name);
  end if;
  return true;
end;
$$;

-- Preserve the existing workspace-wide counting, including failed and unfinished runs.
drop function public.begin_assistant_run();
create function public.begin_assistant_run(p_per_minute int default 3, p_per_month int default 100)
returns table(run_id uuid, result text)
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  minute_limit int := greatest(1, least(coalesce(p_per_minute, 3), 10));
  month_limit int := greatest(1, least(coalesce(p_per_month, 100), 1000));
  created_id uuid;
begin
  if uid is null or not public.is_business_owner() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(1832711045);
  if (select count(*) from public.assistant_runs
      where created_at >= (date_trunc('month', now() at time zone 'UTC') at time zone 'UTC')) >= month_limit then
    return query select null::uuid, 'monthly_limit'::text;
    return;
  end if;
  if (select count(*) from public.assistant_runs where created_at >= now() - interval '1 minute') >= minute_limit then
    return query select null::uuid, 'rate_limit'::text;
    return;
  end if;
  insert into public.assistant_runs (owner_id) values (uid) returning id into created_id;
  return query select created_id, 'ok'::text;
end;
$$;

-- Also lock down grants on the existing finish RPC without replacing its implementation.
revoke all on function public.get_assistant_settings(), public.save_assistant_settings(jsonb, int),
  public.get_assistant_secret(text), public.set_assistant_secret(text, text, text), public.clear_assistant_secret(text),
  public.begin_assistant_run(int, int), public.finish_assistant_run(uuid, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.get_assistant_settings(), public.save_assistant_settings(jsonb, int),
  public.get_assistant_secret(text), public.set_assistant_secret(text, text, text), public.clear_assistant_secret(text),
  public.begin_assistant_run(int, int), public.finish_assistant_run(uuid, boolean)
  to authenticated;
