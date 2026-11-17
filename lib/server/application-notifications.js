import 'server-only';
import { adminClient } from './supabase';
import { deliverApplicationEmail, notificationConfig, processQueue } from '../notifications.mjs';

// Called after intake and by the protected scheduler. Never log applicant data or provider responses.
export async function processApplicationNotifications(limit = 1) {
  const config = notificationConfig(process.env);
  const client = adminClient();
  if (!config || !client) return { configured: false, processed: 0, errors: 0 };
  const result = await processQueue({
    limit,
    claim: async () => {
      const { data, error } = await client.rpc('claim_application_notification');
      if (error) throw new Error('Claim failed');
      return data?.[0] || null;
    },
    finish: async (job, delivered) => {
      const { data, error } = await client.rpc('finish_application_notification', { p_id: job.notification_id, p_lease: job.claim_token, p_success: delivered });
      if (error) throw new Error('Finish failed');
      return data === true;
    },
    deliver: (job) => deliverApplicationEmail(job, config),
  });
  return { configured: true, ...result };
}
