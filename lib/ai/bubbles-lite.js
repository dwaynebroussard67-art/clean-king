/**
 * Bubbles Lite: deterministic, zero-cost assistant engine.
 *
 * When a tenant has no API key configured, Bubbles falls back to this engine.
 * It matches user questions to a fixed intent catalog and runs parameterized
 * database queries to fill template answers. No guessing. No AI cost.
 *
 * Intents are matched in order. The first matching intent wins.
 * Unmatched questions get a helpful "I can't answer that without an AI key" response
 * with a menu of what Bubbles Lite CAN do.
 */

export const LITE_INTENTS = [
  {
    id: 'daily_briefing',
    patterns: [
      /good\s+morning/i,
      /hi\s+bubbles/i,
      /hello\s+bubbles/i,
      /what.s happening today/i,
      /what.*today/i,
      /daily\s+briefing/i,
      /tell\s+me\s+about\s+today/i,
      /how.*day.*going/i,
    ],
    response: function(data) {
      const completed = data.completedJobs ?? 0;
      const scheduled = data.scheduledJobs ?? 0;
      const openShifts = data.openShifts ?? 0;
      const newApps = data.newApplicants ?? 0;
      const newQuotes = data.newQuotes ?? 0;
      const coverage = scheduled - completed;
      return {
        text: `Good morning! Here's today: ${completed} jobs done, ${scheduled} scheduled, ${openShifts} open shifts waiting for crew. ${newApps} new applicants waiting for your review. ${newQuotes} new quote requests. ${coverage > 0 ? `You have ${coverage} jobs still to cover.` : 'All scheduled jobs are covered.'}`,
        data: { type: 'daily_briefing', ...data },
      };
    },
  },

  {
    id: 'today_jobs',
    patterns: [
      /jobs.*today/i,
      /what.*jobs/i,
      /scheduled.*today/i,
      /work.*today/i,
      /shifts.*today/i,
      /where.*crew/i,
      /who.*on.*site/i,
      /today.*schedule/i,
    ],
    response: function(data) {
      const jobs = data.jobs ?? [];
      if (!jobs.length) {
        return { text: "You don't have any jobs scheduled for today. Want me to check open shifts for crew?" };
      }
      const lines = jobs.slice(0, 5).map(j =>
        `${j.siteName} — ${j.shiftTime} — ${j.crewMember || 'No crew assigned yet'}`
      );
      const extra = jobs.length > 5 ? `\n...and ${jobs.length - 5} more.` : '';
      return {
        text: `Today's jobs:\n${lines.join('\n')}${extra}`,
        data: { type: 'today_jobs', jobs },
      };
    },
  },

  {
    id: 'crew_status',
    patterns: [
      /who.*available/i,
      /crew.*available/i,
      /who.*working/i,
      /crew.*status/i,
      /who.*free/i,
      /who.*not\s+working/i,
      /available.*crew/i,
    ],
    response: function(data) {
      const available = data.availableCrew ?? [];
      const working = data.workingCrew ?? [];
      if (!working.length && !available.length) {
        return { text: "I don't have crew data right now. Have you added your team?" };
      }
      let text = `Right now, ${working.length} crew members are working: ${working.join(', ') || 'none'}. `;
      if (available.length) {
        text += `${available.length} are available: ${available.join(', ')}.`;
      } else {
        text += 'No one is currently available.';
      }
      return { text, data: { type: 'crew_status', working: working.length, available: available.length } };
    },
  },

  {
    id: 'open_shifts',
    patterns: [
      /open\s+shift/i,
      /shift.*open/i,
      /need.*crew/i,
      /who.*fill.*shift/i,
      /uncovered/i,
      /coverage.*gap/i,
      /coverage.*need/i,
    ],
    response: function(data) {
      const openShifts = data.openShifts ?? [];
      if (!openShifts.length) {
        return { text: "All shifts are covered today. Want me to check tomorrow?" };
      }
      const lines = openShifts.slice(0, 5).map(s =>
        `${s.siteName} — ${s.shiftTime} — ${s.neededRole || 'General cleaning'}`
      );
      return {
        text: `You have ${openShifts.length} open shifts:\n${lines.join('\n')}`,
        data: { type: 'open_shifts', count: openShifts.length },
      };
    },
  },

  {
    id: 'applicants_waiting',
    patterns: [
      /applicant/i,
      /new\s+applicant/i,
      /who.*apply/i,
      /review.*applicant/i,
      /pending.*applicant/i,
      /hiring/i,
      /new\s+candidate/i,
      /people.*apply/i,
    ],
    response: function(data) {
      const count = data.applicantCount ?? 0;
      const recent = data.recentApplicants ?? [];
      if (!count) {
        return { text: "No applicants waiting for review right now. Your inbox is clear." };
      }
      let text = `${count} applicant${count > 1 ? 's' : ''} waiting for your review.`;
      if (recent.length) {
        const names = recent.slice(0, 3).map(a => a.name).join(', ');
        text += ` Recent: ${names}.`;
      }
      return { text, data: { type: 'applicants_waiting', count } };
    },
  },

  {
    id: 'quote_requests',
    patterns: [
      /quote/i,
      /request.*quote/i,
      /new.*quote/i,
      /lead/i,
      /customer.*ask/i,
      /pending.*quote/i,
      /presupuesto/i,
      /cotizaci/,
    ],
    response: function(data) {
      const count = data.quoteCount ?? 0;
      if (!count) {
        return { text: "No new quote requests right now." };
      }
      return { text: `${count} quote request${count > 1 ? 's' : ''} waiting. Want me to tell you about any of them?` };
    },
  },

  {
    id: 'email_health',
    patterns: [
      /email.*deliver/i,
      /email.*status/i,
      /notification.*status/i,
      /did.*email.*send/i,
      /email.*work/i,
      /notification.*fail/i,
    ],
    response: function(data) {
      const status = data.emailStatus ?? 'unknown';
      if (status === 'healthy') {
        return { text: "Email notifications are working. Recent sends have been accepted by the provider." };
      }
      if (status === 'failed') {
        return { text: "Email delivery has failures. You have pending notifications that need attention. Check the notification health page." };
      }
      return { text: "I can't see the email status right now. Check the notifications page in your dashboard." };
    },
  },

  {
    id: 'setup_help',
    patterns: [
      /how.*set.*up/i,
      /how.*add/i,
      /how.*create/i,
      /how.*do/i,
      /help.*set/i,
      /where.*find/i,
      /where.*add/i,
      /c[oó]mo.*hacer/i,
      /c[oó]mo.*agregar/i,
      /ayuda/i,
    ],
    response: function() {
      return {
        text: `I can help with setup! Here's what I can walk you through:\n\n• Adding your services\n• Setting up crew members\n• Configuring your service areas\n• Connecting the apply page\n• Setting up notifications\n\nWhat do you want to set up?`,
        data: { type: 'setup_help' },
      };
    },
  },

  {
    id: 'coverage_check',
    patterns: [
      /coverage/i,
      /backup/i,
      /plan.*b/i,
      /plan.*backup/i,
      /what.*if.*sick/i,
      /call.*out/i,
      /callout/i,
    ],
    response: function(data) {
      const openShifts = data.openShifts ?? [];
      if (!openShifts.length) {
        return { text: "Right now all your shifts are covered. If someone calls out, I can help find a backup — want to see who's available?" };
      }
      return {
        text: `You have ${openShifts.length} shift${openShifts.length > 1 ? 's' : ''} that need coverage. Want me to suggest who could fill them?`,
        data: { type: 'coverage_check', count: openShifts.length },
      };
    },
  },
];

/**
 * Match a user question to an intent.
 * Returns the first matching intent, or null.
 */
export function matchIntent(question) {
  const lower = question.toLowerCase();
  for (const intent of LITE_INTENTS) {
    for (const pattern of intent.patterns) {
      if (pattern.test(lower)) {
        return intent;
      }
    }
  }
  return null;
}

/**
 * Generate a Bubbles Lite response for a question.
 * @param {string} question - The user's question
 * @param {object} data - Data from the database to fill responses
 * @returns {object} { text, intent?, data: bool }
 */
export function liteResponse(question, data = {}) {
  const intent = matchIntent(question);
  if (!intent) {
    return {
      text: `I don't have an AI key configured, so I can't answer that question yet. But I can help with:\n\n• Your daily briefing ("Good morning" or "What's happening today?")\n• Today's jobs and crew status\n• Open shifts and coverage gaps\n• Applicants waiting for review\n• Quote requests\n• Email notification health\n• Setup help\n\nTry asking about any of those, or add an API key to unlock full Bubbles.`,
      intent: null,
      isFallback: true,
    };
  }
  try {
    const result = intent.response(data);
    return { text: result.text, intent: intent.id, data: result.data || null, isFallback: false };
  } catch {
    return {
      text: "I had trouble pulling that up. Can you try asking in a different way?",
      intent: intent.id,
      isFallback: false,
    };
  }
}

/**
 * Build the data object Bubbles Lite needs from database query results.
 * @param {object} dbResults - Raw counts and lists from the database
 * @returns {object} Normalized data for intent responses
 */
export function buildLiteData(dbResults) {
  return {
    completedJobs: dbResults.completedJobs ?? 0,
    scheduledJobs: dbResults.scheduledJobs ?? 0,
    openShifts: dbResults.openShifts ?? [],
    newApplicants: dbResults.newApplicants ?? 0,
    newQuotes: dbResults.newQuotes ?? 0,
    availableCrew: dbResults.availableCrew ?? [],
    workingCrew: dbResults.workingCrew ?? [],
    applicantCount: dbResults.applicantCount ?? 0,
    recentApplicants: dbResults.recentApplicants ?? [],
    quoteCount: dbResults.quoteCount ?? 0,
    emailStatus: dbResults.emailStatus ?? 'unknown',
    jobs: dbResults.jobs ?? [],
  };
}
