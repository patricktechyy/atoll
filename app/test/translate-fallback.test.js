// Google throttles the anonymous `gtx` client (HTTP 429), which broke lyric translation AND romanization.
// translate.js must use the `dict-chrome-ex` client first and fall back to `gtx`, and remember what worked.
const assert = require('node:assert/strict');
const { translateLines, CLIENTS } = require('../src/translate');

const answer = (client) => ({ ok: true, json: async () => [[['Hello', 'こんにちは'], [null, null, null, "Kon'nichiwa"]], null, 'ja'] });
const refused = { ok: false, status: 429 };

(async () => {
  let seen = [];
  global.fetch = async (url) => { const c = new URL(url).searchParams.get('client'); seen.push(c); return answer(c); };
  const first = await translateLines('song-1', ['こんにちは'], 'en', []);
  assert.deepEqual(seen, ['dict-chrome-ex'], 'the unthrottled client is tried first');
  assert.equal(first.items[0].tr, 'Hello');
  assert.equal(first.items[0].rom, "Kon'nichiwa", 'romanization comes through the same request');

  // dict-chrome-ex refused -> gtx is used, and is then remembered as the first choice
  seen = [];
  global.fetch = async (url) => { const c = new URL(url).searchParams.get('client'); seen.push(c); return c === 'dict-chrome-ex' ? refused : answer(c); };
  const second = await translateLines('song-2', ['こんにちは'], 'en', []);
  assert.deepEqual(seen, ['dict-chrome-ex', 'gtx']);
  assert.equal(second.items[0].tr, 'Hello');
  assert.equal(CLIENTS[0], 'gtx');

  // both refused -> the error reaches the caller instead of silently returning nothing
  global.fetch = async () => refused;
  await assert.rejects(() => translateLines('song-3', ['こんにちは'], 'en', []), /429/);
  console.log('Translate client fallback passed.');
})().catch((e) => { console.error(e); process.exitCode = 1; });
