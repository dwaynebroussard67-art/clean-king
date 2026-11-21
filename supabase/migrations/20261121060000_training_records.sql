-- Training lesson tracking. Replaces the demo-only progress state with persisted records.
-- Apply after the organizations migration so every record is franchise-scoped.

create table public.training_lessons (
  id serial primary key,
  title_en text not null check (char_length(title_en) between 1 and 120),
  title_es text not null check (char_length(title_es) between 1 and 120),
  description_en text not null default '',
  description_es text not null default '',
  video_url text check (video_url is null or video_url ~ '^https?://'),
  duration_seconds integer check (duration_seconds is null or duration_seconds > 0),
  sort_order integer not null default 0,
  organization_id uuid not null references public.organizations(id) on delete cascade
);
alter table public.training_lessons enable row level security;
revoke all on public.training_lessons from anon, authenticated, service_role;
grant select on public.training_lessons to authenticated;
grant insert, update, delete on public.training_lessons to service_role;

create policy "All authenticated see training lessons" on public.training_lessons for select to authenticated
  using (true);

create table public.training_records (
  id uuid primary key default gen_random_uuid(),
  lesson_id integer not null references public.training_lessons(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  completed_at timestamptz not null default now(),
  unique (lesson_id, user_id, organization_id)
);
alter table public.training_records enable row level security;
revoke all on public.training_records from anon, authenticated, service_role;
grant select (lesson_id, completed_at) on public.training_records to authenticated;
grant insert on public.training_records to service_role;
grant delete on public.training_records to service_role;

create policy "Users see own training records" on public.training_records for select to authenticated
  using (user_id = (select auth.uid()));
create policy "Service role writes training records" on public.training_records for all to service_role using (true);

-- RPC: mark a lesson as viewed / completed. Called from the training viewer.
create or replace function public.mark_training_complete(p_organization_id uuid, p_user_id uuid, p_lesson_id integer)
returns table(completed boolean, already boolean)
language plpgsql security definer set search_path = ''
as $$
declare existing boolean;
begin
  if p_organization_id is null or p_user_id is null or p_lesson_id is null then
    return query select false, false;
    return;
  end if;
  -- Verify the lesson belongs to the franchise.
  if not exists (select 1 from public.training_lessons where id = p_lesson_id and organization_id = p_organization_id) then
    return query select false, false;
    return;
  end if;
  select true into existing from public.training_records
    where lesson_id = p_lesson_id and user_id = p_user_id and organization_id = p_organization_id;
  if existing then
    return query select true, true;
    return;
  end if;
  insert into public.training_records(lesson_id, user_id, organization_id)
    values (p_lesson_id, p_user_id, p_organization_id);
  return query select true, false;
end; $$;
revoke all on function public.mark_training_complete(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.mark_training_complete(uuid, uuid, integer) to service_role;

-- Helper: count completed lessons for a user in a franchise.
create or replace function public.training_progress(p_organization_id uuid, p_user_id uuid)
returns table(total bigint, completed bigint)
language sql stable security definer set search_path = ''
as $$
  select count(*), count(*) filter (where r.completed_at is not null)
  from public.training_lessons l
  left join public.training_records r on r.lesson_id = l.id
    and r.user_id = p_user_id and r.organization_id = p_organization_id
  where l.organization_id = p_organization_id;
$$;
revoke all on function public.training_progress(uuid, uuid) from public, anon, service_role;
grant execute on function public.training_progress(uuid, uuid) to authenticated;

-- Seed the demo franchise with the three Rookie Run lessons (run once per franchise).
-- insert into public.training_lessons(organization_id, title_en, title_es, description_en, description_es, sort_order)
-- values
--   ('<ORG UUID>', 'How we clean here', 'Cómo limpiamos aquí', 'Review the approved site instructions and ask your supervisor if anything is unclear. Wear the required protective equipment and leave areas safe for other people.', 'Revisa las instrucciones aprobadas del lugar y pregunta a tu supervisor si algo no está claro. Usa el equipo de protección indicado y deja las áreas seguras para otras personas.', 1),
--   ('<ORG UUID>', 'Restrooms and trash', 'Baños y basura', 'Follow the approved sequence and products for each surface. Avoid cross-contamination between areas. Handle waste according to site instructions; report hazardous objects rather than handling them without authorization.', 'Sigue la secuencia y los productos aprobados para cada superficie. Evita la contaminación entre áreas. Manipula los residuos según las instrucciones del lugar; informa sobre objetos peligrosos en vez de recogerlos sin autorización.', 2),
--   ('<ORG UUID>', 'Chemical safety basics', 'Seguridad química básica', 'Read the label and safety data sheet before using a product. Follow the manufacturer and site instructions. Never mix cleaning chemicals. If there is a spill or exposure, move away and report it according to site procedures.', 'Lee la etiqueta y la hoja de datos de seguridad antes de usar un producto. Sigue las indicaciones del fabricante y del lugar. Nunca mezcles productos químicos. Si hay un derrame o una exposición, aléjate e informa al supervisor según el procedimiento del lugar.', 3);
