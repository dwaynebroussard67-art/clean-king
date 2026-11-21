-- Database-side defense in depth for already issued owner sessions.
-- Apply only through an approved migration to a dedicated test project first.
-- This does NOT replace production authentication, session revocation, or service-key rotation.

alter table public.owner_memberships add column active boolean not null default true;

-- Preserve existing installations' access until an operator explicitly suspends it.
-- Missing singleton row fails closed. Only a privileged SQL operator can change it.
create table public.owner_access_control (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default true
);
insert into public.owner_access_control(singleton, enabled) values (true, true);
alter table public.owner_access_control enable row level security;
revoke all on public.owner_access_control from public, anon, authenticated, service_role;

-- A service-role key is not an administrative interface for granting owner memberships.
-- A database administrator remains privileged; secure that access separately.
revoke insert, update, delete, truncate, references, trigger on public.owner_memberships from public, anon, authenticated, service_role;

create or replace function public.is_business_owner() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.owner_memberships m
    join public.owner_access_control c on c.singleton and c.enabled
    where m.user_id = (select auth.uid()) and m.active
  );
$$;
revoke all on function public.is_business_owner() from public, anon, service_role;
grant execute on function public.is_business_owner() to authenticated;

-- Application membership lookups must agree with the database authorization predicate.
-- The definer function reads its own underlying table without recursive RLS evaluation.
drop policy "Owners can see their own membership" on public.owner_memberships;
create policy "Active owners see own membership" on public.owner_memberships for select to authenticated
  using (user_id = (select auth.uid()) and (select public.is_business_owner()));

-- Do not attribute privileged operator actions to an untrusted JWT. Record only the
-- control changed, not user-entered data. External operator audit is still required.
create function public.audit_owner_access_control() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'owner_access_control' then
    if old.enabled is distinct from new.enabled then
      insert into public.audit_log(actor_id,entity_type,entity_id,action,details)
      values (null,'owner_access','00000000-0000-0000-0000-000000000000'::uuid,'global_access_changed',
        jsonb_build_object('enabled',new.enabled));
    end if;
  elsif tg_table_name = 'owner_memberships' then
    if old.active is distinct from new.active then
      insert into public.audit_log(actor_id,entity_type,entity_id,action,details)
      values (null,'owner_access',new.user_id,'owner_access_changed',jsonb_build_object('active',new.active));
    end if;
  end if;
  return new;
end; $$;
revoke all on function public.audit_owner_access_control() from public, anon, authenticated, service_role;
create trigger audit_global_owner_access after update on public.owner_access_control
  for each row execute function public.audit_owner_access_control();
create trigger audit_individual_owner_access after update on public.owner_memberships
  for each row execute function public.audit_owner_access_control();
