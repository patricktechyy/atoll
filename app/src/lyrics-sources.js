// Lyrics straight from Spotify and Apple Music, using the user's own signed-in web sessions. The app that
// is playing decides which one is asked.
//
// Spotify: the web player's access token (taken from the user's own session at open.spotify.com) →
//   search the track on Spotify → its synced lyrics (Spotify's lyrics come from Musixmatch). Works for
//   songs played in Spotify, as long as Spotify has the song. A free account is enough.
// Apple Music: MusicKit's tokens from the user's own session at music.apple.com → search the catalogue →
//   the song's synced lyrics (TTML). Needs an Apple Music subscription.
//
// Both sign-ins happen in a normal web page inside Atoll, in a separate, persistent browser profile;
// Atoll never sees the password. These are the same private endpoints the official web players use, so
// they may change without notice. There is no fallback: lyrics come from the app that is playing, or not at all.
const CHROME_UA = (v) => `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v} Safari/537.36`;

// ---------------- pure helpers (unit-tested) ----------------
const simple = (s) => String(s || '').toLowerCase().replace(/\s*[([].*?[)\]]\s*/g, ' ').replace(/\s+-\s+.*$/, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
function score(name, artists, durMs, title, artist, dur) {
  const t = simple(title), a = simple(artist), n = simple(name), ar = simple(artists);
  let sc = n === t ? 40 : t && n && (n.includes(t) || t.includes(n)) ? 20 : -100;
  if (a && ar && (ar.includes(a) || a.includes(ar) || a.split(' ')[0] === ar.split(' ')[0])) sc += 30;
  if (dur > 0 && durMs > 0) sc -= Math.min(30, Math.abs(durMs / 1000 - dur) * 2);
  return sc;
}
function pickSpotifyTrack(items, title, artist, dur) {
  let best = null, bs = 39;
  for (const x of items || []) {
    if (!x || !x.id) continue;
    const sc = score(x.name, (x.artists || []).map((a) => a.name).join(' '), x.duration_ms, title, artist, dur);
    if (sc > bs) { best = x; bs = sc; }
  }
  return best;
}
function spotifyToResult(json) {
  const L = json && json.lyrics;
  if (!L || !Array.isArray(L.lines) || !L.lines.length) return null;
  const lines = L.lines.map((l) => ({ t: Number(l.startTimeMs) / 1000, text: String(l.words || '').replace(/^♪$/, '').trim() }));
  if (L.syncType === 'LINE_SYNCED' || L.syncType === 'SYLLABLE_SYNCED') return { synced: lines, plain: lines.map((l) => l.text).join('\n'), source: 'Spotify' };
  return { synced: null, plain: lines.map((l) => l.text).join('\n'), source: 'Spotify' };
}
function pickAppleSong(data, title, artist, dur) {
  let best = null, bs = 39;
  for (const x of data || []) {
    const at = (x && x.attributes) || {};
    const sc = score(at.name, at.artistName, at.durationInMillis, title, artist, dur);
    if (sc > bs) { best = x; bs = sc; }
  }
  return best;
}
// TTML times: "12.345", "1:02.345", "00:01:02.345", "12.3s"
function ttmlTime(s) {
  if (!s) return NaN;
  const str = String(s).trim();
  if (/s$/.test(str)) return parseFloat(str);
  const parts = str.split(':').map(Number);
  return parts.reduce((acc, v) => acc * 60 + v, 0);
}
const decode = (s) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&apos;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/\s+/g, ' ').trim();
function parseTtml(ttml) {
  if (!ttml) return null;
  const lines = [];
  for (const m of String(ttml).matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/g)) {
    const begin = /\bbegin="([^"]+)"/.exec(m[1]);
    // word-by-word lyrics put words (or syllables) in <span>s, spaces between words: drop the tags only
    const text = decode(m[2].replace(/<\/?span[^>]*>/g, ''));
    lines.push({ t: begin ? ttmlTime(begin[1]) : NaN, text });
  }
  if (!lines.length) return null;
  const synced = lines.every((l) => Number.isFinite(l.t));
  return synced
    ? { synced: lines.sort((a, b) => a.t - b.t), plain: lines.map((l) => l.text).join('\n'), source: 'Apple Music' }
    : { synced: null, plain: lines.map((l) => l.text).join('\n'), source: 'Apple Music' };
}

// ---------------- Electron side ----------------
function createSources({ electron, store, secret }) {
  const { BrowserWindow, session } = electron;
  const ua = CHROME_UA((process.versions.chrome || '130.0.0.0'));
  const status = { spotify: { connected: false, error: '', lastOk: 0 }, apple: { connected: false, error: '', lastOk: 0 } };
  const saved = store.get('lyricSources') || {};
  status.spotify.connected = !!saved.spotify; status.apple.connected = !!saved.apple;
  const persist = () => store.set('lyricSources', { spotify: status.spotify.connected, apple: status.apple.connected });
  const sessions = {};
  const ses = (name) => {
    if (!sessions[name]) {
      const s = sessions[name] = session.fromPartition(`persist:atoll-${name}`);
      s.setUserAgent(ua);
      // these pages get nothing from the PC: no microphone, camera, location, notifications…
      try { s.setPermissionRequestHandler((_wc, _perm, cb) => cb(false)); s.setPermissionCheckHandler(() => false); } catch (_) {}
    }
    return sessions[name];
  };
  const header = (h, name) => { const k = Object.keys(h || {}).find((x) => x.toLowerCase() === name); return k ? h[k] : ''; };
  const timeout = (p, ms, what) => {
    let timer;
    return Promise.race([p, new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`${what} timed out`)), ms); })]).finally(() => clearTimeout(timer));
  };

  // a sign-in window: a normal web page in its own browser profile (no access to Atoll)
  function openWindow(name, url, title, { show = true } = {}) {
    const win = new BrowserWindow({
      width: 520, height: 760, show, title, autoHideMenuBar: true, skipTaskbar: !show,
      webPreferences: { session: ses(name), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false, backgroundThrottling: show }
    });
    win.webContents.setUserAgent(ua);
    win.webContents.setAudioMuted(true);
    // sign-in flows open pop-ups (Apple ID, "Continue with…"): keep them in the same profile
    win.webContents.setWindowOpenHandler(({ url: u }) => (/^https:\/\//i.test(u)
      ? { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, webPreferences: { session: ses(name), contextIsolation: true, sandbox: true, nodeIntegration: false } } }
      : { action: 'deny' }));
    win.loadURL(url, { userAgent: ua });
    return win;
  }

  // ---- Spotify
  let spToken = null, spPending = null; // { token, clientToken, exp }
  function spotifyToken(force) {
    if (!force && spToken && spToken.exp > Date.now() + 60e3) return Promise.resolve(spToken);
    if (!spPending) spPending = fetchSpotifyToken().finally(() => { spPending = null; });
    return spPending;
  }
  async function fetchSpotifyToken() {
    const s = ses('spotify');
    // 1) the classic token endpoint (works on many accounts; newer web players need extra parameters)
    try {
      const r = await timeout(s.fetch('https://open.spotify.com/get_access_token?reason=transport&productType=web_player', { headers: { 'User-Agent': ua }, credentials: 'include' }), 8000, 'Spotify token');
      if (r.ok) {
        const j = await r.json();
        if (j && j.accessToken && !j.isAnonymous) { spToken = { token: j.accessToken, exp: Number(j.accessTokenExpirationTimestampMs) || Date.now() + 3000e3 }; return spToken; }
        if (j && j.isAnonymous) throw Object.assign(new Error('signed out of Spotify'), { signedOut: true });
      }
    } catch (e) { if (e.signedOut) throw e; }
    // 2) let the real web player get its token, and take it from its own requests (hidden, ~5-10 s)
    return new Promise((resolve, reject) => {
      // only the player's scripts are needed: skip pictures, video, fonts and styles (lighter, quicker)
      s.webRequest.onBeforeRequest((d, cb) => cb({ cancel: ['image', 'media', 'font', 'stylesheet'].includes(d.resourceType) }));
      const win = openWindow('spotify', 'https://open.spotify.com/', 'Spotify', { show: false });
      let done = false, deadline = null, settle = null;
      const finish = (err, val) => {
        if (done) return; done = true;
        clearTimeout(deadline); clearTimeout(settle);
        try { s.webRequest.onBeforeSendHeaders(null); s.webRequest.onBeforeRequest(null); } catch (_) {}
        setTimeout(() => { try { win.destroy(); } catch (_) {} }, 50);
        err ? reject(err) : resolve(val);
      };
      let clientToken = '';
      s.webRequest.onBeforeSendHeaders({ urls: ['https://*.spotify.com/*'] }, (d, cb) => {
        const h = d.requestHeaders || {};
        const auth = header(h, 'authorization');
        const ct = header(h, 'client-token');
        if (ct) clientToken = ct;
        if (auth && /^Bearer\s+\S{40,}/.test(auth)) {
          spToken = { token: auth.replace(/^Bearer\s+/, ''), clientToken, exp: Date.now() + 50 * 60e3 };
          if (clientToken) { clearTimeout(settle); settle = setTimeout(() => finish(null, spToken), 0); }
          else if (!settle) settle = setTimeout(() => finish(null, spToken), 1500);
        }
        cb({ requestHeaders: h });
      });
      deadline = setTimeout(() => finish(new Error('could not get a Spotify session (are you signed in?)')), 25000);
    });
  }
  async function spotifyLyrics({ title, artist, duration }) {
    if (!status.spotify.connected) return null;
    let tok;
    try { tok = await spotifyToken(false); }
    catch (e) { if (e.signedOut) status.spotify.error = 'signed out of Spotify: connect it again'; throw e; }
    const s = ses('spotify');
    const api = async (url, extra = {}) => {
      let r = await timeout(s.fetch(url, { headers: { Authorization: `Bearer ${tok.token}`, 'User-Agent': ua, ...extra } }), 8000, 'Spotify');
      if (r.status === 401) { tok = await spotifyToken(true); r = await timeout(s.fetch(url, { headers: { Authorization: `Bearer ${tok.token}`, 'User-Agent': ua, ...extra } }), 8000, 'Spotify'); }
      return r;
    };
    const q = `track:${title} artist:${String(artist || '').split(/,|&/)[0].trim()}`;
    const sr = await api(`https://api.spotify.com/v1/search?${new URLSearchParams({ q, type: 'track', limit: '8' })}`);
    if (!sr.ok) throw new Error(`Spotify search ${sr.status}`);
    const track = pickSpotifyTrack(((await sr.json()).tracks || {}).items, title, artist, duration);
    if (!track) return null;
    const lr = await api(`https://spclient.wg.spotify.com/color-lyrics/v2/track/${track.id}?format=json&vocalRemoval=false&market=from_token`,
      { 'app-platform': 'WebPlayer', Accept: 'application/json', ...(tok.clientToken ? { 'client-token': tok.clientToken } : {}) });
    if (lr.status === 404) return { none: true };
    if (!lr.ok) throw new Error(`Spotify lyrics ${lr.status}`);
    status.spotify.lastOk = Date.now(); status.spotify.error = '';
    return spotifyToResult(await lr.json());
  }

  // ---- Apple Music
  let amPending = null;
  let amTok = null; // { dev, user, sf }
  try { const raw = store.get('appleTokens'); if (raw) amTok = JSON.parse(secret.decrypt(raw)); } catch (_) {}
  const MK = `(() => { try { const k = window.MusicKit && MusicKit.getInstance && MusicKit.getInstance();
    return k && k.isAuthorized ? { dev: k.developerToken, user: k.musicUserToken, sf: k.storefrontId || k.storefrontCountryCode } : null; } catch (e) { return null; } })()`;
  function readMusicKit(win, ms) {
    return new Promise((resolve) => {
      const t0 = Date.now();
      const tick = async () => {
        if (win.isDestroyed()) return resolve(null);
        let v = null;
        try { v = await win.webContents.executeJavaScript(MK, true); } catch (_) {}
        if (v && v.dev && v.user) return resolve(v);
        if (Date.now() - t0 > ms) return resolve(null);
        setTimeout(tick, 1500);
      };
      setTimeout(tick, 1500);
    });
  }
  function saveApple(v) { sfChecked = false; amTok = { dev: v.dev, user: v.user, sf: v.sf || 'us' }; try { store.set('appleTokens', secret.encrypt(JSON.stringify(amTok))); } catch (_) {} }
  async function appleTokens(force) {
    if (!force && amTok) return amTok;
    if (!amPending) amPending = fetchAppleTokens().finally(() => { amPending = null; });
    return amPending;
  }
  async function fetchAppleTokens() {
    const win = openWindow('apple', 'https://music.apple.com/', 'Apple Music', { show: false });
    const v = await readMusicKit(win, 25000);
    try { win.destroy(); } catch (_) {}
    if (!v) throw new Error('could not get an Apple Music session (are you signed in?)');
    saveApple(v);
    return amTok;
  }
  async function appleFetch(url, tok) {
    const headers = { Authorization: `Bearer ${tok.dev}`, 'Media-User-Token': tok.user, Origin: 'https://music.apple.com', Referer: 'https://music.apple.com/', 'User-Agent': ua };
    try { return await timeout(fetch(url, { headers }), 8000, 'Apple Music'); } // Node's fetch can send Origin
    catch (e) { return timeout(ses('apple').fetch(url, { headers }), 8000, 'Apple Music'); }
  }
  // The lyrics endpoint answers 404 unless the storefront is the account's own, and MusicKit does not always
  // have it ready when the tokens are read (it then fell back to 'us'). Ask Apple once per run and remember it.
  let sfChecked = false;
  async function appleStorefront(tok, get) {
    if (!sfChecked) {
      try {
        const r = await get('https://amp-api.music.apple.com/v1/me/storefront');
        if (r.ok) {
          const id = (((await r.json()).data || [])[0] || {}).id;
          if (id) { if (id !== tok.sf) saveApple({ dev: tok.dev, user: tok.user, sf: id }); sfChecked = true; }
        }
      } catch (_) {}
    }
    return (amTok && amTok.sf) || tok.sf || 'us';
  }
  async function appleLyrics({ title, artist, duration }) {
    if (!status.apple.connected) return null;
    let tok = await appleTokens(false);
    const get = async (url) => {
      let r = await appleFetch(url, tok);
      if (r.status === 401 || r.status === 403) { tok = await appleTokens(true); r = await appleFetch(url, tok); }
      return r;
    };
    const sf = await appleStorefront(tok, get);
    const sr = await get(`https://amp-api.music.apple.com/v1/catalog/${sf}/search?${new URLSearchParams({ term: `${artist || ''} ${title}`.trim(), types: 'songs', limit: '8' })}`);
    if (!sr.ok) throw new Error(`Apple Music search ${sr.status}`);
    const sj = await sr.json();
    const song = pickAppleSong((((sj.results || {}).songs || {}).data), title, artist, duration);
    if (!song) return null;
    if (song.attributes && song.attributes.hasLyrics === false) return { none: true };
    const lr = await get(`https://amp-api.music.apple.com/v1/catalog/${sf}/songs/${song.id}/lyrics`);
    if (lr.status === 404) return { none: true };
    if (!lr.ok) throw new Error(`Apple Music lyrics ${lr.status}`);
    const lj = await lr.json();
    const ttml = lj && lj.data && lj.data[0] && lj.data[0].attributes && lj.data[0].attributes.ttml;
    status.apple.lastOk = Date.now(); status.apple.error = '';
    return parseTtml(ttml);
  }

  // ---- connect / disconnect (shown in Setup and Settings)
  function connect(name) {
    return new Promise((resolve) => {
      if (name === 'spotify') {
        const win = openWindow('spotify', 'https://accounts.spotify.com/login?continue=https%3A%2F%2Fopen.spotify.com%2F', 'Sign in to Spotify – Atoll');
        let done = false;
        const check = async () => {
          if (done) return;
          const cookies = await ses('spotify').cookies.get({ name: 'sp_dc' }).catch(() => []);
          if (cookies.length && !done) { done = true; status.spotify.connected = true; status.spotify.error = ''; persist(); spToken = null; try { win.close(); } catch (_) {} resolve(status.spotify); }
        };
        win.webContents.on('did-navigate', check);
        win.webContents.on('did-navigate-in-page', check);
        win.webContents.on('did-finish-load', check); // already signed in from before
        win.on('closed', () => resolve(status.spotify));
      } else {
        const win = openWindow('apple', 'https://music.apple.com/', 'Sign in to Apple Music (top right: Sign In) – Atoll');
        let done = false;
        const poll = async () => {
          if (done || win.isDestroyed()) return;
          const v = await readMusicKit(win, 1600);
          if (v) { done = true; saveApple(v); status.apple.connected = true; status.apple.error = ''; persist(); try { win.close(); } catch (_) {} resolve(status.apple); return; }
          setTimeout(poll, 1500);
        };
        win.webContents.once('did-finish-load', poll);
        win.on('closed', () => { done = true; resolve(status.apple); });
      }
    });
  }
  async function disconnect(name) {
    status[name].connected = false; status[name].error = '';
    if (name === 'spotify') spToken = null; else { amTok = null; store.set('appleTokens', null); }
    persist();
    try { await ses(name).clearStorageData(); } catch (_) {}
    return status[name];
  }

  // Which service owns the lyrics for the app that's playing: strictly that app's own, never another's.
  function serviceFor(app) {
    const name = String(app || '');
    if (/^com\.apple\.Music$|AppleInc\.AppleMusic|AppleMusic|iTunes/i.test(name)) return 'apple';
    if (/spotify/i.test(name)) return 'spotify';
    return null;
  }
  // the connected provider for the app that's playing (none if it isn't connected or isn't supported)
  function providers(app) {
    const service = serviceFor(app);
    if (!service || !status[service].connected) return [];
    const fn = service === 'apple' ? appleLyrics : spotifyLyrics;
    return [Object.assign(async (q) => {
      try { return await fn(q); } catch (e) { status[service].error = e.message; throw Object.assign(e, { provider: service }); }
    }, { providerName: service })];
  }
  return { status, connect, disconnect, providers, serviceFor };
}

module.exports = { createSources, pickSpotifyTrack, spotifyToResult, pickAppleSong, parseTtml, ttmlTime };
