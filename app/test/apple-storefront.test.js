// Apple Music lyrics must be asked from the account's own storefront, not MusicKit's 'us' fallback
// (Apple answers 404 for lyrics from any other storefront).
const assert = require('node:assert/strict');
const { createSources } = require('../src/lyrics-sources');
const stored = new Map([['lyricSources', { spotify: false, apple: true }], ['appleTokens', JSON.stringify({ dev: 'd', user: 'u', sf: 'us' })]]);
const fakeElectron = { BrowserWindow: class {}, session: { fromPartition: () => ({ setUserAgent() {}, setPermissionRequestHandler() {}, setPermissionCheckHandler() {} }) } };
const sources = createSources({ electron: fakeElectron, store: { get: k => stored.get(k), set: (k, v) => stored.set(k, v) }, secret: { encrypt: v => v, decrypt: v => v } });
const urls = [];
const json = (status, body) => ({ ok: status < 300, status, json: async () => body });
global.fetch = async (url) => {
  urls.push(String(url));
  if (url.includes('/me/storefront')) return json(200, { data: [{ id: 'id' }] });
  if (url.includes('/catalog/id/search')) return json(200, { results: { songs: { data: [{ id: '1', attributes: { name: 'Song', artistName: 'Band', durationInMillis: 200000, hasLyrics: true } }] } } });
  if (url.includes('/catalog/id/songs/1/lyrics')) return json(200, { data: [{ attributes: { ttml: '<tt><body><div><p begin="00:01.5" end="00:03">Hello</p><p begin="00:04" end="00:06">World</p></div></body></tt>' } }] });
  return json(404, { errors: [] }); // any other storefront
};
(async () => {
  const [provider] = sources.providers('com.apple.Music');
  const result = await provider({ title: 'Song', artist: 'Band', album: '', duration: 200 });
  assert.equal(result.synced.length, 2); assert.equal(result.synced[0].text, 'Hello'); assert.equal(result.synced[0].t, 1.5);
  assert.ok(urls.every(u => !u.includes('/catalog/us/')), 'never queried the fallback storefront');
  assert.equal(JSON.parse(stored.get('appleTokens')).sf, 'id', 'storefront is remembered');
  const before = urls.length;
  await provider({ title: 'Song', artist: 'Band', album: '', duration: 200 });
  assert.equal(urls.filter(u => u.includes('/me/storefront')).length, 1, 'storefront is asked once per run');
  console.log('Apple Music storefront resolution passed.');
})().catch(e => { console.error(e); process.exitCode = 1; });
