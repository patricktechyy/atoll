// Lyrics come only from the app that is playing; no third-party lyric site is ever contacted.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..');
const lyrics = require('../src/lyrics');

// Fail loudly if anything tries to reach the network during these tests.
const calls = [];
global.fetch = async (...a) => { calls.push(a[0]); throw new Error('network is off in this test'); };

// sources factory with a minimal fake electron/store so serviceFor/providers can be checked
const { createSources } = require('../src/lyrics-sources');
const store = new Map([['lyricSources', { spotify: true, apple: false }]]);
const fakeElectron = { BrowserWindow: class {}, session: { fromPartition: () => ({ setUserAgent() {}, setPermissionRequestHandler() {}, setPermissionCheckHandler() {} }) } };
const sources = createSources({ electron: fakeElectron, store: { get: k => store.get(k), set: (k, v) => store.set(k, v) }, secret: { encrypt: v => v, decrypt: v => v } });

(async () => {
  // which service owns which player
  assert.equal(sources.serviceFor('com.apple.Music'), 'apple');
  assert.equal(sources.serviceFor('AppleInc.AppleMusicWin_nzyj5cx40ttqa!App'), 'apple');
  assert.equal(sources.serviceFor('com.spotify.client'), 'spotify');
  assert.equal(sources.serviceFor('Spotify.exe'), 'spotify');
  assert.equal(sources.serviceFor('com.google.Chrome'), null);
  assert.equal(sources.serviceFor(''), null);

  // strict provider choice: only the connected provider of the playing app
  assert.deepEqual(sources.providers('com.spotify.client').map(p => p.providerName), ['spotify']);
  assert.deepEqual(sources.providers('com.apple.Music'), [], 'Apple Music is not connected, and Spotify must not stand in for it');
  assert.deepEqual(sources.providers('com.google.Chrome'), []);

  // other players: unsupported, no lookup at all
  assert.equal((await lyrics.getLyrics({ title: 'Song', artist: 'Band', duration: 200 }, { service: null, providers: [] })).unsupported, true);
  // supported app but not signed in: asks to connect, no lookup
  assert.equal((await lyrics.getLyrics({ title: 'Song', artist: 'Band', duration: 200 }, { service: 'apple', providers: [] })).needsConnect, 'apple');

  // a provider hit is returned, tagged with the service, and replayed from cache without asking again
  let asked = 0;
  const spotify = Object.assign(async q => { asked++; assert.equal(q.title, 'Song'); return { synced: [{ t: 1, text: 'hello' }], plain: 'hello', source: 'Spotify' }; }, { providerName: 'spotify' });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atoll-lyrics-'));
  lyrics.setDiskCache(dir);
  const meta = { title: 'Song (feat. X)', artist: 'Band', album: 'Album - Single', duration: 200 };
  const first = await lyrics.getLyrics(meta, { service: 'spotify', providers: [spotify] });
  assert.equal(first.source, 'Spotify'); assert.equal(first.service, 'spotify'); assert.equal(first.synced[0].text, 'hello');
  await lyrics.getLyrics(meta, { service: 'spotify', providers: [spotify] });
  assert.equal(asked, 1, 'second play comes from the cache');

  // the same song under another service is a separate lookup
  const apple = Object.assign(async () => ({ none: true }), { providerName: 'apple' });
  const other = await lyrics.getLyrics(meta, { service: 'apple', providers: [apple] });
  assert.equal(other.synced, null); assert.equal(other.service, 'apple');

  // no result is a plain "none": no fallback, and an error is reported as retryable
  const empty = Object.assign(async () => null, { providerName: 'spotify' });
  const none = await lyrics.getLyrics({ title: 'Unknown', artist: 'Nobody', duration: 100 }, { service: 'spotify', providers: [empty] });
  assert.deepEqual([none.synced, none.plain, none.error], [null, null, undefined]);
  const broken = Object.assign(async () => { throw Object.assign(new Error('Spotify search 500'), { provider: 'spotify' }); }, { providerName: 'spotify' });
  const err = await lyrics.getLyrics({ title: 'Broken', artist: 'Nobody', duration: 100 }, { service: 'spotify', providers: [broken] });
  assert.equal(err.error, 'unreachable'); assert.ok(err.retryIn >= 30000);

  // the old free providers are gone from the source tree and nothing touched the network
  assert.deepEqual(calls, []);
  const files = ['main.js', 'preload.js', ...fs.readdirSync(path.join(root, 'src')).filter(f => f.endsWith('.js')).map(f => 'src/' + f), ...fs.readdirSync(path.join(root, 'renderer')).filter(f => f.endsWith('.js')).map(f => 'renderer/' + f)];
  for (const f of files) assert.doesNotMatch(fs.readFileSync(path.join(root, f), 'utf8'), /lrclib\.net|music\.163\.com|cloudsearch/i, f + ' still references a free lyrics site');
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('Lyrics are limited to the playing app: routing, connect prompt, caching, errors and removal of free sources passed.');
})().catch(e => { console.error(e); process.exitCode = 1; });
