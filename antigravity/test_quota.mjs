import assert from 'node:assert/strict';
import quotaWidget from './antigravity_quota.js';

const groups = [
  { displayName: 'Claude / 3P', buckets: [
    { window: '5h', remainingFraction: 0, resetTime: new Date(Date.now() + 90 * 60000).toISOString() },
    { window: 'weekly', remainingFraction: 0.42, resetTime: new Date(Date.now() + 2 * 86400000).toISOString() }
  ] },
  { displayName: 'Gemini', buckets: [
    { window: '5h', remainingFraction: 1 },
    { window: 'weekly', remainingFraction: 0.19 }
  ] }
];
const requests = [];
const http = { post: async (url, options) => {
  requests.push({ url, options });
  return { json: async () => url.includes('oauth2')
    ? { access_token: 'stub-access-token' } : { groups } };
} };
const palettes = new Set();
function checkColors(element) {
  for (const field of ['textColor', 'borderColor', 'backgroundColor']) {
    if (element[field]) {
      assert.deepEqual(Object.keys(element[field]).sort(), ['dark', 'light']);
      assert.notEqual(element[field].light, element[field].dark);
      palettes.add(field);
    }
  }
  if (element.backgroundGradient) {
    for (const color of element.backgroundGradient.colors) {
      assert.deepEqual(Object.keys(color).sort(), ['dark', 'light']);
      assert.notEqual(color.light, color.dark);
      palettes.add('gradient');
    }
  }
  for (const child of element.children || []) checkColors(child);
}
for (const family of ['systemSmall', 'systemMedium']) {
  const widget = await quotaWidget({ env: { REFRESH_TOKEN: 'stub-refresh-token' }, widgetFamily: family, http });
  assert.equal(widget.type, 'widget');
  assert.equal(widget.backgroundImage, undefined);
  checkColors(widget);
  const cards = family === 'systemSmall' ? widget.children.slice(1) : widget.children[1].children;
  assert.equal(cards.length, 2);
  assert.deepEqual(cards.map(card => card.children.slice(1).map(row => row.children[0].children[3].text)),
    [['0%', '42%'], ['100%', '19%']]);
  for (const [index, card] of cards.entries()) {
    assert.deepEqual(card.children.slice(1).map(row => row.children[0].children[0].text), ['5h', '周']);
    assert.equal(card.children[1].children[0].children[1].text.startsWith('重置 '), true);
    assert.equal(card.children[2].children[0].children[1].text.startsWith('重置 '), true);
    if (index === 0) {
      assert.match(card.children[1].children[0].children[1].text, /^重置 1h 30m$/);
      assert.match(card.children[2].children[0].children[1].text, /^重置 2d 0h$/);
    } else {
      assert.equal(card.children[1].children[0].children[1].text, '重置 —');
    }
    for (const row of card.children.slice(1)) {
      assert.equal(card.alignItems, 'start');
      assert.equal(row.alignItems, 'start');
      assert.equal(row.children[0].children[3].maxLines, 1);
      const track = row.children[1];
      assert.equal(track.height, family === 'systemSmall' ? 4 : 6);
      assert.equal(track.width, family === 'systemSmall' ? 100 : 116);
      assert.deepEqual(Object.keys(track.backgroundColor).sort(), ['dark', 'light']);
      const value = Number.parseInt(row.children[0].children[3].text, 10);
      assert.equal(track.children.length, value === 0 ? 0 : 2);
      if (value > 0) {
        assert.equal(track.children[0].width, track.width * value / 100);
        assert.equal(track.children[0].height, track.height);
        assert.equal(track.children[1].type, 'spacer');
      }
    }
  }
}
assert.equal(requests.length, 4);
assert.match(requests[0].options.body, /refresh_token=stub-refresh-token/);
assert.equal(requests[1].options.headers.Authorization, 'Bearer stub-access-token');
assert.deepEqual([...palettes].sort(), ['backgroundColor', 'borderColor', 'gradient', 'textColor']);
const missing = await quotaWidget({ env: {}, widgetFamily: 'systemSmall' });
assert.equal(missing.children.length, 3);
assert.match(missing.children[1].text, /REFRESH_TOKEN/);
checkColors(missing);
const fail = await quotaWidget({ env: { REFRESH_TOKEN: 'test' }, widgetFamily: 'systemSmall',
  http: { post: async () => ({ ok: false, status: 401,
    json: async () => ({ error: { message: 'invalid_grant' } }) }) } });
assert.equal(fail.children.length, 3);
checkColors(fail);
const empty = await quotaWidget({ env: { REFRESH_TOKEN: 'stub-refresh-token' }, widgetFamily: 'systemMedium',
  http: { post: async url => ({ json: async () => url.includes('oauth2') ? { access_token: 'stub' } : { groups: [] } }) } });
assert.deepEqual(empty.children[1].children.map(card => card.children.slice(1).map(row => row.children[0].children[3].text)),
  [['—', '—'], ['—', '—']]);
for (const card of empty.children[1].children) for (const row of card.children.slice(1)) {
  assert.equal(row.children[0].children[1].text, '重置 —');
  assert.equal(row.children[1].children.length, 0);
}
console.log('PASS: adaptive light/dark progress bars, small/medium quotas, errors, missing-data placeholders');
