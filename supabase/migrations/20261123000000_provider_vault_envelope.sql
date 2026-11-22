-- Provider vault: envelope encryption for AI provider keys.
-- Replaces the broken per-row IV + plaintext fallback with the tested
-- envelope vault pattern (one vault, one rotation story, one audit trail).
--
-- Depends on: 20261122020000_onboarding_vault.sql (provides org_data_keys,
-- get_org_data_key, ensure_org_data_key, vault_access_log).

-- ---------------------------------------------------------------------------
-- tenant_ai_providers: strip the insecure iv and api_key_plaintext columns,
-- add key_version, require v2 envelope format.
-- ---------------------------------------------------------------------------
alter table public.tenant_ai_providers
  drop column if exists iv,
  drop column if exists api_key_plaintext;

alter table public.tenant_ai_providers
  add column if not exists key_version integer not null default 1;

alter table public.tenant_ai_providers
  alter column encrypted_key type text,
  alter column encrypted_key set not null,
  drop constraint if exists tenant_ai_providers_encrypted_key_check,
  add constraint tenant_ai_providers_encrypted_key_check
    check (char_length(encrypted_key) <= 600 and encrypted_key ~ '^v2\.');

-- Revoke direct table access from service_role; all access goes through
-- security definer functions below (same pattern as sensitive_items in
-- the onboarding vault migration).
revoke all on public.tenant_ai_providers from anon, authenticated, service_role;

-- Grant only safe read columns to authenticated tenants.
grant select (tenant_id, provider_id, model, last_four, status, base_url, key_version)
  on public.tenant_ai_providers to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: save_provider_key — seal a provider key with envelope vault.
-- ---------------------------------------------------------------------------
create or replace function public.save_provider_key(
  p_tenant uuid,
  p_actor uuid,
  p_provider text,
  p_model text,
  p_base_url text,
  p_ciphertext text,
  p_last_four text,
  p_key_version integer
)
returns table(ok boolean, error text)
language plpgsql security definer set search_path = ''
as $$
declare
  ok_owner boolean;
begin
  -- Re-check that p_actor is an owner of p_tenant.
  select exists (
    select 1 from public.owner_memberships m
    where m.user_id = p_actor
      and m.organization_id = p_tenant
      and m.role = 'owner'
  ) into ok_owner;

  if not ok_owner then
    return query select false, 'not_authorized';
    return;
  end if;

  -- Validate ciphertext format before storing.
  if p_ciphertext is null or p_ciphertext !~ '^v2\.' then
    return query select false, 'invalid_ciphertext';
    return;
  end if;

  insert into public.tenant_ai_providers
    (tenant_id, provider_id, model, base_url, encrypted_key, last_four, status, key_version, updated_at)
  values
    (p_tenant, p_provider, p_model, p_base_url, p_ciphertext, p_last_four, 'active', p_key_version, now())
  on conflict (tenant_id, provider_id) do update
    set model = excluded.model,
        base_url = excluded.base_url,
        encrypted_key = excluded.encrypted_key,
        last_four = excluded.last_four,
        status = 'active',
        key_version = excluded.key_version,
        updated_at = now();

  -- Audit log entry (extend vault_access_log action check with provider_key_save).
  insert into public.vault_access_log(actor_id, org_id, action, subject_key, field_key, created_at)
  values (p_actor, p_tenant, 'provider_key_save', p_provider, 'api_key', now());

  return query select true, null;
end; $$;

revoke all on function public.save_provider_key(uuid, uuid, text, text, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.save_provider_key(uuid, uuid, text, text, text, text, text, integer) to service_role;

-- ---------------------------------------------------------------------------
-- RPC: get_provider_key_ciphertext — return the sealed ciphertext only.
-- ---------------------------------------------------------------------------
create or replace function public.get_provider_key_ciphertext(
  p_tenant uuid,
  p_provider text
)
returns table(ciphertext text, key_version integer, last_four text, status text)
language plpgsql security definer set search_path = ''
as $$
begin
  return query
    select encrypted_key, key_version, last_four, status
    from public.tenant_ai_providers
    where tenant_id = p_tenant
      and provider_id = p_provider;
end; $$;

revoke all on function public.get_provider_key_ciphertext(uuid, text) from public, anon, authenticated;
grant execute on function public.get_provider_key_ciphertext(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- RPC: delete_provider_key — owner-gated deletion.
-- ---------------------------------------------------------------------------
create or replace function public.delete_provider_key(
  p_tenant uuid,
  p_actor uuid,
  p_provider text
)
returns table(ok boolean, error text)
language plpgsql security definer set search_path = ''
as $$
declare
  ok_owner boolean;
begin
  select exists (
    select 1 from public.owner_memberships m
    where m.user_id = p_actor
      and m.organization_id = p_tenant
      and m.role = 'owner'
  ) into ok_owner;

  if not ok_owner then
    return query select false, 'not_authorized';
    return;
  end if;

  delete from public.tenant_ai_providers
  where tenant_id = p_tenant and provider_id = p_provider;

  insert into public.vault_access_log(actor_id, org_id, action, subject_key, field_key, created_at)
  values (p_actor, p_tenant, 'provider_key_delete', p_provider, 'api_key', now());

  return query select true, null;
end; $$;

revoke all on function public.delete_provider_key(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.delete_provider_key(uuid, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- Extend vault_access_log action check to include provider key actions.
-- ---------------------------------------------------------------------------
alter table public.vault_access_log
  drop constraint if exists vault_access_log_action_check;

alter table public.vault_access_log
  add constraint vault_access_log_action_check
    check (action in (
      'sensitive_store', 'sensitive_reveal', 'sensitive_delete',
      'provider_key_save', 'provider_key_delete'
    ));