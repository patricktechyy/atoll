// Google throttles the anonymous `gtx` client (HTTP 429), which broke lyric translation AND romanization.
// translate.js must use the `dict-chrome-ex` client first and fall back to `gtx`, and remember what worked.
const assert = require('node:assert/strict');
const { translateLines, fixLanguage, CLIENTS, resetRateLimit } = require('../src/translate');

// 愛してる has kanji, so Google's romanization is still needed for it (local rules cover kana, Hangul, Chinese, Cyrillic, Greek)
const answer = (client) => ({ ok: true, json: async () => [[['I love you', '愛してる'], [null, null, null, 'Aishiteru']], null, 'ja'] });
const refused = { ok: false, status: 429 };

(async () => {
  let seen = [];
  global.fetch = async (url) => { const c = new URL(url).searchParams.get('client'); seen.push(c); return answer(c); };
  const first = await translateLines('song-1', ['愛してる'], 'en', []);
  assert.deepEqual(seen, ['dict-chrome-ex'], 'the unthrottled client is tried first');
  assert.equal(first.items[0].tr, 'I love you');
  assert.equal(first.items[0].rom, 'Aishiteru', 'Google romanization is used for lines the local rules cannot read');

  // dict-chrome-ex refused -> gtx is used, and is then remembered as the first choice
  seen = [];
  global.fetch = async (url) => { const c = new URL(url).searchParams.get('client'); seen.push(c); return c === 'dict-chrome-ex' ? refused : answer(c); };
  const second = await translateLines('song-2', ['愛してる'], 'en', []);
  assert.deepEqual(seen, ['dict-chrome-ex', 'gtx']);
  assert.equal(second.items[0].tr, 'I love you');
  assert.equal(CLIENTS[0], 'gtx');

  // both refused -> the error reaches the caller instead of silently returning nothing
  global.fetch = async () => refused;
  await assert.rejects(() => translateLines('song-3', ['愛してる'], 'en', []), /429/);
  console.log('Translate client fallback passed.');

  // Blocked network: Google keeps refusing. Local romanization must survive, the failure is flagged, and we
  // stop hammering the endpoint during the cooldown.
  resetRateLimit();
  let calls = 0;
  global.fetch = async () => { calls++; return refused; };
  const ko = ['너를 사랑해', '안녕하세요'];
  const blocked = await translateLines('blocked-ko', ko, 'en', []);
  assert.equal(blocked.partial, true);
  assert.equal(blocked.lang, 'ko', 'language falls back to script detection');
  assert.deepEqual(blocked.items.map((i) => i.rom), ['Neoreul saranghae', 'Annyeonghaseyo']);
  assert.deepEqual(blocked.items.map((i) => i.tr), ['', '']);
  const attempts = calls;
  await translateLines('blocked-ko-2', ko, 'en', []);
  assert.equal(calls, attempts, 'no more requests while Google is refusing us');
  const jp = await translateLines('blocked-kana', ['ありがとう'], 'en', ['ja']);
  assert.equal(jp.skipped, true, 'a language you understand is still recognised offline');
  assert.equal(jp.items[0].rom, 'Arigatou');
  // kanji can't be read locally: with Google blocked there is nothing to show, and the error surfaces
  await assert.rejects(() => translateLines('blocked-kanji', ['愛してる'], 'en', []), /429/);
  // Chinese is read locally, so a blocked Google still leaves pinyin
  const cn = await translateLines('blocked-zh', ['我爱你'], 'en', []);
  assert.equal(cn.partial, true);
  assert.equal(cn.items[0].rom, 'Wǒ ài nǐ');
  // local romanization means no romanization request goes to Google for Korean
  resetRateLimit();
  const wanted = [];
  global.fetch = async (url) => { wanted.push(new URL(url).searchParams.getAll('dt')); return { ok: true, json: async () => [[['I love you\nHello', ko.join('\n')]], null, 'ko'] }; };
  const online = await translateLines('online-ko', ko, 'en', []);
  assert.deepEqual(wanted, [['t']], 'only the translation is requested');
  assert.deepEqual(online.items.map((i) => i.tr), ['I love you', 'Hello']);
  assert.equal(online.items[0].rom, 'Neoreul saranghae');
  resetRateLimit();

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
    assert.equal(r.items[0].rom, 'Yě bú shì zhēn de bú huì xiǎng nǐ', 'Chinese is romanized locally (pinyin), not by Google');
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
