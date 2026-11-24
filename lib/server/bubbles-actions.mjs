/**
 * Bubbles Interactive Actions — Owner-authorized operations for Clean King.
 *
 * Allows Bubbles to inspect live applicants, quote leads, and briefings,
 * and execute owner-approved state changes (applicant status, hiring/onboarding,
 * quote lead status) using the authenticated owner's Supabase session.
 */

export const BUBBLES_ACTIONS = [
  'get_briefing',
  'list_applicants',
  'update_applicant_status',
  'hire_applicant',
  'list_quotes',
  'update_quote_status',
  'list_onboarding',
  'confirm_onboarding',
  'remember',
  'recall_memories',
];

export async function executeBubblesAction({ session, user, organizationId, action, payload = {} }) {
  if (!session || !user || !organizationId) {
    return { ok: false, error: 'not_authorized' };
  }

  switch (action) {
    case 'get_briefing': {
      const [apps, quotes, onboarding] = await Promise.all([
        session.from('applicants').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId).eq('status', 'new'),
        session.from('leads').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId).eq('status', 'new'),
        session.from('employee_onboarding').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId),
      ]);
      const newApplicants = apps.count ?? 0;
      const newQuotes = quotes.count ?? 0;
      const activeOnboarding = onboarding.count ?? 0;

      const items = [];
      if (newApplicants > 0) items.push(`${newApplicants} new applicant${newApplicants === 1 ? '' : 's'} waiting for review`);
      if (newQuotes > 0) items.push(`${newQuotes} new commercial quote request${newQuotes === 1 ? '' : 's'}`);
      if (activeOnboarding > 0) items.push(`${activeOnboarding} active onboarding record${activeOnboarding === 1 ? '' : 's'}`);

      const summary = items.length
        ? `Good morning, boss! Coffee is ready. Here's what needs your eyes: ${items.join(', ')}.`
        : `Good morning, boss! Coffee is ready. Everything is caught up—no new applicants or quote requests waiting right now.`;

      return {
        ok: true,
        action,
        message: summary,
        data: { newApplicants, newQuotes, activeOnboarding },
      };
    }

    case 'list_applicants': {
      const { data, error } = await session
        .from('applicants')
        .select('id, first_name, area, shifts, status, transportation, created_at')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false })
        .limit(10);
      if (error) return { ok: false, error: 'query_failed' };
      return {
        ok: true,
        action,
        message: data?.length
          ? `Already on it. Here are the ${data.length} most recent applicants:`
          : 'No applicants in the pipeline yet.',
        data: { applicants: data ?? [] },
      };
    }

    case 'update_applicant_status': {
      const { applicantId, status } = payload;
      if (!applicantId || !['new', 'later', 'screening', 'passed'].includes(status)) {
        return { ok: false, error: 'invalid_params' };
      }
      const { data, error } = await session.rpc('set_applicant_status', {
        p_id: applicantId,
        p_status: status,
      });
      if (error || !data) return { ok: false, error: 'action_failed' };
      return {
        ok: true,
        action,
        message: `Done, boss. Moved that applicant to "${status}".`,
        data: { applicantId, status },
      };
    }

    case 'hire_applicant': {
      const { applicantId } = payload;
      if (!applicantId) return { ok: false, error: 'invalid_params' };
      const { data, error } = await session.rpc('start_employee_onboarding', {
        p_applicant_id: applicantId,
      });
      if (error) return { ok: false, error: 'action_failed' };
      const row = Array.isArray(data) ? data[0] : data;
      if (!row || (row.result !== 'created' && row.result !== 'existing')) {
        return { ok: false, error: row?.result || 'action_failed' };
      }
      return {
        ok: true,
        action,
        message: row.result === 'created'
          ? 'Awesome! They are officially marked hired and onboarding has been started.'
          : 'They are already hired with an active onboarding record, boss.',
        data: { applicantId, onboardingId: row.onboarding_id, result: row.result },
      };
    }

    case 'list_quotes': {
      const { data, error } = await session
        .from('leads')
        .select('id, contact_name, building_type, size, frequency, status, created_at')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false })
        .limit(10);
      if (error) return { ok: false, error: 'query_failed' };
      return {
        ok: true,
        action,
        message: data?.length
          ? `Here are the ${data.length} most recent commercial quote requests:`
          : 'No commercial quote requests yet.',
        data: { quotes: data ?? [] },
      };
    }

    case 'update_quote_status': {
      const { quoteId, status } = payload;
      if (!quoteId || !['new', 'contacted', 'closed'].includes(status)) {
        return { ok: false, error: 'invalid_params' };
      }
      const { error } = await session
        .from('leads')
        .update({ status })
        .eq('id', quoteId)
        .eq('organization_id', organizationId);
      if (error) return { ok: false, error: 'action_failed' };
      return {
        ok: true,
        action,
        message: `Got it—updated that quote request to "${status}".`,
        data: { quoteId, status },
      };
    }

    case 'list_onboarding': {
      const { data, error } = await session
        .from('onboarding_items')
        .select('subject_key, field_key, tier, value, status, updated_at')
        .eq('organization_id', organizationId)
        .order('updated_at', { ascending: false })
        .limit(20);
      if (error) return { ok: false, error: 'query_failed' };
      const proposed = (data ?? []).filter(i => i.status === 'proposed').length;
      return {
        ok: true,
        action,
        message: data?.length
          ? `Here are your onboarding items (${proposed} waiting for confirmation):`
          : 'No onboarding items found yet.',
        data: { items: data ?? [], proposedCount: proposed },
      };
    }

    case 'confirm_onboarding': {
      const { fieldKeys = null } = payload;
      const { data, error } = await session.rpc('confirm_onboarding_items', {
        p_field_keys: fieldKeys,
      });
      if (error) return { ok: false, error: 'action_failed' };
      return {
        ok: true,
        action,
        message: `Done, boss! Confirmed ${data ?? 0} onboarding item${data === 1 ? '' : 's'}.`,
        data: { confirmedCount: data ?? 0 },
      };
    }

    case 'remember': {
      const { memoryKey, content, category = 'general', importance = 3 } = payload;
      if (!memoryKey || !content) return { ok: false, error: 'invalid_params' };
      const { error } = await session
        .from('bubbles_memories')
        .upsert({
          organization_id: organizationId,
          memory_key: String(memoryKey).slice(0, 120),
          content: String(content).slice(0, 2000),
          category: ['preference', 'project', 'reminder', 'decision', 'general'].includes(category) ? category : 'general',
          importance: Math.min(5, Math.max(1, Number(importance) || 3)),
          created_by: user.id,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'organization_id,memory_key' });
      if (error) return { ok: false, error: 'action_failed' };
      return {
        ok: true,
        action,
        message: `Got it, boss. I'll remember that (${memoryKey}).`,
        data: { memoryKey, category },
      };
    }

    case 'recall_memories': {
      const { data, error } = await session
        .from('bubbles_memories')
        .select('id, category, memory_key, content, importance, updated_at')
        .eq('organization_id', organizationId)
        .order('importance', { ascending: false })
        .order('updated_at', { ascending: false })
        .limit(20);
      if (error) return { ok: false, error: 'query_failed' };
      return {
        ok: true,
        action,
        message: data?.length
          ? `Here's what I remember for Clean King (${data.length} saved items):`
          : 'No saved memories yet, boss.',
        data: { memories: data ?? [] },
      };
    }

    default:
      return { ok: false, error: 'unknown_action' };
  }
}
