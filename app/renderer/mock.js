// Demo data. Used when the page is opened in a normal browser (no Electron), or when Atoll
// is started with `npm run demo`. Lets you see every state of the island without Windows APIs.
(function () {
  const params = new URLSearchParams(location.search);
  const demo = !window.atoll || params.get('demo') === '1';
  if (!demo) { window.API = window.atoll; return; }

  const listeners = {};
  const on = (ch) => (cb) => { (listeners[ch] = listeners[ch] || []).push(cb); return () => {}; };
  const emit = (ch, p) => (listeners[ch] || []).forEach((cb) => cb(p));
  window.__atollEmit = emit; // tests: push events as if they came from Windows
  const real = window.atoll || {};

  const now = Date.now();
  const store = real.real ? null : {
    settings: { startWithWindows: false, mascot: false, minimal: false, layout: params.get('tabs') ? 'tabs' : 'pages', openOn: 'hover', hoverDelay: 0.3, gpu: true, smoothViz: true, huds: true, lyricsInNotch: true, fullscreenMode: 'peek', size: 'm', theme: params.get('theme') || 'dark', lite: true, waterEnabled: true, todolistReminders: true, notifications: true, windowsNotifications: true, translateLyrics: true, translateTo: 'en', showRomanization: true, homeLyrics: true, lyricSize: 28, position: { mode: 'top', frac: 0.5, top: 0, display: 'primary' }, sidePanel: { w: 380, h: 480 }, shortcuts: { area: 'Alt+Shift+S', full: 'Alt+Shift+A', clipboard: 'Alt+Shift+V', hide: 'Alt+Shift+H' }, clipboardPaused: false, pasteOnPick: true, screenshotDir: '', accent: '#30d5c8', focusMin: 25, breakMin: 5, waterGoalMl: 2000, bottleMl: 250, waterEveryMin: 60, icsUrl: 'https://calendar.google.com/calendar/ical/demo/basic.ics', meetingHeadsUpMin: 5, notifyPort: 47821, notifyToken: 'demo-token-1234' },
    todos: [
      { id: 1, text: 'Send the Q4 deck to Rama', due: now + 50 * 60e3, done: false },
      { id: 2, text: 'Review notch animation PR', due: null, done: false },
      { id: 3, text: 'Buy coffee beans', due: null, done: true }
    ],
    water: { date: new Date().toDateString(), ml: 750, lastAt: now - 40 * 60e3 },
    shelf: ['C:\\Users\\you\\Desktop\\atoll-logo.png', 'C:\\Users\\you\\Documents\\Q4 Report.pdf', 'C:\\Users\\you\\Downloads\\notes.txt'],
    focus: { sessionsToday: 2, date: new Date().toDateString() },
    todolist: { connected: true, url: 'https://whatsup-production.up.railway.app', user: 'gavin', name: 'Gavin', webUrl: 'https://whatsup-production.up.railway.app/todo/' },
    remoteNotified: {}
  };
  const d0 = new Date(), ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const tom = new Date(Date.now() + 86400e3);
  const remote = [
    { id: 'r1', text: 'Finish physics worksheet', done: false, due: ymd(d0), time: '20:00', list: 'School', priority: 2 },
    { id: 'r2', text: 'Call mum', done: false, due: ymd(tom), time: '19:30', list: '', priority: 0 },
    { id: 'r3', text: 'Read chapter 4 of Sapiens', done: false, due: null, time: null, list: 'Personal', priority: 0 },
    { id: 'r4', text: 'Submit English essay', done: true, doneAt: Date.now() - 3600e3, due: ymd(d0), time: null, list: 'School', priority: 1 }
  ];

  // Album art: a generated gradient so the preview needs no network.
  function makeArt() {
    const c = document.createElement('canvas'); c.width = c.height = 120;
    const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 120, 120);
    gr.addColorStop(0, '#ff8a5b'); gr.addColorStop(.55, '#d9416d'); gr.addColorStop(1, '#3a1c71');
    g.fillStyle = gr; g.fillRect(0, 0, 120, 120);
    g.fillStyle = 'rgba(255,255,255,.85)'; g.beginPath(); g.arc(84, 38, 16, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(0, 86, 120, 34);
    return c.toDataURL();
  }

  const JP = params.get('jp') === '1';
  const JLY = [['夜の海が静かに光る', 'yoru no umi ga shizuka ni hikaru', 'The night sea glows quietly'],
    ['君の声をずっと探している', 'kimi no koe wo zutto sagashite iru', "I've been searching for your voice all along"],
    ['小さな島で待っているよ', 'chiisana shima de matte iru yo', "I'm waiting on a little island"],
    ['星が帰り道を教えてくれる', 'hoshi ga kaerimichi wo oshiete kureru', 'The stars show me the way home'],
    ['波の音が胸の奥で響いて、明日の朝までずっと消えないまま', 'nami no oto ga mune no oku de hibiite, ashita no asa made zutto kienai mama', "The sound of the waves echoes deep in my chest and won't fade until tomorrow morning"],
    ['この夜が終わらないように', 'kono yoru ga owaranai you ni', 'So that this night never ends']];
  const LYRICS = JP ? JLY.map((x) => x[0]) : ['Low tide hums beneath the pier', 'City lights are drifting near', 'I keep your voice on repeat', 'Like waves that fold at my feet',
    'Oh, midnight lagoon', 'Carry me home soon', 'Every star a little island', 'Every heartbeat sings in silence',
    'Hold the night a little longer', 'Every echo growing stronger', 'Oh, midnight lagoon', 'Carry me home soon'];
  const media = { type: 'media', active: true, title: JP ? '小さな島' : 'Midnight Lagoon', artist: JP ? 'Atoll Sessions' : 'The Atoll Sessions', album: 'Islands', playing: true, position: 22, duration: 214, app: params.get('apple') ? 'AppleInc.AppleMusicWin_nzyj5cx40ttqa!App' : 'Spotify.exe', key: 'demo', canSeek: true };
  let mediaAt = Date.now();
  const pos = () => media.position + (media.playing ? (Date.now() - mediaAt) / 1000 : 0);
  let stopped = false;
  const pushMedia = () => { if (stopped) return; media.position = pos() % media.duration; mediaAt = Date.now(); emit('media', { ...media }); };

  let cpu = 18, net = 1.2e6;
  const fake = {
    real: !!real.real,
    getStore: async () => (real.real ? real.getStore() : JSON.parse(JSON.stringify(store))),
    setStore: async (k, v) => (real.real ? real.setStore(k, v) : (store[k] = v, true)),
    setHitRect: (r) => real.setHitRect && real.setHitRect(r),
    media: (cmd, p) => {
      if (cmd === 'toggle') { media.position = pos(); mediaAt = Date.now(); media.playing = !media.playing; }
      if (cmd === 'seek') { media.position = p; mediaAt = Date.now(); }
      if (cmd === 'next' || cmd === 'prev') { media.position = 0; mediaAt = Date.now(); }
      pushMedia();
    },
    getLyrics: async () => ({ synced: LYRICS.map((text, i) => ({ t: 8 + i * 6.5, text })), plain: null, source: 'Demo' }),
    getStats: async () => {
      cpu = Math.max(3, Math.min(96, cpu + (Math.random() - .5) * 14));
      net = Math.max(2e4, Math.min(9e6, net * (0.7 + Math.random() * 0.6)));
      return { cpu: Math.round(cpu), memUsed: 9.4e9 + Math.random() * 2e8, memTotal: 16e9, down: net, up: net / 9, uptime: 3 * 3600 + 1240, cores: 8, atollMem: 118e6, atollReserved: 300e6, atollParts: { Graphics: 21e6, 'Notch UI': 41e6, Main: 40e6, 'Windows helper': 16e6 }, atollReservedParts: { Graphics: 173e6, 'Notch UI': 70e6, Main: 41e6, 'Windows helper': 16e6 }, lastTrim: Date.now() - 42e3, gpuOn: true, atollProcs: 4, helperKind: 'native' };
    },
    getCalendar: async () => {
      const t = Date.now();
      const at = (min) => Math.round((t + min * 60e3) / 60e3) * 60e3;
      const tom = new Date(); tom.setDate(tom.getDate() + 1); tom.setHours(10, 0, 0, 0);
      return {
        fetchedAt: t, error: null, events: [
          { id: 'a', title: 'Design standup', start: at(12), end: at(27), location: 'Google Meet', link: 'https://meet.google.com/abc-defg-hij' },
          { id: 'b', title: 'Lunch with Dewi', start: at(95), end: at(155), location: 'Kopi Kenangan, Senopati', link: null },
          { id: 'c', title: '1:1 with Rama', start: at(240), end: at(270), location: 'Zoom', link: 'https://zoom.us/j/123456789' },
          { id: 'd', title: 'Sprint planning', start: tom.getTime(), end: tom.getTime() + 3600e3, location: 'Microsoft Teams', link: 'https://teams.microsoft.com/l/meetup-join/xyz' }
        ]
      };
    },
    refreshCalendar: async () => fake.getCalendar(),
    statsActive: () => {}, restart: () => location.reload(),
    translate: async (key, lines) => ({ ok: true, data: JP
      ? { lang: 'ja', same: false, items: lines.map((l) => { const x = JLY.find((j) => j[0] === l); return x ? { tr: x[2], rom: x[1] } : { tr: '', rom: '' }; }) }
      : { lang: 'en', same: true, items: lines.map(() => ({ tr: '', rom: '' })) } }),
    displays: async () => [{ id: 'primary', primary: true, width: 1920, height: 1080, name: 'Screen 1', label: 'Screen 1 (main) · 1920×1080' }, { id: '2', primary: false, width: 2560, height: 1440, name: 'Screen 2', label: 'Screen 2 · 2560×1440' }],
    moveToDisplay: () => {},
    dragNotch: () => {}, askPlace: () => {}, moveMode: () => {}, resetPosition: () => emit('place', { offset: 0, top: 0, floating: false }), shot: (m) => window.demo.shot(),
    shortcutsStatus: async () => ({ area: 'ok', full: 'ok', clipboard: 'ok', hide: 'taken' }),
    toastsStatus: async () => ({ ok: true, error: '' }),
    updater: {
      state: async () => ({ state: 'ready', current: '0.11.0', version: '0.11.1', notes: 'Fixes and polish.', progress: 1, canInstall: true }),
      check: async () => ({ state: 'uptodate', current: '0.11.0' }), install: async () => ({ ok: true }), openPage: async () => {}
    },
    lyricSources: {
      status: async () => JSON.parse(JSON.stringify(srcs)),
      connect: async (k) => { await new Promise((r) => setTimeout(r, 700)); srcs[k] = { connected: true, error: '', lastOk: 0 }; emit('lyrics-sources', srcs); return JSON.parse(JSON.stringify(srcs)); },
      disconnect: async (k) => { srcs[k] = { connected: false, error: '', lastOk: 0 }; emit('lyrics-sources', srcs); return JSON.parse(JSON.stringify(srcs)); }
    },
    setup: {
      open: () => window.open('setup.html?demo=1', 'atoll-setup', 'width=640,height=640'),
      done: (v) => { store.setupSeen = v; },
      info: async () => ({ seen: Number(params.get('seen') || 0), version: 1, isUpdate: params.has('seen'), toasts: { ok: true, error: '' } }),
      openWindowsSettings: (p) => console.log('ms-settings:' + p),
      testClipboard: async (text) => { await new Promise((r) => setTimeout(r, 600)); return { ok: params.get('clipfail') ? false : true, reason: params.get('clipfail') || '', text }; }
    },
    diagnostics: async () => ({ lyrics: { spotify: srcs.spotify, apple: srcs.apple, recent: [{ at: Date.now() - 50e3, title: 'Midnight Lagoon', artist: 'The Atoll Sessions', result: 'synced · Spotify', detail: '', ms: 420 }] }, appleMusic: { usable: true, watching: true, sliderFound: true, lastCmd: { cmd: 'seek', ok: true } }, mediaLog: ['10:41:02.120 slider ▶ 63.40/213s AppleInc.AppleMusicWin_nzyj'], version: '0.10.0', electron: '45.2.1', windows: '10.0.26100', lite: true, helper: { kind: 'native', exe: 'C:\\Users\\you\\AppData\\Roaming\\Atoll\\helper\\atoll-helper-full-1a2b3c4d5e.exe', build: {}, parts: null, messages: [], stderr: [], mem: { main: 21e6 } }, clipboard: { count: 3, last: Date.now() - 60e3, via: 'helper', helperSeen: true, error: '' }, toasts: { ok: true, error: '' }, screenshot: '', shortcuts: { area: 'ok', full: 'ok', clipboard: 'ok', hide: 'ok' } }),
    clip: {
      list: async () => clips,
      status: async () => ({ count: 3, last: Date.now() - 60e3, via: 'helper', helperSeen: true, skip: params.get('skip') ? { reason: params.get('skip'), at: Date.now() - 5000 } : null }),
      use: async (id) => { const i = clips.findIndex((c) => c.id === id); if (i > 0) clips.unshift(clips.splice(i, 1)[0]); emit('clips', clips); return true; },
      pin: (id, on) => { clips.forEach((c) => { if (c.id === id) c.pinned = on; }); emit('clips', clips); },
      remove: (id) => { clips = clips.filter((c) => c.id !== id); emit('clips', clips); },
      clear: () => { clips = clips.filter((c) => c.pinned); emit('clips', clips); },
      drag: () => {}
    },
    todo: real.todo || {
      info: async () => store.todolist,
      login: async (url, user, pass) => pass === 'demo' ? { ok: true, data: (store.todolist = { connected: true, url, user, name: user, webUrl: url + '/todo/' }) } : { ok: false, error: 'Wrong username or password' },
      logout: async () => (store.todolist = { connected: false, url: store.todolist.url, user: store.todolist.user, name: '' }),
      list: async () => ({ ok: true, data: JSON.parse(JSON.stringify(remote)) }),
      add: async (text, due, time) => { const m = /(.*?)\s+tomorrow\s+(\d+)pm$/i.exec(text); const t = { id: 'r' + Date.now(), text: m ? m[1] : text, done: false, due: m ? ymd(tom) : due, time: m ? `${+m[2] + 12}:00` : time, list: '' }; remote.unshift(t); return { ok: true, data: t }; },
      update: async (id, patch) => { Object.assign(remote.find((t) => t.id === id) || {}, patch, patch.done ? { doneAt: Date.now() } : {}); return { ok: true }; },
      remove: async (id) => ({ ok: true })
    },
    fileIcon: async (p) => (real.fileIcon ? real.fileIcon(p) : null),
    pathForFile: (f) => (real.pathForFile ? real.pathForFile(f) : 'C:\\Users\\you\\Desktop\\' + f.name),
    openPath: (p) => real.openPath ? real.openPath(p) : console.log('open', p),
    showInFolder: (p) => real.showInFolder && real.showInFolder(p),
    openUrl: (u) => real.openUrl ? real.openUrl(u) : window.open(u, '_blank'),
    startDrag: (p) => real.startDrag && real.startDrag(p),
    notifyInfo: async () => (real.notifyInfo ? real.notifyInfo() : { port: 47821, token: 'demo-token-1234', curl: 'curl -X POST http://127.0.0.1:47821/notify -H "X-Atoll-Token: demo-token-1234" -d "{\\"title\\":\\"Build finished\\"}"' }),
    copy: (t) => real.copy ? real.copy(t) : navigator.clipboard && navigator.clipboard.writeText(t),
    focusWindow: () => real.focusWindow && real.focusWindow(),
    quit: () => real.quit && real.quit(),
    openSettings: (sec) => window.open('settings.html?demo=1' + (sec ? '#' + sec : ''), 'atoll-settings', 'width=760,height=560'),
    notchMenu: () => emit('move-mode', true),
    openClipboard: () => emit('open-tab', 'clipboard'),
    setVolume: (v) => { vol = v; },
    repaint: () => {},
    trimNow: async () => true,
    holdPointer: () => {},
    openPlayer: (app) => console.log('open player', app),
    notifyTest: () => emit('notify', { title: 'Hello from Atoll', body: 'Notifications are working.', app: 'Atoll', icon: 'bell' }),
    onHover: real.onHover || on('hover'),
    onMedia: on('media'), onMediaNote: on('media-note'), onArt: on('art'), onSystem: on('system'),
    onNotify: real.onNotify || on('notify'),
    onCalendar: on('calendar'),
    onOpenTab: real.onOpenTab || on('open-tab'),
    onStore: real.onStore || on('store'),
    onSnapGuide: real.onSnapGuide || on('snap-guide'),
    onFullscreen: real.onFullscreen || on('fullscreen'),
    onPlace: real.onPlace || on('place'), onMoveMode: real.onMoveMode || on('move-mode'), onClips: on('clips'), onClipStatus: on('clip-status'), onShotSaved: real.onShotSaved || on('shot-saved'),
    onShortcuts: on('shortcuts'), onToastsStatus: on('toasts-status'), onSettingsSection: on('settings-section'), onLyricsSources: on('lyrics-sources'), onUpdater: on('updater')
  };
  const srcs = { spotify: { connected: !!params.get('spotify'), error: '', lastOk: params.get('spotify') ? Date.now() - 120e3 : 0 }, apple: { connected: false, error: '', lastOk: 0 } };
  const ago = (m) => Date.now() - m * 60e3;
  let clips = [
    { id: 'c1', type: 'text', text: 'https://whatsup-production.up.railway.app/todo/', at: ago(2), pinned: false },
    { id: 'c2', type: 'text', text: 'Meeting notes: ship Atoll v0.3 on Monday, ask Rama about the lyrics translation and the clipboard shortcut.', at: ago(9), pinned: false },
    { id: 'c3', type: 'image', w: 1280, h: 720, thumb: '', at: ago(25), pinned: false },
    { id: 'c4', type: 'text', text: 'Jl. Senopati No. 12, Kebayoran Baru, Jakarta Selatan', at: ago(60 * 26), pinned: true },
    { id: 'c5', type: 'text', text: 'npm install && npm start', at: ago(60 * 3), pinned: false }
  ];
  if (!real.real) { // emulate the main process zoom for S/M/L in a plain browser
    const set0 = fake.setStore;
    fake.setStore = async (k, v) => { if (k === 'settings') document.documentElement.style.zoom = { s: 0.85, m: 1, l: 1.2 }[v.size] || 1; return set0(k, v); };
  }
  window.API = fake;

  window.addEventListener('DOMContentLoaded', () => {
    const isl = document.getElementById('island');
    if (!isl) return; // the settings window only needs the fake API
    if (!real.onHover) { // plain browser: emulate the main-process hover detection
      isl.addEventListener('mouseenter', () => emit('hover', true));
      isl.addEventListener('mouseleave', () => emit('hover', false));
    }
    clips.forEach((c) => { if (c.type === 'image') c.thumb = makeArt(); });
    setTimeout(() => { pushMedia(); emit('art', { key: 'demo', data: params.get('noart') ? null : makeArt() }); emit('system', { volume: 40, muted: false, caps: false, lang: 'EN', device: 'Speakers' }); }, 300);
    setInterval(pushMedia, 1000);
  });

  // Handy triggers for trying states (also used by the screenshot tests).
  let vol = 40;
  window.demo = {
    emit,
    volume: (v) => emit('system', { volume: (vol = v ?? (vol + 15) % 100), muted: false, caps: false, lang: 'EN', device: 'Speakers' }),
    caps: (on = true) => emit('system', { volume: vol, muted: false, caps: on, lang: 'EN', device: 'Speakers' }),
    lang: (l = 'ID') => emit('system', { volume: vol, muted: false, caps: false, lang: l, device: 'Speakers' }),
    headphones: () => emit('system', { volume: vol, muted: false, caps: false, lang: 'EN', device: 'Headphones (WH-1000XM5)' }),
    notify: (n) => emit('notify', n || { title: 'Build finished', body: 'atoll: 42 tests passed in 3.1s', app: 'GitHub Actions', icon: '✅', duration: 6000 }),
    pause: () => fake.media('toggle'),
    fullscreen: (on = true) => emit('fullscreen', { on, mode: 'peek' }),
    place: (offset, top = 0) => emit('place', { offset, top, floating: top > 0 }),
    move: (on = true) => emit('move-mode', on),
    side: (side = 'right', center = 330) => emit('place', { mode: 'side', side, center }),
    shot: () => emit('shot-saved', { file: 'C:\\Users\\you\\Pictures\\Screenshots\\Atoll\\Atoll 2026-10-31 21.40.12.png', width: 1184, height: 642, thumb: makeArt() }),
    toast: () => emit('notify', { title: 'Dewi', body: 'Udah sampai? Aku di depan pintu masuk ya 😄', app: 'WhatsApp', icon: 'bell', source: 'windows' }),
    stop: () => { stopped = true; emit('media', { type: 'media', active: false }); },
    play: () => { stopped = false; pushMedia(); }
  };
})();
