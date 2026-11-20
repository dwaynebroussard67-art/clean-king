-- Development-only foundation. No provider secrets or endpoints are stored here.
create table public.assistant_settings (
 id uuid primary key default gen_random_uuid(),
 singleton boolean not null unique default true check (singleton),
 owner_name text not null default 'Andy' check (char_length(btrim(owner_name)) between 1 and 40 and owner_name !~ '[[:cntrl:]]'),
 provider text not null default 'anthropic' check (provider in ('anthropic','open')),
 persona text not null default 'enthusiastic' check (persona in ('enthusiastic','calm')),
 include_counts boolean not null default false,
 per_minute integer not null default 3 check (per_minute between 1 and 3),
 per_month integer not null default 100 check (per_month between 1 and 100),
 updated_by uuid references auth.users(id) on delete restrict,
 updated_at timestamptz not null default now()
);
insert into public.assistant_settings(singleton) values(true);
alter table public.assistant_settings enable row level security;
revoke all on public.assistant_settings from public, anon, authenticated, service_role;
grant select (id,owner_name,provider,persona,include_counts,per_minute,per_month,updated_by,updated_at) on public.assistant_settings to authenticated;
create policy "Owner reads assistant settings" on public.assistant_settings for select to authenticated using ((select public.is_business_owner()));

create function public.update_assistant_settings(p_name text,p_provider text,p_persona text,p_counts boolean,p_minute integer,p_month integer) returns boolean
language plpgsql security definer set search_path='' as $$
declare old_row public.assistant_settings%rowtype; actor uuid := (select auth.uid());
begin
 if actor is null or not public.is_business_owner() then raise exception 'Not authorized' using errcode='42501'; end if;
 if p_name is null or char_length(btrim(p_name)) not between 1 and 40 or p_name ~ '[[:cntrl:]]'
  or p_provider is null or p_provider not in ('anthropic','open') or p_persona is null or p_persona not in ('enthusiastic','calm')
  or p_counts is null or p_minute is null or p_minute not between 1 and 3 or p_month is null or p_month not between 1 and 100 then return false; end if;
 -- Settings changes serialize with admission so lowering limits cannot race a new run.
 perform pg_catalog.pg_advisory_xact_lock(1832711045);
 select * into old_row from public.assistant_settings where singleton for update;
 if not found then return false; end if;
 if (old_row.owner_name,old_row.provider,old_row.persona,old_row.include_counts,old_row.per_minute,old_row.per_month)
  is not distinct from (btrim(p_name),p_provider,p_persona,p_counts,p_minute,p_month) then return true; end if;
 update public.assistant_settings set owner_name=btrim(p_name),provider=p_provider,persona=p_persona,include_counts=p_counts,
  per_minute=p_minute,per_month=p_month,updated_by=actor,updated_at=now() where id=old_row.id;
 insert into public.audit_log(actor_id,entity_type,entity_id,action,details)
  values(actor,'assistant_settings',old_row.id,'updated',jsonb_build_object('provider',p_provider,'persona',p_persona,'include_counts',p_counts,'per_minute',p_minute,'per_month',p_month));
 return true;
end; $$;
revoke all on function public.update_assistant_settings(text,text,text,boolean,integer,integer) from public,anon,service_role;
grant execute on function public.update_assistant_settings(text,text,text,boolean,integer,integer) to authenticated;

create or replace function public.begin_assistant_run()
returns table(run_id uuid, result text) language plpgsql security definer set search_path='' as $$
declare uid uuid := (select auth.uid()); created_id uuid; minute_cap integer; month_cap integer;
begin
 if uid is null or not public.is_business_owner() then raise exception 'Not authorized' using errcode='42501'; end if;
 perform pg_catalog.pg_advisory_xact_lock(1832711045);
 select s.per_minute,s.per_month into minute_cap,month_cap from public.assistant_settings s where s.singleton;
 if not found or minute_cap not between 1 and 3 or month_cap not between 1 and 100 then raise exception 'Settings unavailable'; end if;
 if (select count(*) from public.assistant_runs where created_at >= date_trunc('month',now() at time zone 'UTC') at time zone 'UTC') >= month_cap then return query select null::uuid,'monthly_limit'::text;return;end if;
 if (select count(*) from public.assistant_runs where created_at >= now()-interval '1 minute') >= minute_cap then return query select null::uuid,'rate_limit'::text;return;end if;
 insert into public.assistant_runs(owner_id) values(uid) returning id into created_id;
 return query select created_id,'ok'::text;
end; $$;
