-- The historical migration accepted caller-selected limits. Remove that overload so a
-- signed-in owner cannot raise the workspace-wide ceiling through a direct RPC call.
drop function if exists public.begin_assistant_run(integer, integer);
drop function if exists public.begin_assistant_run();

create function public.begin_assistant_run()
returns table(run_id uuid, result text)
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  created_id uuid;
  minute_text text;
  month_text text;
  minute_limit integer := 3;
  month_limit integer := 100;
begin
  if uid is null or not public.is_business_owner() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select s.settings->'limits'->>'perMinute', s.settings->'limits'->>'perMonth'
    into minute_text, month_text
    from public.assistant_settings s where s.id = true;

  if minute_text ~ '^[0-9]+$' then
    if length(minute_text) > 2 then
      minute_limit := 10;
    else
      minute_limit := greatest(1, least(minute_text::integer, 10));
    end if;
  end if;
  if month_text ~ '^[0-9]+$' then
    if length(month_text) > 3 then
      month_limit := 1000;
    else
      month_limit := greatest(1, least(month_text::integer, 1000));
    end if;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(1832711045);
  if (select count(*) from public.assistant_runs
      where created_at >= date_trunc('month', now() at time zone 'UTC') at time zone 'UTC') >= month_limit then
    return query select null::uuid, 'monthly_limit'::text;
    return;
  end if;
  if (select count(*) from public.assistant_runs
      where created_at >= now() - interval '1 minute') >= minute_limit then
    return query select null::uuid, 'rate_limit'::text;
    return;
  end if;

  insert into public.assistant_runs(owner_id) values (uid) returning id into created_id;
  return query select created_id, 'ok'::text;
end;
$$;
revoke all on function public.begin_assistant_run() from public, anon, authenticated;
grant execute on function public.begin_assistant_run() to authenticated;
comment on function public.begin_assistant_run() is
  'Owner-only quota admission. Reads per-minute and per-month limits from assistant_settings; defaults to 3/minute and 100/month. Caller cannot choose limits.';
