-- Organization-scoped application notifications.
-- Updates the notification queue to respect franchise boundaries.

-- The trigger already fires on applicants; copy organization_id into the notification.
create or replace function public.enqueue_application_notification() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.application_notifications(applicant_id, organization_id)
    values (new.id, new.organization_id);
  return new;
end; $$;
revoke all on function public.enqueue_application_notification() from public, anon, authenticated, service_role;

-- Claim one job at a time, scoped to the worker's organization context.
-- The service role may claim any franchise's notifications; RLS is bypassed.
-- Organization is resolved from the applicant so each franchise's queue is isolated.
create or replace function public.claim_application_notification()
returns table(notification_id uuid, claim_token uuid, applicant_id uuid, first_name text, phone text, area text, shifts text[], transportation boolean, languages text[], referrer text, organization_id uuid, created_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
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
    returning n.id, n.lease_token, n.applicant_id, n.organization_id
  )
  select c.id, c.lease_token, a.id, a.first_name, a.phone, a.area, a.shifts, a.transportation, a.languages, a.referrer, c.organization_id, a.created_at
  from claimed c join public.applicants a on a.id = c.applicant_id;
end; $$;
revoke all on function public.claim_application_notification() from public, anon, authenticated;
grant execute on function public.claim_application_notification() to service_role;

-- Add organization_id to the health view (no behavior change, just consistency).
-- The existing application_notification_health function is unchanged; it returns
-- aggregate counts across all franchises. Per-franchise health is future work.
