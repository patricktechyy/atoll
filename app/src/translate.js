// Lyric translation through Google Translate's free web endpoint (the one browser extensions use; no
// API key). It's unofficial, so it can rate limit or block a network outright; we translate a whole song
// in one request and cache it.
// Romanization is LOCAL first (./romanize: Korean, kana, Cyrillic, Greek). Google's romanization is only
// requested for lines the local rules cannot read (kanji, Chinese, Thai, Arabic…), and a Google failure
// never removes the local romanization.
// In the Rust host there is no require(): the build exposes romanize.js as window.AtollPure.romanizeLine.
const romanizeLine = typeof require === 'function' ? require('./romanize').romanizeLine : window.AtollPure.romanizeLine;
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

// When every client is refused (Google answers 429 / a "unusual traffic" captcha for a blocked network),
// stop asking for a while: hammering a blocked endpoint only prolongs the block.
const COOLDOWN_MS = 5 * 60 * 1000;
let blockedUntil = 0;
const resetRateLimit = () => { blockedUntil = 0; };

async function gtxOnce(client, q, to, translate, rom) {
  const url = `${ENDPOINT}?client=${client}&sl=auto&tl=${encodeURIComponent(to)}${translate ? '&dt=t' : ''}${rom ? '&dt=rm' : ''}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8', 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36' },
    body: 'q=' + encodeURIComponent(q)
  });
  if (!res.ok) throw Object.assign(new Error(`Translate returned ${res.status}`), { status: res.status });
  return parseGtx(await res.json());
}

async function gtx(q, to, translate = true, rom = true) {
  if (Date.now() < blockedUntil) throw Object.assign(new Error('Translate returned 429 (paused after being refused)'), { status: 429 });
  let lastError;
  for (const client of [...CLIENTS]) {
    try {
      const out = await gtxOnce(client, q, to, translate, rom);
      if (CLIENTS[0] !== client) { CLIENTS.splice(CLIENTS.indexOf(client), 1); CLIENTS.unshift(client); }
      return out;
    } catch (error) { lastError = error; }
  }
  if (lastError && [403, 429].includes(lastError.status)) blockedUntil = Date.now() + COOLDOWN_MS;
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

  // Local romanization: string when the rules can read the line, null when they cannot (e.g. kanji).
  const local = src.map((s) => (isLatin(s) ? '' : romanizeLine(s)));
  const needRemoteRom = src.some((s, i) => !isLatin(s) && local[i] === null);
  const hasLocalRom = local.some((r) => r);

  let whole = null, skipped = false, remoteError = null;
  try {
    // Detect without asking for translated text when the user has exclusions.
    // Romanization remains available even for a language they understand.
    const detected = understood.length ? await gtx(src.join('\n'), to, false, needRemoteRom) : null;
    skipped = !!detected && understood.includes(baseLanguage(fixLanguage(detected.lang, src)));
    whole = skipped ? detected : await gtx(src.join('\n'), to, true, needRemoteRom);
  } catch (error) { remoteError = error; }

  if (remoteError) {
    // Google refused (rate limit / blocked network). Keep the local romanization; only the translation is lost.
    if (!hasLocalRom) throw remoteError;
    const lang = fixLanguage('', src);
    skipped = !!lang && understood.includes(baseLanguage(lang));
    idx.forEach((li, k) => { items[li] = { tr: '', rom: local[k] && local[k].toLowerCase() !== src[k].toLowerCase() ? local[k] : '' }; });
    return { lang, skipped, items, same: !!lang && baseLanguage(lang) === baseLanguage(to), partial: true, error: String(remoteError.message || remoteError) };
  }

  let tr = splitLines(whole.text);
  let rom = whole.rom ? splitLines(whole.rom) : [];
  const romBad = () => needRemoteRom && src.some((s, i) => local[i] === null && (rom.length !== src.length || !rom[i]));
  if ((!skipped && tr.length !== src.length) || romBad()) {
    // the service merged or split lines: fall back to one request per line (4 at a time)
    tr = new Array(src.length).fill(''); rom = new Array(src.length).fill('');
    for (let i = 0; i < src.length; i += 4) {
      const batch = await Promise.all(src.slice(i, i + 4).map((s) => gtx(s, to, !skipped, needRemoteRom).catch(() => ({ text: '', rom: '' }))));
      batch.forEach((r, k) => { tr[i + k] = r.text.trim(); rom[i + k] = (r.rom || '').trim(); });
    }
  }
  if (rom.length !== src.length) rom = [];
  idx.forEach((li, k) => {
    const t = tr[k] || '';
    const r = local[k] !== null && local[k] !== undefined ? local[k] : rom[k];
    items[li] = {
      tr: skipped ? '' : t.toLowerCase() === src[k].toLowerCase() ? '' : t,
      rom: r && !isLatin(src[k]) && r.toLowerCase() !== src[k].toLowerCase() ? r : ''
    };
  });
  const lang = fixLanguage(whole.lang, src);
  const out = { lang, skipped, items, same: lang === to || lang.split('-')[0] === to.split('-')[0] };
  cache.set(ck, out);
  if (cache.size > 100) cache.delete(cache.keys().next().value);
  return out;
}

module.exports = { translateLines, parseGtx, fixLanguage, CLIENTS, resetRateLimit };
