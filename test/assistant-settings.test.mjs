import test from 'node:test';import assert from 'node:assert/strict';import {parseAssistantSettings} from '../lib/assistant-settings.mjs';
const form=(o={})=>{const f=new FormData();for(const [k,v] of Object.entries({owner_name:' Andy ',provider:'anthropic',persona:'enthusiastic',per_minute:'3',per_month:'100',...o}))f.append(k,v);return f};
test('settings are strictly bounded and reject control characters or duplicate fields',()=>{
 assert.deepEqual(parseAssistantSettings(form()),{p_name:'Andy',p_provider:'anthropic',p_persona:'enthusiastic',p_counts:false,p_minute:3,p_month:100});
 for(const value of [{per_month:'101'},{per_minute:'4'},{per_minute:'1.0'},{provider:'other'},{owner_name:'A\nB'},{persona:'system prompt'}])assert.equal(parseAssistantSettings(form(value)),null);
 const f=form();f.append('provider','open');assert.equal(parseAssistantSettings(f),null);
});
