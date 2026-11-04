const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { reconcile } = require('../renderer/apple-clock');
const { sliderSeconds, sliderValue, projectMedia } = require('../src/apple-timeline');
const { normalizeMedia, isAppleMusic } = require('../src/media');
const { createStore } = require('../src/store');
const os = require('node:os');

// Run the actual main-process bridge with a fake native emitter and deterministic time.
const main = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
let now = 10000;
const native = new EventEmitter();
native.send = () => {};
native.diag = { uia: true };
const reports = [];
class BridgeDate extends Date { static now() { return now; } }
const bridge = vm.createContext({ native, Date: BridgeDate, normalizeMedia,
  isAppleMusic, sliderSeconds, sliderValue, projectMedia, DEMO: true,
  send: (type, value) => { if (type === 'media') reports.push(value); } });
vm.runInContext(main.slice(main.indexOf('const am = {'), main.indexOf('// Album art fallback:')) +
  '\nlet curMedia = null, currentCover = null;\n' + main.slice(main.indexOf('function wireNative()'), main.indexOf('app.whenReady().then')) +
  '\nwireNative();', bridge);
const sample = { active: true, key: 'song', app: 'AppleMusic', playing: true, position: 10, duration: 200 };
native.emit('media', sample);
now += 1500;
native.emit('ampos', { key: 'song', ok: false });
assert.equal(reports.at(-1).position, 11.5, 'cached fallback advances from original sample');
now += 500;
native.emit('ampos', { key: 'song', ok: false });
assert.equal(reports.at(-1).position, 12, 'cached samples do not accumulate projection twice');
native.emit('ampos', { key: 'song', ok: true, pos: 20, min: 0, max: 100 });
assert.equal(reports.at(-1).position, 40, 'percentage slider maps to seconds');
now += 500;
native.emit('ampos', { key: 'song', ok: true, pos: 20, min: 0, max: 100 });
assert.equal(reports.at(-1).position, 40.5, 'unchanged slider retains its original timestamp');
native.emit('ampos', { key: 'old song', ok: true, pos: 99, min: 0, max: 100 });
assert.equal(reports.at(-1).position, 40.5, 'old-track slider is discarded');
native.emit('media', { ...sample, playing: false, position: 15 });
now += 1000;
native.emit('ampos', { key: 'song', ok: false });
// Existing app slider remains available briefly; a fresh paused reading anchors it.
native.emit('ampos', { key: 'song', ok: true, pos: 7.5, min: 0, max: 100 });
assert.equal(reports.at(-1).position, 15);
now += 1000;
native.emit('ampos', { key: 'song', ok: true, pos: 7.5, min: 0, max: 100 });
assert.equal(reports.at(-1).position, 15, 'paused slider never extrapolates');
assert.equal(projectMedia({ ...sample, positionAt: 0 }, 500000).position, 200);
assert.equal(sliderSeconds(0.25, 0, 1, 200), 50);
assert.equal(sliderValue(50, 0, 100, 200), 25);

// Reproduce starting on a lagging Windows session, then acquiring Apple's slider.
let state = {};
let previous = { active: false };
let clockTime = 0;
function tick(position, source = 'app', playing = true, key = 'song', dt = 0.5) {
  clockTime += dt * 1000;
  const next = { ...sample, position, posSource: source, playing, key };
  const result = reconcile(previous, next, dt, state, clockTime);
  previous = { ...next, position: result };
  return result;
}
assert.equal(tick(10, 'session'), 10);
assert.equal(tick(16), 16, 'first authoritative slider removes six seconds of lag');
assert.equal(tick(17.5), 17.5, 'small forward correction catches up immediately');
assert.ok(tick(17) >= 17.5, 'small backward noise does not reverse playback');
const beforeDropout = previous.position;
assert.ok(tick(2, 'session') >= beforeDropout, 'brief slider loss ignores conflicting session');
assert.equal(tick(20, 'app', false), 20, 'pause anchors to player position');
assert.equal(tick(20, 'app', false), 20);
assert.equal(tick(20, 'app', true), 20, 'resume uses fresh player position');
let last = previous.position;
for (let i = 0; i < 8; i++) {
  const p = tick(60);
  assert.ok(p < 60, 'frozen report cannot confirm a seek');
  assert.ok(p >= last);
  last = p;
}
// A progressing external seek is corroborated and accepted in both directions.
tick(80); tick(80.5);
assert.equal(tick(81), 81);
tick(5); tick(5.5);
assert.equal(tick(6), 6);
assert.equal(tick(0, 'session', true, 'new song'), 0, 'track change resets clock');

// Exercise the real reminder scheduler with a fixed daytime clock.
const renderer = fs.readFileSync(path.join(__dirname, '../renderer/app.js'), 'utf8');
const mediaState = { media: { active: false }, mediaAt: 0, store: { settings: { lyricOffset: 0 } },
  lyricsKey: 'song', lyrics: { synced: [{ t: 0, text: 'intro' }, { t: 15.5, text: 'verse' }, { t: 18, text: 'chorus' }] } };
let rendererNow = 0, receiveMedia;
const noOp = () => {};
const lyricRenderer = vm.createContext({ S: mediaState, st: () => mediaState.store.settings,
  performance: { now: () => rendererNow }, window: { AppleClock: { reconcile } },
  api: { onMedia: cb => { receiveMedia = cb; } }, maybeRetryLyrics: noOp,
  playerShown: () => false, renderMusic: noOp, renderLyricsHead: noOp, layout: noOp });
vm.runInContext(renderer.slice(renderer.indexOf('  const mediaPos = () =>'),
  renderer.indexOf('  if (api.getMediaSnapshot)')) + '\n' +
  renderer.slice(renderer.indexOf('  function lyricIndex()'), renderer.indexOf('  function currentLyric()')), lyricRenderer);
receiveMedia({ ...sample, posSource: 'session', position: 10 });
assert.equal(vm.runInContext('lyricIndex()', lyricRenderer), 0);
rendererNow = 500;
receiveMedia({ ...sample, posSource: 'app', position: 16 });
assert.equal(vm.runInContext('lyricIndex()', lyricRenderer), 1, 'actual renderer catches up to the sung line');
mediaState.store.settings.lyricOffset = 2;
assert.equal(vm.runInContext('lyricIndex()', lyricRenderer), 2, 'Earlier 2 seconds advances the actual lyric selection');
mediaState.store.settings.lyricOffset = -2;
assert.equal(vm.runInContext('lyricIndex()', lyricRenderer), 0, 'Later delays actual lyric selection');

const settings = { waterEveryMin: 60, waterGoalMl: 2000, bottleMl: 250 };
const notices = [];
class Daytime extends Date { static now() { return 12 * 3600000; } getHours() { return 12; } }
const reminder = vm.createContext({ st: () => settings, Date: Daytime,
  S: { startedAt: 0, lastWaterNudge: 0 }, water: () => ({ ml: 0, lastAt: 0 }),
  notify: n => notices.push(n) });
vm.runInContext(renderer.slice(renderer.indexOf('  function checkWater()'),
  renderer.indexOf('  /* ---------------- today:')), reminder);
for (const combination of [ { waterReminders: false }, { waterEnabled: false }, { waterEveryMin: 0 } ]) {
  Object.assign(settings, { waterEnabled: true, waterReminders: true, waterEveryMin: 60 }, combination);
  vm.runInContext('checkWater()', reminder);
  assert.equal(notices.length, 0, 'disabled reminders cannot notify');
}
Object.assign(settings, { waterReminders: true, waterEnabled: true, waterEveryMin: 60 });
vm.runInContext('checkWater(); checkWater()', reminder);
assert.equal(notices.length, 1, 'enabled reminders notify once per interval');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'atoll-reminder-test-'));
fs.writeFileSync(path.join(temp, 'atoll.json'), JSON.stringify({ settings: { waterEveryMin: 0, lyricOffset: 2 } }));
const store = createStore(temp);
assert.equal(store.get('settings').waterReminders, true);
assert.equal(store.get('settings').waterEveryMin, 0, 'legacy off preference is preserved');
store.set('settings', { ...store.get('settings'), waterReminders: false });
store.flush();
assert.equal(createStore(temp).get('settings').waterReminders, false, 'toggle persists after restart');
assert.equal(store.get('settings').lyricOffset, 2, 'existing lyric adjustment is preserved');
setTimeout(() => fs.rmSync(temp, { recursive: true, force: true }), 400);
console.log('Reminder, settings persistence, Apple bridge and lyric clock regressions passed.');
