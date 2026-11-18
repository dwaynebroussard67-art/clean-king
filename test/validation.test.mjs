import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidPhone } from '../lib/validation.mjs';
test('phone validation accepts common formats and rejects boundary and malformed values',()=>{
 for(const phone of ['3375550199',' (337) 555-0199 ','+1 337-555-0199','123456789012345']) assert.equal(isValidPhone(phone),true,phone);
 for(const phone of [null,'','123456789','1234567890123456','123456789x','--3375550199--'.repeat(3),'337\n5550199','++13375550199']) assert.equal(isValidPhone(phone),false,String(phone));
});
