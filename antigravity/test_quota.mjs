import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import { Buffer } from 'node:buffer';
import quotaWidget from './antigravity_quota.js';

// Node canvas shim exercises the same OffscreenCanvas 2D drawing path as Egern.
globalThis.OffscreenCanvas = class {
  constructor(w, h) { this.canvas = createCanvas(w, h); }
  getContext(t) { return this.canvas.getContext(t); }
  async convertToBlob() {
    const buffer = await this.canvas.encode('png');
    return { arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) };
  }
};

let requests = [];
const groups = [
  { displayName: 'Claude / 3P', buckets: [
    { window: '5h', remainingFraction: 0, resetTime: new Date(Date.now() + 3600000).toISOString() },
    { window: 'weekly', remainingFraction: 0.42, resetTime: new Date(Date.now() + 86400000).toISOString() }
  ] },
  { displayName: 'Gemini', buckets: [
    { window: '5h', remainingFraction: 1, resetTime: 'bad-date' },
    { window: 'weekly', remainingFraction: 0.19 }
  ] }
];
const http = { post: async (url, options) => {
  requests.push({url, options});
  if (url.includes('oauth2')) return { json: async () => ({access_token:'stub-access-token'}) };
  return { json: async () => ({groups}) };
}};
function png(result, name, width) {
  assert.equal(result.type, 'widget');
  assert.equal(result.padding, 0);
  assert.match(result.backgroundImage, /^data:image\/png;base64,/);
  const bytes = Buffer.from(result.backgroundImage.split(',')[1], 'base64');
  assert.equal(bytes.readUInt32BE(16), width * 3);
  assert.equal(bytes.readUInt32BE(20), 540);
  writeFileSync(name, bytes);
  return bytes;
}
for (const family of ['systemSmall', 'systemMedium']) {
  const result = await quotaWidget({env:{REFRESH_TOKEN:'stub-refresh-token'}, widgetFamily:family, http});
  png(result, `/root/.hermes/cache/scratch/antigravity-${family}.png`, family === 'systemSmall' ? 180 : 380);
}
assert.equal(requests.length, 4);
assert.match(requests[0].options.body, /refresh_token=stub-refresh-token/);
assert.equal(requests[1].options.headers.Authorization, 'Bearer stub-access-token');
for (const family of ['systemSmall', 'systemMedium']) {
  const result = await quotaWidget({env:{}, widgetFamily:family});
  png(result, `/root/.hermes/cache/scratch/antigravity-error-${family}.png`, family === 'systemSmall' ? 180 : 380);
}
const fail = await quotaWidget({env:{REFRESH_TOKEN:'test'}, widgetFamily:'systemSmall', http:{post: async () => ({ok:false,status:401,json:async()=>({error:{message:'invalid_grant'}})})}});
png(fail, '/root/.hermes/cache/scratch/antigravity-api-error.png',180);
const oldCanvas = globalThis.OffscreenCanvas;
globalThis.OffscreenCanvas = undefined;
const fallback = await quotaWidget({env:{}});
assert.equal(fallback.type, 'widget');
assert.equal(fallback.children.length, 3);
assert.match(fallback.children[1].text, /REFRESH_TOKEN/);
for (const family of ['systemSmall', 'systemMedium']) {
  const native = await quotaWidget({env:{REFRESH_TOKEN:'stub-refresh-token'}, widgetFamily:family, http});
  assert.equal(native.type, 'widget');
  const cards = family === 'systemSmall' ? native.children.slice(1) : native.children[1].children;
  assert.equal(cards.length, 2);
  assert.deepEqual(cards.map(card => card.children.slice(1).map(row => row.children[2].text)),
    [['0%', '42%'], ['100%', '19%']]);
  for (const card of cards) {
    for (const row of card.children.slice(1)) {
      assert.equal(row.children[2].maxLines, 1);
    }
  }
}
const empty = await quotaWidget({env:{REFRESH_TOKEN:'stub-refresh-token'}, widgetFamily:'systemMedium',
  http:{post:async url => ({json:async()=> url.includes('oauth2') ? {access_token:'stub'} : {groups:[]}})}});
assert.deepEqual(empty.children[1].children.map(card => card.children.slice(1).map(row => row.children[2].text)),
  [['—', '—'], ['—', '—']]);
globalThis.OffscreenCanvas = oldCanvas;
console.log('PASS: canvas sizes, errors, native fallback quotas, missing-data placeholders');
