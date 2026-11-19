-- Assistant configuration is accessed through server-only service-role RPCs.
-- Browser roles cannot read settings or encrypted provider secrets directly.
create table public.assistant_settings (
  id boolean primary key default true check (id),
  settings jsonb not null,
  version integer not null default 1 check (version > 0),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

create table public.assistant_secrets (
  name text primary key check (name in ('anthropic', 'custom')),
  ciphertext text not null,
  last4 text,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

create table public.assistant_settings_audit (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id),
  action text not null check (action in ('settings_saved', 'secret_set', 'secret_cleared')),
  changed_keys text[] not null default '{}',
  secret_name text check (secret_name is null or secret_name in ('anthropic', 'custom')),
  created_at timestamptz not null default now()
);

alter table public.assistant_settings enable row level security;
alter table public.assistant_secrets enable row level security;
alter table public.assistant_settings_audit enable row level security;
revoke all on public.assistant_settings, public.assistant_secrets, public.assistant_settings_audit
  from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.assistant_settings, public.assistant_secrets,
  public.assistant_settings_audit to service_role;
grant usage, select on sequence public.assistant_settings_audit_id_seq to service_role;

create or replace function public.assistant_settings_actor_exists(p_owner_id uuid)
returns boolean language sql security definer set search_path = '' as $$
  select p_owner_id is not null and exists (
    select 1 from public.owner_memberships where user_id = p_owner_id
  );
$$;
revoke all on function public.assistant_settings_actor_exists(uuid) from public, anon, authenticated;
grant execute on function public.assistant_settings_actor_exists(uuid) to service_role;

create or replace function public.get_assistant_settings(p_owner_id uuid)
returns table(settings jsonb, version integer)
language plpgsql security definer set search_path = '' as $$
begin
  if not public.assistant_settings_actor_exists(p_owner_id) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return query select s.settings, s.version from public.assistant_settings s where s.id = true;
end;
$$;
revoke all on function public.get_assistant_settings(uuid) from public, anon, authenticated;
grant execute on function public.get_assistant_settings(uuid) to service_role;

create or replace function public.save_assistant_settings(
  p_owner_id uuid, p_settings jsonb, p_expected_version integer
)
returns table(result text, version integer)
language plpgsql security definer set search_path = '' as $$
declare
  current_version integer;
  next_version integer;
  valid boolean;
  changed text[];
begin
  if not public.assistant_settings_actor_exists(p_owner_id) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_expected_version is null or p_expected_version < 0 then
    return query select 'invalid'::text, coalesce((select s.version from public.assistant_settings s where s.id = true), 0);
    return;
  end if;

  valid := jsonb_typeof(p_settings) = 'object'
    and p_settings->>'version' = '1'
    and jsonb_typeof(p_settings->'enabled') = 'boolean'
    and jsonb_typeof(p_settings->'persona') = 'object'
    and jsonb_typeof(p_settings->'voice') = 'object'
    and jsonb_typeof(p_settings->'capabilities') = 'object'
    and jsonb_typeof(p_settings->'provider') = 'object'
    and jsonb_typeof(p_settings->'limits') = 'object'
    and jsonb_typeof(p_settings->'limits'->'perMinute') = 'number'
    and (p_settings->'limits'->>'perMinute') ~ '^[0-9]+$'
    and (p_settings->'limits'->>'perMinute')::integer between 1 and 10
    and jsonb_typeof(p_settings->'limits'->'perMonth') = 'number'
    and (p_settings->'limits'->>'perMonth') ~ '^[0-9]+$'
    and (p_settings->'limits'->>'perMonth')::integer between 1 and 1000
    and jsonb_typeof(p_settings->'limits'->'maxOutputTokens') = 'number'
    and (p_settings->'limits'->>'maxOutputTokens') ~ '^[0-9]+$'
    and (p_settings->'limits'->>'maxOutputTokens')::integer between 50 and 800
    and jsonb_typeof(p_settings->'limits'->'temperature') = 'number'
    and (p_settings->'limits'->>'temperature')::numeric between 0 and 1
    and jsonb_typeof(p_settings->'provider'->'customBaseUrl') = 'string'
    and (p_settings->'provider'->>'customBaseUrl' = ''
      or p_settings->'provider'->>'customBaseUrl' like 'https://%');

  if not coalesce(valid, false) then
    return query select 'invalid'::text, coalesce((select s.version from public.assistant_settings s where s.id = true), 0);
    return;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(1832711046);
  select s.version into current_version from public.assistant_settings s where s.id = true for update;
  if current_version is null then
    if p_expected_version <> 0 then
      return query select 'conflict'::text, 0;
      return;
    end if;
    insert into public.assistant_settings(id, settings, version, updated_by)
      values (true, p_settings, 1, p_owner_id);
    next_version := 1;
    changed := array['enabled', 'persona', 'voice', 'capabilities', 'provider', 'limits'];
  else
    if p_expected_version <> current_version then
      return query select 'conflict'::text, current_version;
      return;
    end if;
    next_version := current_version + 1;
    select coalesce(array_agg(key order by key), '{}') into changed
      from jsonb_object_keys(coalesce((select settings from public.assistant_settings where id = true), '{}'::jsonb)
        || p_settings) as key
      where (select settings->key from public.assistant_settings where id = true)
        is distinct from p_settings->key;
    update public.assistant_settings
      set settings = p_settings, version = next_version, updated_by = p_owner_id, updated_at = now()
      where id = true;
  end if;

  insert into public.assistant_settings_audit(actor_id, action, changed_keys)
    values (p_owner_id, 'settings_saved', coalesce(changed, '{}'));
  return query select 'ok'::text, next_version;
end;
$$;
revoke all on function public.save_assistant_settings(uuid, jsonb, integer) from public, anon, authenticated;
grant execute on function public.save_assistant_settings(uuid, jsonb, integer) to service_role;

create or replace function public.get_assistant_secret(p_owner_id uuid, p_name text)
returns table(ciphertext text, last4 text)
language plpgsql security definer set search_path = '' as $$
begin
  if not public.assistant_settings_actor_exists(p_owner_id) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_name not in ('anthropic', 'custom') then return; end if;
  return query select s.ciphertext, s.last4 from public.assistant_secrets s where s.name = p_name;
end;
$$;
revoke all on function public.get_assistant_secret(uuid, text) from public, anon, authenticated;
grant execute on function public.get_assistant_secret(uuid, text) to service_role;

create or replace function public.set_assistant_secret(
  p_owner_id uuid, p_name text, p_ciphertext text, p_last4 text
)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not public.assistant_settings_actor_exists(p_owner_id) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_name not in ('anthropic', 'custom') or p_ciphertext !~ '^v1:[A-Za-z0-9+/]+=*:[A-Za-z0-9+/]+=*:[A-Za-z0-9+/]+=*$'
    or p_last4 is not null and length(p_last4) <> 4 then return false; end if;
  insert into public.assistant_secrets(name, ciphertext, last4, updated_by, updated_at)
    values (p_name, p_ciphertext, p_last4, p_owner_id, now())
  on conflict (name) do update set ciphertext = excluded.ciphertext,
    last4 = excluded.last4, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  insert into public.assistant_settings_audit(actor_id, action, secret_name)
    values (p_owner_id, 'secret_set', p_name);
  return true;
end;
$$;
revoke all on function public.set_assistant_secret(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.set_assistant_secret(uuid, text, text, text) to service_role;

create or replace function public.clear_assistant_secret(p_owner_id uuid, p_name text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare affected integer;
begin
  if not public.assistant_settings_actor_exists(p_owner_id) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_name not in ('anthropic', 'custom') then return false; end if;
  delete from public.assistant_secrets where name = p_name;
  get diagnostics affected = row_count;
  if affected = 1 then
    insert into public.assistant_settings_audit(actor_id, action, secret_name)
      values (p_owner_id, 'secret_cleared', p_name);
  end if;
  return affected = 1;
end;
$$;
revoke all on function public.clear_assistant_secret(uuid, text) from public, anon, authenticated;
grant execute on function public.clear_assistant_secret(uuid, text) to service_role;

-- Initial settings limits are defaults; the next migration removes caller-supplied quota limits.
drop function if exists public.begin_assistant_run();
create or replace function public.begin_assistant_run(p_per_minute integer default 3, p_per_month integer default 100)
returns table(run_id uuid, result text) language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  created_id uuid;
  minute_limit integer := greatest(1, least(coalesce(p_per_minute, 3), 10));
  month_limit integer := greatest(1, least(coalesce(p_per_month, 100), 1000));
begin
  if uid is null or not public.is_business_owner() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(1832711045);
  if (select count(*) from public.assistant_runs where created_at >= date_trunc('month', now() at time zone 'UTC') at time zone 'UTC') >= month_limit then
    return query select null::uuid, 'monthly_limit'::text; return;
  end if;
  if (select count(*) from public.assistant_runs where created_at >= now() - interval '1 minute') >= minute_limit then
    return query select null::uuid, 'rate_limit'::text; return;
  end if;
  insert into public.assistant_runs(owner_id) values (uid) returning id into created_id;
  return query select created_id, 'ok'::text;
end;
$$;
revoke all on function public.begin_assistant_run(integer, integer) from public, anon, authenticated;
grant execute on function public.begin_assistant_run(integer, integer) to authenticated;
