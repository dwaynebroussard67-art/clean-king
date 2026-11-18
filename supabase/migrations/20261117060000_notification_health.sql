-- Aggregate queue health only; never expose applicant or delivery details.
create function public.application_notification_health()
returns table(failed_count bigint, overdue_count bigint)
language sql stable security definer set search_path = '' as $$
  select
    count(*) filter (where n.status='failed'),
    count(*) filter (where (n.status='pending' and n.available_at < now()-interval '15 minutes')
      or (n.status='processing' and n.locked_at < now()-interval '2 minutes'))
  from public.application_notifications n;
$$;
revoke all on function public.application_notification_health() from public, anon, authenticated;
grant execute on function public.application_notification_health() to service_role;
