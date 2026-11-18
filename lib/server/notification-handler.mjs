import { timingSafeEqual } from 'node:crypto';
import { notificationWorkerStatus } from '../notifications.mjs';
const reply=(body,status)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
export function createNotificationHandler({getSecret,processNotifications,checkHealth}) {
  return async function handle(request) {
    const secret=getSecret(), supplied=request.headers.get('authorization')||'';
    const expected=`Bearer ${secret||''}`;
    if(!secret || secret.length<32 || Buffer.byteLength(supplied)!==Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(supplied),Buffer.from(expected))) return reply({error:'Unauthorized'},401);
    try {
      const result=await processNotifications(5), health=await checkHealth();
      return reply({...result,health},notificationWorkerStatus(result,health));
    } catch {return reply({error:'Worker unavailable'},503)}
  };
}
