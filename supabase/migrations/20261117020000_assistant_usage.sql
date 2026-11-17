-- Read-only assistant usage budget and metadata-only audit. Never stores prompts or responses.
create table public.assistant_runs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'started' check (status in ('started', 'completed', 'failed')),
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index assistant_runs_created_idx on public.assistant_runs (created_at desc);
alter table public.assistant_runs enable row level security;
revoke all on public.assistant_runs from public, anon, authenticated, service_role;
grant select on public.assistant_runs to authenticated;
create policy "Owners read assistant metadata" on public.assistant_runs for select to authenticated using ((select public.is_business_owner()));

-- Serializes admission across all owners. 3 requests/minute and 100/month are hard workspace-wide ceilings,
-- not a dollar spend cap; provider-side billing limits are still required.
create or replace function public.begin_assistant_run()
returns table(run_id uuid, result text) language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); created_id uuid;
begin
  if uid is null or not public.is_business_owner() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(1832711045);
  if (select count(*) from public.assistant_runs where created_at >= date_trunc('month', now() at time zone 'UTC') at time zone 'UTC') >= 100 then
    return query select null::uuid, 'monthly_limit'::text; return;
  end if;
  if (select count(*) from public.assistant_runs where created_at >= now() - interval '1 minute') >= 3 then
    return query select null::uuid, 'rate_limit'::text; return;
  end if;
  insert into public.assistant_runs(owner_id) values (uid) returning id into created_id;
  return query select created_id, 'ok'::text;
end; $$;
revoke all on function public.begin_assistant_run() from public, anon, authenticated;
grant execute on function public.begin_assistant_run() to authenticated;

create or replace function public.finish_assistant_run(p_run_id uuid, p_success boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
declare affected integer; uid uuid := (select auth.uid());
begin
  if uid is null or not public.is_business_owner() then raise exception 'Not authorized' using errcode = '42501'; end if;
  if p_run_id is null or p_success is null then return false; end if;
  update public.assistant_runs set status = case when p_success then 'completed' else 'failed' end, finished_at = now()
  where id = p_run_id and owner_id = uid and status = 'started';
  get diagnostics affected = row_count;
  return affected = 1;
end; $$;
revoke all on function public.finish_assistant_run(uuid, boolean) from public, anon, authenticated;
grant execute on function public.finish_assistant_run(uuid, boolean) to authenticated;
