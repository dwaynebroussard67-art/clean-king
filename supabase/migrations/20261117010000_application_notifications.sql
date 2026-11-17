-- Durable application notifications. Queueing and applicant insertion commit together.
create table public.application_notifications (
  id uuid primary key default gen_random_uuid(),
  applicant_id uuid not null unique references public.applicants(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','processing','sent','failed')),
  attempts integer not null default 0 check (attempts >= 0),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  lease_token uuid,
  last_error text check (last_error is null or last_error in ('delivery_failed', 'lease_expired')),
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index application_notifications_pending_idx on public.application_notifications (available_at, created_at) where status = 'pending';
create index application_notifications_processing_idx on public.application_notifications (locked_at) where status = 'processing';
alter table public.application_notifications enable row level security;
revoke all on public.application_notifications from public, anon, authenticated, service_role;
-- Owner can see delivery state, but not lease tokens or directly mutate the queue.
grant select (id, applicant_id, status, attempts, last_error, created_at, sent_at) on public.application_notifications to authenticated;
create policy "Owner reads notification status" on public.application_notifications for select to authenticated using ((select public.is_business_owner()));

create or replace function public.enqueue_application_notification() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.application_notifications(applicant_id) values (new.id);
  return new;
end; $$;
revoke all on function public.enqueue_application_notification() from public, anon, authenticated, service_role;
create trigger enqueue_application_notification after insert on public.applicants for each row execute function public.enqueue_application_notification();

-- Claims one job at a time; SKIP LOCKED prevents concurrent workers claiming the same row.
-- A stale lease can be reclaimed after two minutes. Each claim issues a new token.
create or replace function public.claim_application_notification()
returns table(notification_id uuid, claim_token uuid, applicant_id uuid, first_name text, phone text, area text, shifts text[], transportation boolean, languages text[], referrer text, created_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  update public.application_notifications n set status = 'failed', last_error = 'lease_expired', locked_at = null, lease_token = null
    where n.status = 'processing' and n.locked_at < now() - interval '2 minutes' and n.attempts >= 8;
  return query
  with next_job as (
    select n.id from public.application_notifications n
    where n.attempts < 8 and ((n.status = 'pending' and n.available_at <= now()) or (n.status = 'processing' and n.locked_at < now() - interval '2 minutes'))
    order by n.created_at, n.id for update skip locked limit 1
  ), claimed as (
    update public.application_notifications n set status = 'processing', attempts = n.attempts + 1, locked_at = now(), lease_token = gen_random_uuid()
    from next_job where n.id = next_job.id
    returning n.id, n.lease_token, n.applicant_id
  )
  select c.id, c.lease_token, a.id, a.first_name, a.phone, a.area, a.shifts, a.transportation, a.languages, a.referrer, a.created_at
  from claimed c join public.applicants a on a.id = c.applicant_id;
end; $$;
revoke all on function public.claim_application_notification() from public, anon, authenticated;
grant execute on function public.claim_application_notification() to service_role;

-- Only the holder of the current lease may finish a job. A stale worker cannot overwrite a newer result.
create or replace function public.finish_application_notification(p_id uuid, p_lease uuid, p_success boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
declare affected integer;
begin
  if p_id is null or p_lease is null or p_success is null then return false; end if;
  update public.application_notifications n set
    status = case when p_success then 'sent' when n.attempts >= 8 then 'failed' else 'pending' end,
    sent_at = case when p_success then now() else null end,
    available_at = case when p_success then n.available_at else now() + make_interval(secs => least(3600, (60 * power(2, n.attempts - 1))::integer)) end,
    last_error = case when p_success then null else 'delivery_failed' end,
    locked_at = null, lease_token = null
  where n.id = p_id and n.status = 'processing' and n.lease_token = p_lease and n.locked_at >= now() - interval '2 minutes';
  get diagnostics affected = row_count;
  return affected = 1;
end; $$;
revoke all on function public.finish_application_notification(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.finish_application_notification(uuid, uuid, boolean) to service_role;
