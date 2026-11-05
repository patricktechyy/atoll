// Local, offline romanization for lyrics. No network, no dictionaries: pure rules, so it behaves the same on
// Windows and macOS and keeps working when the online translator is unavailable.
//
//   Korean   Revised Romanization of Korean (the official South Korean system) applied to how the words are
//            actually pronounced (liaison, nasalization, ㄹ assimilation, ㅎ aspiration, palatalization).
//            ㄹ is "r" before a vowel and "l" at the end of a syllable ("neoreul saranghae", not Google's
//            "neoleul salanghae").
//   Japanese kana only (hiragana, katakana, ー, っ, small kana) in Hepburn. Kanji need a dictionary, so a line
//            that contains kanji returns null and the caller may use another source.
//   Russian / Ukrainian (Cyrillic) and Greek, in simple BGN/PCGN-style Latin.
//
// romanizeLine(text) -> string, or null when the line has letters this module cannot romanize.

const isLatinOnly = (s) => !/[^\u0000-ɏḀ-ỿ\s\d\p{P}\p{S}]/u.test(s);

// ---------------------------------------------------------------- Korean
const L_JAMO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const T_JAMO = ['', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
const CLUSTER = { 'ㄳ': ['ㄱ', 'ㅅ'], 'ㄵ': ['ㄴ', 'ㅈ'], 'ㄶ': ['ㄴ', 'ㅎ'], 'ㄺ': ['ㄹ', 'ㄱ'], 'ㄻ': ['ㄹ', 'ㅁ'], 'ㄼ': ['ㄹ', 'ㅂ'], 'ㄽ': ['ㄹ', 'ㅅ'], 'ㄾ': ['ㄹ', 'ㅌ'], 'ㄿ': ['ㄹ', 'ㅍ'], 'ㅀ': ['ㄹ', 'ㅎ'], 'ㅄ': ['ㅂ', 'ㅅ'] };
const INITIAL = { 'ㄱ': 'g', 'ㄲ': 'kk', 'ㄴ': 'n', 'ㄷ': 'd', 'ㄸ': 'tt', 'ㄹ': 'r', 'ㅁ': 'm', 'ㅂ': 'b', 'ㅃ': 'pp', 'ㅅ': 's', 'ㅆ': 'ss', 'ㅇ': '', 'ㅈ': 'j', 'ㅉ': 'jj', 'ㅊ': 'ch', 'ㅋ': 'k', 'ㅌ': 't', 'ㅍ': 'p', 'ㅎ': 'h' };
const FINAL = { 'ㄱ': 'k', 'ㄴ': 'n', 'ㄷ': 't', 'ㄹ': 'l', 'ㅁ': 'm', 'ㅂ': 'p', 'ㅇ': 'ng' };
const VOWEL = ['a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa', 'wae', 'oe', 'yo', 'u', 'wo', 'we', 'wi', 'yu', 'eu', 'ui', 'i'];
const VOWEL_I = 20;
// The seven sounds a syllable-final consonant can actually have.
const NEUTRAL = { 'ㄱ': 'ㄱ', 'ㄲ': 'ㄱ', 'ㅋ': 'ㄱ', 'ㄴ': 'ㄴ', 'ㄷ': 'ㄷ', 'ㅅ': 'ㄷ', 'ㅆ': 'ㄷ', 'ㅈ': 'ㄷ', 'ㅊ': 'ㄷ', 'ㅌ': 'ㄷ', 'ㅎ': 'ㄷ', 'ㄹ': 'ㄹ', 'ㅁ': 'ㅁ', 'ㅂ': 'ㅂ', 'ㅍ': 'ㅂ', 'ㅇ': 'ㅇ' };
const CLUSTER_SOUND = { 'ㄳ': 'ㄱ', 'ㄵ': 'ㄴ', 'ㄶ': 'ㄴ', 'ㄺ': 'ㄱ', 'ㄻ': 'ㅁ', 'ㄼ': 'ㄹ', 'ㄽ': 'ㄹ', 'ㄾ': 'ㄹ', 'ㄿ': 'ㅂ', 'ㅀ': 'ㄹ', 'ㅄ': 'ㅂ' };
const ASPIRATE = { 'ㄱ': 'ㅋ', 'ㄷ': 'ㅌ', 'ㅂ': 'ㅍ', 'ㅈ': 'ㅊ' };

function koreanWord(word) {
  const syl = [...word].map((ch) => {
    const code = ch.charCodeAt(0) - 0xAC00;
    return { l: L_JAMO[Math.floor(code / 588)], v: Math.floor((code % 588) / 28), t: [...(T_JAMO[code % 28])].flatMap((j) => CLUSTER[j] || [j]), ll: false };
  });
  for (let i = 0; i < syl.length; i++) {
    const a = syl[i], b = syl[i + 1];
    let t = a.t;
    if (b && t.length) {
      const last = t[t.length - 1];
      if (b.l === 'ㅇ') {
        // liaison: the final moves onto the empty initial of the next syllable
        if (last === 'ㅎ') t = t.slice(0, -1);                     // 좋아 -> joa, 많아 -> mana
        else if (last !== 'ㅇ') {
          let moved = last;
          if ((moved === 'ㄷ' || moved === 'ㅌ') && b.v === VOWEL_I) moved = moved === 'ㄷ' ? 'ㅈ' : 'ㅊ'; // 같이 -> gachi
          t = t.slice(0, -1);
          b.l = moved;
        }
      } else if (last === 'ㅎ') {
        t = t.slice(0, -1);
        if (b.l === 'ㄱ' || b.l === 'ㄷ' || b.l === 'ㅈ') b.l = ASPIRATE[b.l];   // 좋다 -> jota
        else if (b.l === 'ㅅ') b.l = 'ㅆ';
        else if (b.l === 'ㄴ' && !t.length) t = ['ㄴ'];                          // 좋네 -> jonne
      } else if (t.length === 1 && b.l === 'ㅎ' && (last === 'ㄷ' || last === 'ㅌ') && b.v === VOWEL_I) {
        b.l = 'ㅊ'; t = [];                                                      // 닫히다 -> dachida
      } else if (t.length === 1 && b.l === 'ㅎ' && ASPIRATE[last]) {
        b.l = ASPIRATE[last]; t = [];                                            // 놓고, 입학 -> ipak
      }
    }
    let f = '';
    if (t.length === 1) f = NEUTRAL[t[0]] || '';
    else if (t.length === 2) {
      const joined = Object.keys(CLUSTER).find((k) => CLUSTER[k][0] === t[0] && CLUSTER[k][1] === t[1]);
      f = CLUSTER_SOUND[joined] || '';
      if (joined === 'ㄺ' && b && b.l === 'ㄱ') f = 'ㄹ';                          // 읽고 -> ilgo
    }
    if (b && f) {
      if (f === 'ㄱ' || f === 'ㄷ' || f === 'ㅂ') {
        if (b.l === 'ㄹ') b.l = 'ㄴ';
        if (b.l === 'ㄴ' || b.l === 'ㅁ') f = { 'ㄱ': 'ㅇ', 'ㄷ': 'ㄴ', 'ㅂ': 'ㅁ' }[f]; // 국물 -> gungmul, 합니다 -> hamnida
      } else if ((f === 'ㅁ' || f === 'ㅇ') && b.l === 'ㄹ') b.l = 'ㄴ';           // 종로 -> jongno
      else if (f === 'ㄴ' && b.l === 'ㄹ') f = 'ㄹ';                              // 신라 -> silla
      else if (f === 'ㄹ' && b.l === 'ㄴ') b.l = 'ㄹ';                            // 설날 -> seollal
      if (f === 'ㄹ' && b.l === 'ㄹ') b.ll = true;
    }
    a.f = f;
  }
  return syl.map((s) => (s.ll ? 'l' : INITIAL[s.l]) + VOWEL[s.v] + (s.f ? FINAL[s.f] : '')).join('');
}

const korean = (s) => s.replace(/[가-힣]+/g, koreanWord);

// ---------------------------------------------------------------- Japanese kana (Hepburn)
const KANA_BASE = {
  あ: 'a', い: 'i', う: 'u', え: 'e', お: 'o', か: 'ka', き: 'ki', く: 'ku', け: 'ke', こ: 'ko',
  さ: 'sa', し: 'shi', す: 'su', せ: 'se', そ: 'so', た: 'ta', ち: 'chi', つ: 'tsu', て: 'te', と: 'to',
  な: 'na', に: 'ni', ぬ: 'nu', ね: 'ne', の: 'no', は: 'ha', ひ: 'hi', ふ: 'fu', へ: 'he', ほ: 'ho',
  ま: 'ma', み: 'mi', む: 'mu', め: 'me', も: 'mo', や: 'ya', ゆ: 'yu', よ: 'yo',
  ら: 'ra', り: 'ri', る: 'ru', れ: 're', ろ: 'ro', わ: 'wa', ゐ: 'i', ゑ: 'e', を: 'o', ん: 'n',
  が: 'ga', ぎ: 'gi', ぐ: 'gu', げ: 'ge', ご: 'go', ざ: 'za', じ: 'ji', ず: 'zu', ぜ: 'ze', ぞ: 'zo',
  だ: 'da', ぢ: 'ji', づ: 'zu', で: 'de', ど: 'do', ば: 'ba', び: 'bi', ぶ: 'bu', べ: 'be', ぼ: 'bo',
  ぱ: 'pa', ぴ: 'pi', ぷ: 'pu', ぺ: 'pe', ぽ: 'po', ゔ: 'vu',
  ぁ: 'a', ぃ: 'i', ぅ: 'u', ぇ: 'e', ぉ: 'o', ゃ: 'ya', ゅ: 'yu', ょ: 'yo', ゎ: 'wa'
};
const KANA_SPECIAL = {
  ふぁ: 'fa', ふぃ: 'fi', ふぇ: 'fe', ふぉ: 'fo', うぃ: 'wi', うぇ: 'we', うぉ: 'wo', てぃ: 'ti', でぃ: 'di', とぅ: 'tu', どぅ: 'du',
  しぇ: 'she', じぇ: 'je', ちぇ: 'che', つぁ: 'tsa', つぃ: 'tsi', つぇ: 'tse', つぉ: 'tso', ゔぁ: 'va', ゔぃ: 'vi', ゔぇ: 've', ゔぉ: 'vo', いぇ: 'ye', くぁ: 'kwa', ぐぁ: 'gwa'
};
const SMALL_Y = { ゃ: 'a', ゅ: 'u', ょ: 'o' };
const IS_KANA = /[ぁ-ゖゝゞァ-ヺー]/;
const toHiragana = (s) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60)).replace(/ヽ/g, 'ゝ').replace(/ヾ/g, 'ゞ');

function kanaRun(run, whole, offset) {
  const src = run;
  const h = toHiragana(run);
  const tokens = [];            // { r: romaji, small: bool }
  let geminate = false;
  const push = (r) => {
    if (geminate && /^[bcdfghjklmnpqrstvwxyz]/.test(r) && !r.startsWith('n')) r = (r.startsWith('ch') ? 't' : r[0]) + r;
    geminate = false;
    tokens.push(r);
  };
  const nextAfter = whole.charAt(offset + run.length);
  for (let i = 0; i < h.length; i++) {
    const c = h[i], n = h[i + 1];
    if (c === 'っ') { geminate = true; continue; }
    if (c === 'ー') { const prev = tokens[tokens.length - 1] || ''; const v = prev.match(/[aiueo]$/); if (v) tokens[tokens.length - 1] = prev + v[0]; continue; }
    if (c === 'ゝ' || c === 'ゞ') { const prev = tokens[tokens.length - 1]; if (prev) push(prev); continue; }
    if (n && KANA_SPECIAL[c + n]) { push(KANA_SPECIAL[c + n]); i++; continue; }
    if (n && SMALL_Y[n] && KANA_BASE[c] && /i$/.test(KANA_BASE[c]) && c !== 'い' && c !== 'ゐ') {
      const stem = KANA_BASE[c];
      push(/(sh|ch|j)i$/.test(stem) ? stem.slice(0, -1) + SMALL_Y[n] : stem.slice(0, -1) + 'y' + SMALL_Y[n]);
      i++; continue;
    }
    let r = KANA_BASE[c];
    if (r === undefined) return null;
    // は / へ as the particle or greeting at the end of a chunk: こんにちは -> konnichiwa, ここへ -> koko e
    const atEnd = i === h.length - 1 && !/[\p{L}\d]/u.test(nextAfter) && h.length > 1;
    const katakana = src[i] !== c;
    if (!katakana && atEnd && c === 'は') r = 'wa';
    if (!katakana && atEnd && c === 'へ') r = 'e';
    push(r);
  }
  // ん before a vowel or y needs an apostrophe: しんあい -> shin'ai
  return tokens.map((t, i) => (t === 'n' && i + 1 < tokens.length && /^[aiueoy]/.test(tokens[i + 1]) ? "n'" : t)).join('');
}
const kana = (s) => s.replace(/[ぁ-ゖゝゞァ-ヺー]+/g, (run, offset) => {
  const out = kanaRun(run, s, offset);
  return out === null ? run : out;
});

// ---------------------------------------------------------------- Cyrillic
const CYR = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };
const CYR_UK = { г: 'h', ґ: 'g', е: 'e', є: 'ye', и: 'y', і: 'i', ї: 'yi', й: 'y', щ: 'shch', ю: 'yu', я: 'ya', х: 'kh' };
const CYR_BG = { ъ: 'a', щ: 'sht' };
function cyrillic(s) {
  const uk = /[іїєґІЇЄҐ]/.test(s);
  return s.replace(/[Ѐ-ӿ]/g, (c) => {
    const lower = c.toLowerCase();
    const r = (uk && CYR_UK[lower] !== undefined ? CYR_UK[lower] : CYR[lower]);
    if (r === undefined) return c;
    return c === lower ? r : r.charAt(0).toUpperCase() + r.slice(1);
  });
}

// ---------------------------------------------------------------- Greek
const GREEK_PAIRS = [['ου', 'ou'], ['αι', 'e'], ['ει', 'i'], ['οι', 'i'], ['υι', 'i'], ['μπ', 'b'], ['ντ', 'd'], ['γγ', 'ng'], ['γκ', 'g'], ['γχ', 'nch'], ['αυ', 'av'], ['ευ', 'ev']];
const GREEK = { α: 'a', β: 'v', γ: 'g', δ: 'd', ε: 'e', ζ: 'z', η: 'i', θ: 'th', ι: 'i', κ: 'k', λ: 'l', μ: 'm', ν: 'n', ξ: 'x', ο: 'o', π: 'p', ρ: 'r', σ: 's', ς: 's', τ: 't', υ: 'y', φ: 'f', χ: 'ch', ψ: 'ps', ω: 'o' };
function greek(s) {
  return s.replace(/[Ͱ-Ͽἀ-῿]+/g, (word) => {
    let w = word.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const upper = word === word.toUpperCase() && word.length > 1;
    let out = '';
    for (let i = 0; i < w.length;) {
      const pair = GREEK_PAIRS.find(([g]) => w.startsWith(g, i));
      if (pair) { out += pair[1]; i += 2; continue; }
      out += GREEK[w[i]] ?? w[i]; i++;
    }
    return upper ? out.toUpperCase() : (word[0] !== word[0].toLowerCase() ? out.charAt(0).toUpperCase() + out.slice(1) : out);
  });
}

// ---------------------------------------------------------------- entry point
function romanizeLine(text) {
  const s = String(text == null ? '' : text).normalize('NFC');
  if (isLatinOnly(s)) return s;
  let out = s;
  if (/[가-힣]/.test(out)) out = korean(out);
  if (IS_KANA.test(out)) out = kana(out);
  if (/[Ѐ-ӿ]/.test(out)) out = cyrillic(out);
  if (/[Ͱ-Ͽἀ-῿]/.test(out)) out = greek(out);
  if (!isLatinOnly(out)) return null;          // kanji, hanja, Thai, Arabic…: needs a dictionary
  return out.replace(/^(\P{L}*)(\p{Ll})/u, (_, lead, ch) => lead + ch.toUpperCase());
}

module.exports = { romanizeLine, koreanWord, isLatinOnly };
