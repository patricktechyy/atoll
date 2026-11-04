// Tiny JSON store kept in %APPDATA%/Atoll/atoll.json
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { remember } = require('./position-presets');

const DEFAULTS = {
  settings: {
    startWithWindows: false,
    snapGuides: true,
    hud_volume: true, hud_caps: true, hud_lang: true, hud_device: true, hud_charge: true, hud_net: true,
    mascot: false,           // little eyes on the idle notch
    minimal: false,
    layout: 'pages',         // pages (Alcove: page dots) | tabs (classic: tab bar on top)
    openOn: 'hover',         // hover | click — how the notch opens
    hoverDelay: 0.3,         // seconds the pointer rests on the notch before it opens (0 – 0.6)
    gpu: true,               // draw with the graphics card (smooth; software drawing leaves ghosts in transparent windows)
    lyricOffset: 0,          // seconds: + shows lines earlier, − later
    artLookup: true,         // find missing album art on the iTunes Search API (title + artist only)
    smoothViz: true,         // smooth (CSS) or stepped music visualizer
    huds: true,              // volume / caps lock / language / charging pop out of the notch
    designV2: true,          // set once the Alcove-style redesign has migrated the settings
    lyricsInNotch: true,
    autoUpdate: true,        // check GitHub Releases in the background and download updates (installing is always the user's click)
    fullscreenMode: 'peek',  // peek = hidden until the mouse touches the top edge | show | hide
    size: 'm',               // s | m | l
    theme: 'dark',           // dark (black notch) | light (white notch)
    lite: true,              // fewer processes, less memory (applies after restart)
    waterEnabled: true,
    waterReminders: true,
    todolistReminders: true,
    notifications: true,          // show anything in the notch at all
    windowsNotifications: true,   // mirror toasts from WhatsApp, Discord, Chrome…
    translateLyrics: true,
    translateTo: 'en',
    understoodLanguages: [],
    showRomanization: true,
    homeLyrics: true,
    lyricSize: 28,                // Music tab lyrics (Home uses ~72%), 14-40 px
    position: { mode: 'top', frac: 0.5, top: 0, display: 'primary' }, // mode top (notch / floating) or side (vertical on an edge)
    sidePanel: { w: 380, h: 480 },  // side mode panel size (resizable)
    shortcuts: { romanization: 'Control+Alt+F8', layout: 'Control+Alt+P', area: 'Alt+Shift+S', full: 'Alt+Shift+A', clipboard: 'Alt+Shift+V', hide: 'Alt+Shift+H' },
    clipboardPaused: false,
    pasteOnPick: true,
    screenshotDir: '',
    accent: '#30d5c8',
    focusMin: 25,
    breakMin: 5,
    waterGoalMl: 2000,
    bottleMl: 250,
    waterEveryMin: 60,       // 0 = off
    icsUrl: '',
    calendarSource: 'ics',
    appleCalendarIds: [],
    meetingHeadsUpMin: 5,
    notifyPort: 47821,
    notifyToken: ''
  },
  todos: [],                 // {id, text, due:ms|null, done, notified}
  water: { date: '', ml: 0, lastAt: 0 },
  shelf: [],                 // absolute file paths
  focus: { sessionsToday: 0, date: '' },
  todolist: { url: '', user: '', name: '', cookie: '' }, // cookie is DPAPI-encrypted
  remoteNotified: {},        // Todolist task id -> due it was reminded for
  clips: []                  // clipboard history
};

function merge(base, extra) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  if (!extra || typeof extra !== 'object') return out;
  for (const [k, v] of Object.entries(extra)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) {
      out[k] = merge(base[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function createStore(dir) {
  const file = path.join(dir, 'atoll.json');
  let data = merge(DEFAULTS, {});
  let raw = null;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    data = merge(DEFAULTS, raw);
  } catch (_) { /* first run */ }
  if ('hideInFullscreen' in data.settings) {
    if (data.settings.hideInFullscreen === false) data.settings.fullscreenMode = 'show';
    delete data.settings.hideInFullscreen;
  }
  // v0.8 (Alcove-style): the notch starts plain; the mascot is opt-in now
  if (raw && raw.settings && !raw.settings.designV2) data.settings.mascot = false;
  if (!data.settings.notifyToken) data.settings.notifyToken = crypto.randomBytes(12).toString('hex');

  if (data.settings.shortcuts.layout === 'Control+Shift+P') data.settings.shortcuts.layout = 'Control+Alt+P';
  remember(data.settings);
  let timer = null;
  const flush = () => {
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file + '.tmp', JSON.stringify(data, null, 2));
      fs.renameSync(file + '.tmp', file);
    } catch (e) { console.error('[store] save failed', e); }
  };
  const save = () => { clearTimeout(timer); timer = setTimeout(flush, 300); };
  save();

  return {
    all: () => data,
    get: (k) => data[k],
    set: (k, v) => { if (k === 'settings') remember(v); data[k] = v; save(); },
    flush
  };
}

module.exports = { createStore, DEFAULTS };
