// Lyric translation + romanization (romaji, pinyin, romanized Korean…) through Google Translate's
// free web endpoint (the one browser extensions use; no API key). It's unofficial, so it can rate
// limit; we translate a whole song in one request and cache it.
const cache = new Map();
const ENDPOINT = 'https://translate.googleapis.com/translate_a/single';

// Response: [[ [translated, original, …], …, [null, null, targetRoman, sourceRoman] ], null, "ja", …]
function parseGtx(data) {
  if (!Array.isArray(data) || !Array.isArray(data[0])) throw new Error('Unexpected translate response');
  const parts = data[0].filter(Array.isArray);
  const text = parts.filter((p) => typeof p[0] === 'string').map((p) => p[0]).join('');
  const rom = parts.filter((p) => p[0] == null && typeof p[3] === 'string').map((p) => p[3]).join('');
  const lang = typeof data[2] === 'string' ? data[2] : (data[8] && data[8][0] && data[8][0][0]) || '';
  return { text, rom, lang };
}

// Google throttles the anonymous `gtx` client hard (HTTP 429 "Sorry..." for every request, which
// broke translation and romanization at once). The `dict-chrome-ex` client (the Chrome dictionary
// extension's) answers with the identical format and is not throttled the same way. Try it first;
// fall back to `gtx` if it is refused. Whichever works last is remembered for the next call.
const CLIENTS = ['dict-chrome-ex', 'gtx'];

async function gtxOnce(client, q, to, translate) {
  const url = `${ENDPOINT}?client=${client}&sl=auto&tl=${encodeURIComponent(to)}${translate ? '&dt=t' : ''}&dt=rm`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8', 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36' },
    body: 'q=' + encodeURIComponent(q)
  });
  if (!res.ok) throw new Error(`Translate returned ${res.status}`);
  return parseGtx(await res.json());
}

async function gtx(q, to, translate = true) {
  let lastError;
  for (const client of [...CLIENTS]) {
    try {
      const out = await gtxOnce(client, q, to, translate);
      if (CLIENTS[0] !== client) { CLIENTS.splice(CLIENTS.indexOf(client), 1); CLIENTS.unshift(client); }
      return out;
    } catch (error) { lastError = error; }
  }
  throw lastError;
}

const splitLines = (s) => s.replace(/\r/g, '').split('\n').map((x) => x.trim());
const isLatin = (s) => !/[^\u0000-ɏḀ-ỿ\s\d\p{P}\p{S}]/u.test(s);

// Google's detected language is sometimes wrong for whole songs: Traditional Chinese lyrics come back as
// "en" (while still being translated correctly). Atoll uses that label to hide the translation ("already in
// your language" / "a language you understand"), so a wrong "en" silently removed the English line.
// If the label names a Latin-script language but the lyrics are mostly another script, trust the script.
const SCRIPTS = [
  ['ja', /[぀-ヿㇰ-ㇿ]/gu],            // kana (any kana means Japanese, even among Han)
  ['ko', /[ᄀ-ᇿ㄰-㆏가-힯]/gu],
  ['zh', /[㐀-䶿一-鿿]/gu],
  ['ru', /[Ѐ-ӿ]/gu],
  ['ar', /[؀-ۿݐ-ݿ]/gu],
  ['he', /[֐-׿]/gu],
  ['th', /[฀-๿]/gu],
  ['hi', /[ऀ-ॿ]/gu],
  ['el', /[Ͱ-Ͽ]/gu]
];
const LATIN_LANGS = new Set(['en', 'id', 'ms', 'es', 'pt', 'fr', 'de', 'it', 'nl', 'sv', 'da', 'no', 'nb', 'fi', 'pl', 'cs', 'tr', 'vi', 'ro', 'hu', 'tl', 'fil', 'sw', 'ca']);
function scriptLanguage(lines) {
  const text = lines.join('\n');
  const letters = (text.match(/\p{L}/gu) || []).length;
  if (!letters) return '';
  const count = (re) => (text.match(re) || []).length;
  const kana = count(SCRIPTS[0][1]);
  let best = '', most = 0;
  for (const [lang, re] of SCRIPTS) { const n = lang === 'ja' ? kana : count(re); if (n > most) { best = lang; most = n; } }
  if (most / letters < 0.5) return '';               // mostly Latin (or mixed): leave Google's answer alone
  return kana ? 'ja' : best;                          // Han characters next to kana are Japanese
}
function fixLanguage(lang, lines) {
  const base = String(lang || '').toLowerCase().split(/[-_]/)[0];
  if (base && !LATIN_LANGS.has(base)) return lang;
  return scriptLanguage(lines) || lang;
}

// lines: ["…", "…"] -> { lang, items: [{ tr, rom }] } (same length as lines)
async function translateLines(key, lines, to = 'en', understoodLanguages = []) {
  const baseLanguage = code => String(code).toLowerCase().split(/[-_]/)[0];
  const understood = [...new Set((Array.isArray(understoodLanguages) ? understoodLanguages : []).map(baseLanguage))].sort();
  const ck = JSON.stringify([key, to, understood]);
  if (cache.has(ck)) return cache.get(ck);
  const idx = [];
  const src = [];
  lines.forEach((l, i) => { const t = (l || '').trim(); if (t && t !== '♪') { idx.push(i); src.push(t); } });
  const items = lines.map(() => ({ tr: '', rom: '' }));
  if (!src.length) return { lang: '', items, same: true };

  // Detect without asking for translated text when the user has exclusions.
  // Romanization remains available even for a language they understand.
  const detected = understood.length ? await gtx(src.join('\n'), to, false) : null;
  const skipped = !!detected && understood.includes(baseLanguage(fixLanguage(detected.lang, src)));
  const whole = skipped ? detected : await gtx(src.join('\n'), to);
  let tr = splitLines(whole.text);
  let rom = whole.rom ? splitLines(whole.rom) : [];
  if ((!skipped && tr.length !== src.length) || (src.some(s => !isLatin(s)) && (rom.length !== src.length || rom.some((r,i) => !r && !isLatin(src[i]))))) {
    // the service merged or split lines: fall back to one request per line (4 at a time)
    tr = new Array(src.length).fill(''); rom = new Array(src.length).fill('');
    for (let i = 0; i < src.length; i += 4) {
      const batch = await Promise.all(src.slice(i, i + 4).map((s) => gtx(s, to, !skipped).catch(() => ({ text: '', rom: '' }))));
      batch.forEach((r, k) => { tr[i + k] = r.text.trim(); rom[i + k] = (r.rom || '').trim(); });
    }
  }
  if (rom.length !== src.length) rom = [];
  idx.forEach((li, k) => {
    const t = tr[k] || '';
    items[li] = {
      tr: skipped ? '' : t.toLowerCase() === src[k].toLowerCase() ? '' : t,
      rom: rom[k] && !isLatin(src[k]) && rom[k].toLowerCase() !== src[k].toLowerCase() ? rom[k] : ''
    };
  });
  const lang = fixLanguage(whole.lang, src);
  const out = { lang, skipped, items, same: lang === to || lang.split('-')[0] === to.split('-')[0] };
  cache.set(ck, out);
  if (cache.size > 100) cache.delete(cache.keys().next().value);
  return out;
}

module.exports = { translateLines, parseGtx, fixLanguage, CLIENTS };
