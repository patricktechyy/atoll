// Atoll Settings window. Every change is saved right away; the notch picks it up from the store broadcast.
(async function () {
  const api = window.API;
  const mac = window.atoll?.platform === 'darwin';
  if (mac) document.body.classList.add('mac'); // room for the window buttons (hidden title bar)
  const I = window.ICONS;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const bytes = (n) => { const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; } return `${n.toFixed(n < 10 && i ? 1 : 0)} ${u[i]}`; };
  const rate = (n) => bytes(n) + '/s';
  const hhmm = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const S = { store: await api.getStore(), section: 'general', shortcuts: {}, toasts: {}, stats: null, cpuHist: [], netHist: [], statsT: 0, diag: null, version: '' };
  const st = () => S.store.settings;
  const save = () => api.setStore('settings', st());

  const SECTIONS = [
    ['general', 'sliders', 'General'],
    ['appearance', 'palette', 'Appearance'],
    ['music', 'music', 'Music & Lyrics'],
    ['notifications', 'bell', 'Notifications'],
    ['indicators', 'volume', 'System indicators'],
    ['shortcuts', 'keyboard', 'Shortcuts & Screenshots'],
    ['clipboard', 'clipboard', 'Clipboard'],
    ['tasks', 'todo', 'Tasks'],
    ['calendar', 'calendar', 'Calendar'],
    ['focus', 'timer', 'Focus & Water'],
    ['system', 'cpu', 'System'],
    ['about', 'info', 'About']
  ];
  const DEFAULT_ON = ['autoUpdate', 'snapGuides', 'hud_volume', 'hud_caps', 'hud_lang', 'hud_device', 'hud_charge', 'hud_net', 'artLookup', 'gpu', 'waterEnabled', 'waterReminders', 'todolistReminders', 'lite', 'notifications', 'windowsNotifications', 'showRomanization', 'pasteOnPick', 'smoothViz', 'huds', 'lyricsInNotch', 'translateLyrics'];
  const isOn = (k) => st()[k] ?? DEFAULT_ON.includes(k);

  /* ---------- building blocks ---------- */
  const row = (label, sub, ctl, { icon, cls = '' } = {}) => `<div class="row ${cls}">${icon ? `<span class="ri">${I[icon] || ''}</span>` : ''}<div class="lbl"><span>${label}</span>${sub ? `<small>${sub}</small>` : ''}</div>${ctl != null ? `<div class="ctl">${ctl}</div>` : ''}</div>`;
  const tall = (label, sub, body, opts = {}) => `<div class="row tall ${opts.cls || ''}"><div class="lbl"><span>${label}</span>${sub ? `<small>${sub}</small>` : ''}</div>${body}</div>`;
  const toggle = (k) => `<span class="switch-txt">${isOn(k) ? 'On' : 'Off'}</span><button class="switch ${isOn(k) ? 'on' : ''}" data-tog="${k}" role="switch" aria-checked="${isOn(k)}"></button>`;
  const seg = (k, opts, cur = st()[k]) => `<div class="seg">${opts.map(([v, t]) => `<button data-seg="${k}" data-v="${v}" class="${String(cur) === String(v) ? 'on' : ''}">${t}</button>`).join('')}</div>`;
  const num = (k, min, max, step = 1, unit = '') => `<input type="number" data-num="${k}" value="${st()[k]}" min="${min}" max="${max}" step="${step}">${unit ? `<span class="range-val" style="min-width:0">${unit}</span>` : ''}`;
  const group = (...rows) => `<div class="group">${rows.filter(Boolean).join('')}</div>`;
  const h2 = (t) => `<h2>${t}</h2>`;
  const ACCENTS = ['#30d5c8', '#0a84ff', '#bf5af2', '#ff375f', '#ff9f0a', '#30d158', '#f2f2f2'];
  const LANGS = [['en', 'English'], ['id', 'Indonesian'], ['ja', 'Japanese'], ['ko', 'Korean'], ['zh-CN', 'Chinese'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['pt', 'Portuguese'], ['th', 'Thai'], ['vi', 'Vietnamese'], ['ms', 'Malay']];

  function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('on'), 1600); }
  function applyAccent() {
    const c = st().accent || '#30d5c8';
    document.documentElement.style.setProperty('--accent', c);
    const n = parseInt(c.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    document.documentElement.style.setProperty('--accent-fg', 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#111' : '#fff');
  }

  /* ---------- sections ---------- */
  const view = {};

  view.general = async () => {
    const d = Number.isFinite(+st().hoverDelay) ? Math.max(0, Math.min(0.6, +st().hoverDelay)) : 0.3;
    const click = (st().openOn || 'hover') === 'click';
    return [
    group(
      row(mac ? 'Open at login' : 'Start with Windows', 'Atoll waits at the top of your screen when you sign in', toggle('startWithWindows'), { icon: 'bolt' }),
      row('Open the notch', 'Hover: rest the pointer on it. Click: only when you click. Swiping down on it works either way.', seg('openOn', [['hover', 'On hover'], ['click', 'On click']], st().openOn || 'hover'), { icon: 'home' }),
      row('Hover delay', click ? 'Only used when the notch opens on hover' : 'How long the pointer rests on the notch before it opens. It swells a little while it waits, so you can tell.',
        `<input type="range" id="hover-delay" min="0" max="0.6" step="0.05" value="${d}" style="--p:${(100 * d / 0.6).toFixed(1)}%" ${click ? 'disabled' : ''}><span class="range-val" id="hover-delay-v">${d === 0 ? 'Instant' : d.toFixed(2) + ' s'}</span>`, { icon: 'timer', cls: click ? 'dim' : '' }),
      row('System HUDs', 'Volume, Caps Lock, keyboard language, audio device, charging and Wi-Fi slide out of the notch', toggle('huds'), { icon: 'volume' })
    ),
    h2('When an app is full screen'),
    group(
      row('Videos, games, Chrome with F11', 'Hidden until hovered: move the pointer to the top edge to bring the notch back', seg('fullscreenMode', [['peek', 'Hidden until hovered'], ['show', 'Always show'], ['hide', 'Off']]), { icon: 'video' })
    ),
    h2('Performance'),
    group(
      row('Use the graphics card', 'Smooth animations without leftover shadows. Turn off only if your graphics driver misbehaves. Restart to apply.', toggle('gpu'), { icon: 'cpu' }),
      row('Lite mode', mac ? 'Reduce visual effects.' : 'Less visual processing and a smaller JavaScript memory budget. Restart to apply process settings.', `<button class="btn sm" id="restart">Restart now</button>${toggle('lite')}`, { icon: 'flame' })
    )
  ].join('');
  };

  view.appearance = async () => {
    const s = st();
    const pos = s.position || { mode: 'top', frac: 0.5, top: 0, display: 'primary' };
    const displays = api.displays ? await api.displays() : [];
    const d = displays.find((x) => String(x.id) === String(pos.display)) || displays[0] || { width: 1920, height: 1080, label: 'Main screen' };
    const side = pos.mode === 'side';
    const styleNow = side ? pos.side : 'top';
    const hv = side ? Math.round(pos.inset || 0) : Math.round((pos.frac ?? 0.5) * 100);
    const vv = side ? Math.round(pos.cy || d.height / 2) : Math.round(pos.top || 0);
    const hMax = side ? 300 : 100, vMax = side ? d.height : Math.max(100, d.height - 80);
    return [
      group(
        tall('Layout', 'How the open notch is organised. Both have the same features, gestures and animations.',
          `<div class="picks">${[['pages', 'Pages', 'Alcove style: one page at a time, dots and ‹ › to move between them'], ['tabs', 'Tabs', 'Classic: clock and a tab bar on top, Home shows the player, lyrics and cards']].map(([v, t, d]) => `<button class="pick lay ${(s.layout || 'pages') === v ? 'on' : ''}" data-layout-style="${v}"><span class="screen">${v === 'tabs' ? '<i class="t" style="height:44%;width:62%;border-radius:0 0 7px 7px"></i><i class="tbar"></i>' : '<i class="t" style="height:34%;width:46%;border-radius:0 0 9px 9px"></i><i class="pdots"></i>'}</span><b>${t}</b><small>${d}</small></button>`).join('')}</div>`)
      ),
      h2('Look'),
      group(
        row('Notch colour', 'Black blends into the camera area; white stands out on dark wallpapers', seg('theme', [['dark', 'Black'], ['light', 'White']]), { icon: 'palette' }),
        row('Size', 'Scales the whole island, including the open panel', seg('size', [['s', 'Small'], ['m', 'Medium'], ['l', 'Large']]), { icon: 'sliders' }),
        row('Accent colour', 'Timers, highlights and the selected page dot', `<div class="swatches">${ACCENTS.map((c) => `<button data-accent="${c}" class="${s.accent === c ? 'on' : ''}" style="background:${c};color:${c}" title="${c}"></button>`).join('')}</div>`, { icon: 'star' })
      ),
      h2('Idle notch'),
      group(
        row('Mascot eyes', 'A pair of little eyes that blink when nothing is happening', toggle('mascot'), { icon: 'bot' }),
        row('Snap guides while dragging', 'Alt-drag aligns to screen quarters and centre within 16 pixels; shows alignment guides.', toggle('snapGuides'), { icon: 'sliders' }),
        row('Minimal notch', 'Shrink to a thin line when idle', toggle('minimal'), { icon: 'home' }),
        row('Smooth visualizer', 'Off: a lighter, stepped animation', toggle('smoothViz'), { icon: 'stats' })
      ),
      h2('Style'),
      group(
        tall('Where the notch lives', 'Ctrl+Alt+P cycles Top → Right → Left. Each position is remembered separately, including its pixel offsets.',
          `<div class="picks">${[['top', 'Top notch'], ['left', 'Left edge'], ['right', 'Right edge']].map(([v, t]) => `<button class="pick ${styleNow === v ? 'on' : ''}" data-layout="${v}"><span class="screen"><i class="${v === 'top' ? 't' : v === 'left' ? 'l' : 'r'}"></i></span>${t}</button>`).join('')}</div>`)
      ),
      h2('Position'),
      group(
        displays.length > 1
          ? row('Show on screen', 'Which monitor the notch lives on. Each layout keeps its own offsets on it.', `<div class="seg">${displays.map((x) => `<button data-display="${esc(x.id)}" class="${String(x.id) === String(d.id) ? 'on' : ''}" title="${esc(x.label)}">${esc(x.name)}</button>`).join('')}</div>`, { icon: 'pin' })
          : row('Show on screen', 'Only one screen is connected. Plug in another monitor to choose where the notch lives.', '<span class="chip">1 screen</span>', { icon: 'pin' }),
        row('Move the notch', `${side ? `On the ${pos.side} edge` : pos.top > 0 ? 'Floating on the screen' : 'On the top edge'}${displays.length > 1 ? ' · ' + esc(d.label) : ''}. You can also right-click it, or hold <span class="kbd">Alt</span> and drag.`,
          '<button class="btn" id="pos-offset-reset">Reset offsets</button><button class="btn" id="pos-reset">Back to top centre</button><button class="btn accent" id="pos-move">Move…</button>', { icon: 'pin' }),
        row(side ? 'Away from the edge' : 'Left ↔ right', '', `<button class="btn sm" data-nudge="-2,0">‹</button><input type="range" id="pos-h" min="0" max="${hMax}" value="${hv}" style="--p:${100 * hv / hMax}%"><button class="btn sm" data-nudge="2,0">›</button><span class="range-val" id="pos-h-v">${side ? hv + ' px' : hv + '%'}</span>`),
        row('Up ↕ down', '', `<button class="btn sm" data-nudge="0,-2">‹</button><input type="range" id="pos-v" min="0" max="${vMax}" value="${vv}" style="--p:${100 * vv / vMax}%"><button class="btn sm" data-nudge="0,2">›</button><span class="range-val" id="pos-v-v">${vv} px</span>`)
      ),
      `<p class="hint">Tip: while moving, the arrow keys nudge the notch by 2 px (hold Shift for 20 px). Press Enter when it's right.</p>`
    ].join('');
  };

  const offTxt = (v) => (Math.abs(v) < 0.05 ? 'In sync' : `${v > 0 ? 'Earlier' : 'Later'} ${Math.abs(v).toFixed(1)} s`);
  // Where lyrics come from: your own Spotify / Apple Music, the only lyrics sources (shared with the setup guide)
  const ago = (t) => { const s = Math.round((Date.now() - t) / 1000); return s < 60 ? 'just now' : s < 3600 ? Math.round(s / 60) + ' min ago' : Math.round(s / 3600) + ' h ago'; };
  function sourceRows(info) {
    const src = (k, name, icon, about) => {
      const x = (info && info[k]) || {};
      const busy = S.connecting === k;
      const sub = x.connected
        ? (x.error ? `<span class="err">${esc(x.error)}</span>` : `<span class="ok">Connected ✓</span>${x.lastOk ? ` · last lyrics ${ago(x.lastOk)}` : ''}`)
        : about;
      const ctl = x.connected
        ? `<button class="btn danger" data-src-off="${k}">Disconnect</button>${x.error ? `<button class="btn" data-src-on="${k}">Sign in again</button>` : ''}`
        : `<button class="btn accent" data-src-on="${k}" ${busy ? 'disabled' : ''}>${busy ? 'Waiting for sign-in…' : 'Connect…'}</button>`;
      return row(name, sub, ctl, { icon });
    };
    return [
      src('spotify', 'Spotify', 'music', 'Used for songs playing in the Spotify app. Needs a Spotify account (free is enough).'),
      src('apple', 'Apple Music', 'music', 'Used for songs playing in the Music app. Needs an Apple Music subscription.')
    ];
  }
  view.music = async () => {
    const s = st();
    const info = api.lyricSources ? await api.lyricSources.status() : null;
    return [
      h2('Where lyrics come from'),
      group(...sourceRows(info)),
      `<p class="hint">You sign in on Spotify’s or Apple’s own page, in a separate browser profile inside Atoll: Atoll never sees your password, and only the song’s title and artist are looked up. These are the same connections their web players use, so they may change; if one stops working, lyrics stop until it is fixed: Atoll has no other lyrics source. Lyrics always come from the app that is playing, so connect the one you listen in. Songs you’ve played are kept on this computer, so replaying them needs no connection.</p>`,
      h2('In the notch'),
      group(
        row('Lyrics under the notch', 'While a song plays, the current line grows out under the album art and visualizer', toggle('lyricsInNotch'), { icon: 'lyrics' }),
        row('Find missing album art', 'When a player shows no cover (Apple Music often doesn’t), look the song up on Apple’s iTunes catalogue. Only the title and artist are sent.', toggle('artLookup'), { icon: 'music' }),
                row('Swipe to change songs', 'Swipe sideways on the closed notch with two fingers (or Shift + scroll). Always on.', '<span class="chip good">On</span>', { icon: 'next' })
      ),
      h2('Translation'),
      group(
        row('Translate lyrics', 'Google Translate, shown under each line', toggle('translateLyrics'), { icon: 'translate' }),
        row('Translate to', '', `<select id="tr-to">${LANGS.map(([v, t]) => `<option value="${v}" ${(s.translateTo || 'en') === v ? 'selected' : ''}>${t}</option>`).join('')}</select>`),
        tall('Languages I understand', 'Skip translation when the detected song language is selected. You can choose several.',
          `<div class="group">${LANGS.map(([v, label]) => `<label style="display:inline-flex;align-items:center;gap:8px;padding:8px 12px"><input type="checkbox" data-understood="${v}" ${(s.understoodLanguages || []).includes(v) ? 'checked' : ''}>${label}</label>`).join('')}</div>`),
        row('Romanization', 'Japanese romaji, Korean romanization and Mandarin Pinyin under each line. Ctrl+Alt+F8 toggles this (configurable in Shortcuts). Requires the translation service.', toggle('showRomanization'))
      ),
      h2('Timing'),
      group(
        row('Lyrics timing', 'Adjust when lines change for your player. Earlier advances the lyrics.', `<input type="range" id="lyr-off" min="-10" max="10" step="0.1" value="${Number(s.lyricOffset) || 0}" style="--p:${(100 * ((Number(s.lyricOffset) || 0) + 10) / 20).toFixed(1)}%"><span class="range-val" id="lyr-off-v">${offTxt(Number(s.lyricOffset) || 0)}</span>`, { icon: 'timer' })
      ),
      h2('Lyrics page'),
      group(
        row('Text size', 'Up to 40 px. You can also use A− / A+ on the lyrics page.', `<input type="range" id="ls" min="14" max="40" step="2" value="${s.lyricSize || 26}" style="--p:${100 * ((s.lyricSize || 26) - 14) / 26}%"><span class="range-val" id="ls-v">${s.lyricSize || 26} px</span>`, { icon: 'lyrics' })
      ),
      `<p class="hint">${mac ? 'Works with Music and Spotify. Allow Automation when macOS asks.' : 'Works with Spotify, Apple Music and players in the Windows media flyout.'} Album art opens the app that's playing; click a lyric line to jump to it.</p>`
    ].join('');
  };

  view.indicators = async () => group(
    row('System indicators', 'Master switch for system pop-ups', toggle('huds')),
    ...[['volume','Volume and mute'],['caps','Caps Lock'],['lang','Keyboard language'],['device','Audio device'],['charge','Charging and battery power'],['net','Online / offline']].map(([key,label]) => row(label, 'Show this system indicator in the notch', toggle('hud_' + key)))
  );
  view.notifications = async () => {
    const s = st();
    if (api.toastsStatus) S.toasts = await api.toastsStatus();
    const info = await api.notifyInfo();
    const on = s.notifications !== false;
    const t = S.toasts || {};
    const winNote = mac ? (t.ok ? 'Mirroring visible banners' : 'Requires Accessibility permission for Atoll') : t.ok === true ? '<span class="ok">Reading Windows notifications ✓</span>' : t.ok === false ? `<span class="err">${esc(t.error || 'Not available on this PC')}</span>` : 'WhatsApp, Discord, Chrome, Teams… appear in the notch';
    const P = [['auto', 'Auto'], ['notch', 'From the notch'], ['top-left', 'Top left'], ['top-center', 'Top centre'], ['top-right', 'Top right'], ['bottom-left', 'Bottom left'], ['bottom-center', 'Bottom centre'], ['bottom-right', 'Bottom right']];
    const where = s.notifPos || 'auto';
    const dot = (v) => {
      if (v === 'auto' || v === 'notch') return '<i class="t" style="height:16%;width:44%"></i>';
      const [y, x] = v.split('-');
      return `<i class="n" style="${y === 'top' ? 'top:7%' : 'bottom:7%'};${x === 'left' ? 'left:5%' : x === 'right' ? 'right:5%' : 'left:35%'}"></i>`;
    };
    return [
      group(
        row('Show notifications', 'Reminders, meetings, timers and anything sent to Atoll', toggle('notifications'), { icon: 'bell' }),
        on && row(mac ? 'App notification banners' : 'Windows app notifications', winNote, toggle('windowsNotifications'), { icon: 'bell' })
      ),
      on ? h2('Where they pop up') : '',
      on ? group(tall('Position', 'Auto drops them out of the notch at the top, and uses the top centre in side mode',
        `<div class="pos-grid">${P.map(([v, t]) => `<button class="pick ${where === v ? 'on' : ''}" data-npos="${v}"><span class="screen">${dot(v)}</span>${t}</button>`).join('')}</div>`),
        row('Try it', '', '<button class="btn" id="test-notif">Send a test notification</button>')) : '',
      h2('Notifications API'),
      group(tall('Send notifications from scripts, CI, Home Assistant…', `POST to <span class="mono">http://127.0.0.1:${info.port}/notify</span> with the header <span class="mono">X-Atoll-Token</span>`,
        `<code>${esc(info.curl)}</code><div class="ctl"><button class="btn" id="copy-curl">Copy example</button><button class="btn" id="copy-token">Copy token</button></div>`))
    ].join('');
  };

  view.shortcuts = async () => {
    const s = st(), sc = { romanization: 'Control+Alt+F8', ...(s.shortcuts || {}) };
    if (api.shortcutsStatus) S.shortcuts = await api.shortcutsStatus();
    const chip = (k) => {
      const v = S.shortcuts[k];
      return v === 'ok' ? '<span class="chip good">Active</span>' : v === 'taken' ? '<span class="chip bad">Unavailable: another app or system reserved it</span>' : v === 'invalid' ? '<span class="chip bad">Not a valid shortcut</span>' : sc[k] ? '' : '<span class="chip">Off</span>';
    };
    const r = (k, label, icon) => row(label, chip(k), `<input type="text" class="sc" data-sc="${k}" value="${esc(sc[k] || '')}" placeholder="Click and press keys">`, { icon });
    return [
      group(
        r('romanization', 'Toggle romanization / Pinyin', 'translate'),
        r('layout', 'Cycle Top / Right / Left', 'pin'),
        r('area', 'Screenshot an area', 'camera'),
        r('full', 'Screenshot the whole screen', 'camera'),
        r('clipboard', 'Clipboard history', 'clipboard'),
        r('hide', 'Hide / show the notch', 'home')
      ),
      `<p class="hint">Click a box and press the keys you want (for example <span class="kbd">Alt</span> + <span class="kbd">Shift</span> + <span class="kbd">S</span>). Backspace clears it. Romanization defaults to Ctrl+Alt+F8 (a function key avoids AltGr character input). Active means the system accepted the shortcut; unavailable shortcuts must be changed.</p>`,
      h2('Screenshots'),
      group(
        row('Save to', 'Every screenshot is also copied to the clipboard', `<input type="text" id="shot-dir" value="${esc(s.screenshotDir || '')}" placeholder="Pictures\\Screenshots\\Atoll" style="width:240px">`, { icon: 'shelf' }),
        row('Take one now', '', '<button class="btn" id="shot-area">Area</button><button class="btn" id="shot-full">Full screen</button>', { icon: 'camera' })
      )
    ].join('');
  };

  view.clipboard = async () => {
    const list = api.clip ? await api.clip.list() : [];
    return [
      group(
        row('Paste right away', mac ? 'Allow Atoll in Privacy & Security → Accessibility to paste with Command+V.' : 'Picking an item pastes it into the app you were using, like Win + V. Off: it is only copied.', toggle('pasteOnPick'), { icon: 'clipboard' }),
        row('Pause clipboard history', 'New copies aren’t saved. Password managers are always skipped.', toggle('clipboardPaused'), { icon: 'pauseSm' })
      ),
      h2('History'),
      group(
        row(`${list.length} item${list.length === 1 ? '' : 's'} saved`, `${list.filter((c) => c.pinned).length} pinned · pinned items are kept forever`, '<button class="btn" id="cb-open">Open history</button><button class="btn danger" id="cb-clear">Clear unpinned</button>', { icon: 'clipboard' })
      ),
      `<p class="hint">Open it anytime with <span class="kbd">${esc((st().shortcuts || {}).clipboard || 'Alt+Shift+V')}</span>. Type to search, arrow keys to choose, Enter to paste.</p>`
    ].join('');
  };

  view.tasks = async () => {
    const tl = S.store.todolist || {};
    if (tl.connected) {
      return [
        group(
          row(`Signed in as <b>${esc(tl.name || tl.user)}</b>`, `${esc(tl.url)} · tasks sync both ways`, '<button class="btn" id="tl-open">Open Todolist</button><button class="btn danger" id="tl-out">Sign out</button>', { icon: 'todo' }),
          row('Reminders in the notch', 'At each task’s time, alongside the WhatsApp Buddy message', toggle('todolistReminders'), { icon: 'bell' })
        ),
        `<p class="hint">Tasks show up on the Today page. Type things like “call mum tomorrow 8pm” and the date is understood.</p>`
      ].join('');
    }
    return [
      group(tall('Sync with Gavin’s Todolist', 'Use your Whats Up sign-in. Atoll keeps only the session, encrypted on this PC, never your password.',
        `<div class="inputs"><input type="url" id="tl-url" placeholder="https://your-app.up.railway.app" value="${esc(tl.url || '')}" style="flex:1.6">
         <input type="text" id="tl-user" placeholder="Username" value="${esc(tl.user || '')}">
         <input type="password" id="tl-pass" placeholder="Password">
         <button class="btn accent" id="tl-in">Sign in</button></div><span class="err" id="tl-err"></span>`)),
      `<p class="hint">Without an account, tasks are kept on this PC and remind you at their time.</p>`
    ].join('');
  };

  view.calendar = async () => {
    const s = st();
    const cal = await api.getCalendar();
    const apple = mac && s.calendarSource === 'apple';
    const connected = apple || !!s.icsUrl;
    const now = Date.now();
    const evs = (cal.events || []).filter((e) => e.end > now).slice(0, 6);
    return [
      mac && group(row('Calendar source', '', `<div class="seg"><button data-calendar-source="apple" class="${apple ? 'on' : ''}">Apple Calendar</button><button data-calendar-source="ics" class="${!apple ? 'on' : ''}">Calendar link</button></div>`)),
      apple && group(
        row('Apple Calendar', cal.authorized ? 'Connected. Events from calendars on this Mac, including synced accounts.' : 'Allow Atoll to show your events and meeting reminders.', `<button class="btn accent" id="apple-cal-connect">${cal.authorized ? 'Refresh' : 'Connect Apple Calendar'}</button><button class="btn" id="apple-cal-off">Disconnect</button>`, { icon: 'calendar' }),
        cal.error && tall('Calendar access', '', `<span class="err">${esc(cal.error)}</span>`),
        cal.authorized && tall('Calendars to show', 'Leave all unchecked to show every calendar.', `<div>${(cal.calendars || []).map(c => `<label style="display:flex;align-items:center;gap:8px;padding:8px"><input type="checkbox" data-apple-calendar="${esc(c.id)}" ${(s.appleCalendarIds || []).includes(c.id) ? 'checked' : ''}>${esc(c.title)}${c.account ? ' · ' + esc(c.account) : ''}</label>`).join('')}</div>`)
      ),
      group(
        !apple && tall('Calendar link (ICS)', s.icsUrl ? 'Connected. Atoll checks it every 10 minutes.' : 'Paste the private iCal link of your calendar',
          `<div class="inputs"><input type="url" id="ics" placeholder="https://…/basic.ics" value="${esc(s.icsUrl || '')}"><button class="btn accent" id="ics-save">${s.icsUrl ? 'Update' : 'Connect'}</button>${s.icsUrl ? '<button class="btn" id="ics-refresh">Refresh</button><button class="btn danger" id="ics-off">Disconnect</button>' : ''}</div>
           ${cal.error ? `<span class="err">${esc(cal.error)}</span>` : ''}
           ${s.icsUrl ? '' : `<ol class="steps"><li><b>Google Calendar:</b> Settings → your calendar → Integrate calendar → copy <i>Secret address in iCal format</i>.</li><li><b>Outlook:</b> Settings → Calendar → Shared calendars → Publish a calendar → copy the <i>ICS</i> link.</li></ol>`}`),
        row('Meeting heads-up', 'The notch shows a countdown, then a notification with a Join button', num('meetingHeadsUpMin', 1, 30, 1, 'min before'), { icon: 'bell' })
      ),
      connected ? h2('Coming up') : '',
      connected ? group(tall(evs.length ? `Next ${evs.length} event${evs.length === 1 ? '' : 's'}` : 'Nothing in the next 7 days', '',
        `<div class="evs">${evs.map((e) => `<div class="ev"><span>${e.allDay ? 'All day' : new Date(e.start).toLocaleDateString([], { weekday: 'short' }) + ' ' + hhmm(e.start)}</span><b>${esc(e.title)}</b>${e.link ? `<button class="btn sm" data-url="${esc(e.link)}">Join</button>` : '<span></span>'}</div>`).join('')}</div>`)) : ''
    ].filter(Boolean).join('');
  };

  view.focus = async () => {
    const w = isOn('waterEnabled');
    return [
      h2('Focus timer'),
      group(
        row('Focus length', '', num('focusMin', 5, 120, 5, 'min'), { icon: 'timer' }),
        row('Break length', '', num('breakMin', 1, 30, 1, 'min'), { icon: 'timer' })
      ),
      h2('Water'),
      group(
        row('Water tracking', 'Show your water intake on the Today page', toggle('waterEnabled'), { icon: 'water' }),
        w && row('Daily goal', '', num('waterGoalMl', 500, 6000, 250, 'ml')),
        w && row('Glass / bottle size', '', num('bottleMl', 50, 2000, 50, 'ml')),
        w && row('Water reminders', 'Turn reminders off while keeping water tracking', toggle('waterReminders'), { icon: 'bell' }),
        w && isOn('waterReminders') && row('Remind me every', '8 am to 10 pm, until you reach the goal · 0 = off', num('waterEveryMin', 0, 240, 15, 'min'))
      )
    ].join('');
  };

  async function macPermissions() {
    if (!mac) return '';
    const p = await api.macPermissions();
    const button = (id, allowed) => allowed ? '<span class="chip good">Allowed</span>' : `<button class="btn" data-mac-permission="${id}">Request access…</button>`;
    return h2('Mac permissions') + group(
      row('Screen Recording', 'Capture screenshots. Reopen Atoll after changing access.', button('screen', p.screen === 'granted'), { icon: 'camera' }),
      row('Accessibility', 'Paste items and read visible notification banners.', button('accessibility', p.accessibility), { icon: 'clipboard' }));
  }
  view.system = async () => [
    await macPermissions(),
    '<div class="stats" id="stats"></div>',
    h2('Atoll itself'),
    group(tall('Memory', '', '<div class="parts" id="parts"><span class="hint" style="margin:0">Measuring…</span></div>', { cls: 'mem' })),
    h2('Diagnostics'),
    group(tall('If something doesn’t work, copy this and send it to whoever helps you', '<span id="diag-sum">Checking…</span>',
      '<div class="diag" id="diag">…</div><div class="ctl"><button class="btn accent" id="diag-copy">Copy diagnostics</button></div>'))
  ].join('');

  const updateRows = (u) => {
    if (!u) return '';
    const pct = Math.round((u.progress || 0) * 100);
    const sub = {
      checking: 'Checking for updates…',
      downloading: `Downloading Atoll ${esc(u.version || '')}${pct ? ` · ${pct}%` : '…'}`,
      ready: `Atoll ${esc(u.version || '')} is ready. It installs when you restart.`,
      uptodate: `You have the latest version (${esc(u.current)}).`,
      error: `<span class="err">${esc(u.error || 'Could not check for updates.')}</span>`,
      unavailable: esc(u.error || 'Updates are not available in this build.'),
      idle: 'Atoll checks for updates in the background.'
    }[u.state] || '';
    const busyNow = u.state === 'checking' || u.state === 'downloading';
    const ctl = u.state === 'ready'
      ? `<button class="btn accent" id="upd-install">${u.canInstall === false ? 'Download update' : 'Restart to update'}</button>`
      : `<button class="btn" id="upd-check" ${busyNow || u.state === 'unavailable' ? 'disabled' : ''}>Check for updates</button>`;
    return [
      group(
        row('Software update', sub, ctl, { icon: 'refresh' }),
        u.state === 'ready' && u.notes ? tall(`What’s new in ${esc(u.version || '')}`, '', `<div class="notes">${esc(u.notes).replace(/\n/g, '<br>')}</div>`) : '',
        row('Update automatically', 'Check in the background every few hours and download updates. Nothing is installed until you choose Restart.', toggle('autoUpdate'), { icon: 'bolt' })
      )
    ].join('');
  };

  view.about = async () => {
    if (!S.version && api.diagnostics) { try { S.version = (await api.diagnostics()).version; } catch (_) {} }
    const upd = api.updater ? await api.updater.state() : null;
    return [
      `<div class="group about"><span class="logo"><i></i></span><div><b>Atoll</b><span>Version ${esc(S.version || '0.10.0')} · a Dynamic Island for ${mac ? 'macOS' : 'Windows'}</span></div></div>`,
      updateRows(upd),
      group(
        row('Setup guide', 'The first-run walkthrough: layout, lyrics sources, clipboard, notifications', '<button class="btn" id="setup-open">Open the guide</button>', { icon: 'star' }),
        row('Lyrics', 'From the app that is playing, through your Spotify or Apple Music account. Translations by Google Translate.', null, { icon: 'lyrics' }),
        row('Your data', mac ? 'Everything stays on this Mac, in ~/Library/Application Support/Atoll' : 'Everything stays on this PC, in %APPDATA%\\Atoll', null, { icon: 'info' }),
        row('Restart Atoll', '', '<button class="btn" id="restart">Restart</button>', { icon: 'refresh' }),
        row('Quit Atoll', 'The notch disappears until you start Atoll again', '<button class="btn danger" id="quit">Quit</button>', { icon: 'x' })
      )
    ].join('');
  };

  /* ---------- rendering & wiring ---------- */
  function renderNav() {
    $('#nav').innerHTML = SECTIONS.map(([id, icon, label]) => `<button data-sec="${id}" class="${S.section === id ? 'on' : ''}">${I[icon] || ''}<span>${label}</span></button>`).join('');
    $('#side-foot').innerHTML = `Atoll ${esc(S.version || '')}`;
  }
  $('#nav').addEventListener('click', (e) => { const b = e.target.closest('[data-sec]'); if (b) go(b.dataset.sec); });

  async function go(sec, animate = true) {
    if (!view[sec]) sec = 'general';
    const changed = sec !== S.section;
    S.section = sec;
    try { history.replaceState(null, '', '#' + sec); } catch (_) {}
    renderNav();
    $('#title').textContent = SECTIONS.find((x) => x[0] === sec)[2];
    await render(animate && changed);
  }
  async function render(animate) {
    const sec = S.section;
    const box = $('#content');
    const keep = box.scrollTop;
    const html = await view[sec]();
    if (sec !== S.section) return; // switched while loading
    box.innerHTML = html;
    if (animate) { box.classList.remove('enter'); void box.offsetWidth; box.classList.add('enter'); box.scrollTop = 0; }
    else { box.classList.remove('enter'); box.scrollTop = keep; }
    wire(box);
    clearInterval(S.statsT);
    if (api.statsActive) api.statsActive(sec === 'system');
    if (sec === 'system') { pollStats(); S.statsT = setInterval(pollStats, 1000); loadDiag(); }
  }
  const rerender = () => render(false);

  function wire(box) {
    $$('[data-tog]', box).forEach((b) => b.onclick = () => {
      const k = b.dataset.tog;
      st()[k] = !isOn(k); save();
      b.classList.toggle('on', st()[k]); b.setAttribute('aria-checked', st()[k]);
      b.previousElementSibling.textContent = st()[k] ? 'On' : 'Off';
      if (['notifications', 'waterEnabled', 'waterReminders'].includes(k)) setTimeout(rerender, 180);
      if (k === 'lite' || k === 'gpu') toast('Restart Atoll to apply');
    });
    $$('[data-seg]', box).forEach((b) => b.onclick = () => {
      st()[b.dataset.seg] = b.dataset.v; save();
      $$(`[data-seg="${b.dataset.seg}"]`, box).forEach((x) => x.classList.toggle('on', x === b));
      if (b.dataset.seg === 'openOn') setTimeout(rerender, 150);
    });
    $$('[data-num]', box).forEach((inp) => inp.onchange = () => {
      const v = Math.max(+inp.min, Math.min(+inp.max, Math.round(+inp.value || 0)));
      inp.value = v; st()[inp.dataset.num] = v; save();
    });
    $$('[data-accent]', box).forEach((b) => b.onclick = () => {
      st().accent = b.dataset.accent; save(); applyAccent();
      $$('[data-accent]', box).forEach((x) => x.classList.toggle('on', x === b));
    });
    $$('[data-url]', box).forEach((b) => b.onclick = () => api.openUrl(b.dataset.url));
    const on = (id, fn, ev = 'onclick') => { const el = $('#' + id, box); if (el) el[ev] = fn; };
    $$('[data-mac-permission]', box).forEach(b => b.onclick = async () => {
      b.disabled = true;
      try { await api.requestMacPermission(b.dataset.macPermission); }
      finally { await rerender(); }
    });
    on('restart', () => api.restart && api.restart());
    on('quit', () => api.quit());
    on('setup-open', () => api.setup && api.setup.open());

    $$('[data-layout-style]', box).forEach((b) => b.onclick = () => {
      st().layout = b.dataset.layoutStyle; save();
      $$('[data-layout-style]', box).forEach((x) => x.classList.toggle('on', x === b));
    });
    // appearance / position
    $$('[data-layout]', box).forEach((b) => b.onclick = () => {
      const v = b.dataset.layout, pos = st().position || {};
      const current = pos.mode === 'side' ? pos.side : 'top';
      st().positionPresets = { ...(st().positionPresets || {}), [current]: { ...pos } };
      st().position = { ...(st().positionPresets[v] || (v === 'top' ? { mode: 'top', frac: 0.5, top: 0 } : { mode: 'side', side: v, cy: 450, inset: 0 })), display: pos.display || 'primary' };
      save(); setTimeout(rerender, 200);
    });
    $$('[data-display]', box).forEach((b) => b.onclick = () => {
      if (api.moveToDisplay) api.moveToDisplay(b.dataset.display);
      toast('Notch moved'); setTimeout(rerender, 250);
    });
    on('pos-move', () => { api.moveMode && api.moveMode(true); });
    on('pos-offset-reset', async () => {
      const p = st().position || {};
      const displays = api.displays ? await api.displays() : [];
      const d = displays.find(d => String(d.id) === String(p.display)) || displays.find(d => d.primary) || displays[0];
      st().position = { ...p, ...(p.mode === 'side' ? { inset: 0, cy: Math.round((d?.height || 900)/2) } : { frac: 0.5, top: 0 }) };
      await save(); rerender(); toast('Offsets reset for this layout');
    });
    on('pos-reset', () => { api.resetPosition && api.resetPosition(); toast('Back at the top centre'); });
    $$('[data-nudge]', box).forEach((b) => b.onclick = () => { const [dx, dy] = b.dataset.nudge.split(',').map(Number); if (api.nudge) api.nudge([dx, dy]); });
    const slider = (id, apply, label) => {
      const el = $('#' + id, box); if (!el) return;
      el.oninput = () => { el.style.setProperty('--p', `${100 * (el.value - el.min) / (el.max - el.min)}%`); apply(+el.value); label(+el.value); save(); };
    };
    const pos = st().position || {};
    const side = pos.mode === 'side';
    slider('pos-h', (v) => { st().position = { ...st().position, ...(side ? { inset: v } : { frac: v / 100 }) }; }, (v) => ($('#pos-h-v').textContent = side ? v + ' px' : v + '%'));
    slider('pos-v', (v) => { st().position = { ...st().position, ...(side ? { cy: v } : { top: v }) }; }, (v) => ($('#pos-v-v').textContent = v + ' px'));

    slider('hover-delay', (v) => { st().hoverDelay = Math.round(v * 100) / 100; }, (v) => ($('#hover-delay-v').textContent = v === 0 ? 'Instant' : v.toFixed(2) + ' s'));

    // music: lyrics sources
    $$('[data-src-on]', box).forEach((b) => b.onclick = async () => {
      const k = b.dataset.srcOn;
      S.connecting = k; rerender();
      const r = await api.lyricSources.connect(k);
      S.connecting = null; rerender();
      if (r && r[k] && r[k].connected) toast(`${k === 'spotify' ? 'Spotify' : 'Apple Music'} connected`);
    });
    $$('[data-src-off]', box).forEach((b) => b.onclick = async () => { await api.lyricSources.disconnect(b.dataset.srcOff); rerender(); toast('Disconnected'); });
    $$('[data-understood]', box).forEach(input => input.onchange = () => {
      st().understoodLanguages = $$('[data-understood]:checked', box).map(el => el.dataset.understood);
      save();
    });
    on('tr-to', (e) => { st().translateTo = e.target.value; save(); }, 'onchange');
    slider('ls', (v) => { st().lyricSize = v; }, (v) => ($('#ls-v').textContent = v + ' px'));
    slider('lyr-off', (v) => { st().lyricOffset = Math.round(v * 10) / 10; }, (v) => ($('#lyr-off-v').textContent = offTxt(v)));

    // notifications
    $$('[data-npos]', box).forEach((b) => b.onclick = () => {
      st().notifPos = b.dataset.npos; save();
      $$('[data-npos]', box).forEach((x) => x.classList.toggle('on', x === b));
      setTimeout(() => api.notifyTest && api.notifyTest({ title: 'Notifications pop up here', body: 'Change it anytime in Settings → Notifications.' }), 250);
    });
    on('test-notif', () => api.notifyTest && api.notifyTest());
    on('copy-curl', async () => { api.copy((await api.notifyInfo()).curl); toast('Example copied'); });
    on('copy-token', async () => { api.copy((await api.notifyInfo()).token); toast('Token copied'); });

    // shortcuts: record the keys pressed
    $$('[data-sc]', box).forEach((inp) => {
      inp.onkeydown = (e) => {
        e.preventDefault();
        if (e.getModifierState('AltGraph')) { toast('AltGr is for typing. Choose Ctrl+Alt with a function key.'); return; }
        if (e.key === 'Backspace' || e.key === 'Delete') { inp.value = ''; commitSc(inp); return; }
        if (e.key === 'Escape') { inp.blur(); return; }
        if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
        const mods = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Super'].filter(Boolean);
        if (!mods.length && !/^F\d+$/.test(e.key)) { toast('Add Ctrl, Alt or Shift'); return; }
        const k = e.key.length === 1 ? e.key.toUpperCase() : ({ ' ': 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right' }[e.key] || e.key);
        inp.value = [...mods, k].join('+');
        commitSc(inp);
      };
    });
    on('shot-dir', (e) => { st().screenshotDir = e.target.value.trim(); save(); }, 'onchange');
    on('shot-area', () => api.shot && api.shot('area'));
    on('shot-full', () => api.shot && api.shot('full'));

    // clipboard
    on('cb-open', () => api.openClipboard ? api.openClipboard() : null);
    on('cb-clear', () => { api.clip.clear(); setTimeout(rerender, 200); toast('Cleared'); });

    // tasks
    on('tl-open', () => api.openUrl((S.store.todolist || {}).webUrl));
    on('tl-out', async () => { S.store.todolist = await api.todo.logout(); rerender(); });
    const login = async () => {
      const btn = $('#tl-in'), err = $('#tl-err');
      err.textContent = ''; btn.disabled = true; btn.textContent = 'Signing in…';
      const r = await api.todo.login($('#tl-url').value, $('#tl-user').value.trim(), $('#tl-pass').value);
      btn.disabled = false; btn.textContent = 'Sign in';
      if (!r.ok) { err.textContent = r.error; return; }
      S.store.todolist = r.data; rerender(); toast('Todolist connected');
    };
    on('tl-in', login);
    on('tl-pass', (e) => { if (e.key === 'Enter') login(); }, 'onkeydown');

    // updates
    on('upd-check', async () => { await api.updater.check(); rerender(); });
    on('upd-install', async () => {
      const r = await api.updater.install();
      if (r && r.openPage) api.updater.openPage();
      if (r && !r.ok && r.error) toast(r.error);
    });
    // calendar
    $$('[data-calendar-source]', box).forEach(button => button.onclick = async () => {
      st().calendarSource = button.dataset.calendarSource;
      await save(); await api.refreshCalendar(); rerender();
    });
    on('apple-cal-connect', async () => {
      const button = $('#apple-cal-connect'); button.disabled = true;
      try {
        st().calendarSource = 'apple';
        await api.connectAppleCalendar();
      } finally { rerender(); }
    });
    on('apple-cal-off', async () => {
      st().calendarSource = 'ics'; await save(); await api.refreshCalendar(); rerender();
    });
    $$('[data-apple-calendar]', box).forEach(input => input.onchange = async () => {
      st().appleCalendarIds = $$('[data-apple-calendar]:checked', box).map(el => el.dataset.appleCalendar);
      await save(); await api.refreshCalendar(); rerender();
    });
    const saveIcs = async () => {
      const v = $('#ics').value.trim();
      st().icsUrl = v; st().calendarSource = 'ics'; await save();
      $('#content').style.opacity = '.6';
      await api.refreshCalendar();
      $('#content').style.opacity = '';
      rerender();
    };
    on('ics-save', saveIcs);
    on('ics', (e) => { if (e.key === 'Enter') saveIcs(); }, 'onkeydown');
    on('ics-refresh', async () => { await api.refreshCalendar(); rerender(); toast('Calendar refreshed'); });
    on('ics-off', async () => { st().icsUrl = ''; await save(); rerender(); });
  }
  function commitSc(inp) {
    st().shortcuts = { ...(st().shortcuts || {}), [inp.dataset.sc]: inp.value.trim() };
    save();
    setTimeout(async () => { if (api.shortcutsStatus) S.shortcuts = await api.shortcutsStatus(); rerender(); }, 300);
  }

  /* ---------- system ---------- */
  function spark(data, max, color) {
    if (data.length < 2) return '<svg class="spark"></svg>';
    const W = 150, H = 34, n = data.length;
    const pts = data.map((v, i) => `${(i / (n - 1)) * W},${H - 2 - (Math.min(v, max) / max) * (H - 4)}`).join(' ');
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><polygon points="0,${H} ${pts} ${W},${H}" fill="${color}" opacity=".15"/><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.6" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>`;
  }
  async function pollStats() {
    let x; try { x = await api.getStats(); } catch (_) { return; }
    if (S.section !== 'system') return;
    S.cpuHist.push(x.cpu); S.netHist.push(x.down);
    if (S.cpuHist.length > 60) S.cpuHist.shift();
    if (S.netHist.length > 60) S.netHist.shift();
    const memPct = Math.round(100 * x.memUsed / x.memTotal);
    let batt = { v: '—', s: 'No battery', pct: 0 };
    if (navigator.getBattery) {
      try {
        const b = await navigator.getBattery();
        const none = b.level === 1 && b.charging && b.chargingTime === 0 && b.dischargingTime === Infinity; // desktops report this
        batt = none ? { v: '—', s: 'Plugged in', pct: 100 } : { v: Math.round(b.level * 100) + '<small>%</small>', s: b.charging ? 'Charging' : 'On battery', pct: Math.round(b.level * 100) };
      } catch (_) {}
    }
    const up = Math.floor(x.uptime / 3600);
    const box = $('#stats'); if (!box) return;
    box.innerHTML = `
      <div class="stat"><div class="k">${I.cpu}CPU</div><div class="v">${x.cpu}<small>%</small></div><div class="s">${x.cores} cores</div>${spark(S.cpuHist, 100, 'var(--accent)')}</div>
      <div class="stat"><div class="k">${I.memory}Memory</div><div class="v">${memPct}<small>%</small></div><div class="s">${bytes(x.memUsed)} of ${bytes(x.memTotal)}</div><div class="meter"><i style="width:${memPct}%"></i></div></div>
      <div class="stat"><div class="k">${I.down}Network</div><div class="v" style="font-size:19px">${rate(x.down)}</div><div class="s">↑ ${rate(x.up)}</div>${spark(S.netHist, Math.max(1e5, ...S.netHist), '#5ac8fa')}</div>
      <div class="stat"><div class="k">${I.battery}Battery</div><div class="v">${batt.v}</div><div class="s">${batt.s} · up ${up}h ${Math.floor((x.uptime % 3600) / 60)}m</div><div class="meter"><i style="width:${batt.pct}%;background:${batt.pct && batt.pct <= 20 ? 'var(--danger)' : '#30d158'}"></i></div></div>`;
    const parts = Object.entries(x.atollParts || {}).sort((a, b) => b[1] - a[1]);
    const res = x.atollReservedParts || {};
    const max = Math.max(1, ...parts.map((p) => p[1]));
    const pb = $('#parts');
    if (pb && x.atollMem) {
      const ago = x.lastTrim ? Math.round((Date.now() - x.lastTrim) / 1000) : 0;
      const gfx = (res.Graphics || 0);
      pb.innerHTML = `<div class="part head"><span></span><span></span><b>In RAM</b><b>Private commit</b></div>` +
        `<div class="part"><span><b style="text-align:left">Total</b></span><span class="hint" style="margin:0">${x.atollProcs || ''} processes${st().lite !== false ? ' · Lite mode' : ''}</span><b>${bytes(x.atollMem)}</b><b class="dim">${x.atollReserved ? bytes(x.atollReserved) : ''}</b></div>` +
        parts.map(([k, v]) => `<div class="part"><span>${esc(k)}</span><span class="bar"><i style="width:${(100 * v / max).toFixed(1)}%"></i></span><b>${bytes(v)}</b><b class="dim">${res[k] ? bytes(res[k]) : ''}</b></div>`).join('') +
        `<div class="mem-foot"><span class="hint" style="margin:0">Hidden lists and artwork caches are kept small. Manual trim evicts resident pages temporarily and may slow the next interaction${x.lastTrim ? ` · last time ${ago < 60 ? ago + ' s' : Math.round(ago / 60) + ' min'} ago` : ''}.${x.gpuOn && gfx > 60e6 ? ` The graphics process has private commit of ${bytes(gfx)}: <a data-goto="general">turn it off</a> to save that, at the cost of smoothness.` : ''}</span><button class="btn sm" id="trim-now">Free memory now</button></div>` +
        (x.helperError ? `<span class="err">Native helper unavailable, using PowerShell: ${esc(x.helperError.slice(0, 300))}</span>` : '');
      const tb = $('#trim-now'); if (tb) tb.onclick = async () => { tb.disabled = true; if (api.trimNow) await api.trimNow(); setTimeout(() => { tb.disabled = false; pollStats(); }, 1500); toast('Memory cleanup requested'); };
      $$('[data-goto]', pb).forEach((a2) => a2.onclick = () => go(a2.dataset.goto));
    }
  }
  async function loadDiag() {
    if (!api.diagnostics) return;
    const d = await api.diagnostics();
    if (S.section !== 'system') return;
    const h = d.helper || {};
    const kinds = { native: 'Native helper ✓ (light)', 'native-core+powershell': 'Native core + PowerShell for music', powershell: 'PowerShell helper (heavy fallback)', none: 'No helper running' };
    $('#diag-sum').textContent = `${kinds[h.kind] || h.kind || '?'} · clipboard: ${d.clipboard.count} saved this session${d.clipboard.last ? ' (last ' + hhmm(d.clipboard.last) + ' via ' + d.clipboard.via + ')' : ''}`;
    const lines = [
      `Atoll ${d.version} · Electron ${d.electron} · ${mac ? 'Darwin' : 'Windows'} ${d.windows} · Lite ${d.lite}`,
      `Helper: ${h.kind}${h.exe ? ' (' + h.exe.split(/[\\/]/).pop() + ')' : ''}`,
      ...(h.parts ? [`Parts: ${Object.entries(h.parts).map(([k, v]) => k + (v ? ' ✓' : ' ✗')).join(', ')}`] : []),
      ...Object.entries(h.build || {}).map(([k, v]) => `Build ${k} failed: ${v}`),
      `Apple Music controls: ${mac ? 'macOS Automation' : h.uia === false ? 'not built in (see messages)' : h.uia ? 'built in' : 'unknown'}${d.appleMusic ? ` · usable ${d.appleMusic.usable} · watching ${d.appleMusic.watching} · slider found ${d.appleMusic.sliderFound}${d.appleMusic.lastCmd ? ` · last ${d.appleMusic.lastCmd.cmd} ${d.appleMusic.lastCmd.ok ? 'ok' : 'failed ' + (d.appleMusic.lastCmd.why || '')}` : ''}` : ''}`,
      ...((d.mediaLog || []).length ? ['Now playing reports:', ...d.mediaLog.map((x) => '  ' + x)] : []),
      ...(d.lyrics ? [
        `Lyrics: Spotify ${d.lyrics.spotify ? (d.lyrics.spotify.connected ? 'connected' : 'off') + (d.lyrics.spotify.error ? ' (' + d.lyrics.spotify.error + ')' : '') : '?'} · Apple Music ${d.lyrics.apple ? (d.lyrics.apple.connected ? 'connected' : 'off') + (d.lyrics.apple.error ? ' (' + d.lyrics.apple.error + ')' : '') : '?'}`,
        ...(d.lyrics.recent || []).map((x) => `  ${hhmm(x.at)} ${x.title} — ${x.artist}: ${x.result} (${x.ms} ms)${x.detail ? ' · ' + x.detail : ''}`)
      ] : []),
      `Clipboard: ${JSON.stringify(d.clipboard)}`,
      `Notifications: ${JSON.stringify(d.toasts)}`,
      `Shortcuts: ${JSON.stringify(d.shortcuts)}`,
      ...(d.screenshot ? [`Screenshot: ${d.screenshot}`] : []),
      ...(h.messages || []).map((m) => `[${m.at}] ${m.where}: ${m.msg}`),
      ...(h.stderr || []).map((m) => `stderr: ${m}`)
    ];
    $('#diag').textContent = lines.join('\n');
    $('#diag-copy').onclick = () => { api.copy(lines.join('\n')); toast('Diagnostics copied'); };
  }

  /* ---------- live updates ---------- */
  api.onStore((s) => {
    S.store = s; applyAccent();
    const a = document.activeElement;
    if (a && a.closest('#content') && /INPUT|SELECT/.test(a.tagName)) return; // don't yank what you're typing
    if (a && a.type === 'range') return;
    rerender();
  });
  if (api.onSettingsSection) api.onSettingsSection((sec) => go(sec));
  if (api.onLyricsSources) api.onLyricsSources(() => { if (S.section === 'music') rerender(); });
  // update progress and results while About is open (at most twice a second)
  if (api.onUpdater) {
    let queued = null;
    api.onUpdater(() => { if (S.section !== 'about' || queued) return; queued = setTimeout(() => { queued = null; if (S.section === 'about') rerender(); }, 500); });
  }
  window.addEventListener('hashchange', () => go(location.hash.slice(1)));

  applyAccent();
  if (api.diagnostics) api.diagnostics().then((d) => { S.version = d.version; renderNav(); }).catch(() => {});
  go(location.hash.slice(1) || 'general', false);
})();
