// Synced lyrics come only from the music app that is playing: Spotify's lyrics for Spotify, Apple
// Music's for Apple Music, using the user's own signed-in session (src/lyrics-sources.js). Atoll no
// longer asks any third-party lyrics service (LRCLIB, NetEase...). What it already fetched is kept on
// disk, so replaying a song needs no connection.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Strip things like "(Official Video)", "- Remastered 2011", "[Lyrics]" from titles (common for YouTube).
function cleanTitle(t) {
  return (t || '')
    .replace(/\s*[\(\[][^\)\]]*(official|video|audio|lyrics?|visualizer|remaster|mv|hd|4k)[^\)\]]*[\)\]]/gi, '')
    .replace(/\s+-\s+.*remaster.*$/i, '')
    .trim();
}

// Apple Music (and Spotify) names: "Song (feat. X)", album "Song - Single" / "Album - EP" / "(Deluxe Edition)"
const stripFeat = (t) => String(t || '').replace(/\s*[\(\[](feat\.?|ft\.?|featuring|with)\s[^\)\]]*[\)\]]/gi, '').replace(/\s+(feat\.?|ft\.?)\s.+$/i, '').trim();
const cleanAlbum = (a) => String(a || '').replace(/\s+-\s+(single|ep)$/i, '').replace(/\s*[\(\[][^\)\]]*(deluxe|expanded|edition|remaster|bonus|anniversary|version)[^\)\]]*[\)\]]/gi, '').trim();

// ---- caches: a few songs in memory, the rest as small files (so replaying a song costs no request)
const mem = new Map();
const pending = new Map();
const misses = new Map(); // key -> when "no lyrics anywhere" was found (asked again after 6 h)
let diskDir = null, writes = 0;
function setDiskCache(dir) { diskDir = dir; try { fs.mkdirSync(dir, { recursive: true }); } catch (_) { diskDir = null; } }
const fileFor = (key) => diskDir && path.join(diskDir, crypto.createHash('sha1').update(key).digest('hex').slice(0, 20) + '.json');
function cacheGet(key) {
  if (mem.has(key)) { const v = mem.get(key); mem.delete(key); mem.set(key, v); return v; }
  const f = fileFor(key);
  if (f) { try { const v = JSON.parse(fs.readFileSync(f, 'utf8')); if (v && v.key === key) { remember(key, v.result); return v.result; } } catch (_) {} }
  return null;
}
function remember(key, result) { mem.set(key, result); while (mem.size > 12) mem.delete(mem.keys().next().value); }
function cacheSet(key, result) {
  remember(key, result);
  const f = fileFor(key);
  if (!f) return;
  try { fs.writeFileSync(f, JSON.stringify({ key, at: Date.now(), result })); } catch (_) {}
  if (++writes % 40 === 0) prune();
}
function prune() {
  try {
    const files = fs.readdirSync(diskDir).filter((n) => n.endsWith('.json')).map((n) => { const p = path.join(diskDir, n); return { p, t: fs.statSync(p).mtimeMs }; });
    files.sort((a, b) => b.t - a.t).slice(800).forEach((x) => { try { fs.unlinkSync(x.p); } catch (_) {} });
  } catch (_) {}
}
function forgetMisses() { misses.clear(); }

// last few lookups, for Settings → System → Diagnostics
const log = [];
const note = (entry) => { log.unshift({ at: Date.now(), ...entry }); log.length = Math.min(log.length, 10); };
function lyricsStatus() { return { recent: log.slice() }; }

// options.service: 'spotify' | 'apple' | null, the app that is playing
// options.providers: [async ({title, artist, album, duration}) => result | {none:true} | null], the
//   connected providers for that app. Nothing else is ever asked.
async function getLyrics(meta, options = {}) {
  // Duplicate IPC calls share one lookup (including provider token acquisition).
  const key = JSON.stringify([meta.title, meta.artist, meta.album, meta.duration, options.service || null,
    (options.providers || []).map(p => p.providerName || p.name), !!options.force]);
  if (pending.has(key)) return pending.get(key);
  const job = lookupLyrics(meta, options).finally(() => pending.delete(key));
  pending.set(key, job);
  return job;
}
async function lookupLyrics({ title, artist, album, duration }, { providers = [], service = null, force = false } = {}) {
  if (!title) return null;
  if (!service) return { synced: null, plain: null, unsupported: true };
  if (!providers.length) return { synced: null, plain: null, needsConnect: service };
  let track = stripFeat(cleanTitle(title));
  let who = (artist || '').replace(/\s*-\s*Topic$/i, '').trim();
  const alb = cleanAlbum(album);
  const dur = duration > 0 && duration <= 3600 ? Math.round(duration) : 0;
  // 'v3': results are kept per service, and older entries from other lyric sites are never read.
  const key = JSON.stringify(['v3', service, track.toLowerCase(), who.toLowerCase(), alb.toLowerCase(), dur]);
  const t0 = Date.now();

  const cached = !force && cacheGet(key);
  if (cached) return cached;
  const missAt = misses.get(key);
  if (!force && missAt && Date.now() - missAt < 6 * 3600e3) return { synced: null, plain: null, service };

  let hit = null;
  const errors = [];
  for (const p of providers) {
    try {
      const r = await p({ title: track, artist: who, album: alb, duration: dur });
      if (r && !r.none && (r.synced || r.plain || r.instrumental)) { hit = r; break; }
    } catch (e) { errors.push(`${e.provider || 'source'}: ${e.message}`); }
  }

  if (!hit && errors.length) {
    // not cached: asked again later
    note({ title: track, artist: who, result: 'error', detail: errors.join(' · '), ms: Date.now() - t0 });
    return { error: 'unreachable', detail: errors.join(' · '), service, retryIn: 60000 };
  }
  const result = hit ? { synced: hit.synced || null, plain: hit.plain || null, instrumental: !!hit.instrumental, source: hit.source || null, service } : { synced: null, plain: null, service };
  if (hit) cacheSet(key, result);
  else {
    misses.set(key, Date.now());
    while (misses.size > 256) misses.delete(misses.keys().next().value);
  }
  note({ title: track, artist: who, result: hit ? `${hit.synced ? 'synced' : hit.instrumental ? 'instrumental' : 'plain'} · ${result.source}` : 'none found', detail: errors.join(' · '), ms: Date.now() - t0 });
  return result;
}

module.exports = { getLyrics, cleanTitle, stripFeat, cleanAlbum, setDiskCache, forgetMisses, lyricsStatus };
