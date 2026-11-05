// Atoll — a living Dynamic Island for Windows.
const { app, BrowserWindow, screen, ipcMain, Tray, Menu, nativeImage, shell, safeStorage, globalShortcut, net, protocol, nativeTheme } = require('electron');
const clipboard = require('./src/pasteboard');
const v8 = require('v8');
const { cycle: cyclePosition } = require('./src/position-presets');
const fs = require('fs');
const os = require('os');
const path = require('path');
// Integration tests may supply a separate profile before any settings or credentials load.
if (process.env.ATOLL_TEST === '1' && process.env.ATOLL_TEST_USER_DATA) {
  app.setPath('userData', path.resolve(process.env.ATOLL_TEST_USER_DATA));
}
const { createStore, DEFAULTS } = require('./src/store');
const mac = process.platform === 'darwin';
const { NativeBridge } = mac ? require('./src/native-mac') : require('./src/native');
const { getLyrics, setDiskCache: setLyricsCache, forgetMisses, lyricsStatus } = require('./src/lyrics');
const { createSources } = require('./src/lyrics-sources');
const { createUpdater } = require('./src/updater');
const { capabilities } = require('./src/platform');
const { displayCutout, windowCutout } = require('./src/display-safe-area');
const { resetPermission } = require('./src/mac-permissions');
const { fetchCalendar } = require('./src/calendar');
const { startNotifyServer } = require('./src/notify-server');
const { TodolistSync, nodeTransport, electronTransport, chainTransport } = require('./src/todolist');
const { ClipHistory } = require('./src/clipboard');
const { Screenshots, defaultFolder } = require('./src/screenshot');
const { translateLines } = require('./src/translate');
const { normalizeMedia, fixArtData, pickItunesArt, isAppleMusic } = require('./src/media');
const { sliderSeconds, sliderValue, projectMedia } = require('./src/apple-timeline');

// Screen-capture tools: while one of these is in front, Atoll gets fully out of the way
// (Snipping Tool / Win+Shift+S overlay, ShareX, Greenshot, Lightshot, Snagit, PicPick, Flameshot).
const CAPTURE_TOOLS = new Set(['screenclippinghost', 'snippingtool', 'screensketch', 'sharex', 'greenshot', 'lightshot', 'snagit32', 'snagitcapture', 'picpick', 'flameshot', 'gyazo']);

const DEMO = process.argv.includes('--demo');
const WIN_W = 800; // room for the open panel's spring overshoot and its shadow
const WIN_H = 480;
const SIZE_ZOOM = { s: 0.85, m: 1, l: 1.2 };
const SIDE_W = 600; // side (vertical) mode: room for the resizable panel next to the screen edge
const SIDE_H = 660;

// ---- Lite mode: decided before Electron starts, so read the settings file directly ----
const early = (() => {
  try { return { ...DEFAULTS.settings, ...JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'atoll.json'), 'utf8')).settings }; }
  catch (_) { return DEFAULTS.settings; }
})();
// Graphics card: on by default. Drawing a transparent window in software is what made the island
// stutter and leave ghost shadows behind it, so turning it off (Settings → General) is only for
// PCs whose graphics driver misbehaves.
if (early.gpu === false) {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('in-process-gpu');
}
if (!mac && early.lite !== false) {
  // the page's JavaScript is tiny (~2 MB): cap the heap. (Not V8's --lite-mode: it switches off the
  // optimizing compiler, which made opening the notch noticeably slower on modest PCs.)
  app.commandLine.appendSwitch('js-flags', '--max-old-space-size=64 --max-semi-space-size=2');
  app.commandLine.appendSwitch('renderer-process-limit', '1');
  try { v8.setFlagsFromString('--optimize-for-size'); v8.setFlagsFromString('--expose-gc'); } catch (_) {}
}
// Things a notch never needs (and media-key capture that could fight with Spotify).
app.commandLine.appendSwitch('disable-features', [
  'HardwareMediaKeyHandling', 'MediaSessionService', 'SpareRendererForSitePerProcess', 'CalculateNativeWinOcclusion', 'Translate',
  'AutofillServerCommunication', 'BackForwardCache', 'Prerender2', 'OptimizationHints', 'MediaRouter', 'DialMediaRouteProvider',
  // fewer background processes: audio (the chime) runs inside the main process instead of its own
  'AudioServiceOutOfProcess'
].join(','));
// …and so does the network service (calendar, lyrics, Todolist), instead of a separate ~15-20 MB process
app.commandLine.appendSwitch('enable-features', 'NetworkServiceInProcess2');
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');

if (!app.requestSingleInstanceLock()) { app.quit(); }
// atoll://clip/<file> serves clipboard thumbnails from disk, so they don't sit in memory
protocol.registerSchemesAsPrivileged([{ scheme: 'atoll', privileges: { standard: true, secure: true } }]);
if (!mac) app.setAppUserModelId('app.atoll.notch');

let win = null;
let tray = null;
let store = null;
let todo = null;
const native = new NativeBridge();
let hitRect = { x: (WIN_W - 214) / 2, y: 0, w: 214, h: 34 };
let zoom = 1;
let hovering = false;
let lastRaise = 0;
let fullscreen = false;
const hiddenFor = new Set(); // reasons the window is hidden right now: fullscreen, capture, shot, paste, user
let offset = 0;              // notch centre relative to the window centre (CSS px)
let dragging = 0;            // drag to move the notch (until this time)
let held = 0;                // a press that started on the island: stay interactive until release (until this time)
let grab = { x: 0, y: 0 };   // where on the island the pointer grabbed it (CSS px)
let islandTop = 0;           // island top inside the window (CSS px)
let clips = null;
let shots = null;
let toastStatus = { ok: null, error: '' };
let calendar = { events: [], error: null, fetchedAt: 0 };
const netStat = { rx: 0, tx: 0, t: 0, down: 0, up: 0 };
let cpuPrev = os.cpus();
const captureWaits = new Map();   // screenshot id -> callback (the helper does the actual capture)
const clipStats = { count: 0, last: 0, via: '', helperSeen: false, error: '' };

const send = (ch, payload) => { if (win && !win.isDestroyed()) win.webContents.send(ch, payload); };
// to the notch, Settings and the setup guide
const sendAll = (ch, payload) => { for (const w of [win, settingsWin, setupWin]) if (w && !w.isDestroyed()) w.webContents.send(ch, payload); };
// the notch and the settings window both keep a copy of the store: tell every window (but the one that changed it)
let settingsWin = null, setupWin = null;
let updater = null; // in-app updates (src/updater.js)
let lyricSources = null; // Spotify / Apple Music lyrics (src/lyrics-sources.js)
function broadcastStore(except) {
  const data = publicStore();
  for (const w of [win, settingsWin, setupWin]) if (w && !w.isDestroyed() && w.webContents !== except) w.webContents.send('store', data);
}
const settings = () => store.get('settings');

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function targetDisplay() {
  const pos = settings().position || {};
  return screen.getAllDisplays().find((d) => String(d.id) === String(pos.display)) || screen.getPrimaryDisplay();
}
// Show the notch on another screen (id: 'primary' or a display id). Every remembered layout follows, so
// switching Top / Left / Right later does not send it back to the old screen.
function moveToDisplay(id) {
  const s = settings();
  const pos = s.position || { mode: 'top', frac: 0.5, top: 0 };
  const presets = {};
  for (const [k, v] of Object.entries(s.positionPresets || {})) presets[k] = { ...v, display: id };
  settings().position = { ...pos, display: id };
  settings().positionPresets = presets;
  store.set('settings', settings());
  placeWindow(); broadcastStore();
}
function displayMenu() {
  const all = screen.getAllDisplays();
  if (all.length < 2) return [];
  const current = targetDisplay().id;
  return [{ label: 'Show notch on screen', submenu: all.map((d, i) => {
    const primary = d.id === screen.getPrimaryDisplay().id;
    return { label: `${d.label || 'Screen ' + (i + 1)}${primary ? ' (main)' : ''} · ${d.size.width}×${d.size.height}`, type: 'radio', checked: d.id === current, click: () => moveToDisplay(primary ? 'primary' : String(d.id)) };
  }) }];
}
// The notch can sit anywhere: position = { display, frac (centre, 0..1 of the screen width), top (DIPs from the
// screen's top; 0 = attached to the top edge like a real notch) }. The window stays inside its screen;
// near a side or the bottom the island is drawn off-centre inside the window instead.
function placeWindow() {
  if (!win) return;
  if (toastWin && !toastWin.isDestroyed()) placeToast(toastPosition);
  const d = targetDisplay();
  const pos = settings().position || {};
  if (pos.mode === 'side') { // standing on the left or right edge
    const w = Math.round(SIDE_W * zoom), h = Math.round(SIDE_H * zoom);
    const inset = Math.round(clamp(Number(pos.inset) || 0, 0, 300) * 1); // fine-tuned away from the edge
    const x = pos.side === 'left' ? d.bounds.x + inset : d.bounds.x + d.bounds.width - w - inset;
    const cy = d.bounds.y + clamp(Math.round(Number(pos.cy) || d.bounds.height / 2), Math.round(90 * zoom), d.bounds.height - Math.round(90 * zoom));
    const y = clamp(Math.round(cy - h / 2), d.bounds.y, d.bounds.y + d.bounds.height - h);
    win.setBounds({ x, y, width: w, height: h });
    send('place', { mode: 'side', side: pos.side === 'left' ? 'left' : 'right', center: (cy - y) / zoom, inset });
    return;
  }
  const frac = clamp(Number(pos.frac ?? 0.5), 0, 1);
  const w = Math.round(WIN_W * zoom), h = Math.round(WIN_H * zoom);
  const half = 125 * zoom;
  const cx = clamp(d.bounds.x + frac * d.bounds.width, d.bounds.x + half, d.bounds.x + d.bounds.width - half);
  const top = clamp(Math.round(Number(pos.top) || 0), 0, d.bounds.height - Math.round(50 * zoom));
  const x = clamp(Math.round(cx - w / 2), d.bounds.x, d.bounds.x + d.bounds.width - w);
  const y = clamp(d.bounds.y + top, d.bounds.y, d.bounds.y + d.bounds.height - h);
  win.setBounds({ x, y, width: w, height: h });
  offset = (cx - (x + w / 2)) / zoom;
  islandTop = (d.bounds.y + top - y) / zoom;
  // Keep the shape attached to the screen edge. The renderer reserves the real camera rectangle
  // inside that shape, with wings beside it and panel content below it, instead of moving the window.
  send('place', { mode: 'top', offset, top: islandTop, floating: top > 0, cutout: windowCutout(d, { x, y }, zoom) });
}

function setHidden(reason, on) {
  if (!win || win.isDestroyed()) return;
  const was = hiddenFor.size > 0;
  if (on) hiddenFor.add(reason); else hiddenFor.delete(reason);
  const now = hiddenFor.size > 0;
  if (now && !was) win.hide();
  if (!now && was) { win.showInactive(); raise(); }
  if (tray && store.onChange) store.onChange();
}

// Notch size S/M/L scales the whole island (notch, overlays, panel) by zooming the page.
function applySize() {
  zoom = SIZE_ZOOM[settings().size] || 1;
  placeWindow();
  if (win) win.webContents.setZoomFactor(zoom);
}

function raise() {
  if (!win || win.isDestroyed()) return;
  win.setAlwaysOnTop(true, 'screen-saver');
  win.moveTop();
}

function createWindow() {
  win = new BrowserWindow({
    ...(mac ? { type: 'panel', enableLargerThanScreen: true } : {}),
    width: WIN_W, height: WIN_H, frame: false, transparent: true, resizable: false, movable: false,
    minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, hasShadow: false,
    alwaysOnTop: true, show: false, backgroundColor: '#00000000', title: 'Atoll',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true,
      backgroundThrottling: false, spellcheck: false, enableWebSQL: false
    }
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'), { query: DEMO ? { demo: '1' } : {} });
  win.webContents.on('did-finish-load', () => applySize());
  win.once('ready-to-show', () => win.showInactive());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  // Ctrl+wheel / Ctrl+= must not change the size behind our back
  win.webContents.on('zoom-changed', () => win.webContents.setZoomFactor(zoom));
  applySize();
}

// The window is mostly transparent and click-through. We poll the cursor and only make the
// window interactive while the pointer is over the island. Polling also works while dragging
// files from Explorer, and lets us pull the notch back on top of full-screen apps the moment
// the pointer touches the top edge.
function startHoverLoop() {
  let slowTick = 0, guideOn = false;
  const loop = () => {
    let next = 120;
    if (win && !win.isDestroyed() && win.isVisible()) {
      const p = screen.getCursorScreenPoint();
      const b = win.getBounds();
      const x = p.x - b.x, y = p.y - b.y;
      const r = { x: hitRect.x * zoom, y: hitRect.y * zoom, w: hitRect.w * zoom, h: hitRect.h * zoom };
      const m = hovering ? 14 : 4;
      const topEdge = r.y < 2 ? -2 : r.y - m;
      const inside = dragging > Date.now() || held > Date.now() || (x >= r.x - m && x <= r.x + r.w + m && y >= topEdge && y <= r.y + r.h + m);
      if (dragging > Date.now()) { // drag: the notch follows the pointer anywhere, even onto another screen
        const d = screen.getDisplayNearestPoint(p);
        const display = d.id === screen.getPrimaryDisplay().id ? 'primary' : String(d.id);
        const nearL = p.x - d.bounds.x < 40, nearR = d.bounds.x + d.bounds.width - 1 - p.x < 40, nearTop = p.y - d.bounds.y < 30;
        if ((nearL || nearR) && !nearTop) { // touching a side: it stands up vertically on that edge
          settings().position = { mode: 'side', side: nearL ? 'left' : 'right', cy: Math.round(p.y - d.bounds.y), display };
        } else {
          let cx = p.x - grab.x * zoom;
          let top = p.y - d.bounds.y - grab.y * zoom;
          if (settings().snapGuides !== false && top < 24 * zoom) top = 0; // snap back onto the top edge
          settings().position = { mode: 'top', frac: clamp((cx - d.bounds.x) / d.bounds.width, 0, 1), top: Math.round(top), display };
        }
        const pos = settings().position;
        const snap = settings().snapGuides !== false;
        let target, matched = false;
        if (snap) {
          const side = pos.mode === 'side';
          const length = side ? d.bounds.height : d.bounds.width;
          const value = side ? pos.cy : pos.frac * length;
          ({ target, matched } = require('./src/snap-position')(value, length));
          if (matched) { if (side) pos.cy = target; else pos.frac = target / length; }
        }
        placeWindow();
        if (snap) {
          const bounds = win.getBounds(), side = pos.mode === 'side';
          send('snap-guide', { axis: side ? 'y' : 'x', at: (target + (side ? d.bounds.y-bounds.y : d.bounds.x-bounds.x))/zoom, matched });
          guideOn = true;
        } else if (guideOn) { send('snap-guide', null); guideOn = false; }
      } else if (guideOn) { send('snap-guide', null); guideOn = false; }
      if (inside !== hovering) {
        hovering = inside;
        idleSince = inside ? 0 : Date.now();
        // above Chrome/F11/video players before we open; it's a window-manager call that can cost a
        // frame, so not on every hover: when something full-screen is up, or at most every few seconds
        if (inside && (fullscreen || Date.now() - lastRaise > 4000)) { lastRaise = Date.now(); raise(); }
        win.setIgnoreMouseEvents(!inside, { forward: true });
        send('hover', inside);
      }
      // poll fast only while the pointer is near the top of the screen
      next = dragging > Date.now() ? 16 : hovering || (y > -120 && y < b.height + 60 && x > -200 && x < b.width + 200) ? 40 : 200;
      if (fullscreen && !hovering && ++slowTick % 20 === 0) raise();
    }
    setTimeout(loop, next);
  };
  loop();
}

function cpuPercent() {
  const now = os.cpus();
  let idle = 0; let total = 0;
  now.forEach((c, i) => {
    const p = cpuPrev[i] || c;
    for (const k of Object.keys(c.times)) total += c.times[k] - p.times[k];
    idle += c.times.idle - p.times.idle;
  });
  cpuPrev = now;
  return total > 0 ? Math.round(100 * (1 - idle / total)) : 0;
}

let calendarRequest = 0;
async function refreshCalendar(requestAccess = false) {
  const request = ++calendarRequest;
  const s = settings();
  let result;
  try {
    result = mac && s.calendarSource === 'apple'
      ? await require('./src/calendar-mac').readAppleCalendar(s.appleCalendarIds, requestAccess)
      : await fetchCalendar(s.icsUrl, 7);
  } catch (error) {
    result = { events: [], error: 'Could not load calendar: ' + error.message, fetchedAt: Date.now() };
  }
  if (request !== calendarRequest) return calendar;
  calendar = result;
  send('calendar', calendar);
  return calendar;
}

function applyLoginItem(on) {
  app.setLoginItemSettings(mac ? { openAtLogin: !!on } : { openAtLogin: !!on, args: [] });
}

function publicStore() {
  const all = store.all();
  const { clips: _c, appleTokens: _a, ...rest } = all;
  return { ...rest, todolist: todo.publicInfo() }; // never hand the session cookie / music tokens to the page
}

function buildTray() {
  const trayIcon = () => {
    const dark = nativeTheme.shouldUseDarkColorsForSystemIntegratedUI ?? nativeTheme.shouldUseDarkColors;
    if (mac) { const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray-dark.png')).resize({ height: 18 }); icon.setTemplateImage(true); return icon; }
    const img = nativeImage.createFromPath(path.join(__dirname, 'assets', dark ? 'tray-light.png' : 'tray-dark.png'));
    return img.isEmpty() ? nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray.png')) : img;
  };
  tray = new Tray(trayIcon());
  nativeTheme.on('updated', () => { if (tray && !tray.isDestroyed()) tray.setImage(trayIcon()); });
  tray.setToolTip('Atoll');
  const rebuild = () => {
    const s = settings();
    const set = (k, v) => { s[k] = v; store.set('settings', s); broadcastStore(); };
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Open Atoll', click: () => send('open-tab', 'now') },
      { label: 'Settings…', click: () => openSettings() },
      { label: 'Setup guide…', click: () => openSetup() },
      { type: 'separator' },
      { label: mac ? 'Open at login' : 'Start with Windows', type: 'checkbox', checked: !!s.startWithWindows, click: (i) => { set('startWithWindows', i.checked); applyLoginItem(i.checked); } },
      { label: 'Minimal notch', type: 'checkbox', checked: !!s.minimal, click: (i) => set('minimal', i.checked) },
      { label: 'White notch', type: 'checkbox', checked: s.theme === 'light', click: (i) => set('theme', i.checked ? 'light' : 'dark') },
      { label: 'Size', submenu: ['s', 'm', 'l'].map((z) => ({ label: { s: 'Small', m: 'Medium', l: 'Large' }[z], type: 'radio', checked: s.size === z, click: () => { set('size', z); applySize(); } })) },
      { label: `Hide Atoll (${(s.shortcuts || {}).hide || 'no shortcut'})`, type: 'checkbox', checked: hiddenFor.has('user'), click: (i) => setHidden('user', i.checked) },
      { label: `Screenshot an area (${(s.shortcuts || {}).area || "no shortcut"})`, click: () => shots.take('area') },
      { label: `Clipboard history (${(s.shortcuts || {}).clipboard || "no shortcut"})`, click: () => openClipboard() },
      ...displayMenu(),
      { label: 'Move the notch…', click: () => { setHidden('user', false); send('move-mode', true); if (win) win.focus(); } },
      { label: 'Put the notch back at the top centre', click: () => { settings().position = { mode: 'top', frac: 0.5, top: 0, display: 'primary' }; store.set('settings', settings()); placeWindow(); } },
      { type: 'separator' },
      { label: 'Copy notification API example', click: () => clipboard.writeText(curlExample()) },
      { label: 'Restart Atoll', click: () => { app.relaunch(); app.quit(); } },
      { label: 'Quit Atoll', click: () => app.quit() }
    ]));
  };
  rebuild();
  tray.on('click', () => send('open-tab', 'now'));
  store.onChange = rebuild;
}

// ---- Settings: its own window, like Alcove's (the notch itself has no settings page) ----
function openSettings(section) {
  if (settingsWin && !settingsWin.isDestroyed()) {
    if (section) settingsWin.webContents.send('settings-section', section);
    if (settingsWin.isMinimized()) settingsWin.restore();
    settingsWin.show(); settingsWin.focus();
    return;
  }
  const dark = () => nativeTheme.shouldUseDarkColors;
  const bg = () => (dark() ? '#202020' : '#f3f3f3');
  settingsWin = new BrowserWindow({
    width: 880, height: 620, minWidth: 720, minHeight: 480, show: false, title: 'Atoll Settings',
    icon: path.join(__dirname, 'assets', 'icon.png'), backgroundColor: bg(), autoHideMenuBar: true,
    titleBarStyle: 'hidden', titleBarOverlay: { color: bg(), symbolColor: dark() ? '#ffffff' : '#1a1a1a', height: 44 },
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false }
  });
  const recolor = () => { if (settingsWin && !settingsWin.isDestroyed()) { settingsWin.setBackgroundColor(bg()); try { settingsWin.setTitleBarOverlay({ color: bg(), symbolColor: dark() ? '#ffffff' : '#1a1a1a' }); } catch (_) {} } };
  nativeTheme.on('updated', recolor);
  settingsWin.loadFile(path.join(__dirname, 'renderer', 'settings.html'), { hash: section || '' });
  settingsWin.once('ready-to-show', () => settingsWin.show());
  settingsWin.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  settingsWin.webContents.on('will-navigate', (e) => e.preventDefault());
  settingsWin.on('closed', () => { nativeTheme.removeListener('updated', recolor); settingsWin = null; native.send({ cmd: 'net', on: false }); });
}

// ---- Setup guide: on the first run, and after an update that adds something to set up ----
// Bump SETUP_VERSION when a release needs the user's attention; steps marked `since` that version
// are shown to people updating (renderer/setup.js), everything is shown on a fresh install.
const SETUP_VERSION = 1; // 1 = v0.10: lyrics from Spotify / Apple Music, clipboard check
let firstRun = false;
function openSetup() {
  if (setupWin && !setupWin.isDestroyed()) { setupWin.show(); setupWin.focus(); return; }
  const dark = nativeTheme.shouldUseDarkColors;
  const bg = dark ? '#202020' : '#f3f3f3';
  setupWin = new BrowserWindow({
    width: 680, height: 640, minWidth: 600, minHeight: 560, show: false, title: 'Welcome to Atoll', resizable: true, maximizable: false,
    icon: path.join(__dirname, 'assets', 'icon.png'), backgroundColor: bg, autoHideMenuBar: true,
    titleBarStyle: 'hidden', titleBarOverlay: { color: bg, symbolColor: dark ? '#ffffff' : '#1a1a1a', height: 40 },
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false }
  });
  setupWin.loadFile(path.join(__dirname, 'renderer', 'setup.html'));
  setupWin.once('ready-to-show', () => setupWin.show());
  setupWin.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  setupWin.webContents.on('will-navigate', (e) => e.preventDefault());
  setupWin.on('closed', () => { setupWin = null; });
}

// Right-click on the notch
function notchMenu() {
  const s = settings();
  Menu.buildFromTemplate([
    { label: 'Open', click: () => send('open-tab', 'now') },
    { label: 'Clipboard history', click: () => openClipboard() },
    { label: 'Screenshot an area', click: () => shots.take('area') },
    { type: 'separator' },
    ...displayMenu(),
    { label: 'Move the notch…', click: () => { send('move-mode', true); if (win) win.focus(); } },
    { label: 'Back to top centre', enabled: (s.position || {}).mode === 'side' || (s.position || {}).top > 0 || Math.abs(((s.position || {}).frac ?? 0.5) - 0.5) > 0.001, click: () => { settings().position = { mode: 'top', frac: 0.5, top: 0, display: 'primary' }; store.set('settings', settings()); placeWindow(); broadcastStore(); } },
    { label: `Hide Atoll${(s.shortcuts || {}).hide ? ` (${s.shortcuts.hide} to bring it back)` : ''}`, click: () => setHidden('user', true) },
    { type: 'separator' },
    { label: 'Settings…', click: () => openSettings() },
    { label: 'Quit Atoll', click: () => app.quit() }
  ]).popup({ window: win });
}

// Clicking the album art opens the app that's playing
function openPlayer(id) {
  const s = id.toLowerCase();
  if (mac && s === 'com.apple.music') return shell.openExternal('music:');
  if (s.includes('spotify')) return shell.openExternal('spotify:');
  if (s.includes('zune') || s.includes('microsoft.media')) return shell.openExternal('mswindowsmusic:');
  // Store apps report a full app id (Package!App): Explorer can open those directly
  if (/^[\w.-]+_[a-z0-9]+![\w.-]+$/i.test(id)) {
    require('child_process').spawn('explorer.exe', [`shell:AppsFolder\\${id}`], { detached: true, stdio: 'ignore' }).unref();
  }
}

function curlExample() {
  const s = settings();
  return `curl -X POST http://127.0.0.1:${s.notifyPort}/notify -H "X-Atoll-Token: ${s.notifyToken}" -H "Content-Type: application/json" -d "{\\"title\\":\\"Build finished\\",\\"body\\":\\"All tests passed\\",\\"icon\\":\\"✅\\"}"`;
}

// Working set = resident pages (includes shared pages); private bytes = committed private
// memory. Summed working sets are not identical to Task Manager's private working set.
function memoryBreakdown() {
  const parts = {}, reservedParts = {};
  let total = 0, reserved = 0;
  for (const m of app.getAppMetrics()) {
    const ws = (m.memory ? m.memory.workingSetSize || 0 : 0) * 1024;
    const pb = (m.memory ? m.memory.privateBytes || m.memory.workingSetSize || 0 : 0) * 1024;
    const name = { Browser: 'Main', Tab: 'Notch UI', GPU: 'Graphics', Utility: m.name || m.serviceName || 'Utility' }[m.type] || m.type;
    parts[name] = (parts[name] || 0) + ws; total += ws;
    reservedParts[name] = (reservedParts[name] || 0) + pb; reserved += pb;
  }
  const names = { main: mac ? 'Mac helper' : native.kind === 'powershell' ? 'Windows helper (PowerShell)' : 'Windows helper', media: 'Music helper (PowerShell)' };
  for (const [role, ws] of Object.entries(native.mem)) { if (ws) { const n = names[role] || role; parts[n] = ws; total += ws; reservedParts[n] = ws; reserved += ws; } }
  const b = native.diag.build;
  return { atollMem: total, atollReserved: reserved, atollParts: parts, atollReservedParts: reservedParts, lastTrim, gpuOn: early.gpu !== false,
    atollProcs: app.getAppMetrics().length + Object.keys(native.procs).length, helperKind: native.kind, helperError: native.kind === 'native' ? '' : (b.full || b.core || '') };
}

// Explicit manual trim only. Evicting working sets on a timer makes the next hover fault
// code and textures back into RAM; it does not reduce the app's committed allocation.
let idleSince = Date.now(), lastTrim = 0;
function trimNow() {
  lastTrim = Date.now();
  send('trim');
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send('trim');
  if (typeof mainGc === 'function') { try { mainGc(); } catch (_) {} }
  const pids = app.getAppMetrics().map((m) => m.pid);
  for (const p of Object.values(native.procs)) if (p && p.pid) pids.push(p.pid);
  native.send({ cmd: 'trim', pids });
}
let mainGc = null;
try { mainGc = require('vm').runInNewContext('gc'); } catch (_) {}

// ipcMain.handle calls (event, ...args): drop the event so handlers get only what the page sent
const safe = (fn) => async (_event, ...a) => {
  try { return { ok: true, data: await fn(...a) }; } catch (e) { return { ok: false, error: e.message || String(e), code: e.code || 0 }; }
};

function wireIpc() {
  if (mac) {
    const { systemPreferences } = require('electron');
    ipcMain.handle('mac:permissions', async () => {
      let calendar = null; // null: could not be read
      try { calendar = !!JSON.parse(await require(path.join(process.resourcesPath, 'helper', 'platform.node')).calendarEvents(false)).authorized; } catch (_) {}
      return {
        screen: systemPreferences.getMediaAccessStatus('screen'),
        accessibility: systemPreferences.isTrustedAccessibilityClient(false),
        calendar
      };
    });
    // "Fix permission": clear Atoll's stale entry for one permission (see src/mac-permissions.js), then ask again.
    // Needed because every Atoll build has a new code fingerprint: after an update macOS can show Atoll as allowed
    // while refusing it, and asking again shows no prompt. Only from the Settings window, only on the user's click.
    ipcMain.handle('mac:fix', async (event, kind) => {
      if (!settingsWin || event.sender !== settingsWin.webContents) return { ok: false, error: 'Open Settings to fix a permission.' };
      const testing = process.env.ATOLL_TEST === '1';
      // the test build shares Atoll's bundle id: tests record the command instead of clearing real permissions
      const run = testing
        ? async (cmd, args) => { (global.__tccCalls = global.__tccCalls || []).push([cmd, args]); }
        : (cmd, args) => new Promise((resolve, reject) => require('child_process').execFile(cmd, args, { timeout: 15000 }, (err, _out, stderr) => (err ? reject(Object.assign(err, { stderr })) : resolve())));
      const reset = await resetPermission(kind, { run, packaged: app.isPackaged });
      if (!reset.ok) return reset;
      try {
        if (kind === 'calendar') {
          store.set('settings', { ...settings(), calendarSource: 'apple' });
          broadcastStore(event.sender);
          const c = await refreshCalendar(true); // shows macOS's Calendar prompt again
          return { ok: true, allowed: !!c.authorized, note: c.authorized ? '' : 'Choose Allow in the macOS prompt. If none appeared, quit and reopen Atoll, then try again.' };
        }
        if (kind === 'screen') {
          const allowed = require(path.join(process.resourcesPath, 'helper', 'platform.node')).requestScreen();
          if (!allowed) await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
          return { ok: true, allowed: !!allowed, note: 'macOS needs Atoll reopened before screenshots work.', restart: true };
        }
        if (kind === 'accessibility') {
          const allowed = systemPreferences.isTrustedAccessibilityClient(true);
          if (!allowed) await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility');
          return { ok: true, allowed: !!allowed, note: allowed ? '' : 'Switch Atoll on in the list that opened.' };
        }
        if (kind === 'automation' && !testing) {
          // restart the music helper: its next request to Music / Spotify makes macOS ask again
          native.stop();
          for (let i = 0; i < 30 && native.procs.main; i++) await new Promise((r) => setTimeout(r, 100));
          native.start(path.join(app.getPath('userData'), 'helper'));
        }
        return { ok: true, allowed: null, note: 'Play a song in Music or Spotify. macOS will ask whether Atoll may control it: choose OK.' };
      } catch (e) { return { ok: false, error: 'The permission was cleared, but asking again failed: ' + (e.message || e) }; }
    });
    ipcMain.handle('mac:request', async (event, kind) => {
      if (!settingsWin || event.sender !== settingsWin.webContents) return false;
      if (kind === 'screen') {
        const allowed = require(path.join(process.resourcesPath, 'helper', 'platform.node')).requestScreen();
        if (!allowed) await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
        return allowed;
      }
      if (kind === 'accessibility') {
        const allowed = systemPreferences.isTrustedAccessibilityClient(true);
        if (!allowed) await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility');
        return allowed;
      }
      return false;
    });
  }
  ipcMain.handle('media:snapshot', () => curMedia ? { ...withAppleMusicPosition(curMedia), cover: currentCover } : { active: false });
  ipcMain.handle('store:all', () => publicStore());
  ipcMain.handle('store:set', (_e, key, value) => {
    if (!['settings', 'todos', 'water', 'shelf', 'focus', 'remoteNotified'].includes(key)) return false;
    const before = settings();
    store.set(key, value);
    if (key === 'settings') {
      if (before.startWithWindows !== value.startWithWindows) applyLoginItem(value.startWithWindows);
      if (before.icsUrl !== value.icsUrl || before.calendarSource !== value.calendarSource || JSON.stringify(before.appleCalendarIds) !== JSON.stringify(value.appleCalendarIds)) refreshCalendar();
      if (before.size !== value.size) applySize();
      if (before.fullscreenMode !== value.fullscreenMode) applyFullscreen();
      if (JSON.stringify(before.position) !== JSON.stringify(value.position)) placeWindow();
      if (before.windowsNotifications !== value.windowsNotifications || before.notifications !== value.notifications) syncHelper();
      if (JSON.stringify(before.shortcuts) !== JSON.stringify(value.shortcuts)) registerShortcuts();
      if (store.onChange) store.onChange();
    }
    broadcastStore(_e.sender);
    return true;
  });
  // a press on the island keeps the window taking the mouse until it's released, so a drag that
  // wanders off the notch (scrubbing, swiping pages, selecting text) doesn't lose its pointer-up and close it
  ipcMain.on('hold-pointer', (_e, on) => { held = on ? Date.now() + 20000 : 0; });
  ipcMain.on('repaint', () => { if (win && !win.isDestroyed()) win.webContents.invalidate(); });
  ipcMain.on('hit-rect', (_e, r) => {
    if (r && [r.x, r.y, r.w, r.h].every(Number.isFinite)) hitRect = r;
  });
  ipcMain.on('media', (_e, cmd) => {
    if (!cmd || !['toggle', 'next', 'prev', 'seek'].includes(cmd.cmd)) return;
    const pos = Number(cmd.pos) || 0;
    // Apple Music ignores "seek" and "previous" from Windows' media controls: use its own controls
    if (curMedia && isAppleMusic(curMedia.app) && amUsable()) {
      if (cmd.cmd === 'seek') {
        const value = am.found && am.key === curMedia.key ? amValue(pos, curMedia.duration) : null;
        if (value !== null) { native.send({ cmd: 'amseek', pos: value }); am.pos = value; am.at = Date.now(); return; }
      }
      if (cmd.cmd === 'prev') { native.send({ cmd: 'amprev' }); return; }
    }
    native.send({ cmd: cmd.cmd, pos });
  });
  ipcMain.on('stats-active', (_e, on) => native.send({ cmd: 'net', on: !!on }));
  // Lyrics come only from the app that is playing (Spotify or Apple Music), never from another site
  ipcMain.handle('lyrics', (_e, meta) => {
    const app = curMedia && curMedia.app;
    return getLyrics(meta || {}, {
      force: !!(meta && meta.force),
      service: lyricSources ? lyricSources.serviceFor(app) : null,
      providers: lyricSources ? lyricSources.providers(app) : []
    });
  });
  // Spotify / Apple Music as lyrics sources: you sign in on their own page, in a separate browser profile
  const sourcesInfo = () => ({ ...(lyricSources ? lyricSources.status : {}) });
  // What this platform can do (src/platform.js); read synchronously by the preload
  ipcMain.on('caps', (e) => { e.returnValue = capabilities(); });
  // In-app updates: Settings → About
  ipcMain.handle('updater:state', () => (updater ? updater.getState() : { state: 'unavailable', current: app.getVersion() }));
  ipcMain.handle('updater:check', () => (updater ? updater.check({ manual: true }) : { state: 'unavailable' }));
  ipcMain.handle('updater:install', () => (updater ? updater.install() : { ok: false }));
  ipcMain.handle('updater:open-page', () => { const page = updater && updater.getState().releasesPage; if (page && /^https:\/\/github\.com\//.test(page)) shell.openExternal(page); });
  ipcMain.handle('lyric-sources:status', () => sourcesInfo());
  ipcMain.on('setup:open', () => openSetup());
  ipcMain.on('setup:done', (_e, v) => { store.set('setupSeen', Math.max(Number(store.get('setupSeen')) || 0, Number(v) || SETUP_VERSION)); });
  ipcMain.handle('setup:info', () => ({ seen: Number(store.get('setupSeen')) || 0, version: SETUP_VERSION, isUpdate: Number(store.get('setupSeen')) > 0 || !store.get('firstVersion'), toasts: toastStatus }));
  ipcMain.on('open-ms-settings', (_e, page) => { if (['notifications', 'privacy-notifications', 'display'].includes(page)) shell.openExternal('ms-settings:' + page); });
  // the guide's clipboard check: put a line on the clipboard and see whether it lands in the history
  ipcMain.handle('setup:clip-test', async () => {
    const sample = `Atoll clipboard check · ${new Date().toLocaleTimeString()}`;
    if (settings().clipboardPaused) return { ok: false, reason: 'paused' };
    const skipBefore = clipStats.skip;
    clipboard.writeText(sample);
    const t0 = Date.now();
    while (Date.now() - t0 < 6000) {
      await new Promise((r) => setTimeout(r, 200));
      const top = clips && clips.list()[0];
      if (top && top.type === 'text' && top.text === sample) {
        // take the test line out again (and anything that re-reads it in the next moment)
        const drop = () => { for (const x of clips.list().filter((y) => y.type === 'text' && y.text === sample)) clips.remove(x.id); };
        drop(); clips.ignoreHash = top.hash; setTimeout(drop, 1500);
        return { ok: true, via: clipStats.via, ms: Date.now() - t0 };
      }
    }
    const skip = clipStats.skip !== skipBefore ? clipStats.skip : null;
    return { ok: false, reason: skip ? skip.reason : 'not seen', error: clipStats.error || '', helper: native.kind, helperSeen: clipStats.helperSeen };
  });
  ipcMain.handle('lyric-sources:connect', async (_e, name) => {
    if (!lyricSources || !['spotify', 'apple'].includes(name)) return sourcesInfo();
    await lyricSources.connect(name);
    forgetMisses(); sendAll('lyrics-sources', sourcesInfo()); // songs with no lyrics before: ask again
    return sourcesInfo();
  });
  ipcMain.handle('lyric-sources:disconnect', async (_e, name) => {
    if (lyricSources && ['spotify', 'apple'].includes(name)) await lyricSources.disconnect(name);
    sendAll('lyrics-sources', sourcesInfo());
    return sourcesInfo();
  });
  ipcMain.handle('stats', () => ({
    cpu: cpuPercent(), memUsed: os.totalmem() - os.freemem(), memTotal: os.totalmem(),
    down: netStat.down, up: netStat.up, uptime: os.uptime(), cores: os.cpus().length,
    ...memoryBreakdown()
  }));
  ipcMain.handle('calendar:connect-apple', async event => {
    if (!mac || !settingsWin || event.sender !== settingsWin.webContents) return { events: [], error: 'Open Calendar settings to connect Apple Calendar.' };
    store.set('settings', { ...settings(), calendarSource: 'apple' });
    broadcastStore(event.sender);
    return refreshCalendar(true);
  });
  ipcMain.handle('calendar:get', () => calendar);
  ipcMain.handle('calendar:refresh', () => refreshCalendar());
  ipcMain.handle('file-icon', async (_e, p) => {
    try { return (await app.getFileIcon(p, { size: 'normal' })).toDataURL(); } catch (_) { return null; }
  });
  ipcMain.on('open-path', (_e, p) => { if (typeof p === 'string') shell.openPath(p); });
  ipcMain.on('show-in-folder', (_e, p) => { if (typeof p === 'string') shell.showItemInFolder(p); });
  ipcMain.on('open-url', (_e, u) => { if (/^https?:\/\//i.test(u || '')) shell.openExternal(u); });
  ipcMain.on('start-drag', (e, p) => {
    if (typeof p !== 'string') return;
    e.sender.startDrag({ file: p, icon: nativeImage.createFromPath(path.join(__dirname, 'assets', 'drag.png')) });
  });
  ipcMain.handle('notify-info', () => {
    const s = settings();
    return { port: s.notifyPort, token: s.notifyToken, curl: curlExample() };
  });
  ipcMain.on('copy', (_e, text) => clipboard.writeText(String(text || '')));
  ipcMain.on('focus-window', () => { if (win) win.focus(); });
  ipcMain.on('restart', () => { app.relaunch(); app.quit(); });
  ipcMain.on('quit', () => app.quit());

  // Notch placement
  ipcMain.handle('displays', () => screen.getAllDisplays().map((d, i) => {
    const primary = d.id === screen.getPrimaryDisplay().id;
    return { width: d.bounds.width, height: d.bounds.height, primary, id: primary ? 'primary' : String(d.id), name: d.label || `Screen ${i + 1}`, label: `${d.label || 'Screen ' + (i + 1)}${primary ? ' (main)' : ''} · ${d.size.width}×${d.size.height}` };
  }));
  ipcMain.on('move-to-display', (_e, id) => { if (typeof id === 'string' && (id === 'primary' || screen.getAllDisplays().some((d) => String(d.id) === id))) moveToDisplay(id); });
  ipcMain.on('drag-notch', (_e, on, g) => {
    if (on && g) grab = { x: Number(g.x) || 0, y: Number(g.y) || 0 };
    dragging = on ? Date.now() + 30000 : 0;
    if (!on) { store.set('settings', settings()); broadcastStore(); }
  });
  ipcMain.on('move-mode', (e, on) => {
    if (!on || !win) return;
    setHidden('user', false);
    if (e.sender !== win.webContents) send('move-mode', true); // asked from the settings window
    win.focus();
  });
  ipcMain.on('open-settings', (_e, section) => openSettings(section));
  ipcMain.on('notch-menu', () => notchMenu());
  ipcMain.on('open-clipboard', () => openClipboard());
  ipcMain.on('set-volume', (_e, v) => { if (Number.isFinite(+v)) native.send({ cmd: 'setvol', v: Math.max(0, Math.min(100, Math.round(+v))) }); });
  ipcMain.on('open-player', (_e, id) => openPlayer(String(id || '')));
  ipcMain.on('notify-test', (_e, n) => send('notify', { icon: 'bell', title: 'Hello from Atoll', body: 'This is where your notifications appear.', app: 'Atoll', force: true, ...(n || {}) }));
  // arrow keys / nudge buttons: dx, dy in screen pixels
  ipcMain.on('nudge', (_e, delta) => {
    const [dx, dy] = (Array.isArray(delta) ? delta : [0, 0]).map((n) => Number(n) || 0);
    const d = targetDisplay();
    const pos = { ...(settings().position || {}) };
    if (pos.mode === 'side') {
      pos.cy = clamp((Number(pos.cy) || d.bounds.height / 2) + dy, 0, d.bounds.height);
      pos.inset = clamp((Number(pos.inset) || 0) + (pos.side === 'left' ? dx : -dx), 0, 300);
    } else {
      pos.mode = 'top';
      pos.frac = clamp(Number(pos.frac ?? 0.5) + dx / d.bounds.width, 0, 1);
      pos.top = clamp((Number(pos.top) || 0) + dy, 0, d.bounds.height - 80);
    }
    settings().position = pos;
    placeWindow();
    store.set('settings', settings());
    broadcastStore();
  });
  ipcMain.on('reset-position', () => { settings().position = { mode: 'top', frac: 0.5, top: 0, display: 'primary' }; store.set('settings', settings()); placeWindow(); broadcastStore(); });
  ipcMain.on('place?', () => placeWindow());

  // Lyrics translation
  ipcMain.handle('translate', safe((key, lines, to, understood) => translateLines(String(key), Array.isArray(lines) ? lines.slice(0, 400).map(String) : [], String(to || 'en'), Array.isArray(understood) ? understood.slice(0, 100).map(String) : [])));

  // Clipboard history
  ipcMain.handle('clip:list', () => {
    try {
      const r = clips.captureDetailed();
      if (r.saved) { clipStats.count++; clipStats.last = Date.now(); clipStats.via = 'opened'; clipStats.skip = null; }
      else if (r.reason === 'private' && !(clipStats.skip && clipStats.skip.reason === 'private')) clipStats.skip = { reason: r.reason, at: Date.now() };
    } catch (e) { clipStats.error = e.message; }
    return clips.list();
  });
  ipcMain.handle('trim-now', () => { trimNow(); return true; });
  ipcMain.handle('clip:status', () => ({ ...clipStats, paused: !!settings().clipboardPaused }));
  ipcMain.handle('clip:use', (_e, id, paste) => {
    if (!clips.use(id)) return false;
    if (paste && settings().pasteOnPick !== false && (process.platform === 'win32' || mac)) {
      // hide so Windows hands focus back to the app you were in, then press Ctrl+V there
      setHidden('paste', true);
      setTimeout(() => native.send({ cmd: 'paste' }), 140);
      setTimeout(() => setHidden('paste', false), 500);
    }
    return true;
  });
  ipcMain.on('clip:pin', (_e, id, on) => clips.pin(id, on));
  ipcMain.on('clip:remove', (_e, id) => clips.remove(id));
  ipcMain.on('clip:clear', () => clips.clear());
  ipcMain.on('clip:drag', (e, id) => {
    const f = clips.filePath(id);
    if (f) e.sender.startDrag({ file: f, icon: nativeImage.createFromPath(path.join(__dirname, 'assets', 'drag.png')) });
  });

  // Screenshots & shortcuts
  ipcMain.on('shot', (_e, mode) => shots.take(mode === 'full' ? 'full' : 'area'));
  ipcMain.handle('shortcuts:status', () => shortcutStatus);
  ipcMain.handle('toasts:status', () => toastStatus);
  ipcMain.handle('diagnostics', () => ({
    version: app.getVersion(), electron: process.versions.electron, windows: require('os').release(), lite: early.lite !== false,
    helper: native.report(), clipboard: clipStats,
    appleMusic: { usable: amUsable(), watching: am.watching, sliderFound: am.found, lastCmd: am.lastCmd },
    lyrics: { ...lyricsStatus(), spotify: lyricSources ? lyricSources.status.spotify : null, apple: lyricSources ? lyricSources.status.apple : null }, mediaLog: mediaLog.slice(-12), toasts: toastStatus, screenshot: shots ? shots.lastError : '', shortcuts: shortcutStatus
  }));

  ipcMain.on('toast:show', (_e, n) => {
    clearTimeout(toastIdleT);
    if (!n || hiddenFor.has('user') || hiddenFor.has('capture') || hiddenFor.has('shot')) { send('toast-event', { id: n && n.id, type: 'done' }); return; }
    ensureToast();
    placeToast(n.pos);
    const message = { ...n, cameraInset: toastInset };
    if (toastReady) toastWin.webContents.send('toast', message); else toastPending = message;
    toastWin.showInactive();
    toastWin.setAlwaysOnTop(true, 'screen-saver');
    toastWin.moveTop();
  });
  ipcMain.on('toast:ready', () => { toastReady = true; if (toastPending) { toastWin.webContents.send('toast', toastPending); toastPending = null; } });
  ipcMain.on('toast:interactive', (_e, on) => { if (toastWin && !toastWin.isDestroyed()) toastWin.setIgnoreMouseEvents(!on, { forward: true }); });
  ipcMain.on('toast:event', (_e, ev) => {
    send('toast-event', ev);
    if (ev && ev.type === 'done' && toastWin && !toastWin.isDestroyed()) {
      toastWin.hide(); toastWin.setIgnoreMouseEvents(true, { forward: true });
      // not needed for a while? let the window go (it comes back in a blink when the next one arrives)
      clearTimeout(toastIdleT);
      toastIdleT = setTimeout(() => { if (toastWin && !toastWin.isDestroyed() && !toastWin.isVisible()) { toastWin.destroy(); toastWin = null; toastReady = false; } }, 90 * 1000);
    }
  });

  // Gavin's Todolist
  ipcMain.handle('todo:info', () => todo.publicInfo());
  ipcMain.handle('todo:login', safe(async (url, user, pass) => { const r = await todo.login(url, user, pass); broadcastStore(); return r; }));
  ipcMain.handle('todo:logout', async () => { const r = await todo.logout(); broadcastStore(); return r; });
  ipcMain.handle('todo:list', safe(() => todo.tasks()));
  ipcMain.handle('todo:add', safe((text, due, time) => todo.add(String(text || '').slice(0, 300), due, time)));
  ipcMain.handle('todo:update', safe((id, patch) => todo.update(String(id), patch)));
  ipcMain.handle('todo:remove', safe((id) => todo.remove(String(id))));
}

// ---- Notifications somewhere else on the screen (Settings → Notifications → Where they pop up).
// A small second window; it shares the notch's renderer process, so it costs very little.
const TOAST_W = 520, TOAST_H = 150;
let toastWin = null, toastReady = false, toastPending = null, toastIdleT = null;
let toastPosition = 'top-center';
let toastInset = 0;
function ensureToast() {
  if (toastWin && !toastWin.isDestroyed()) return toastWin;
  toastReady = false;
  toastWin = new BrowserWindow({
    width: TOAST_W, height: TOAST_H, frame: false, transparent: true, resizable: false, movable: false, focusable: false,
    minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, hasShadow: false, alwaysOnTop: true, show: false,
    backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'renderer', 'toast-preload.js'), contextIsolation: true, sandbox: true, spellcheck: false, backgroundThrottling: false }
  });
  toastWin.setAlwaysOnTop(true, 'screen-saver');
  toastWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  toastWin.setIgnoreMouseEvents(true, { forward: true });
  toastWin.loadFile(path.join(__dirname, 'renderer', 'toast.html'));
  toastWin.webContents.on('did-finish-load', () => toastWin.webContents.setZoomFactor(zoom));
  return toastWin;
}
function placeToast(where) {
  toastPosition = where;
  const d = targetDisplay(), wa = d.workArea || d.bounds;
  const W = Math.round(TOAST_W * zoom), H = Math.round(TOAST_H * zoom);
  const cx = Math.round(d.bounds.x + (d.bounds.width - W) / 2);
  const right = wa.x + wa.width - W, bottom = wa.y + wa.height - H;
  const camera = displayCutout(d);
  const top = d.bounds.y, cornerTop = Math.max(wa.y, top + (camera?.height || 0));
  toastInset = where === 'top-center' && camera ? Math.ceil(camera.height / zoom) + 6 : 0;
  const xy = {
    'top-center': [cx, top], 'top-left': [wa.x, cornerTop], 'top-right': [right, cornerTop],
    'bottom-left': [wa.x, bottom], 'bottom-center': [cx, bottom], 'bottom-right': [right, bottom]
  }[where] || [cx, top];
  toastWin.setBounds({ x: xy[0], y: xy[1], width: W, height: H });
  toastWin.webContents.setZoomFactor(zoom);
  if (toastPending) toastPending.cameraInset = toastInset;
  toastWin.webContents.send('toast-place', { cameraInset: toastInset });
}

function applyFullscreen() {
  const mode = settings().fullscreenMode || 'peek';
  send('fullscreen', { on: fullscreen, mode });
  setHidden('fullscreen', fullscreen && mode === 'hide');
  if (fullscreen && mode !== 'hide') raise();
}

function syncHelper() {
  const s = settings();
  native.send({ cmd: 'toasts', on: s.notifications !== false && s.windowsNotifications !== false });
}

function openClipboard() {
  setHidden('user', false);
  send('open-tab', 'clipboard');
  if (win) { win.focus(); }
}

let shortcutStatus = {};
function registerShortcuts() {
  globalShortcut.unregisterAll();
  const sc = { romanization: 'Control+Alt+F8', layout: 'Control+Alt+P', ...(settings().shortcuts || {}) };
  const actions = {
    romanization: () => {
      const s = settings(); s.showRomanization = !s.showRomanization;
      store.set('settings', s); store.flush(); broadcastStore();
    },
    area: () => shots.take('area'),
    full: () => shots.take('full'),
    clipboard: openClipboard,
    layout: () => {
      const s = settings();
      cyclePosition(s, targetDisplay().bounds.height);
      store.set('settings', s); store.flush(); applySize(); broadcastStore();
    },
    hide: () => setHidden('user', !hiddenFor.has('user'))
  };
  shortcutStatus = {};
  for (const [k, fn] of Object.entries(actions)) {
    if (!sc[k]) { shortcutStatus[k] = 'off'; continue; }
    try { shortcutStatus[k] = globalShortcut.register(sc[k], fn) ? 'ok' : 'taken'; } catch (_) { shortcutStatus[k] = 'invalid'; }
  }
  send('shortcuts', shortcutStatus);
}

// "5319275A.WhatsAppDesktop_cv1g1gvanyjgm!App" -> "WhatsApp"
function appNameFromId(id) {
  const known = { whatsappdesktop: 'WhatsApp', whatsapp: 'WhatsApp', discord: 'Discord', chrome: 'Chrome', msedge: 'Edge', teams: 'Teams', msteams: 'Teams', telegramdesktop: 'Telegram', spotify: 'Spotify', outlook: 'Outlook', slack: 'Slack', line: 'LINE', instagram: 'Instagram', zoom: 'Zoom' };
  let s = String(id || '').split('!')[0].replace(/_[a-z0-9]{10,}$/i, '').replace(/\.exe$/i, '');
  if (/^Windows\.SystemToast/i.test(s) || /^Microsoft\.Windows/i.test(s)) return 'Windows';
  const parts = s.split(/[.\\]/).filter(Boolean);
  let last = (parts.pop() || s).replace(/\.exe$/i, '');
  if (/^(App|Desktop|Client)$/i.test(last) && parts.length) last = parts.pop();
  const k = last.toLowerCase().replace(/[^a-z]/g, '');
  return known[k] || Object.entries(known).find(([kk]) => k.includes(kk))?.[1] || last.replace(/([a-z])([A-Z])/g, '$1 $2');
}

// Clipboard: told "it changed", read it a moment later: the copying app (Chrome, Office…) is often still
// writing it, and reading too early finds it locked or empty. Try again a few times before giving up.
let clipTimer = null, lastClipSig = null, lastHint = null;
function clipSig() {
  const t = clipboard.readText();
  return clipboard.availableFormats().join(',') + '|' + t.length + '|' + t.slice(0, 256) + '|' + t.slice(-256);
}
function captureClipboard(via, attempt = 0, hint = null) {
  clearTimeout(clipTimer);
  if (hint) lastHint = hint;
  clipTimer = setTimeout(() => {
    let r;
    try { r = clips.captureDetailed(); } catch (e) { clipStats.error = `${e.message}${e.stack ? ' @ ' + String(e.stack).split('\n')[1].trim() : ''}`; r = { saved: false, reason: 'error' }; }
    // our own read found nothing / failed, but the helper read the text itself: use that
    const h = lastHint;
    if (!r.saved && ['locked', 'empty', 'error'].includes(r.reason) && h && Date.now() - h.at < 5000) {
      if (h.private) r = { saved: false, reason: 'private' };
      else if (h.text) { try { r = clips.addText(h.text); if (r.saved) via += ' (helper text)'; } catch (e) { clipStats.error = e.message; } }
    }
    if (!r.saved && (r.reason === 'locked' || r.reason === 'empty') && attempt < 3) return captureClipboard(via, attempt + 1);
    if (h && h.error) clipStats.helperError = h.error;
    if (r.saved) { clipStats.count++; clipStats.last = Date.now(); clipStats.via = via; clipStats.skip = null; }
    else if (r.reason !== 'same' && r.reason !== 'own') clipStats.skip = { reason: r.reason, at: Date.now() };
    try { lastClipSig = clipSig(); } catch (_) {}
    send('clip-status', clipStats);
  }, [120, 250, 600, 1200][attempt]);
}

// Apple Music: read and move its own controls (see AppleUia in atoll-helper.cs)
const am = { watching: false, found: false, pos: 0, min: 0, max: 0, at: 0, key: null, playing: false, lastCmd: null };
const amUsable = () => native.kind !== 'powershell' && native.diag.uia !== false;
function watchAppleMusic() {
  const want = !!(curMedia && isAppleMusic(curMedia.app) && amUsable());
  const key = want ? curMedia.key : null;
  if (want !== am.watching || key !== am.watchedKey) {
    am.watching = want; am.watchedKey = key;
    native.send({ cmd: 'amwatch', on: want, key: key || '' });
  }
}
const amSeconds = (v, dur) => sliderSeconds(v, am.min, am.max, dur);
const amValue = (sec, dur) => sliderValue(sec, am.min, am.max, dur);
function withAppleMusicPosition(n) {
  n = projectMedia(n, Date.now());
  if (!n || !n.active || !isAppleMusic(n.app) || !am.found || am.key !== n.key || Date.now() - am.at > 2000) return n;
  const seconds = amSeconds(am.pos, n.duration);
  if (seconds === null) return n;
  const out = { ...n, posSource: 'app', canSeek: true };
  const ahead = n.playing ? (Date.now() - am.at) / 1000 : 0;
  out.position = Math.min(out.duration || Infinity, seconds + ahead);
  return out;
}
// a short history of what players reported, for diagnostics (helps tune timing for odd players)
const mediaLog = [];
function logMedia(src, n) {
  if (!n || !n.active) return;
  mediaLog.push(`${new Date().toISOString().slice(11, 23)} ${src} ${n.playing ? '▶' : '❚❚'} ${Number(n.position || 0).toFixed(2)}/${Number(n.duration || 0).toFixed(0)}s ${String(n.app || '').slice(0, 24)}`);
  if (mediaLog.length > 24) mediaLog.shift();
}

// Album art fallback: when the player publishes no cover (Apple Music often doesn't), look the song up
// on Apple's public iTunes Search API. Only the title and artist are sent; results are cached.
let curMedia = null, artLookupT = null, currentCover = null;
function publishCover(cover) {
  if (curMedia?.key !== cover.key) return;
  currentCover = cover;
  send('art', cover);
}
const artGot = new Set(), artCache = new Map();
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
function scheduleArtLookup(key) {
  if (settings().artLookup === false || !key) return;
  clearTimeout(artLookupT);
  // the player may still publish its cover (Spotify does, a second or two late): give it a moment
  artLookupT = setTimeout(async () => {
    const m = curMedia;
    if (!m || m.key !== key || artGot.has(key)) return;
    const data = await lookupArt(m.title, m.artist);
    if (data && curMedia && curMedia.key === key && !artGot.has(key)) { artGot.add(key); publishCover({ key, data, source: 'itunes' }); }
  }, isAppleMusic(curMedia && curMedia.app) ? 1200 : 6000);
  if (artGot.size > 300) artGot.clear();
}
function compactArt(data) {
  if (!data) return null;
  try {
    const img = nativeImage.createFromDataURL(data);
    if (img.isEmpty()) return null;
    const size = img.getSize();
    const scale = Math.min(1, 192 / Math.max(size.width, size.height));
    const small = scale < 1 ? img.resize({ width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)) }) : img;
    return `data:image/jpeg;base64,${small.toJPEG(85).toString('base64')}`;
  } catch (_) { return null; }
}
async function lookupArt(title, artist) {
  const ck = `${title}|${artist}`.toLowerCase();
  if (artCache.has(ck)) return artCache.get(ck);
  let data = null;
  try {
    const q = new URLSearchParams({ term: `${artist || ''} ${title || ''}`.trim(), media: 'music', entity: 'song', limit: '8', country: (app.getLocaleCountryCode && app.getLocaleCountryCode()) || 'US' });
    const r = await withTimeout(net.fetch(`https://itunes.apple.com/search?${q}`), 6000);
    if (r.ok) {
      const url = pickItunesArt((await r.json()).results, title, artist);
      if (url) {
        const ir = await withTimeout(net.fetch(url), 6000);
        if (ir.ok) {
          const buf = Buffer.from(await ir.arrayBuffer());
          if (buf.length > 0 && buf.length < 3e6) data = `data:${(ir.headers.get('content-type') || 'image/jpeg').split(';')[0]};base64,${buf.toString('base64')}`;
        }
      }
    }
  } catch (_) { /* offline or blocked: no cover, no fuss */ }
  data = compactArt(data);
  artCache.set(ck, data);
  if (artCache.size > 6) artCache.delete(artCache.keys().next().value);
  return data;
}

function wireNative() {
  native.on('media', (m) => {
    const n = { ...normalizeMedia(m), positionAt: Date.now() };
    if (!n || !n.active || !curMedia || n.key !== curMedia.key) {
      currentCover = null;
      am.found = false; am.at = 0; am.key = null;
    }
    curMedia = n && n.active ? n : null;
    watchAppleMusic();
    logMedia('session', n);
    send('media', withAppleMusicPosition(n));
  });
  // Apple Music's own progress slider: its real position (twice a second while it plays)
  native.on('ampos', (m) => {
    // The helper tags the sample with its media-session key. Do not reuse the old
    // song's slider during a track transition or refresh the age of an unchanged value.
    if (!curMedia || !isAppleMusic(curMedia.app) || m.key !== curMedia.key) return;
    const pos = Number(m.pos), min = Number(m.min), max = Number(m.max);
    if (m.ok && sliderSeconds(pos, min, max, curMedia.duration) !== null) {
      if (!am.found || am.key !== m.key || am.pos !== pos || am.min !== min || am.max !== max || am.playing !== curMedia.playing) am.at = Date.now();
      Object.assign(am, { found: true, pos, min, max, key: m.key, playing: curMedia.playing });
    }
    if (curMedia && isAppleMusic(curMedia.app)) { const n = withAppleMusicPosition(curMedia); logMedia('slider', n); send('media', n); }
  });
  native.on('amdone', (m) => {
    am.lastCmd = { cmd: m.cmd, ok: !!m.ok, at: Date.now(), why: m.why || '' };
    if (m.ok) return;
    if (m.cmd === 'prev') native.send({ cmd: 'prev' }); // fall back to Windows' media controls
    if (m.cmd === 'seek') send('media-note', { kind: 'noseek', app: curMedia && curMedia.app });
  });
  native.on('art', (m) => {
    const data = compactArt(fixArtData(m.data)); // Apple Music labels its cover "image/jpeg, image/png": unreadable as-is
    if (data) { artGot.add(m.key); if (artGot.size > 128) artGot.delete(artGot.values().next().value); publishCover({ ...m, data }); return; }
    send('art', { ...m, data: null });
    scheduleArtLookup(m.key);
  });
  native.on('system', (m) => send('system', m));
  native.on('error', (m) => console.error('[native error]', m));
  native.on('net', (m) => {
    if (netStat.t) {
      const dt = (m.t - netStat.t) / 1000;
      if (dt > 0) { netStat.down = Math.max(0, (m.rx - netStat.rx) / dt); netStat.up = Math.max(0, (m.tx - netStat.tx) / dt); }
    }
    Object.assign(netStat, { rx: m.rx, tx: m.tx, t: m.t });
  });
  native.on('captured', (m) => { const cb = captureWaits.get(String(m.id)); if (cb) { captureWaits.delete(String(m.id)); cb(m); } });
  native.on('fullscreen', (m) => { fullscreen = !!m.on; applyFullscreen(); });
  native.on('ready', () => { syncHelper(); send('stats-resync'); });
  native.on('fg', (m) => setHidden('capture', CAPTURE_TOOLS.has(String(m.proc || '').toLowerCase())));
  native.on('clip', (m) => {
    if (settings().clipboardPaused) return;
    clipStats.helperSeen = true;
    const hint = m && ('text' in m || 'private' in m) ? { text: m.text || '', private: !!m.private, error: m.error || '', at: Date.now() } : null;
    captureClipboard('helper', 0, hint);
  });
  native.on('toasts-status', (m) => { toastStatus = { ok: !!m.ok, error: m.error || '' }; send('toasts-status', toastStatus); });
  native.on('toast', (m) => {
    const s = settings();
    if (s.notifications === false || s.windowsNotifications === false) return;
    send('notify', { title: m.title || appNameFromId(m.app), body: m.body || '', app: m.attribution || appNameFromId(m.app), icon: 'bell', source: 'windows', duration: 6500 });
  });
  if (!DEMO) native.start(path.join(app.getPath('userData'), 'helper'));
}

app.whenReady().then(() => {
  firstRun = !fs.existsSync(path.join(app.getPath('userData'), 'atoll.json'));
  store = createStore(app.getPath('userData'));
  if (firstRun) store.set('firstVersion', app.getVersion()); // a fresh install (people updating from before 0.10 have none)
  setLyricsCache(path.join(app.getPath('userData'), 'lyrics'));
  const secret = {
    encrypt: (v) => (safeStorage.isEncryptionAvailable() ? 'enc:' + safeStorage.encryptString(v).toString('base64') : (() => { throw new Error('no encryption'); })()),
    decrypt: (v) => safeStorage.decryptString(Buffer.from(String(v).replace(/^enc:/, ''), 'base64'))
  };
  lyricSources = createSources({ electron: require('electron'), store, secret });
  updater = createUpdater({ app, net, getSettings: settings, sendAll, notify: (n) => send('notify', n), pkg: require('./package.json'), userData: app.getPath('userData') });
  if (!DEMO) updater.start();
  todo = new TodolistSync(store, safeStorage, chainTransport(nodeTransport, electronTransport(net)));
  protocol.handle('atoll', (req) => {
    const u = new URL(req.url);
    const f = clips && u.host === 'clip' ? clips.fileFor(decodeURIComponent(u.pathname.slice(1))) : null;
    if (!f) return new Response('not found', { status: 404 });
    return net.fetch(require('url').pathToFileURL(f).toString());
  });
  clips = new ClipHistory(store, app.getPath('userData'), () => send('clips', clips.list()));
  shots = new Screenshots({
    hide: () => setHidden('shot', true),
    show: () => setHidden('shot', false),
    folder: () => settings().screenshotDir || defaultFolder(),
    onSaved: (r) => send('shot-saved', r),
    capture: (r) => new Promise((resolve) => {
      if (!native.alive) return resolve({ ok: false, error: 'helper not running' });
      const id = String(Date.now());
      const file = path.join(os.tmpdir(), `atoll-shot-${id}.png`);
      const t = setTimeout(() => { captureWaits.delete(id); resolve({ ok: false, error: 'timed out' }); }, 6000);
      captureWaits.set(id, (m) => { clearTimeout(t); resolve(m); });
      native.send({ cmd: 'capture', id, file, x: r.x, y: r.y, w: r.width, h: r.height });
    })
  });
  wireIpc();
  createWindow();
  buildTray();
  wireNative();
  // first run, or an update with something new to set up: the guide (once the notch has appeared)
  if (process.argv.includes('--settings')) openSettings(mac ? 'system' : undefined);
  else if (!process.env.ATOLL_TEST && !DEMO && (Number(store.get('setupSeen')) || 0) < SETUP_VERSION) setTimeout(openSetup, 1800);
  startHoverLoop();
  registerShortcuts();
  // Clipboard safety net: Atoll also looks at the clipboard itself, every second until the helper has
  // reported a copy, then every 2.5 s (it never switches off: a missed helper event can't lose copies).
  let pollTick = 0;
  setInterval(() => {
    pollTick++;
    if (settings().clipboardPaused || (mac && native.alive)) return;
    if (clipStats.helperSeen && native.alive && pollTick % 5 !== 0) return;
    try {
      const sig = clipSig();
      if (lastClipSig !== null && sig !== lastClipSig) captureClipboard('polling');
      lastClipSig = sig;
    } catch (e) { clipStats.error = e.message; }
  }, 500);
  // Do not periodically evict live code/textures from RAM. That produces page faults on
  // the next hover. The renderer releases hidden lists; manual trim stays in Settings.
  screen.on('display-metrics-changed', placeWindow);
  screen.on('display-added', placeWindow);
  screen.on('display-removed', placeWindow);

  const s = settings();
  startNotifyServer({ port: s.notifyPort, token: s.notifyToken, onNotify: (n) => send('notify', n) });
  refreshCalendar();
  setInterval(refreshCalendar, 10 * 60 * 1000);
});

if (process.env.ATOLL_TEST) global.__atollTest = { native, clipStats, trimNow, am, withAppleMusicPosition, get curMedia() { return curMedia; }, get idleSince() { return idleSince; }, set idleSince(v) { idleSince = v; } };
app.on('second-instance', (_e, argv) => (argv || []).includes('--settings') ? openSettings() : send('open-tab', 'now'));
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('before-quit', () => { native.stop(); if (store) store.flush(); });
app.on('window-all-closed', () => app.quit());
