import test from 'node:test';
import assert from 'node:assert/strict';
import { directionsUrl } from '../lib/site-guide.mjs';
test('directions use a fixed Google Maps origin and safely encoded destination',()=>{
 const url=new URL(directionsUrl('  123 Main St & 2nd Ave, Lafayette, LA  '));
 assert.equal(url.origin,'https://www.google.com');assert.equal(url.pathname,'/maps/dir/');assert.equal(url.searchParams.get('api'),'1');assert.equal(url.searchParams.get('destination'),'123 Main St & 2nd Ave, Lafayette, LA');assert.equal(url.searchParams.get('travelmode'),'driving');
 const escaped=new URL(directionsUrl('https://evil.test/?x=1&y=2'));assert.equal(escaped.hostname,'www.google.com');assert.equal(escaped.searchParams.get('destination'),'https://evil.test/?x=1&y=2');
});
test('missing, malformed, and overly long addresses fail closed',()=>{for(const input of [null,undefined,0,'','   ','a\nb','a\u0000b','x'.repeat(401),'😀'.repeat(200)]) assert.equal(directionsUrl(input),null)});
test('international addresses are preserved',()=>{const url=new URL(directionsUrl('Calle José, San Juan'));assert.equal(url.searchParams.get('destination'),'Calle José, San Juan')});
