import 'server-only';
import { adminClient, intakeConfig } from './supabase';
import { deliverApplicationEmail, notificationConfig, processQueue } from '../notifications.mjs';

// Called after intake and by the protected scheduler. Never log applicant data or provider responses.
export async function processApplicationNotifications(limit = 1) {
  const config = notificationConfig(process.env);
  const client = adminClient();
  if (!config || !client || !intakeConfig()) return { configured: false, processed: 0, errors: 0 };
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

// Caller must authenticate the scheduler before returning these aggregate counts.
export async function applicationNotificationHealth() {
  const config=notificationConfig(process.env), client=adminClient();
  if(!config || !client || !intakeConfig()) return {configured:false};
  const {data,error}=await client.rpc('application_notification_health');
  const row=data?.[0];
  if(error || !row || !Number.isSafeInteger(row.failed_count) || row.failed_count<0 || !Number.isSafeInteger(row.overdue_count) || row.overdue_count<0) throw new Error('Queue health unavailable');
  return {configured:true,failed:row.failed_count,overdue:row.overdue_count};
}
