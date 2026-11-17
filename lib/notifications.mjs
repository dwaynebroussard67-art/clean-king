import { z } from 'zod';

const email = z.string().email().max(254);
const origin = (value) => {
  try { const url = new URL(value); return url.protocol === 'https:' && url.origin === value ? value : null; } catch { return null; }
};
export function notificationConfig(env) {
  if (env.APPLICATION_EMAIL_NOTIFICATIONS_ENABLED !== 'true') return null;
  const to = email.safeParse(env.APPLICATION_NOTIFICATION_TO);
  const from = email.safeParse(env.APPLICATION_NOTIFICATION_FROM);
  const appOrigin = origin(env.APP_ORIGIN);
  if (!to.success || !from.success || !appOrigin || !env.RESEND_API_KEY || env.RESEND_API_KEY.length < 10) return null;
  return { to: to.data, from: from.data, origin: appOrigin, apiKey: env.RESEND_API_KEY };
}
// Applicant input is untrusted. Normalize control characters so it cannot forge additional email lines.
const line = (value) => String(value ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim();
const title = (value) => ({days:'Days',nights:'Nights',weekends:'Weekends',en:'English',es:'Spanish'}[value] || line(value));
export function applicationEmail(job, config) {
  return {
    from: config.from,
    to: [config.to],
    subject: 'New applicant ready to review',
    text: [
      'A new application has arrived.', '',
      `First name: ${line(job.first_name)}`,
      `Mobile: ${line(job.phone)}`,
      `Area: ${line(job.area)}`,
      `Available: ${job.shifts.map(title).join(', ')}`,
      `Transportation: ${job.transportation ? 'Yes' : 'No'}`,
      `Languages: ${job.languages.map(title).join(', ')}`,
      `Referred by: ${line(job.referrer) || 'No referral given'}`, '',
      'You can call the applicant using the number above.',
      `Review the full application securely: ${config.origin}/owner`, '',
      'This message contains personal information. Please keep it private.',
    ].join('\n'),
  };
}
export async function deliverApplicationEmail(job, config, fetcher = fetch) {
  const response = await fetcher('https://api.resend.com/emails', {
    method: 'POST', headers: { 'Authorization': `Bearer ${config.apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': `application/${job.notification_id}` },
    body: JSON.stringify(applicationEmail(job, config)), signal: AbortSignal.timeout(8000),
  });
  // Do not persist provider responses: they may contain addresses or other personal data.
  return response.ok;
}

// At most five jobs per invocation so a scheduled serverless run stays bounded.
export async function processQueue({ claim, finish, deliver, limit = 1 }) {
  let processed = 0, errors = 0;
  for (let i = 0; i < Math.min(Math.max(limit, 1), 5); i++) {
    let job;
    try { job = await claim(); } catch { errors++; break; }
    if (!job) break;
    let delivered = false;
    try { delivered = await deliver(job); } catch { /* network failures are retried */ }
    let finished = false;
    try { finished = await finish(job, delivered); } catch { /* lease will expire for recovery */ }
    processed++;
    if (!delivered || !finished) errors++;
    if (!finished) break;
  }
  return { processed, errors };
}
