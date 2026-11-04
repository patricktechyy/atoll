// Google throttles the anonymous `gtx` client (HTTP 429), which broke lyric translation AND romanization.
// translate.js must use the `dict-chrome-ex` client first and fall back to `gtx`, and remember what worked.
const assert = require('node:assert/strict');
const { translateLines, fixLanguage, CLIENTS } = require('../src/translate');

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

  // Google labels Traditional Chinese lyrics "en". Atoll hides the translation for an "en" song, so the label
  // must be corrected from the script, with or without "understood" languages.
  const zh = ['也不是真的不會想你', '我會想你', '夜深了我還是睡不著'];
  global.fetch = async (url) => {
    const withText = new URL(url).searchParams.getAll('dt').includes('t');
    return { ok: true, json: async () => [withText
      ? [['It is not that I do not miss you\ni will miss you\nit is late and I cannot sleep', zh.join('\n')], [null, null, null, 'Yě bùshì\nWǒ huì\nYè shēn le']]
      : [[null, null, null, 'Yě bùshì\nWǒ huì\nYè shēn le']], null, 'en'] };
  };
  for (const understood of [[], ['en', 'id']]) {
    const r = await translateLines('zh-labelled-en-' + understood.length, zh, 'en', understood);
    assert.equal(r.lang, 'zh');
    assert.equal(r.skipped, false, 'a Chinese song is not "a language you understand" because Google said en');
    assert.equal(r.same, false, 'a Chinese song is not already in English');
    assert.equal(r.items[0].tr, 'It is not that I do not miss you');
    assert.equal(r.items[0].rom, 'Yě bùshì');
  }

  // the override only fires when the script disagrees with a Latin-language label
  assert.equal(fixLanguage('en', ['Hello there', 'How are you']), 'en', 'English stays English');
  assert.equal(fixLanguage('en', ['I love you', 'baby baby', '我愛你']), 'en', 'mostly Latin with a little Chinese is left alone');
  assert.equal(fixLanguage('zh-CN', zh), 'zh-CN', 'a correct non-Latin label is kept');
  assert.equal(fixLanguage('ko', ['안녕']), 'ko');
  assert.equal(fixLanguage('en', ['こんにちは世界', '愛してる']), 'ja', 'kana means Japanese even with Han');
  assert.equal(fixLanguage('en', ['안녕하세요', '사랑해']), 'ko');
  assert.equal(fixLanguage('id', ['Привет', 'мир']), 'ru');
  assert.equal(fixLanguage('', ['']), '');
  console.log('Script-based language correction passed.');
})().catch((e) => { console.error(e); process.exitCode = 1; });
