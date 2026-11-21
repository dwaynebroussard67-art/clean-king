import test from 'node:test';
import assert from 'node:assert/strict';
import { developmentLoginEnabled, developmentIntakeConfig } from '../lib/auth-config.mjs';
const config={NODE_ENV:'development',OWNER_EMAIL_LINK_ENABLED:'true',NEXT_PUBLIC_SUPABASE_URL:'https://example.supabase.co',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'test',APP_ORIGIN:'http://localhost:3000'};
test('development email-link access fails closed in production even when enabled',()=>{
 assert.equal(developmentLoginEnabled(config),true);
 assert.equal(developmentLoginEnabled({...config,NODE_ENV:'production',APP_ORIGIN:'https://example.com'}),false);
 assert.equal(developmentLoginEnabled({...config,NODE_ENV:undefined}),false);
 assert.equal(developmentLoginEnabled({...config,OWNER_EMAIL_LINK_ENABLED:'false'}),false);
 assert.equal(developmentLoginEnabled({...config,APP_ORIGIN:'http://attacker.test'}),false);
 assert.equal(developmentLoginEnabled({...config,APP_ORIGIN:'https://example.test/path'}),false);
 assert.equal(developmentLoginEnabled({...config,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:''}),false);
});

test('intake fails closed in production even when all test flags are enabled',()=>{
 const env={...config,INTAKE_ENABLED:'true',TURNSTILE_SECRET_KEY:'test',NEXT_PUBLIC_TURNSTILE_SITE_KEY:'test',SUPABASE_SERVICE_ROLE_KEY:'test'};
 assert.equal(developmentIntakeConfig(env).hostname,'localhost');
 assert.equal(developmentIntakeConfig({...env,NODE_ENV:'production',APP_ORIGIN:'https://example.test'}),null);
 assert.equal(developmentIntakeConfig({...env,APP_ORIGIN:'ftp://localhost'}),null);
 assert.equal(developmentIntakeConfig({...env,APP_ORIGIN:'http://localhost:3000/path'}),null);
 assert.equal(developmentIntakeConfig({...env,INTAKE_ENABLED:'false'}),null);
 assert.equal(developmentIntakeConfig({...env,TURNSTILE_SECRET_KEY:''}),null);
});
