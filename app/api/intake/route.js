import { after } from 'next/server';
import { processApplicationNotifications } from '../../../lib/server/application-notifications';
import { adminClient, intakeConfig, referralsEnabled, organizationByOrigin } from '../../../lib/server/supabase';
import { createIntakeHandler } from '../../../lib/server/intake-handler.mjs';

export const runtime = 'nodejs';
export const POST = createIntakeHandler({
  getConfig: intakeConfig,
  referralsEnabled,
  createAdmin: adminClient,
  after,
  processNotifications: processApplicationNotifications,
  organizationByOrigin,
});
