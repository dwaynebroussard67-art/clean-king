import { assistantConfig,askAssistant } from '../../../../../lib/assistant.mjs';
import { createOwnerAssistantHandler } from '../../../../../lib/server/owner-assistant-handler.mjs';
import { ownerLoginEnabled,sessionClient } from '../../../../../lib/server/supabase';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=30;
export const POST=createOwnerAssistantHandler({enabled:ownerLoginEnabled,getOrigin:()=>process.env.APP_ORIGIN,createSession:sessionClient,getConfig:provider=>assistantConfig(process.env,provider),ask:askAssistant,connectionTest:true});
