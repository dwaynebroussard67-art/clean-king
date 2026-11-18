import test from 'node:test';
import assert from 'node:assert/strict';
import { getRequestId, clearRequestId } from '../lib/idempotency.mjs';
const id='11111111-1111-4111-8111-111111111111', next='22222222-2222-4222-8222-222222222222';
function storage(){const data=new Map();return {data,getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)}}
test('request IDs survive reload in a tab without storing personal information',()=>{
 const s=storage();assert.equal(getRequestId(s,'application',()=>id),id);assert.equal(getRequestId(s,'application',()=>next),id);assert.equal(getRequestId(s,'quote',()=>next),next);
 assert.deepEqual([...s.data.values()].sort(),[id,next].sort());
 clearRequestId(s,'application',next);assert.equal(getRequestId(s,'application',()=>next),id);
 clearRequestId(s,'application',id);assert.equal(getRequestId(s,'application',()=>next),next);
});
test('corrupt or inaccessible session storage safely falls back to fresh IDs',()=>{
 const s=storage();s.setItem('goodwork:intake:v1:application','bad');assert.equal(getRequestId(s,'application',()=>id),id);
 const blocked={getItem(){throw Error()},setItem(){throw Error()},removeItem(){throw Error()}};
 assert.equal(getRequestId(blocked,'quote',()=>next),next);assert.doesNotThrow(()=>clearRequestId(blocked,'quote',next));
});
