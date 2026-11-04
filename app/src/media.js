// Now-playing clean-up, mostly for Apple Music for Windows (Microsoft Store app), whose media-session
// data is a bit off compared with Spotify & co.:
//  • it puts "Artist — Album" in the artist field (or in album artist, with artist empty) and leaves
//    the album empty
//  • its cover's content type is a comma-separated list ("image/jpeg, image/png"), which breaks a data: URL
//  • sometimes it publishes no cover at all → we look the song up on Apple's public iTunes Search API
//  • its reported position jumps around (smoothed in the renderer)

const APPLE_MUSIC = /^com\.apple\.Music$|AppleInc\.AppleMusic|AppleMusic\.exe|^AppleMusic$|iTunes/i;
const isAppleMusic = (app) => APPLE_MUSIC.test(String(app || ''));

// "Artist — Album" → { artist, album }. Em dash first, then en dash, then a spaced hyphen.
function splitArtistAlbum(s) {
  for (const sep of [' — ', ' – ', ' - ']) {
    const i = s.indexOf(sep);
    if (i > 0 && i < s.length - sep.length) return { artist: s.slice(0, i).trim(), album: s.slice(i + sep.length).trim() };
  }
  return null;
}

function normalizeMedia(m) {
  if (!m || !m.active) return m;
  const out = { ...m };
  let artist = String(out.artist || '').trim();
  const albumArtist = String(out.albumArtist || '').trim();
  if (!artist && albumArtist) artist = albumArtist;
  // only for Apple Music, and only when it really left the album empty: an artist whose name
  // contains a dash in another app is left alone
  if (isAppleMusic(out.app) && !String(out.album || '').trim() && artist) {
    const parts = splitArtistAlbum(artist);
    if (parts) { artist = parts.artist; out.album = parts.album; }
  }
  out.artist = artist;
  delete out.albumArtist;
  return out;
}

// what kind of image these base64 bytes are (by their first bytes)
function sniffImageType(b64) {
  const h = String(b64 || '').slice(0, 16);
  if (h.startsWith('iVBORw0KGgo')) return 'image/png';
  if (h.startsWith('/9j/')) return 'image/jpeg';
  if (h.startsWith('R0lGOD')) return 'image/gif';
  if (h.startsWith('UklGR')) return 'image/webp';
  if (h.startsWith('Qk')) return 'image/bmp';
  return 'image/png';
}

// "data:image/jpeg, image/png;base64,…" → "data:image/jpeg;base64,…"
function fixArtData(data) {
  if (typeof data !== 'string' || !data.startsWith('data:')) return data;
  const i = data.indexOf(';base64,');
  if (i < 0) return data;
  const b64 = data.slice(i + 8);
  if (!b64) return null;
  let ct = data.slice(5, i).split(',')[0].trim().toLowerCase();
  if (!/^image\/[\w.+-]+$/.test(ct)) ct = sniffImageType(b64);
  return `data:${ct};base64,${b64}`;
}

// Best iTunes Search result for a song: same title (ignoring "(feat. …)", "- Remastered" etc.),
// preferring the same artist; returns a 600×600 artwork URL.
const simplify = (s) => String(s || '').toLowerCase().replace(/\s*[([].*?[)\]]\s*/g, ' ').replace(/\s+-\s+.*$/, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
function pickItunesArt(results, title, artist) {
  const t = simplify(title), a = simplify(artist);
  let best = null, bestScore = -1;
  for (const r of results || []) {
    if (!r || !r.artworkUrl100) continue;
    let score = 0;
    const rt = simplify(r.trackName), ra = simplify(r.artistName);
    if (rt === t) score += 4; else if (rt.includes(t) || t.includes(rt)) score += 2;
    if (a && (ra === a || ra.includes(a) || a.includes(ra))) score += 3;
    if (score > bestScore) { best = r; bestScore = score; }
  }
  if (!best || bestScore < 2) return null;
  return best.artworkUrl100.replace(/\/\d+x\d+(bb)?\.(jpg|png)$/i, '/600x600bb.$2');
}

module.exports = { normalizeMedia, fixArtData, sniffImageType, pickItunesArt, isAppleMusic, splitArtistAlbum };
