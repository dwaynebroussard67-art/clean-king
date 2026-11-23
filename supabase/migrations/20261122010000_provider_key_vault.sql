-- Provider key vault: per-tenant encrypted AI provider credentials.
-- Supports Anthropic (Slot A), OpenAI-compatible (Slot B), and Bubbles Lite (Slot C, no key).

-- ---------------------------------------------------------------------------
-- tenant_ai_providers: one row per provider per tenant
-- ---------------------------------------------------------------------------
create table public.tenant_ai_providers (
  tenant_id uuid not null references public.organizations(id) on delete cascade,
  provider_id text not null check (provider_id in ('anthropic', 'openai_compatible')),
  model text not null default '' check (char_length(model) <= 120),
  encrypted_key text check (encrypted_key is null or char_length(encrypted_key) <= 512),
  iv text check (iv is null or char_length(iv) = 22),
  last_four text check (last_four is null or char_length(last_four) <= 4),
  status text not null default 'inactive' check (status in ('active', 'inactive')),
  base_url text check (base_url is null or char_length(base_url) <= 255),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, provider_id)
);
alter table public.tenant_ai_providers enable row level security;
revoke all on public.tenant_ai_providers from anon, authenticated, service_role;
grant select (provider_id, model, last_four, status, base_url) on public.tenant_ai_providers to authenticated;
grant insert, update, delete on public.tenant_ai_providers to service_role;

-- Tenants see only their own providers.
create policy "Tenants see own providers" on public.tenant_ai_providers for select to authenticated
  using ((select public.owns_organization(tenant_id)));

-- ---------------------------------------------------------------------------
-- tenant_ai_budget: per-tenant monthly dollar budget
-- ---------------------------------------------------------------------------
create table public.tenant_ai_budget (
  tenant_id uuid primary key references public.organizations(id) on delete cascade,
  monthly_cap_cents integer not null default 0 check (monthly_cap_cents >= 0),
  spent_cents integer not null default 0 check (spent_cents >= 0),
  period_start timestamptz not null default date_trunc('month', now()),
  soft_warning_sent boolean not null default false,
  hard_stop boolean not null default false
);
alter table public.tenant_ai_budget enable row level security;
revoke all on public.tenant_ai_budget from anon, authenticated, service_role;
grant select on public.tenant_ai_budget to authenticated;
grant insert, update, delete on public.tenant_ai_budget to service_role;

create policy "Tenants see own budget" on public.tenant_ai_budget for select to authenticated
  using ((select public.owns_organization(tenant_id)));

-- ---------------------------------------------------------------------------
-- assistant_action_audit: every proposed/approved/executed action is logged
-- ---------------------------------------------------------------------------
create table public.assistant_action_audit (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.organizations(id) on delete cascade,
  action_type text not null check (char_length(action_type) <= 50),
  proposal jsonb not null default '{}'::jsonb,
  decision text check (decision is null or decision in ('approved', 'rejected', 'edited')),
  result jsonb check (result is null or char_length(result::text) <= 10000),
  verification jsonb check (verification is null or char_length(verification::text) <= 10000),
  actor_id uuid references auth.users(id) on delete set null,
  actor_role text check (actor_role is null or actor_role in ('owner', 'manager', 'bubbles')),
  created_at timestamptz not null default now()
);
alter table public.assistant_action_audit enable row level security;
revoke all on public.assistant_action_audit from anon, authenticated, service_role;
grant select on public.assistant_action_audit to authenticated;
grant insert on public.assistant_action_audit to service_role;

create policy "Tenants see own action audit" on public.assistant_action_audit for select to authenticated
  using ((select public.owns_organization(tenant_id)));

-- ---------------------------------------------------------------------------
-- RPC: check and increment budget spend. Fails closed when budget exceeded.
-- ---------------------------------------------------------------------------
create or replace function public.check_ai_budget(p_tenant_id uuid, p_cents integer)
returns table(allowed boolean, remaining_cents integer, total_cents integer, hard_stopped boolean)
language plpgsql security definer set search_path = ''
as $$
declare budget public.tenant_ai_budget%rowtype;
begin
  select * into budget from public.tenant_ai_budget where tenant_id = p_tenant_id;
  if not found then
    -- No budget configured = no limit
    return query select true, null::integer, null::integer, false;
    return;
  end if;
  -- Reset monthly spend at the start of a new period
  if budget.period_start < date_trunc('month', now()) then
    update public.tenant_ai_budget
      set spent_cents = 0, period_start = date_trunc('month', now()), soft_warning_sent = false
      where tenant_id = p_tenant_id
      returning * into budget;
  end if;
  if budget.hard_stop then
    return query select false, 0, budget.monthly_cap_cents, true;
    return;
  end if;
  if (budget.spent_cents + p_cents) > budget.monthly_cap_cents then
    -- Hard stop: mark and reject
    update public.tenant_ai_budget set hard_stop = true where tenant_id = p_tenant_id;
    return query select false, 0, budget.monthly_cap_cents, true;
    return;
  end if;
  -- Allow and increment
  update public.tenant_ai_budget
    set spent_cents = spent_cents + p_cents,
        soft_warning_sent = (budget.spent_cents + p_cents) >= (budget.monthly_cap_cents * 0.8)
    where tenant_id = p_tenant_id;
  return query select true, budget.monthly_cap_cents - (budget.spent_cents + p_cents), budget.monthly_cap_cents, false;
end; $$;
revoke all on function public.check_ai_budget(uuid, integer) from public, anon, authenticated;
grant execute on function public.check_ai_budget(uuid, integer) to service_role;

-- ---------------------------------------------------------------------------
-- Seed helper: create a default inactive budget for a tenant (run once per tenant).
-- ---------------------------------------------------------------------------
-- insert into public.tenant_ai_budget(tenant_id, monthly_cap_cents)
-- values ('<TENANT UUID>', 2000);  -- $20.00/month default cap
