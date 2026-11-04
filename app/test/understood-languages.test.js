const assert = require('node:assert/strict');
const { translateLines } = require('../src/translate');
let calls = [];
let language = 'id';
global.fetch = async (url, options) => {
  const params = new URL(url).searchParams;
  const translated = params.getAll('dt').includes('t');
  calls.push(translated);
  return { ok: true, json: async () => [translated ? [['Hello', 'Halo']] : [[null, null, null, 'Halo']], null, language] };
};
(async () => {
  const skipped = await translateLines('id-song', ['Halo'], 'en', ['id']);
  assert.equal(skipped.skipped, true);
  assert.equal(skipped.items[0].tr, '');
  assert.deepEqual(calls, [false], 'excluded song never requests translated text');
  calls = [];
  const included = await translateLines('id-song', ['Halo'], 'en', []);
  assert.equal(included.items[0].tr, 'Hello');
  assert.deepEqual(calls, [true], 'changing exclusions does not reuse a suppressed cache entry');
  calls = [];
  language = 'id-ID';
  assert.equal((await translateLines('regional', ['Halo'], 'en', ['ID'])).skipped, true);
  assert.deepEqual(calls, [false]);
  language = 'ja';
  global.fetch = async url => {
    const translated = new URL(url).searchParams.getAll('dt').includes('t');
    assert.equal(translated, false);
    return { ok: true, json: async () => [[[null, null, null, 'konnichiwa']], null, 'ja'] };
  };
  const romanized = await translateLines('japanese', ['こんにちは'], 'en', ['ja']);
  assert.equal(romanized.items[0].tr, '');
  assert.equal(romanized.items[0].rom, 'konnichiwa', 'romanization is preserved');
  console.log('Language exclusions, cache changes, regional codes and romanization passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
