import 'server-only';

/** Record that a user completed a training lesson. Returns { completed: bool, already: bool }. */
export async function recordLessonComplete({ organizationId, userId, lessonId, supabaseClient }) {
  if (!organizationId || !userId || !lessonId) return { completed: false, already: false };
  const { data, error } = await supabaseClient.rpc('mark_training_complete', {
    p_organization_id: organizationId,
    p_user_id: userId,
    p_lesson_id: lessonId,
  });
  if (error || !data) return { completed: false, already: false };
  return { completed: data[0]?.completed ?? false, already: data[0]?.already ?? false };
}

/** Fetch training progress for a user in a franchise: { total, completed }. */
export async function trainingProgress({ organizationId, userId, supabaseClient }) {
  if (!organizationId || !userId) return { total: 0, completed: 0 };
  const { data, error } = await supabaseClient.rpc('training_progress', {
    p_organization_id: organizationId,
    p_user_id: userId,
  });
  if (error || !data) return { total: 0, completed: 0 };
  return { total: data[0]?.total ?? 0, completed: data[0]?.completed ?? 0 };
}

/** Fetch the lessons for a franchise. Returns array of { id, title_en, title_es, description_en, description_es, video_url, duration_seconds, sort_order }. */
export async function getLessons({ organizationId, supabaseClient }) {
  if (!organizationId) return [];
  const { data, error } = await supabaseClient
    .from('training_lessons')
    .select('*')
    .eq('organization_id', organizationId)
    .order('sort_order');
  if (error || !data) return [];
  return data;
}
