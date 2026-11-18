import test from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_ACK, demoModeEnabled, ownerAccessEnabled, developmentLoginEnabled, developmentIntakeConfig, developmentReferralsEnabled } from '../lib/auth-config.mjs';
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

const demo = {
  ...config,
  NODE_ENV: 'production',
  APP_ORIGIN: 'https://demo.example.test',
  DEMO_MODE: 'true',
  DEMO_MODE_ACK: 'I_UNDERSTAND_SYNTHETIC_DATA_ONLY',
};

test('demo access requires independent opt-in, exact acknowledgment, HTTPS origin and project config', () => {
  assert.equal(DEMO_ACK, demo.DEMO_MODE_ACK);
  assert.equal(demoModeEnabled({}), false);
  assert.equal(demoModeEnabled(config), false);
  assert.equal(demoModeEnabled(demo), true);
  for (const changes of [
    { DEMO_MODE: undefined }, { DEMO_MODE: 'TRUE' }, { DEMO_MODE: 'false' },
    { DEMO_MODE_ACK: undefined }, { DEMO_MODE_ACK: `${DEMO_ACK} ` },
    { NEXT_PUBLIC_SUPABASE_URL: '' }, { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: ' ' },
    { APP_ORIGIN: 'not a URL' }, { APP_ORIGIN: 'http://localhost:3000' },
    { APP_ORIGIN: 'https://demo.example.test/' }, { APP_ORIGIN: 'https://demo.example.test/path' },
    { APP_ORIGIN: 'https://demo.example.test?query' }, { APP_ORIGIN: 'https://demo.example.test#hash' },
    { APP_ORIGIN: 'https://user@demo.example.test' },
  ]) {
    assert.equal(demoModeEnabled({ ...demo, ...changes }), false);
    assert.equal(ownerAccessEnabled({ ...demo, ...changes }), false);
  }
});

test('demo login grants no additional intake or employee referral access', () => {
  const allFlags = {
    ...demo, INTAKE_ENABLED: 'true', REFERRALS_ENABLED: 'true', SUPABASE_SERVICE_ROLE_KEY: 'test',
    TURNSTILE_SECRET_KEY: 'test', NEXT_PUBLIC_TURNSTILE_SITE_KEY: 'test',
  };
  assert.equal(ownerAccessEnabled(config), true);
  assert.equal(ownerAccessEnabled({}), false);
  assert.equal(ownerAccessEnabled(allFlags), true);
  assert.equal(developmentLoginEnabled(allFlags), false);
  assert.equal(developmentIntakeConfig(allFlags), null);
  assert.equal(developmentReferralsEnabled(allFlags), false);
  const dev = { ...allFlags, NODE_ENV: 'development', OWNER_EMAIL_LINK_ENABLED: 'false' };
  assert.equal(ownerAccessEnabled(dev), true);
  assert.equal(developmentReferralsEnabled(dev), false);
  assert.equal(developmentReferralsEnabled({ ...dev, OWNER_EMAIL_LINK_ENABLED: 'true' }), true);
});
