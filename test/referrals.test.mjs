import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeReferralCode } from '../lib/referrals.mjs';
import { parseIntake } from '../lib/intake.mjs';

test('referral codes normalize and reject malformed input without granting profile access', () => {
 assert.equal(normalizeReferralCode('  '+ 'A'.repeat(64)+' '),'a'.repeat(64));
 for (const x of ['',null,'a'.repeat(63),'g'.repeat(64),'a'.repeat(65),'a'.repeat(32)+'\n'+'a'.repeat(32)]) assert.equal(normalizeReferralCode(x),null);
 const base={kind:'application',formLanguage:'en',requestId:'11111111-1111-4111-8111-111111111111',token:'test',data:{firstName:'Example',phone:'3375550199',area:'Example',shifts:['nights'],transportation:'yes',languages:['en'],referrer:'',smsConsent:false}};
 assert.equal(parseIntake({...base,data:{...base.data,referralCode:'A'.repeat(64)}}).data.referralCode,'a'.repeat(64));
 assert.equal(parseIntake({...base,data:{...base.data,referralCode:'bad'}}),null);
 assert.equal(parseIntake({...base,data:{...base.data,referralCode:'',contacts:['private']}}),null);
});
