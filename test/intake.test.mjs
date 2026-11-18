import test from 'node:test';
import assert from 'node:assert/strict';
import { parseIntake, toRow } from '../lib/intake.mjs';
const base = {kind:'application',formLanguage:'en',requestId:'f7019507-387d-4c40-8d4d-48eef3df98a0',token:'valid-token',data:{firstName:' Maria ',phone:'(337) 555-0199',area:'Lafayette',shifts:['nights'],transportation:'yes',languages:['en','es'],referrer:'',smsConsent:true}};
test('application trims fields and records explicit text consent',()=>{const parsed=parseIntake(base);assert.equal(parsed.data.firstName,'Maria');const row=toRow(parsed);assert.equal(row.sms_consent,true);assert.ok(row.consented_at);assert.equal(row.referrer,null);});
test('applicant may decline text consent without a false timestamp',()=>{const row=toRow(parseIntake({...base,data:{...base.data,smsConsent:false}}));assert.equal(row.sms_consent,false);assert.equal(row.consented_at,null)});
test('bad and hostile applications fail validation',()=>{for(const changes of [{firstName:''},{phone:'hi'},{shifts:[]},{shifts:['nights','nights']},{transportation:'maybe'},{languages:['fr']},{smsConsent:'true'},{firstName:'x'.repeat(81)},{status:'hired'}])assert.equal(parseIntake({...base,data:{...base.data,...changes}}),null);assert.equal(parseIntake({...base,requestId:'not-a-uuid'}),null);assert.equal(parseIntake({...base,unexpected:true}),null)});
test('quote requires building type and valid contact',()=>{const quote={kind:'quote',formLanguage:'es',requestId:base.requestId,token:'token',data:{buildingType:'hospital',size:'unsure',frequency:'weekly',name:'Jordan',phone:'3375550199',email:'jordan@example.com'}};assert.equal(toRow(parseIntake(quote)).building_type,'hospital');assert.equal(parseIntake({...quote,data:{...quote.data,buildingType:'unknown'}}),null);assert.equal(parseIntake({...quote,data:{...quote.data,email:'bad'}}),null)});

test('optional experience answers are validated and preserved without assuming missing answers',()=>{
 const data={...base.data,experienceLevel:'under_one',commercialExperience:'yes',residentialExperience:'no',equipmentExperience:null,trainingWillingness:'unsure'};
 const row=toRow(parseIntake({...base,data}));
 assert.equal(row.experience_level,'under_one'); assert.equal(row.commercial_experience,'yes'); assert.equal(row.residential_experience,'no'); assert.equal(row.equipment_experience,null); assert.equal(row.training_willingness,'unsure');
 assert.equal(toRow(parseIntake(base)).experience_level,null);
 for(const changes of [{experienceLevel:'expert'},{commercialExperience:true},{residentialExperience:'unknown'},{equipmentExperience:''},{trainingWillingness:'maybe'}]) assert.equal(parseIntake({...base,data:{...data,...changes}}),null);
});
