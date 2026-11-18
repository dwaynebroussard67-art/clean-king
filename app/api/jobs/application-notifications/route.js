import { applicationNotificationHealth, processApplicationNotifications } from '../../../../lib/server/application-notifications';
import { createNotificationHandler } from '../../../../lib/server/notification-handler.mjs';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export const GET=createNotificationHandler({
  getSecret:()=>process.env.CRON_SECRET,
  processNotifications:processApplicationNotifications,
  checkHealth:applicationNotificationHealth,
});
