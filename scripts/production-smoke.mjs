// Exercise production build guardrails with synthetic configuration only. Never touches real providers.
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import assert from 'node:assert/strict';

const socket=createServer();
await new Promise((resolve,reject)=>{socket.once('error',reject);socket.listen(0,'127.0.0.1',resolve)});
const port=socket.address().port;
await new Promise(resolve=>socket.close(resolve));
const env={...process.env,NODE_ENV:'production',PORT:String(port),APP_ORIGIN:'https://synthetic.example',
 INTAKE_ENABLED:'true',REFERRALS_ENABLED:'true',OWNER_EMAIL_LINK_ENABLED:'true',OWNER_ASSISTANT_ENABLED:'false',
 APPLICATION_EMAIL_NOTIFICATIONS_ENABLED:'false',NEXT_PUBLIC_SUPABASE_URL:'https://example.supabase.co',
 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'synthetic',SUPABASE_SERVICE_ROLE_KEY:'synthetic',
 NEXT_PUBLIC_TURNSTILE_SITE_KEY:'synthetic',TURNSTILE_SECRET_KEY:'synthetic',OPENAI_API_KEY:'',RESEND_API_KEY:'',CRON_SECRET:''};
const child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(port)],{env,stdio:['ignore','pipe','pipe']});
let logs='';
try{
 await new Promise((resolve,reject)=>{
  const timeout=setTimeout(()=>reject(Error(`Production server did not become ready: ${logs}`)),30000);
  const onData=chunk=>{logs+=chunk.toString();if(logs.includes('Ready in')){clearTimeout(timeout);resolve()}};
  child.stdout.on('data',onData);child.stderr.on('data',onData);
  child.once('exit',code=>{clearTimeout(timeout);reject(Error(`Production server exited ${code}: ${logs}`))});
 });
 const base=`http://127.0.0.1:${port}`;
 const owner=await fetch(`${base}/owner/login`);const html=await owner.text();
 assert.equal(owner.status,200);assert.match(html,/Owner sign-in is not configured/);assert.match(owner.headers.get('cache-control')||'',/no-store/);
 const crew=await fetch(`${base}/crew/referrals`);assert.equal(crew.status,200);assert.match(await crew.text(),/Employee referrals are not available yet/);assert.match(crew.headers.get('cache-control')||'',/no-store/);
 const intake=await fetch(`${base}/api/intake`,{method:'POST',headers:{origin:'https://synthetic.example','content-type':'application/json'},body:'{}'});assert.equal(intake.status,503);
 console.log('Production guards: owner development login, referral pages and intake fail closed.');
} finally { child.kill('SIGTERM'); }
