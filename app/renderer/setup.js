// Atoll setup guide. Every choice is saved right away, like in Settings. Shown on the first run, and
// after an update whose steps are marked `since` a newer setup version (main.js: SETUP_VERSION).
(async function () {
  const api = window.API;
  const mac = window.atoll?.platform === 'darwin';
  if (mac) document.body.classList.add('mac'); // room for the window buttons (hidden title bar)
  const I = window.ICONS;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const S = { store: await api.getStore(), info: await api.setup.info(), i: 0, dir: 1, sources: null, connecting: null, clip: null };
  const st = () => S.store.settings;
  const save = () => api.setStore('settings', st());
  const DEFAULT_ON = ['gpu', 'notifications', 'windowsNotifications', 'pasteOnPick'];
  const isOn = (k) => st()[k] ?? DEFAULT_ON.includes(k);

  const row = (label, sub, ctl, { icon, logo, cls = '' } = {}) => `<div class="row ${cls}">${logo || (icon ? `<span class="ri">${I[icon] || ''}</span>` : '')}<div class="lbl"><span>${label}</span>${sub ? `<small>${sub}</small>` : ''}</div>${ctl != null ? `<div class="ctl">${ctl}</div>` : ''}</div>`;
  const toggle = (k) => `<span class="switch-txt">${isOn(k) ? 'On' : 'Off'}</span><button class="switch ${isOn(k) ? 'on' : ''}" data-tog="${k}" role="switch" aria-checked="${isOn(k)}"></button>`;
  const seg = (k, opts, cur = st()[k]) => `<div class="seg">${opts.map(([v, t]) => `<button data-seg="${k}" data-v="${v}" class="${String(cur) === String(v) ? 'on' : ''}">${t}</button>`).join('')}</div>`;
  const group = (...rows) => `<div class="group">${rows.filter(Boolean).join('')}</div>`;
  const head = (kicker, title, lead) => `<div class="kicker">${kicker}</div><h1>${title}</h1>${lead ? `<p class="lead">${lead}</p>` : ''}`;
  function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('on'), 1600); }
  const ago = (t) => { const s = Math.round((Date.now() - t) / 1000); return s < 60 ? 'just now' : s < 3600 ? Math.round(s / 60) + ' min ago' : Math.round(s / 3600) + ' h ago'; };

  /* ---------- steps (since: shown to people updating from an older setup version) ---------- */
  const STEP = {};
  STEP.welcome = () => S.info.isUpdate ? [
    head('Atoll 0.10', 'What’s new', 'A few things changed since you last set Atoll up. This takes about a minute.'),
    `<div class="news">
      <div>${I.lyrics}<div><b>Lyrics straight from Spotify or Apple Music</b><span>Atoll no longer uses free lyrics sites. Lyrics now come only from the app that is playing: connect Spotify and/or Apple Music.</span></div></div>
      <div>${I.clipboard}<div><b>Clipboard history fixed</b><span>Copies that “couldn’t be read” are now saved. You can check it in a moment.</span></div></div>
      <div>${I.bolt}<div><b>Smoother open and close</b><span>The text inside stays perfectly still while the notch grows, and an instrumental part shows “• • •” instead of closing.</span></div></div>
    </div>`
  ].join('') : [
    `<div class="hero" aria-hidden="true"><div class="isl"><span class="art"></span><span class="viz"><b></b><b></b><b></b></span></div><div class="card"><span class="big"></span><span class="lines"><i></i><i></i><i></i></span></div><svg class="cursor" viewBox="0 0 16 16"><path d="M2 1l11 7-5 1 3 5-2 1-3-5-4 3z" fill="#fff" stroke="#000" stroke-width="1"/></svg></div>`,
    head('Welcome', 'Atoll lives in the notch', 'Music with synced lyrics, timers, notifications, files and your clipboard history, at the top of your screen where your eyes already are. Rest the pointer on the notch to open it.')
  ].join('');

  STEP.layout = () => [
    head('Layout', 'How should the open notch look?', 'You can change this anytime in Settings → Appearance.'),
    group(
      `<div class="row tall"><div class="picks">${[['pages', 'Pages', 'One page at a time, with dots and ‹ › to move between them'], ['tabs', 'Tabs', 'A clock and a tab bar on top; Home shows the player, lyrics and cards']].map(([v, t, d]) => `<button class="pick lay ${(st().layout || 'pages') === v ? 'on' : ''}" data-layout-style="${v}"><span class="screen">${v === 'tabs' ? '<i class="t" style="height:44%;width:62%;border-radius:0 0 7px 7px"></i><i class="tbar"></i>' : '<i class="t" style="height:34%;width:46%;border-radius:0 0 9px 9px"></i><i class="pdots"></i>'}</span><b>${t}</b><small>${d}</small></button>`).join('')}</div></div>`,
      row('Open the notch', 'On hover: rest the pointer on it. On click: only when you click.', seg('openOn', [['hover', 'On hover'], ['click', 'On click']], st().openOn || 'hover'), { icon: 'home' })
    )
  ].join('');

  STEP.lyrics = () => {
    const info = S.sources || {};
    const src = (k, name, about) => {
      const x = info[k] || {};
      const busy = S.connecting === k;
      const sub = x.connected ? (x.error ? `<span class="err">${esc(x.error)}</span>` : `<span class="ok">Connected ✓</span>${x.lastOk ? ` · last lyrics ${ago(x.lastOk)}` : ''}`) : about;
      const ctl = x.connected ? `<button class="btn" data-src-off="${k}">Disconnect</button>` : `<button class="btn accent" data-src-on="${k}" ${busy ? 'disabled' : ''}>${busy ? '<span class="spin"></span>Waiting for sign-in…' : 'Connect…'}</button>`;
      return row(name, sub, ctl, { logo: `<span class="src-logo ${k}">${I.music}</span>` });
    };
    return [
      head('Lyrics', 'Where should lyrics come from?', 'Lyrics come only from the app that is playing, through your own account. Connect the service you listen with: without it, that app’s songs show no lyrics.'),
      group(
        src('spotify', 'Spotify', 'For songs playing in Spotify. A free account is enough.'),
        src('apple', 'Apple Music', 'For songs playing in the Music app. Needs a subscription.')
      ),
      `<p class="hint">A window opens with Spotify’s or Apple’s own sign-in page. It runs in a separate browser profile, so Atoll never sees your password; only song titles and artists are looked up. “Continue with Google / Facebook” may be blocked in app windows: use your email and password or a one-time code instead.</p>`
    ].join('');
  };

  STEP.clipboard = () => {
    const c = S.clip;
    const why = {
      paused: 'Clipboard history is paused. Turn it back on in Settings → Clipboard.',
      private: 'The copy was marked private (password managers do this), so it was skipped.',
      locked: 'Another app kept the clipboard locked, so Atoll couldn’t read it. Try again.',
      empty: 'The clipboard looked empty when Atoll read it. Try again.',
      error: 'Atoll couldn’t read the clipboard.',
      'not seen': 'Atoll didn’t notice the copy. Restart Atoll and try again; if it still fails, copy the diagnostics in Settings → System and send them.'
    };
    const result = !c ? '' : c.running
      ? `<div class="check"><span class="spin"></span>Copying a line and waiting for it to show up in the history…</div>`
      : c.ok ? `<div class="check good">${I.check}<span>It works: the copy showed up in ${(c.ms / 1000).toFixed(1)} s.</span></div>`
        : `<div class="check bad">${I.x}<span>${esc(why[c.reason] || why['not seen'])}${c.error ? ` <span class="mono">(${esc(c.error)})</span>` : ''}</span></div>`;
    return [
      head('Clipboard', 'Everything you copy, kept for you', `Copy text, links or pictures as usual. <span class="kbd">${esc((st().shortcuts || {}).clipboard || 'Alt+Shift+V')}</span> opens the history; pick an item and it’s pasted where you were. Password managers are always skipped.`),
      group(
        row('Check that it works', 'Atoll copies a test line and looks for it in the history (then removes it)', `<button class="btn accent" id="clip-test" ${c && c.running ? 'disabled' : ''}>${c && !c.running ? 'Check again' : 'Check'}</button>`, { icon: 'clipboard' }),
        row('Paste right away', mac ? 'Allow Accessibility for Atoll to paste with Command+V.' : 'Picking an item pastes it, like Win + V. Off: it is only copied.', toggle('pasteOnPick'), { icon: 'command' })
      ),
      result
    ].join('');
  };

  STEP.notifications = () => {
    if (mac) return head('Notifications', 'Notifications from the notch', 'Atoll shows reminders and local alerts. Allow Accessibility in System Settings to mirror visible app banners and paste clipboard items.') + group(row('App notification banners', '', toggle('windowsNotifications')), row('Try it', '', '<button class="btn" id="test-notif">Send a test</button>'));
    const t = S.info.toasts || {};
    const status = t.ok === true ? '<span class="ok">Atoll can read Windows notifications ✓</span>' : t.ok === false ? `<span class="err">${esc(t.error || 'Not available on this PC')}</span>` : 'WhatsApp, Discord, Teams, Chrome… drop out of the notch';
    return [
      head('Notifications', 'Notifications from the notch', 'Messages from your apps slide out of the notch. If you see every notification twice, turn off Windows’ own banners for that app.'),
      group(
        row('Windows app notifications', status, toggle('windowsNotifications'), { icon: 'bell' }),
        row('Try it', '', '<button class="btn" id="test-notif">Send a test</button>', { icon: 'bell' }),
        row('Windows’ own banners', 'Settings → System → Notifications → pick an app → Show notification banners: off', '<button class="btn" id="ms-notif">Open Windows settings</button>', { icon: 'sliders' })
      )
    ].join('');
  };

  STEP.basics = () => [
    head('Almost done', 'A couple of basics', ''),
    group(
      row(mac ? 'Open at login' : 'Start with Windows', 'Atoll waits at the top of your screen when you sign in', toggle('startWithWindows'), { icon: 'bolt' }),
      row('Use the graphics card', 'Recommended: smooth animations without leftover shadows. Turn off only if your graphics driver misbehaves (restart to apply).', toggle('gpu'), { icon: 'cpu' })
    )
  ].join('');

  STEP.done = () => [
    head('All set', 'That’s it', 'Rest the pointer on the notch at the top of your screen to open it. Swipe sideways on it to change songs, or drop files on it to keep them handy.'),
    group(
      row('Open this guide again', 'Right-click the Atoll icon in the taskbar corner → Setup guide, or Settings → About', null, { icon: 'info' }),
      row('Everything else', 'Colours, size, position, shortcuts, calendar, focus timer…', '<button class="btn" id="open-settings">Open Settings</button>', { icon: 'gear' })
    )
  ].join('');

  const ALL = [
    { id: 'welcome', always: true },
    { id: 'layout', since: 0 },
    { id: 'lyrics', since: 1 },
    { id: 'clipboard', since: 1 },
    { id: 'notifications', since: 0 },
    { id: 'basics', since: 0 },
    { id: 'done', always: true }
  ];
  const steps = ALL.filter((x) => x.always || !S.info.isUpdate || x.since > S.info.seen);

  /* ---------- rendering ---------- */
  function render(animate) {
    const id = steps[S.i].id;
    const box = $('#step');
    box.innerHTML = STEP[id]();
    if (animate) { box.className = ''; void box.offsetWidth; box.className = S.dir < 0 ? 'in back' : 'in'; $('#stage').scrollTop = 0; }
    else box.className = '';
    $('#dots').innerHTML = steps.map((_, k) => `<i class="${k === S.i ? 'on' : k < S.i ? 'done' : ''}"></i>`).join('');
    $('#count').textContent = `${S.i + 1} of ${steps.length}`;
    $('#back').hidden = S.i === 0;
    const last = S.i === steps.length - 1;
    $('#next').textContent = last ? 'Finish' : S.i === 0 ? (S.info.isUpdate ? 'Let’s go' : 'Get started') : id === 'lyrics' && !((S.sources || {}).spotify || {}).connected && !((S.sources || {}).apple || {}).connected ? 'Skip' : 'Next';
    wire(box);
  }
  const rerender = () => render(false);
  function go(d) {
    const n = S.i + d;
    if (n >= steps.length) { finish(); return; }
    if (n < 0) return;
    S.dir = d; S.i = n;
    if (steps[n].id === 'lyrics' && !S.sources) loadSources();
    render(true);
  }
  async function loadSources() { S.sources = await api.lyricSources.status(); if (steps[S.i].id === 'lyrics') rerender(); }
  let finished = false;
  function finish() {
    if (!finished) { finished = true; api.setup.done(S.info.version); }
    window.close();
  }
  // closing the window counts as done too: the guide stays one click away (tray, Settings → About)
  window.addEventListener('beforeunload', () => { if (!finished) { finished = true; api.setup.done(S.info.version); } });

  function wire(box) {
    $$('[data-tog]', box).forEach((b) => b.onclick = () => {
      const k = b.dataset.tog;
      st()[k] = !isOn(k); save();
      b.classList.toggle('on', st()[k]); b.setAttribute('aria-checked', st()[k]);
      b.previousElementSibling.textContent = st()[k] ? 'On' : 'Off';
      if (k === 'gpu') toast('Applies after a restart');
    });
    $$('[data-seg]', box).forEach((b) => b.onclick = () => {
      st()[b.dataset.seg] = b.dataset.v; save();
      $$(`[data-seg="${b.dataset.seg}"]`, box).forEach((x) => x.classList.toggle('on', x === b));
    });
    $$('[data-layout-style]', box).forEach((b) => b.onclick = () => {
      st().layout = b.dataset.layoutStyle; save();
      $$('[data-layout-style]', box).forEach((x) => x.classList.toggle('on', x === b));
    });
    $$('[data-src-on]', box).forEach((b) => b.onclick = async () => {
      const k = b.dataset.srcOn;
      S.connecting = k; rerender();
      S.sources = await api.lyricSources.connect(k);
      S.connecting = null; rerender();
      if (S.sources[k] && S.sources[k].connected) toast(`${k === 'spotify' ? 'Spotify' : 'Apple Music'} connected`);
    });
    $$('[data-src-off]', box).forEach((b) => b.onclick = async () => { S.sources = await api.lyricSources.disconnect(b.dataset.srcOff); rerender(); });
    const on = (id, fn) => { const el = $('#' + id, box); if (el) el.onclick = fn; };
    on('clip-test', async () => {
      S.clip = { running: true }; rerender();
      S.clip = await api.setup.testClipboard();
      rerender();
    });
    on('test-notif', () => api.notifyTest && api.notifyTest({ title: 'Hello from Atoll', body: 'Notifications appear right here.' }));
    on('ms-notif', () => api.setup.openWindowsSettings('notifications'));
    on('open-settings', () => { api.openSettings && api.openSettings(); finish(); });
  }

  $('#next').onclick = () => go(1);
  $('#back').onclick = () => go(-1);
  document.addEventListener('keydown', (e) => {
    if (/INPUT|SELECT|TEXTAREA/.test((document.activeElement || {}).tagName || '')) return;
    if (e.key === 'ArrowRight' || (e.key === 'Enter' && document.activeElement === document.body)) go(1);
    if (e.key === 'ArrowLeft') go(-1);
  });
  api.onStore((s) => { S.store = s; });
  if (api.onLyricsSources) api.onLyricsSources((x) => { S.sources = x; if (steps[S.i].id === 'lyrics' && !S.connecting) rerender(); });
  if (api.onToastsStatus) api.onToastsStatus((t) => { S.info.toasts = t; if (steps[S.i].id === 'notifications') rerender(); });

  // accent from the user's settings
  const c = st().accent || '#30d5c8';
  document.documentElement.style.setProperty('--accent', c);
  const n = parseInt(c.slice(1), 16);
  document.documentElement.style.setProperty('--accent-fg', 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) > 150 ? '#111' : '#fff');
  render(true);
})();
