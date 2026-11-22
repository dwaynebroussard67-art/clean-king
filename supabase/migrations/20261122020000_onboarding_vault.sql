-- Onboarding vault: the three-tier hand-over system (see ONBOARDING_BLUEPRINT.md).
--   Tier 0/1 (public / delegated) -> onboarding_items  (ordinary rows, RLS by franchise, owner confirms)
--   Tier 2   (sensitive)          -> sensitive_items   (CIPHERTEXT ONLY, no role can SELECT the ciphertext column)
-- Requires: organizations, owner_memberships, current_organization_id() from the multi-franchise migration.
-- Apply only to a dedicated approved project. No real data until owner passkeys / step-up exist.

-- ---------------------------------------------------------------------------
-- Per-franchise wrapped data key. The key-encryption key lives in the app environment, never here.
-- ---------------------------------------------------------------------------
create table public.org_data_keys (
  organization_id uuid not null references public.organizations(id) on delete restrict,
  version integer not null default 1 check (version >= 1),
  wrapped_dek text not null check (char_length(wrapped_dek) between 40 and 400),
  kek_version integer not null check (kek_version >= 1),
  created_at timestamptz not null default now(),
  primary key (organization_id, version)
);
alter table public.org_data_keys enable row level security;
revoke all on public.org_data_keys from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Tier 0/1 items: proposed by a harvest/import, confirmed by the owner. Tier 2 is refused by CHECK.
-- ---------------------------------------------------------------------------
create table public.onboarding_items (
  organization_id uuid not null references public.organizations(id) on delete restrict,
  subject_key text not null check (subject_key ~ '^[a-z_]{3,20}(:[A-Za-z0-9_-]{1,64})?$'),
  field_key text not null check (field_key ~ '^[a-z_]{3,40}$'),
  tier smallint not null check (tier in (0, 1)),
  value jsonb not null check (pg_column_size(value) <= 4000),
  source text not null check (source in ('site_harvest', 'file_import', 'admin_entry')),
  status text not null default 'proposed' check (status in ('proposed', 'confirmed')),
  confirmed_by uuid references auth.users(id) on delete set null,
  confirmed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (organization_id, subject_key, field_key),
  check ((status = 'confirmed') = (confirmed_at is not null))
);
alter table public.onboarding_items enable row level security;
revoke all on public.onboarding_items from public, anon, authenticated, service_role;
grant select on public.onboarding_items to authenticated;
create policy "Owners read own org items" on public.onboarding_items for select to authenticated
  using (organization_id = (select public.current_organization_id()));

-- ---------------------------------------------------------------------------
-- Tier 2: ciphertext only. authenticated may read masked METADATA; nobody can select ciphertext directly.
-- ---------------------------------------------------------------------------
create table public.sensitive_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  subject_key text not null check (subject_key ~ '^[a-z_]{3,20}(:[A-Za-z0-9_-]{1,64})?$'),
  field_key text not null check (field_key ~ '^[a-z_]{3,40}$'),
  ciphertext text not null check (ciphertext ~ '^v2\.[0-9]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$' and char_length(ciphertext) <= 600),
  blind_index text check (blind_index is null or blind_index ~ '^[0-9a-f]{64}$'),
  mask text not null check (char_length(mask) <= 24),
  key_version integer not null check (key_version >= 1),
  source text not null check (source in ('owner', 'employee_link')),
  entered_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, subject_key, field_key)
);
create index sensitive_items_blind_idx on public.sensitive_items (organization_id, field_key, blind_index) where blind_index is not null;
alter table public.sensitive_items enable row level security;
revoke all on public.sensitive_items from public, anon, authenticated, service_role;
grant select (id, organization_id, subject_key, field_key, mask, source, created_at, updated_at) on public.sensitive_items to authenticated;
create policy "Owners read own org sensitive metadata" on public.sensitive_items for select to authenticated
  using (organization_id = (select public.current_organization_id()));

-- ---------------------------------------------------------------------------
-- One-time links for people to enter their OWN secrets (employee SSN, direct deposit...).
-- Only a SHA-256 of the token is stored; the link itself is the credential.
-- ---------------------------------------------------------------------------
create table public.sensitive_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  subject_key text not null check (subject_key ~ '^[a-z_]{3,20}:[A-Za-z0-9_-]{1,64}$'),
  field_keys text[] not null check (cardinality(field_keys) between 1 and 8),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.sensitive_requests enable row level security;
revoke all on public.sensitive_requests from public, anon, authenticated, service_role;
grant select (id, organization_id, subject_key, field_keys, expires_at, used_at, created_at) on public.sensitive_requests to authenticated;
create policy "Owners read own org requests" on public.sensitive_requests for select to authenticated
  using (organization_id = (select public.current_organization_id()));

-- ---------------------------------------------------------------------------
-- Append-only access log. Every store / reveal / delete / rewrap lands here, inside the same transaction.
-- ---------------------------------------------------------------------------
create table public.vault_access_log (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  actor_id uuid references auth.users(id) on delete set null,
  item_id uuid,
  action text not null check (action in ('store', 'store_via_link', 'reveal', 'delete', 'rewrap', 'request_issued')),
  detail text check (detail is null or char_length(detail) <= 200),
  created_at timestamptz not null default now()
);
alter table public.vault_access_log enable row level security;
revoke all on public.vault_access_log from public, anon, authenticated, service_role;
grant select on public.vault_access_log to authenticated;
create policy "Owners read own org vault log" on public.vault_access_log for select to authenticated
  using (organization_id = (select public.current_organization_id()));
create function public.vault_log_immutable() returns trigger language plpgsql as $$
begin raise exception 'vault_access_log is append-only'; end; $$;
create trigger vault_log_no_change before update or delete on public.vault_access_log
  for each row execute function public.vault_log_immutable();

-- ---------------------------------------------------------------------------
-- Functions. All SECURITY DEFINER with empty search_path; EXECUTE only for service_role.
-- The server authenticates the owner first and passes p_actor; each function re-checks membership.
-- ---------------------------------------------------------------------------
create function public.vault_actor_is_owner(p_org uuid, p_actor uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_org is not null and p_actor is not null and exists (
    select 1 from public.owner_memberships m where m.user_id = p_actor and m.organization_id = p_org);
$$;
revoke all on function public.vault_actor_is_owner(uuid, uuid) from public, anon, authenticated, service_role;

create function public.ensure_org_data_key(p_org uuid, p_wrapped text, p_kek_version integer)
returns table(version integer, wrapped_dek text, kek_version integer)
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.org_data_keys(organization_id, version, wrapped_dek, kek_version)
    values (p_org, 1, p_wrapped, p_kek_version) on conflict do nothing;   -- race-safe: first writer wins
  return query select k.version, k.wrapped_dek, k.kek_version from public.org_data_keys k
    where k.organization_id = p_org order by k.version desc limit 1;
end; $$;

create function public.get_org_data_key(p_org uuid)
returns table(version integer, wrapped_dek text, kek_version integer)
language sql stable security definer set search_path = '' as $$
  select k.version, k.wrapped_dek, k.kek_version from public.org_data_keys k
  where k.organization_id = p_org order by k.version desc limit 1;
$$;

create function public.rewrap_org_data_key(p_org uuid, p_actor uuid, p_version integer, p_wrapped text, p_kek_version integer) returns boolean
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if not public.vault_actor_is_owner(p_org, p_actor) and p_actor is not null then raise exception 'Not authorized' using errcode = '42501'; end if;
  update public.org_data_keys set wrapped_dek = p_wrapped, kek_version = p_kek_version where organization_id = p_org and version = p_version;
  get diagnostics n = row_count;
  if n = 1 then insert into public.vault_access_log(organization_id, actor_id, action, detail) values (p_org, p_actor, 'rewrap', 'kek_version=' || p_kek_version); end if;
  return n = 1;
end; $$;

create function public.upsert_onboarding_items(p_org uuid, p_actor uuid, p_source text, p_items jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare it jsonb; n integer := 0;
begin
  if not public.vault_actor_is_owner(p_org, p_actor) then raise exception 'Not authorized' using errcode = '42501'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 500 then raise exception 'bad items'; end if;
  for it in select * from jsonb_array_elements(p_items) loop
    insert into public.onboarding_items(organization_id, subject_key, field_key, tier, value, source)
      values (p_org, it->>'subject_key', it->>'field_key', (it->>'tier')::smallint, it->'value', p_source)
      on conflict (organization_id, subject_key, field_key) do update
        set value = excluded.value, source = excluded.source, status = 'proposed',
            confirmed_by = null, confirmed_at = null, updated_at = now()
        where public.onboarding_items.status = 'proposed' or public.onboarding_items.value is distinct from excluded.value;
    n := n + 1;
  end loop;
  return n;
end; $$;

-- Owner clicks "looks right": confirm every proposed item in their own franchise (or only the listed fields).
create function public.confirm_onboarding_items(p_field_keys text[] default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer; actor uuid := (select auth.uid()); org uuid := (select public.current_organization_id());
begin
  if actor is null or org is null or not public.vault_actor_is_owner(org, actor) then raise exception 'Not authorized' using errcode = '42501'; end if;
  update public.onboarding_items set status = 'confirmed', confirmed_by = actor, confirmed_at = now(), updated_at = now()
    where organization_id = org and status = 'proposed' and (p_field_keys is null or field_key = any(p_field_keys));
  get diagnostics n = row_count;
  return n;
end; $$;

create function public.store_sensitive_item(p_org uuid, p_actor uuid, p_subject_key text, p_field_key text,
  p_ciphertext text, p_blind text, p_mask text, p_key_version integer) returns uuid
language plpgsql security definer set search_path = '' as $$
declare item uuid;
begin
  if not public.vault_actor_is_owner(p_org, p_actor) then raise exception 'Not authorized' using errcode = '42501'; end if;
  insert into public.sensitive_items(organization_id, subject_key, field_key, ciphertext, blind_index, mask, key_version, source, entered_by)
    values (p_org, p_subject_key, p_field_key, p_ciphertext, p_blind, p_mask, p_key_version, 'owner', p_actor)
    on conflict (organization_id, subject_key, field_key) do update
      set ciphertext = excluded.ciphertext, blind_index = excluded.blind_index, mask = excluded.mask,
          key_version = excluded.key_version, source = 'owner', entered_by = p_actor, updated_at = now()
    returning id into item;
  insert into public.vault_access_log(organization_id, actor_id, item_id, action, detail) values (p_org, p_actor, item, 'store', p_field_key);
  return item;
end; $$;

-- Owner asks for an employee to enter their own data. Raw token never reaches the database.
create function public.issue_sensitive_request(p_org uuid, p_actor uuid, p_subject_key text, p_field_keys text[], p_token_hash text, p_ttl_hours integer)
returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare exp timestamptz := now() + make_interval(hours => least(greatest(p_ttl_hours, 1), 168)); rid uuid;
begin
  if not public.vault_actor_is_owner(p_org, p_actor) then raise exception 'Not authorized' using errcode = '42501'; end if;
  insert into public.sensitive_requests(organization_id, subject_key, field_keys, token_hash, expires_at, created_by)
    values (p_org, p_subject_key, p_field_keys, p_token_hash, exp, p_actor) returning id into rid;
  insert into public.vault_access_log(organization_id, actor_id, item_id, action, detail) values (p_org, p_actor, rid, 'request_issued', p_subject_key);
  return exp;
end; $$;

create function public.peek_sensitive_request(p_token_hash text)
returns table(organization_id uuid, subject_key text, field_keys text[], state text)
language sql stable security definer set search_path = '' as $$
  select r.organization_id, r.subject_key, r.field_keys,
         case when r.used_at is not null then 'used' when r.expires_at <= now() then 'expired' else 'open' end
  from public.sensitive_requests r where r.token_hash = p_token_hash;
$$;

-- Atomic: validates the link, stores every item, burns the link. All or nothing.
create function public.submit_sensitive_items(p_token_hash text, p_items jsonb) returns text
language plpgsql security definer set search_path = '' as $$
declare r public.sensitive_requests%rowtype; it jsonb; item uuid;
begin
  select * into r from public.sensitive_requests where token_hash = p_token_hash for update;
  if not found then return 'invalid'; end if;
  if r.used_at is not null then return 'used'; end if;
  if r.expires_at <= now() then return 'expired'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then return 'invalid'; end if;
  for it in select * from jsonb_array_elements(p_items) loop
    if not ((it->>'field_key') = any(r.field_keys)) then raise exception 'field not requested'; end if;
    insert into public.sensitive_items(organization_id, subject_key, field_key, ciphertext, blind_index, mask, key_version, source)
      values (r.organization_id, r.subject_key, it->>'field_key', it->>'ciphertext', it->>'blind_index', it->>'mask', (it->>'key_version')::integer, 'employee_link')
      on conflict (organization_id, subject_key, field_key) do update
        set ciphertext = excluded.ciphertext, blind_index = excluded.blind_index, mask = excluded.mask,
            key_version = excluded.key_version, source = 'employee_link', entered_by = null, updated_at = now()
      returning id into item;
    insert into public.vault_access_log(organization_id, actor_id, item_id, action, detail) values (r.organization_id, null, item, 'store_via_link', it->>'field_key');
  end loop;
  update public.sensitive_requests set used_at = now() where id = r.id;
  return 'ok';
end; $$;

-- The ONLY path to ciphertext. Logs before returning; the reason is mandatory.
create function public.vault_reveal(p_org uuid, p_actor uuid, p_item uuid, p_reason text)
returns table(ciphertext text, subject_key text, field_key text, key_version integer)
language plpgsql security definer set search_path = '' as $$
begin
  if not public.vault_actor_is_owner(p_org, p_actor) then raise exception 'Not authorized' using errcode = '42501'; end if;
  if p_reason is null or char_length(btrim(p_reason)) < 5 then raise exception 'A reason is required'; end if;
  insert into public.vault_access_log(organization_id, actor_id, item_id, action, detail) values (p_org, p_actor, p_item, 'reveal', left(btrim(p_reason), 200));
  return query select s.ciphertext, s.subject_key, s.field_key, s.key_version
    from public.sensitive_items s where s.id = p_item and s.organization_id = p_org;
end; $$;

create function public.vault_delete(p_org uuid, p_actor uuid, p_item uuid, p_reason text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if not public.vault_actor_is_owner(p_org, p_actor) then raise exception 'Not authorized' using errcode = '42501'; end if;
  delete from public.sensitive_items where id = p_item and organization_id = p_org;
  get diagnostics n = row_count;
  if n = 1 then insert into public.vault_access_log(organization_id, actor_id, item_id, action, detail) values (p_org, p_actor, p_item, 'delete', left(coalesce(p_reason, ''), 200)); end if;
  return n = 1;
end; $$;

-- Lock every function to the server role only (confirm_onboarding_items is the one owner-session RPC).
do $$
declare fn text;
begin
  foreach fn in array array[
    'ensure_org_data_key(uuid,text,integer)', 'get_org_data_key(uuid)', 'rewrap_org_data_key(uuid,uuid,integer,text,integer)',
    'upsert_onboarding_items(uuid,uuid,text,jsonb)', 'store_sensitive_item(uuid,uuid,text,text,text,text,text,integer)',
    'issue_sensitive_request(uuid,uuid,text,text[],text,integer)', 'peek_sensitive_request(text)', 'submit_sensitive_items(text,jsonb)',
    'vault_reveal(uuid,uuid,uuid,text)', 'vault_delete(uuid,uuid,uuid,text)', 'vault_log_immutable()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', fn);
    if fn <> 'vault_log_immutable()' then execute format('grant execute on function public.%s to service_role', fn); end if;
  end loop;
end $$;
revoke all on function public.confirm_onboarding_items(text[]) from public, anon, service_role;
grant execute on function public.confirm_onboarding_items(text[]) to authenticated;
