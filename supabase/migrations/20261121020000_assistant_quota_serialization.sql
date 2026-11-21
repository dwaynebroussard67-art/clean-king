-- Serialize settings changes with quota admission, using the same transaction lock.
-- The existing settings RPC first takes its own save lock (1046), then this lock;
-- admission only takes 1045. Do not add a path taking those locks in reverse order.
create function public.lock_assistant_settings_admission() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(1832711045);
  return new;
end; $$;
revoke all on function public.lock_assistant_settings_admission() from public, anon, authenticated, service_role;
create trigger assistant_settings_admission_lock
  before insert or update on public.assistant_settings
  for each row execute function public.lock_assistant_settings_admission();

create or replace function public.begin_assistant_run()
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

  -- Lock before reading: a concurrent committed limit reduction must be visible.
  perform pg_catalog.pg_advisory_xact_lock(1832711045);
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
