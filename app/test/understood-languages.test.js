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
  assert.equal(romanized.items[0].rom, 'Konnichiwa', 'romanization is preserved (local)');

  // A faithful Google: a request with NO `dt` gets an empty answer and no detected language (this silently dropped
  // the translation of every song whenever "languages I understand" was set, because detection ran first).
  const dts = [];
  global.fetch = async (url) => {
    const dt = new URL(url).searchParams.getAll('dt');
    dts.push(dt.join(','));
    if (!dt.length) return { ok: true, json: async () => [null, null, '', null, null, null, null, []] };
    return { ok: true, json: async () => [dt.includes('t') ? [['Fantasy about castles and colorful swirls', '幻想着城堡和彩色漩涡']] : [[null, null, null, 'Huànxiǎngzhe chéngbǎo']], null, 'zh-CN'] };
  };
  const zh = await translateLines('real-google-zh', ['幻想着城堡和彩色漩涡'], 'en', ['en', 'id']);
  assert.ok(!zh.partial, 'detection must not fail against a real Google answer');
  assert.equal(zh.skipped, false, 'Chinese is not an understood language');
  assert.equal(zh.items[0].tr, 'Fantasy about castles and colorful swirls');
  assert.equal(zh.items[0].rom, 'Huàn xiǎng zhe chéng bǎo hé cǎi sè xuán wō', 'pinyin is local');
  assert.ok(dts.every((d) => d), 'every request names what it wants (dt)');
  console.log('Language exclusions, cache changes, regional codes and romanization passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
