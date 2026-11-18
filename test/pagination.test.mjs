import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeCursor,decodeCursor,beforeFilter,ownerPageLink } from '../lib/pagination.mjs';
const row={created_at:'2026-11-17T10:11:12.123456+00:00',id:'11111111-1111-4111-8111-111111111111'};
test('keyset cursor preserves microsecond precision and ties by ID',()=>{
 const cursor=encodeCursor(row);assert.ok(cursor);assert.deepEqual(decodeCursor(cursor),row);
 assert.equal(beforeFilter(row),'created_at.lt.2026-11-17T10:11:12.123456+00:00,and(created_at.eq.2026-11-17T10:11:12.123456+00:00,id.lt.11111111-1111-4111-8111-111111111111)');
});
test('cursor rejects tampering, unbounded input, invalid dates and filter injection',()=>{
 for(const value of [null,[],123,'', 'a'.repeat(201), 'AAAA=', 'a/b', Buffer.from(JSON.stringify([row.created_at+',x',row.id])).toString('base64url'),Buffer.from(JSON.stringify([row.created_at,row.id+'),or(x)'])).toString('base64url'),Buffer.from(JSON.stringify(['not-date',row.id])).toString('base64url')]) assert.equal(decodeCursor(value),null);
 assert.equal(encodeCursor({...row,id:'fake'}),null);assert.equal(beforeFilter({...row,created_at:'x),id.eq.*'}),null);
});

test('pagination resets one section without losing the other cursor',()=>{
 const a=encodeCursor(row), b=encodeCursor({...row,id:'22222222-2222-4222-8222-222222222222'});
 assert.equal(ownerPageLink('apps',null,a,b),`/owner?leads=${b}`);
 assert.equal(ownerPageLink('leads',null,a,b),`/owner?apps=${a}`);
 assert.equal(ownerPageLink('apps',b,a,b),`/owner?apps=${b}&leads=${b}`);
 assert.equal(ownerPageLink('apps',null,a,null),'/owner');
 assert.throws(()=>ownerPageLink('invalid',null,a,b));
});
