// Atoll — the island, redesigned to behave like Alcove:
//  • closed it's a plain black notch; live activities grow out of its sides ("wings") and leave the
//    middle empty; a second activity splits off into its own little bubble
//  • hovering makes it breathe a little bigger, resting on it (or clicking) opens it
//  • swipe sideways on the closed notch to skip tracks, sideways on the open panel to change page,
//    down to open, up to close (trackpad / Shift+wheel / mouse wheel)
//  • HUDs (volume, caps lock, language, charging…) pop out of the sides; drag the volume bar
//  • notifications drop out of the notch, wait while you hover, then retract
//  • the open panel has no chrome: pages with dots; settings live in their own window
(async function () {
  const api = window.API;
  const I = window.ICONS;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const island = $('#island');
  const bubble = $('#bubble');
  const root = document.documentElement;

  const S = {
    store: await api.getStore(),
    hover: false, expanded: false, pinned: false, page: 'now', lastPage: 'now', lastPageAt: 0,
    media: { active: false }, mediaAt: 0, pausedAt: 0, art: null, artKey: null,
    lyrics: null, lyricsKey: null, lyricsRetryAt: 0, lyricsRequest: 0, lyricIdx: -1, homeLyrIdx: -2,
    hud: null, hudT: 0,
    notif: null, queue: [], notifT: 0, toastBusy: null,
    sys: null, battery: null, lowBatt: false,
    timer: { mode: 'focus', running: false, endAt: 0, remaining: null },
    cal: { events: [], error: null }, notified: new Set(),
    lastHoverAt: Date.now(), startedAt: Date.now(), lastWaterNudge: Date.now(),
    waterUndo: [], icons: new Map(), lastLayout: '', peek: false,
    remote: { tasks: [], error: null, loading: false, at: 0 }, snoozed: new Map(),
    offset: 0, top: 0, floating: false, cutout: null, moving: false, mode: 'top', side: 'right', center: 330,
    trans: null, transKey: null, clips: [], cbSel: 0, swX: 0, swY: 0, swAt: 0, wingKey: { l: '', r: '', u: '' }
  };
  const measurer = document.createElement('div'); measurer.id = 'c-measure'; document.body.appendChild(measurer);
  const st = () => S.store.settings;
  const setText = (el, t) => { if (el && el.textContent !== t) el.textContent = t; };
  const setHtml = (el, h) => { if (el && el.__h !== h) { el.__h = h; el.innerHTML = h; } };
  const save = (k) => api.setStore(k, S.store[k]);

  /* ---------------- helpers ---------------- */
  const pad = (n) => String(n).padStart(2, '0');
  const mmss = (sec) => { sec = Math.max(0, Math.round(sec)); return `${Math.floor(sec / 60)}:${pad(sec % 60)}`; };
  const hhmm = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
  const short = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
  const rel = (ms) => {
    const m = Math.round(ms / 60e3);
    if (m <= 0) return 'now';
    if (m < 60) return `in ${m} min`;
    const h = Math.floor(m / 60), r = m % 60;
    return `in ${h}h${r ? ' ' + r + 'm' : ''}`;
  };
  const dayLabel = (t) => {
    const d = new Date(t), now = new Date();
    const tom = new Date(); tom.setDate(now.getDate() + 1);
    if (sameDay(d, now)) return 'Today';
    if (sameDay(d, tom)) return 'Tomorrow';
    return d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
  };
  const langName = (code) => { try { return new Intl.DisplayNames(['en'], { type: 'language' }).of(code.toLowerCase()); } catch (_) { return code; } };
  const provider = (url) => /zoom\.us/.test(url) ? 'Zoom' : /teams\./.test(url) ? 'Teams' : /meet\.google/.test(url) ? 'Meet' : /webex/.test(url) ? 'Webex' : 'call';
  const ring = (frac, cls = '') => `<svg class="ring ${cls}" viewBox="0 0 20 20"><circle cx="10" cy="10" r="8" class="t"/><circle cx="10" cy="10" r="8" class="f" style="stroke-dashoffset:${(50.27 * (1 - Math.max(0, Math.min(1, frac)))).toFixed(2)}"/></svg>`;

  function chime(kind = 'done') {
    try {
      const ctx = new AudioContext();
      const notes = kind === 'done' ? [659.25, 880, 1318.5] : [880, 659.25];
      notes.forEach((f, i) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'sine'; o.frequency.value = f;
        const t = ctx.currentTime + i * 0.16;
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.18, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
        o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + 1);
      });
      setTimeout(() => ctx.close(), 2000);
    } catch (_) {}
  }

  function applyLook() {
    root.dataset.theme = st().theme === 'light' ? 'light' : 'dark';
    document.body.classList.toggle('lite', st().lite !== false);
    document.body.classList.toggle('nogpu', st().gpu === false); // software drawing: no blur, no shadows (they leave ghosts)
    root.style.setProperty('--accent', st().accent || '#30d5c8');
  }
  function applyLyricSize() {
    const n = Math.max(14, Math.min(40, st().lyricSize || 26));
    root.style.setProperty('--lyr-size', n + 'px');
  }

  /* ---------------- live activities ---------------- */
  const NOTCH = { w: 196, h: 32 };
  function nextMeeting(withinMs) {
    const now = Date.now();
    return (S.cal.events || []).find((e) => !e.allDay && e.end > now && (withinMs == null || e.start - now <= withinMs));
  }
  const artOk = () => S.media.active && S.art && S.artKey === S.media.key;
  const vizHtml = (n = 4) => `<span class="viz ${st().smoothViz === false ? '' : 'smooth'} ${S.media.playing ? '' : 'paused'}">${'<i></i>'.repeat(n)}</span>`;

  // Everything that wants to live in the closed notch, most important first.
  // The first one owns the wings; the second gets the split bubble.
  function activities() {
    const out = [];
    const now = Date.now();
    const soon = nextMeeting(5 * 60e3);
    if (soon) {
      const left = soon.start - now;
      out.push({
        kind: 'meeting', wing: 98,
        l: `<span class="ico acc">${I.calendar}</span><span class="txt">${esc(short(soon.title, 12))}</span>`,
        r: `<span class="txt acc">${left <= 0 ? 'now' : Math.max(1, Math.round(left / 60e3)) + 'm'}</span>`,
        b: `<span class="acc">${I.calendar}</span>`
      });
    }
    if (S.timer.running) {
      const rem = timerRemaining(), frac = rem / modeLen(S.timer.mode);
      out.push({
        kind: 'timer', wing: 64,
        l: ring(frac), r: `<span class="txt ${S.timer.mode === 'focus' ? 'acc' : ''}">${mmss(rem)}</span>`,
        b: ring(frac)
      });
    }
    const playing = S.media.active && S.media.playing;
    if (playing || (S.media.active && now - S.pausedAt < 8000)) {
      // The lyric row under the notch stays while the song has synced lyrics: an instrumental part (or
      // the intro / outro) shows animated dots instead of the row collapsing and coming back. It also
      // stays while the next song's lyrics load, and only goes when a song really has no lyrics.
      let under = null;
      const L = S.lyrics;
      if (st().lyricsInNotch && playing) {
        if (L && L.synced) { const line = currentLyric(); under = line && line !== '♪' ? { text: line, tr: currentTranslation(), rm: transFor(lyricIndex()).rm } : { gap: true }; }
        else if (L && L.loading && S.hadUnder) under = { gap: true };
      }
      S.hadUnder = !!under;
      out.push({
        kind: 'music', wing: 56,
        l: artOk() ? `<img class="art" src="${S.art}" alt="">` : `<span class="bot">${I.bot}</span>`,
        r: vizHtml(4),
        b: artOk() ? `<img src="${S.art}" alt="">` : I.music,
        under
      });
    }
    return out;
  }

  /* ---------------- layout ---------------- */
  // Open panel size per page (CSS px; S/M/L zooms the whole page).
  const PAGE_SIZE = { now: { w: 480, h: 196 }, lyrics: { w: 560, h: 306 }, today: { w: 600, h: 306 }, clipboard: { w: 580, h: 336 }, files: { w: 560, h: 256 } };
  // Two layouts (Settings → Appearance → Layout):
  //  • Pages: Alcove-style, no chrome, page dots with small ‹ › buttons
  //  • Tabs: the classic look, a clock + tab bar + pin across the top, Home shows player + lyrics + cards
  const isTabs = () => st().layout === 'tabs';
  const TABS = [['home', 'home', 'Home'], ['lyrics', 'lyrics', 'Lyrics'], ['files', 'shelf', 'Files'], ['clipboard', 'clipboard', 'Clipboard'],
    ['calendar', 'calendar', 'Calendar'], ['tasks', 'todo', 'Tasks'], ['focus', 'timer', 'Focus'], ['stats', 'stats', 'Stats']];
  const SIDE_TABS = [['now', 'home', 'Now playing'], ['files', 'shelf', 'Files'], ['clipboard', 'clipboard', 'Clipboard'], ['tasks', 'todo', 'Tasks']];
  const tabList = () => (S.mode === 'side' ? SIDE_TABS : TABS);
  const pagesFor = () => (S.mode === 'side' ? ['now', 'files', 'clipboard', 'tasks'] : isTabs() ? TABS.map((t) => t[0]) : ['now', 'lyrics', 'today', 'clipboard', 'files']);
  // Tasks and Focus (tabs layout) are two views of the Today page
  const pageEl = (pg) => $(`.page[data-page="${pg === 'tasks' || pg === 'focus' ? 'today' : pg}"]`);
  const TABS_SIZE = { w: 700, h: 356 };
  // the open panel's content box in the Pages layout: big enough for every page
  for (const size of Object.values(PAGE_SIZE)) size.h += 14;
  const PANEL_ENVELOPE = { w: Math.max(...Object.values(PAGE_SIZE).map((p) => p.w)), h: Math.max(...Object.values(PAGE_SIZE).map((p) => p.h)) };
  // Pages layout (top): each page keeps its own size and is centred under the notch inside the panel
  function placePages(cx, ax) {
    const own = S.mode !== 'side' && !isTabs();
    for (const name of ['now', 'lyrics', 'today', 'clipboard', 'files', 'home', 'calendar', 'stats']) {
      const el = $(`.page[data-page="${name}"]`); if (!el) continue;
      const ps = PAGE_SIZE[name];
      const key = own && ps ? `${Math.round(cx - ps.w / 2) - ax}|${ps.w}|${ps.h}` : '';
      if (el.__place === key) continue;
      el.__place = key;
      if (key) { el.style.setProperty('--px', (Math.round(cx - ps.w / 2) - ax) + 'px'); el.style.setProperty('--pw', ps.w + 'px'); el.style.setProperty('--ph', ps.h + 'px'); }
      else { el.style.removeProperty('--px'); el.style.removeProperty('--pw'); el.style.removeProperty('--ph'); }
    }
  }
  const TABBAR_H = 46;
  const lyricsShown = () => S.expanded && (S.page === 'lyrics' || (S.page === 'home' && isTabs() && S.mode !== 'side'));
  const playerShown = () => S.expanded && (S.page === 'now' || (S.page === 'home' && isTabs()));

  function layout() {
    if (S.mode === 'side') return layoutSide();
    const s = st();
    const cls = [];
    const acts = activities();
    let state, w, h, r, primary = null;
    const camera = S.cutout;
    const center = window.innerWidth / 2 + S.offset;
    const rowBottom = camera ? Math.max(0, camera.y + camera.height - S.top) : 0;
    const overlapsCamera = (width) => {
      if (!camera || !rowBottom) return false;
      const left = Math.round(Math.max(12, Math.min(window.innerWidth - width - 12, center - width / 2)));
      return left < camera.x + camera.width && left + width > camera.x;
    };
    const wing = S.hud?.wing || acts[0]?.wing || (s.mascot ? 32 : 0);
    const compactWidth = Math.max(196 + wing * 2, acts[0]?.under ? 420 : 0);
    const compactCamera = overlapsCamera(compactWidth);
    const gap = camera ? Math.ceil(camera.width + 2 * Math.abs(camera.x + camera.width / 2 - center) + 16) : 196;
    // The physical housing never scales with Atoll. Reserve its measured width in CSS pixels
    // so album art, text and HUD controls stay in the two visible wings at every zoom level.
    const wingsFit = compactCamera && gap + wing * 2 <= window.innerWidth - 24;
    NOTCH.w = wingsFit ? Math.max(196, gap) : 196;
    NOTCH.h = wingsFit ? Math.max(32, Math.ceil(rowBottom) + 4) : 32;
    root.style.setProperty('--wing-h', NOTCH.h + 'px');
    root.style.setProperty('--camera-gap', NOTCH.w + 'px');
    root.style.setProperty('--under-top', (NOTCH.h + 2) + 'px');

    if (S.moving) { state = 'mover'; w = 300; h = 46; r = 23; }
    else if (S.notif) { state = 'notif'; w = S.notif.image ? 440 : 400; h = 84; r = 30; }
    else if (S.expanded) { const p = isTabs() ? TABS_SIZE : PAGE_SIZE[S.page] || PAGE_SIZE.now; state = 'panel'; w = p.w; h = p.h; r = 30; }
    else if (S.hud) { state = 'hud'; w = NOTCH.w + 2 * S.hud.wing; h = NOTCH.h; r = 14; renderHud(); }
    else if (acts.length) {
      primary = acts[0];
      state = 'compact'; w = NOTCH.w + 2 * primary.wing; h = NOTCH.h; r = 14;
      if (primary.under) { // optional lyric line under the wings: grows with the line
        w = Math.max(w, 420);
        const u = primary.under;
        measurer.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;width:' + (w-28) + 'px;font:600 14px/19px var(--font-d);white-space:normal;overflow-wrap:anywhere';
        measurer.innerHTML = u.gap ? '♪' : esc(u.text) + [u.rm,u.tr].filter(Boolean).map(t => '<small style="display:block;font:500 12px/16px var(--font)">' + esc(t) + '</small>').join('');
        if (!u.gap) S.underHeight = Math.min(152, measurer.offsetHeight);
        h = NOTCH.h + 8 + (S.underHeight || 19) + 6; r = 22;
      }
      renderCompact(primary);
    } else {
      state = 'compact'; w = NOTCH.w + (wingsFit && s.mascot ? 64 : 0); h = NOTCH.h; r = 12; cls.push('idle');
      renderCompact(null);
      if (s.minimal) { w = wingsFit ? NOTCH.w : 150; h = wingsFit ? NOTCH.h : 6; r = wingsFit ? 12 : 3; cls.push('minimal'); }
    }
    if (S.peek && state === 'compact') cls.push('peek');
    if (isTabs()) cls.push('tabs');
    // hover: the notch swells a little (Alcove: ~9% wider, +5 px), content stays put
    const base = { w, h };
    // Grow the SAME edge-attached shape around an empty camera header. Only the content moves
    // below the housing; the shell, ears and spring still start at the physical screen edge.
    const contentTop = overlapsCamera(w) && (['panel', 'notif', 'mover'].includes(state) || !wingsFit) ? Math.ceil(rowBottom) + 6 : 0;
    h += contentTop;
    if (overlapsCamera(w)) cls.push('camera');
    if (S.hover && !S.buttonsOut && (state === 'compact' || state === 'hud') && !S.expanded && !S.moving && !cls.includes('minimal')) { cls.push('breathe'); w += 18; h += 5; }
    const x = Math.round(Math.max(12, Math.min(window.innerWidth - w - 12, window.innerWidth / 2 + S.offset - w / 2)));
    const y = Math.round(Math.max(0, Math.min(S.top, window.innerHeight - h - 8)));
    if (S.floating) cls.push('floating');
    if (S.moving) cls.push('moving');
    // the split bubble for a 2nd activity
    const second = state === 'compact' && !cls.includes('peek') && acts[1] ? acts[1] : null;
    const edge = state === 'compact' && S.peek && !S.floating;
    const hw = edge ? Math.max(w, 420) : w;
    const hit = { x: Math.max(0, x + w / 2 - hw / 2), y, w: hw + (second ? 40 : 0), h: edge ? 6 : Math.max(h, 12) };
    applyGeom(state, w, h, r, x, y, cls, hit, second, base, contentTop);
  }

  // One spring system drives the whole shape (position, size, corners, ears, shadow), so everything moves
  // together, and an interrupted animation bends towards the new target keeping its speed.
  // The shape is a clip over a still shell: per frame only the clip, the shadow box and the two ears
  // change. Content layers are placed once per state and never move, so text can't shimmer at any
  // display scaling, and the edges can move in fractions of a pixel (smoother than whole-pixel steps).
  const shellEl = $('#shell'), shadeEl = $('#shade'), earEls = $$('#island > .ear');
  const layerEls = Object.fromEntries(['compact', 'hud', 'notif', 'panel', 'mover', 'side'].map((id) => [id, $('#' + id)]));
  let vw = window.innerWidth, vh = window.innerHeight;
  const px = (n) => n.toFixed(2) + 'px';
  const geo = window.Motion.animator((g) => {
    const x = g.x, y = g.y, w = Math.max(0, g.w), h = Math.max(0, g.h);
    const r = Math.max(0, Math.min(g.r, w / 2, h));
    const rr = px(r);
    const radii = island.classList.contains('floating') ? rr : S.mode === 'side' ? (S.side === 'left' ? `0 ${rr} ${rr} 0` : `${rr} 0 0 ${rr}`) : `0 0 ${rr} ${rr}`;
    shellEl.style.clipPath = `inset(${px(y)} ${px(vw - x - w)} ${px(vh - y - h)} ${px(x)} round ${radii})`;
    const sh = Math.max(0, Math.min(1, g.s));
    const sd = shadeEl.style;
    if (sh > 0.005 || island.classList.contains('moving') || island.classList.contains('floating')) {
      sd.visibility = 'visible'; sd.left = px(x); sd.top = px(y); sd.width = px(w); sd.height = px(h); sd.borderRadius = radii;
      const shs = sh.toFixed(2); if (shadeEl.__s !== shs) { shadeEl.__s = shs; sd.setProperty('--s', shs); }
    } else if (sd.visibility !== 'hidden') sd.visibility = 'hidden'; // no shadow to draw: skip it entirely
    const e = Math.max(0, g.e);
    const es = px(e);
    if (earEls[0].__e !== es) { for (const el of earEls) { el.__e = es; el.style.setProperty('--e', es); } }
    const [eL, eR] = earEls;
    if (S.mode === 'side') {
      const ex = S.side === 'left' ? x : x + w - e;
      eL.style.left = px(ex); eL.style.top = px(y - e); eR.style.left = px(ex); eR.style.top = px(y + h);
    } else {
      eL.style.left = px(x - e); eL.style.top = px(y); eR.style.left = px(x + w); eR.style.top = px(y);
    }
  }, { x: (window.innerWidth - NOTCH.w) / 2, y: 0, w: NOTCH.w, h: NOTCH.h, r: 12, e: 6, s: 0 },
  // once the shape has settled, ask Windows to repaint the whole window: some drivers leave faint
  // ghosts of shadows/blur in transparent windows otherwise
  () => { clearTimeout(S.repaintT); S.repaintT = setTimeout(() => api.repaint && api.repaint(), 60); });
  const BIG = new Set(['panel', 'notif']);
  window.addEventListener('resize', () => { vw = window.innerWidth; vh = window.innerHeight; S.lastLayout = ''; layout(); });
  // the shape's current rectangle (tests, dragging)
  const shapeRect = () => { const g = geo.get(); return { x: g.x, y: g.y, width: g.w, height: g.h }; };

  function applyGeom(state, w, h, r, x, y, cls, hit, second, base = { w, h }, contentTop = 0) {
    // bubble
    bubble.classList.toggle('on', !!second);
    bubble.classList.toggle('floating', S.floating);
    if (second) { setHtml($('#b-in'), second.b); bubble.style.left = (x + w + 8) + 'px'; bubble.style.top = (y + contentTop) + 'px'; }
    const key = [state, w, h, x, y, ...cls, second ? second.kind : ''].join('|');
    if (key === S.lastLayout) return;
    S.lastLayout = key;
    const prev = S.geomState || 'compact';
    const prevBase = S.geomBase || base;
    S.geomState = state; S.geomBase = base;
    // which spring: opening (lively, small overshoot), closing (no bounce), hover swell, or a shape change
    let preset;
    if (state === prev && base.w === prevBase.w && base.h === prevBase.h) preset = 'breathe';
    else if (BIG.has(state) && !BIG.has(prev)) preset = 'open';
    else if (BIG.has(prev) && !BIG.has(state)) preset = 'close';
    else preset = w * h >= (S.prevArea || 0) ? 'morph' : 'close';
    S.prevArea = w * h;
    if (S.dragging) preset = 'snap';
    island.className = `state-${state} ${cls.join(' ')}`;
    // The new content is laid out at its final size right away, at a fixed whole-pixel spot on screen;
    // the growing shape reveals it. The open panel is one fixed size whatever the page (pages are placed
    // inside it), so switching pages never moves or re-lays out what's on screen.
    const layer = layerEls[state];
    let lw = base.w, lh = base.h;
    if (state === 'panel' && S.mode !== 'side') { const e = isTabs() ? TABS_SIZE : PANEL_ENVELOPE; lw = e.w; lh = e.h; }
    const cx = x + w / 2, cy = y + h / 2;
    const ax = S.mode === 'side' ? (S.side === 'left' ? Math.round(x) : Math.round(x + w - lw)) : Math.round(cx - lw / 2);
    const ay = S.mode === 'side' ? Math.round(cy - lh / 2) : Math.round(y + contentTop);
    if (state !== prev || layer.__ax !== ax || layer.__ay !== ay || layer.__lw !== lw || layer.__lh !== lh) {
      layer.__ax = ax; layer.__ay = ay;
      layer.__lw = lw; layer.__lh = lh;
      layer.style.setProperty('--lw', lw + 'px');
      layer.style.setProperty('--lh', lh + 'px');
      layer.style.setProperty('--in-delay', preset === 'open' ? '.05s' : '.02s');
      layer.style.left = ax + 'px'; layer.style.top = ay + 'px'; // placed once: never moved while the shape animates
    }
    if (state === 'panel') { // page dots, gear and tips sit on the panel's final edges; the shape reveals them
      const dr = $('#dots-row').style; dr.left = x + 'px'; dr.width = w + 'px'; dr.top = (y + h - 34) + 'px';
      const gr = $('#gear').style; gr.left = (x + w - 36) + 'px'; gr.top = (y + h - 39) + 'px';
      const tp = $('#panel-tip').style; tp.left = (x + w / 2) + 'px'; tp.top = (y + contentTop + 10) + 'px';
    }
    if (state === 'panel') placePages(cx, ax);
    for (const id of ['compact', 'hud', 'notif', 'panel', 'mover', 'side']) $('#' + id).classList.toggle('on', id === state);
    const big = BIG.has(state);
    const minimal = cls.includes('minimal');
    geo.to({ x, y, w, h, r, e: minimal || S.floating ? 0 : big ? 12 : 6, s: big ? 1 : 0 }, preset, { s: 'close', e: preset === 'breathe' ? 'breathe' : 'close' });
    api.setHitRect(hit);
  }

  function renderCompact(a) {
    if (!a) { // idle: a plain notch (the mascot's eyes if you turned them on)
      setHtml($('#wl'), '');
      setHtml($('#wr'), st().mascot ? '<span class="eyes"><i></i><i></i></span>' : '');
      setHtml($('#c-under'), '');
      return;
    }
    setHtml($('#wl'), a.l);
    // keep the visualizer element alive across updates (re-creating it would restart its animation)
    const rk = a.kind === 'music' ? 'viz:' + (st().smoothViz === false ? 's' : 'm') + (S.media.playing ? 'p' : 'x') : a.r;
    if (S.wingKey.r !== rk) { S.wingKey.r = rk; $('#wr').innerHTML = a.r; $('#wr').__h = a.r; }
    const u = !a.under ? '' : a.under.gap ? '<span class="gapdots"><i></i><i></i><i></i></span>' : `${esc(a.under.text)}${a.under.rm ? `<small class="rm">${esc(a.under.rm)}</small>` : ''}${a.under.tr ? `<small>${esc(a.under.tr)}</small>` : ''}`;
    const ue = $('#c-under');
    if (ue.__h !== u) {
      ue.classList.add('swap');
      setTimeout(() => { ue.innerHTML = u; ue.scrollTop = 0; ue.__h = u; ue.classList.remove('swap'); }, 150);
      ue.__h = u;
    }
  }

  /* ---------------- side mode ---------------- */
  const sidePanel = () => {
    const p = st().sidePanel || {};
    return { w: Math.max(300, Math.min(560, p.w || 380)), h: Math.max(300, Math.min(window.innerHeight - 16, p.h || 480)) };
  };
  function layoutSide() {
    root.style.setProperty('--wing-h', '32px');
    const playing = S.media.active && S.media.playing;
    const cls = ['side', 'side-' + S.side];
    if (isTabs()) cls.push('tabs');
    if (S.floating) cls.push('floating');
    let state, w, h, r;
    if (S.moving) { state = 'mover'; w = 300; h = 46; r = 23; }
    else if (S.notif) { state = 'notif'; w = S.notif.image ? 440 : 380; h = 84; r = 26; }
    else if (S.expanded) { const p = sidePanel(); state = 'panel'; w = p.w; h = isTabs() ? (S.page === 'now' ? 226 : p.h + 18) : (S.page === 'now' ? 206 : p.h); r = 26; }
    else if (S.hud) { state = 'hud'; w = 2 * S.hud.wing + 40; h = 40; r = 20; renderHud(); }
    else {
      state = 'side'; w = 42; h = playing || S.timer.running ? 150 : 118; r = 21;
      if (playing) cls.push(artOk() ? 's-has-art' : 's-has-bot');
      if (playing && !S.timer.running) cls.push('s-has-eq');
      if (S.timer.running) cls.push('s-has-timer');
      if (S.peek) cls.push('peek');
      const now = new Date();
      setText($('#s-hh'), pad(now.getHours())); setText($('#s-mm'), pad(now.getMinutes()));
      if (!$('#s-bot').innerHTML) $('#s-bot').innerHTML = I.bot;
      if (artOk() && $('#s-art').src !== S.art) $('#s-art').src = S.art;
      if (S.timer.running) setText($('#s-timer'), mmss(timerRemaining()));
      { const c = `viz ${st().smoothViz === false ? '' : 'smooth'} ${S.media.playing ? '' : 'paused'}`; if ($('#s-eq').className !== c) $('#s-eq').className = c; }
    }
    if (S.moving) cls.push('moving');
    const base = { w, h };
    if (S.hover && !S.buttonsOut && (state === 'side' || state === 'hud') && !S.expanded && !S.moving) { cls.push('breathe'); w += 5; h += 18; }
    const x = S.side === 'left' ? 0 : window.innerWidth - w;
    const y = Math.round(Math.max(8, Math.min(window.innerHeight - h - 8, S.center - h / 2)));
    const peekEdge = state === 'side' && S.peek;
    const hit = peekEdge ? { x: S.side === 'left' ? 0 : window.innerWidth - 6, y: y - 30, w: 6, h: h + 60 } : { x, y, w, h };
    applyGeom(state, w, h, r, x, y, cls, hit, null, base);
  }

  const hoverDelayMs = () => { const d = Number(st().hoverDelay); return Math.round(1000 * (Number.isFinite(d) ? Math.max(0, Math.min(0.6, d)) : 0.3)); };

  /* ---------------- open / close / pages ---------------- */
  function choosePage() {
    const pages = pagesFor();
    if (Date.now() - S.lastPageAt < 60000 && pages.includes(S.lastPage)) return S.lastPage;
    if (S.mode === 'side') return 'now';
    if (isTabs()) return 'home';
    return S.media.active ? 'now' : 'today';
  }
  // Opening: the shape starts moving in this very frame; the page's content was usually prepared
  // during the hover delay, otherwise it's filled in on the next frame (it fades in a little later
  // anyway), so building a long list can never hold the animation back.
  function open(page, { pin = false } = {}) {
    if (S.moving) return;
    clearTimeout(S.openT);
    S.page = pagesFor().includes(page) ? page : choosePage();
    S.expanded = true;
    if (pin) S.pinned = true;
    const ready = S.prepared && S.prepared.page === S.page && Date.now() - S.prepared.at < 4000;
    S.prepared = null;
    const pages = $('#pages');
    pages.classList.add('instant'); // the panel fades in as one piece: no second, per-page animation
    const el = pageEl(S.page);
    $$('.page').forEach((p) => { p.classList.toggle('on', p === el); p.classList.remove('from-l', 'from-r'); });
    renderNav();
    layout();
    if (ready && lyricsShown()) { S.homeLyrIdx = -2; S.lyricIdx = -1; updateLyrics(true); } // centre the sung line now that it's visible
    requestAnimationFrame(() => {
      if (S.expanded) { renderPanel(true); if (playerShown()) renderProgress(); }
      requestAnimationFrame(() => pages.classList.remove('instant'));
    });
  }
  // build the page we're about to open while the pointer rests on the notch
  function prepareOpen() {
    if (S.expanded || S.moving) return;
    const pg = choosePage();
    if (!pagesFor().includes(pg)) return;
    if (S.prepared && S.prepared.page === pg && Date.now() - S.prepared.at < 4000) return;
    S.page = pg;
    renderPanel(true);
    S.prepared = { page: pg, at: Date.now() };
  }
  function close() {
    if (!S.expanded) return;
    S.expanded = false; S.pinned = false;
    S.lastPage = S.page; S.lastPageAt = Date.now();
    S.dragging = false; $('#pages').style.transform = '';
    stopStats();
    const a = document.activeElement; if (a && a.blur) a.blur();
    layout();
  }
  function holdOpen() {
    const a = document.activeElement;
    return S.pinned || S.dragging || S.pressInside || (a && a.tagName === 'INPUT' && a.closest('#panel') && a.value);
  }
  function goPage(to, { wrap = false } = {}) {
    const pages = pagesFor();
    const cur = pages.indexOf(S.page);
    let idx = typeof to === 'number' ? cur + to : pages.indexOf(to);
    if (wrap) idx = (idx + pages.length) % pages.length;
    idx = Math.max(0, Math.min(pages.length - 1, idx));
    if (idx < 0 || idx === cur) {
      // at the end: a little rubber-band
      $('#pages').animate([{ transform: 'translateX(0)' }, { transform: `translateX(${typeof to === 'number' ? -to * 14 : 0}px)` }, { transform: 'translateX(0)' }], { duration: 320, easing: 'ease-out' });
      return;
    }
    const dir = idx > cur ? 1 : -1;
    const oldEl = pageEl(S.page), newEl = pageEl(pages[idx]);
    S.page = pages[idx];
    if (oldEl !== newEl) {
      newEl.classList.remove('on', 'from-l', 'from-r'); newEl.classList.add(dir > 0 ? 'from-r' : 'from-l');
      void newEl.offsetWidth;
      if (oldEl) { oldEl.classList.remove('on', 'from-l', 'from-r'); oldEl.classList.add(dir > 0 ? 'from-l' : 'from-r'); }
      newEl.classList.add('on'); newEl.classList.remove('from-l', 'from-r');
    }
    renderNav(); renderPanel(false); layout();
  }
  // page dots (Pages layout) or the tab bar (Tabs layout)
  function renderNav() {
    const pages = pagesFor();
    if (!isTabs()) {
      const labels = { tasks: 'Tasks', now: 'Playing', lyrics: 'Lyrics', today: 'Today', clipboard: 'Clipboard', files: 'Files' };
      setHtml($('#dots'), pages.map((p) => `<button data-p="${p}" title="${labels[p]}" aria-label="${labels[p]}"><span>${labels[p]}</span></button>`).join(''));
      $$('#dots button').forEach((b) => { b.classList.toggle('on', b.dataset.p === S.page); b.setAttribute('aria-current', b.dataset.p === S.page ? 'page' : 'false'); });
      return;
    }
    const html = tabList().map(([id, icon, label]) => `<button data-p="${id}" title="${label}">${I[icon]}</button>`).join('') +
      `<button data-act="settings" title="Settings">${I.gear}</button>`;
    setHtml($('#tabs'), html);
    $$('#tabs [data-p]').forEach((b) => { b.classList.toggle('on', b.dataset.p === S.page); b.classList.toggle('dot', b.dataset.p === 'focus' && S.timer.running); });
    $('#pin').classList.toggle('on', !!S.pinned);
  }
  const renderDots = renderNav;
  $('#dots').addEventListener('click', (e) => { const b = e.target.closest('[data-p]'); if (b) goPage(b.dataset.p); });
  $('#pg-prev').innerHTML = I.chevL; $('#pg-next').innerHTML = I.chevR;
  $('#pg-prev').addEventListener('click', (e) => { e.stopPropagation(); goPage(-1, { wrap: true }); });
  $('#pg-next').addEventListener('click', (e) => { e.stopPropagation(); goPage(1, { wrap: true }); });
  $('#tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.act === 'settings') { close(); if (api.openSettings) api.openSettings(); return; }
    goPage(b.dataset.p);
  });
  $('#pin').innerHTML = I.pin;
  $('#pin').addEventListener('click', () => { S.pinned = !S.pinned; $('#pin').classList.toggle('on', S.pinned); });

  // Where the shared pieces live for the current layout: the player sits on Home in Tabs and on Now
  // Playing in Pages; the lyrics sit beside it on Home, and on their own page otherwise.
  function applyLayoutDom() {
    const tabs = isTabs();
    $('#tabbar').hidden = !tabs;
    const music = $('#music');
    const want = tabs && S.mode !== 'side' ? $('#home-player') : $('.page[data-page="now"]');
    if (music.parentElement !== want) want.appendChild(music);
    placeLyrics();
  }
  function placeLyrics() {
    const want = isTabs() && S.mode !== 'side' && S.page === 'home' ? $('#home-lyr') : $('.page[data-page="lyrics"]');
    const ly = $('#m-lyrics');
    if (ly.parentElement !== want) { want.appendChild(ly); S.homeLyrIdx = -2; requestAnimationFrame(() => placeHomeLyrics(true)); }
  }

  function renderPanel(first) {
    if (first) { const el = pageEl(S.page); $$('.page').forEach((p) => { p.classList.toggle('on', p === el); p.classList.remove('from-l', 'from-r'); }); }
    placeLyrics();
    const today = $('.today');
    today.classList.toggle('only-tasks', S.page === 'tasks');
    today.classList.toggle('only-widgets', S.page === 'focus');
    if (S.page !== 'stats') stopStats();
    const lyrics = () => { if ($('#m-lyr').dataset.released || !$('#m-lyr').children.length) { delete $('#m-lyr').dataset.released; renderHomeLyrics(); } updateLyrics(true); };
    switch (S.page) {
      case 'now': renderMusic(); break;
      case 'home': renderMusic(); renderHomeRow(); lyrics(); break;
      case 'lyrics': renderLyricsHead(); lyrics(); break;
      case 'today': case 'tasks': case 'focus': renderToday(); if (Date.now() - S.remote.at > 15e3) loadRemote(); break;
      case 'clipboard': loadClips(); renderClips(); break;
      case 'files': renderShelf(); break;
      case 'calendar': renderCalPage(); break;
      case 'stats': startStats(); break;
    }
  }

  /* ---------------- pointer: hover, click, swipe, drag ---------------- */
  // Pointer buttons. A press that starts on the island (scrubbing, dragging a page, selecting text,
  // dragging the volume) keeps it open and responsive until you let go, wherever the pointer goes.
  // Something dragged in from elsewhere (a window, a text selection) passes over without opening it.
  S.pressInside = false; S.buttonsOut = false;
  function setPress(on) {
    if (S.pressInside === on) return;
    S.pressInside = on;
    if (api.holdPointer) api.holdPointer(on);
    if (!on) {
      // released: undo anything a lost pointer-up could leave half-done
      if (S.dragging) { S.dragging = false; const pg = $('#pages'); pg.style.transition = 'transform .3s var(--ease-content)'; pg.style.transform = ''; setTimeout(() => (pg.style.transition = ''), 320); }
      if (!S.hover && S.expanded && !S.pinned) { clearTimeout(S.leaveT); S.leaveT = setTimeout(() => { if (!S.hover && !S.pressInside && S.expanded && !holdOpen()) close(); }, 120); }
    }
  }
  island.addEventListener('pointerdown', () => setPress(true), true);
  bubble.addEventListener('pointerdown', () => setPress(true), true);
  window.addEventListener('pointerup', () => setPress(false), true);
  window.addEventListener('pointercancel', () => setPress(false), true);
  window.addEventListener('blur', () => setPress(false));
  window.addEventListener('mousemove', (e) => {
    const held = e.buttons !== 0 && !S.pressInside;
    if (S.buttonsOut && !held) { S.buttonsOut = false; if (S.hover) startHover(); }
    S.buttonsOut = held;
  }, true);

  function startHover() {
    clearTimeout(S.openT);
    if (S.moving || S.expanded) return;
    if (S.notif) { clearTimeout(S.notifT); return; }
    if (S.buttonsOut) return; // dragging something across: leave it alone
    if ((st().openOn || 'hover') !== 'hover') { layout(); return; }
    // Alcove waits a moment before opening (the notch swells meanwhile); Settings → General → Hover delay
    const dwell = () => {
      if (!S.hover || S.expanded || S.moving || S.notif || S.buttonsOut) return;
      if (S.hud || S.hudHold) { S.openT = setTimeout(dwell, 250); return; } // a HUD is out: let you use it (drag the volume)
      open();
    };
    const delay = hoverDelayMs();
    layout();
    if (delay <= 0 && !S.hud) { dwell(); return; }
    S.openT = setTimeout(dwell, delay);
    // let the swell finish first (~180 ms), then use the rest of the wait to build the page
    if (delay >= 260) setTimeout(() => { if (S.hover && !S.expanded) prepareOpen(); }, Math.min(190, delay - 60));
  }

  api.onHover((v) => {
    S.hover = v;
    clearTimeout(S.leaveT); clearTimeout(S.openT);
    if (v) {
      S.lastHoverAt = Date.now();
      startHover();
      return;
    }
    if (S.notif) armNotifTimer(Math.min(S.notif.ms || 4000, 2500));
    S.leaveT = setTimeout(() => { if (!S.hover && !S.pressInside && S.expanded && !holdOpen()) close(); }, 120);
    layout();
  });
  window.addEventListener('blur', () => { setTimeout(() => { if (S.expanded && !S.hover && !S.pressInside) close(); }, 80); });

  island.addEventListener('click', (e) => {
    if (S.moving || e.altKey || S.expanded || S.notif || S.mode === 'side' && !S.hover) return;
    if (S.hud && e.target.closest('.bar')) return;
    open();
  });
  island.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (S.expanded) return;
    if (api.notchMenu) api.notchMenu(); else setMoving(true);
  });

  // Wheel / trackpad gestures
  island.addEventListener('wheel', (e) => {
    if (S.moving) return;
    const now = performance.now();
    if (now - S.swAt > 400) { S.swX = 0; S.swY = 0; }
    S.swAt = now;
    const horiz = Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey;
    const dx = e.deltaX || (e.shiftKey ? e.deltaY : 0);
    const lyricScroll = e.target.closest('.c-under, #m-lyr li');
    if (!horiz && lyricScroll && lyricScroll.scrollHeight > lyricScroll.clientHeight) return;
    if (!S.expanded) {
      if (S.hud && S.hud.kind === 'volume' && !horiz) { e.preventDefault(); setVolume((S.sys ? S.sys.volume : 50) + (e.deltaY < 0 ? 2 : -2)); return; }
      if (horiz) {
        S.swX += dx;
        if (Math.abs(S.swX) > 70 && S.media.active && !S.swLock) { // swipe → next / previous track
          const next = S.swX > 0;
          api.media(next ? 'next' : 'prev');
          const c = $('#compact'); c.classList.remove('nudge-next', 'nudge-prev'); void c.offsetWidth; c.classList.add(next ? 'nudge-next' : 'nudge-prev');
          S.swLock = true; setTimeout(() => (S.swLock = false), 600); S.swX = 0;
        }
      } else if (e.deltaY > 25) open(); // swipe down opens
      e.preventDefault();
      return;
    }
    if (horiz) {
      e.preventDefault();
      S.swX += dx;
      if (Math.abs(S.swX) > 80 && !S.swLock) { goPage(S.swX > 0 ? 1 : -1); S.swLock = true; setTimeout(() => (S.swLock = false), 420); S.swX = 0; }
      return;
    }
    if (e.target.closest('.dots')) { e.preventDefault(); if (!S.swLock) { goPage(e.deltaY > 0 ? 1 : -1); S.swLock = true; setTimeout(() => (S.swLock = false), 300); } return; }
    // swipe up at the top of the panel closes it
    const sc = e.target.closest('.scroll, #t-list, #m-lyr.plain');
    if (e.deltaY < 0 && (!sc || sc.scrollTop <= 0)) {
      S.swY += e.deltaY;
      if (S.swY < -140) { S.swY = 0; S.pinned = false; close(); }
    }
  }, { passive: false });

  // Drag the open panel sideways to change page (content follows the pointer a little)
  $('#pages').addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('button, input, .cb, .file, #m-bar, li, a, .np-art, .widget, #m-lyr')) return;
    const x0 = e.clientX; let dx = 0;
    const pages = $('#pages');
    S.dragging = true;
    const move = (ev) => { dx = ev.clientX - x0; pages.style.transform = `translateX(${dx * 0.3}px)`; };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      S.dragging = false;
      pages.style.transition = 'transform .35s var(--ease-content)'; pages.style.transform = '';
      setTimeout(() => (pages.style.transition = ''), 360);
      if (Math.abs(dx) > 60) goPage(dx < 0 ? 1 : -1);
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  });

  document.addEventListener('keydown', (e) => {
    if (S.moving && e.key.startsWith('Arrow') && api.nudge) {
      e.preventDefault();
      const step = e.shiftKey ? 20 : 2;
      api.nudge({ ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key]);
      clearTimeout(S.moveT); S.moveT = setTimeout(() => setMoving(false), 60000);
      return;
    }
    if (e.key === 'Escape' || (S.moving && e.key === 'Enter')) { if (S.moving) setMoving(false); close(); return; }
    const inInput = e.target && e.target.tagName === 'INPUT';
    if (!S.expanded || inInput) return;
    if (e.key === 'ArrowRight') goPage(1);
    if (e.key === 'ArrowLeft') goPage(-1);
    if (e.key === ' ' && (S.page === 'now' || S.page === 'home')) { e.preventDefault(); togglePlay(); }
  });

  $('#gear').innerHTML = I.gear;
  $('#gear').addEventListener('click', (e) => { e.stopPropagation(); close(); if (api.openSettings) api.openSettings(); });

  if (api.onFullscreen) api.onFullscreen((m) => { S.peek = !!(m && m.on && m.mode === 'peek'); S.lastLayout = ''; layout(); });

  // tray / shortcuts: open a page and keep it open until you leave or press Esc
  const TAB_TO_PAGE = { now: 'now', music: 'lyrics', lyrics: 'lyrics', clipboard: 'clipboard', shelf: 'files', files: 'files', todo: 'today', today: 'today', calendar: 'today', focus: 'today' };
  // side layout: Now playing, Files, Clipboard, Tasks (see SIDE_TABS)
  const TAB_TO_SIDE = { now: 'now', music: 'now', lyrics: 'now', clipboard: 'clipboard', shelf: 'files', files: 'files', todo: 'tasks', today: 'tasks', calendar: 'tasks', focus: 'tasks', stats: 'now' };
  const TAB_TO_TAB = { now: 'home', music: 'lyrics', lyrics: 'lyrics', clipboard: 'clipboard', shelf: 'files', files: 'files', todo: 'tasks', today: 'home', calendar: 'calendar', focus: 'focus', stats: 'stats' };
  api.onOpenTab((tab) => {
    if (tab === 'settings') { if (api.openSettings) api.openSettings(); return; }
    S.cbSel = 0;
    open((S.mode === 'side' ? TAB_TO_SIDE : isTabs() ? TAB_TO_TAB : TAB_TO_PAGE)[tab] || 'now', { pin: true });
    if (S.page === 'clipboard') setTimeout(() => { const i = $('#cb-search'); i.value = ''; i.focus(); renderClips(); }, 80);
    api.focusWindow();
  });

  /* ---------------- HUDs (the sides of the notch) ---------------- */
  const hudEnabled = kind => st().huds !== false && st()['hud_' + kind] !== false;
  function showHud(h) {
    if (['volume','caps','lang','device','charge','net'].includes(h.kind) && !hudEnabled(h.kind)) return;
    if (S.expanded || S.moving) return;
    S.hud = h;
    S.hudKey = '';
    clearTimeout(S.hudT);
    S.hudT = setTimeout(() => { if (S.hudHold) return; S.hud = null; layout(); }, h.ms || 1600);
    S.lastLayout = ''; layout();
  }
  function renderHud() {
    const h = S.hud; if (!h) return;
    const k = h.kind + h.l + h.r;
    if (S.hudKey === k) return;
    S.hudKey = k;
    $('#hl').innerHTML = h.l; $('#hr').innerHTML = h.r;
  }
  // The volume HUD stays on screen while you keep pressing: the bar glides to each new level on a
  // spring (a new press mid-glide just bends it, keeping its speed) and the speaker icon is never
  // rebuilt, so nothing flashes; it only changes when you cross mute / low / high.
  const volAnim = window.Motion.animator(({ v }) => {
    const i = $('#hr .bar i');
    if (i) i.style.transform = `translateX(${(Math.max(0, Math.min(100, v)) - 100).toFixed(2)}%)`;
  }, { v: 0 });
  const volIcon = (v, muted) => (muted || v <= 0 ? I.mute : v < 40 ? I.volumeLow : I.volume);
  const hideHudSoon = (ms = 1600) => { clearTimeout(S.hudT); S.hudT = setTimeout(() => { if (S.hudHold) return; S.hud = null; layout(); }, ms); };
  function volHud(v, muted) {
    return { kind: 'volume', wing: 108,
      l: `<span class="ico" id="vol-ico">${volIcon(v, muted)}</span>`,
      r: '<span class="bar" data-vol><i></i></span>' };
  }
  function showVolume(v, muted, preset = 'breathe') {
    if (!hudEnabled('volume')) return;
    const level = muted ? 0 : v;
    const ico = $('#vol-ico');
    if (S.hud && S.hud.kind === 'volume' && ico && $('#hr .bar i')) {
      volAnim.to({ v: level }, preset);
      const svg = volIcon(v, muted);
      if (ico.__svg !== svg) { ico.__svg = svg; ico.innerHTML = svg; }
      if (!S.hudHold) hideHudSoon();
      return;
    }
    showHud(volHud(v, muted));
    volAnim.set({ v: level });
    const fresh = $('#vol-ico'); if (fresh) fresh.__svg = volIcon(v, muted);
  }
  function setVolume(v, preset = 'breathe') {
    v = Math.max(0, Math.min(100, Math.round(v)));
    if (api.setVolume) api.setVolume(v);
    if (S.sys) { S.sys.volume = v; S.sys.muted = false; }
    showVolume(v, false, preset);
  }
  // drag the volume bar
  $('#hud').addEventListener('pointerdown', (e) => {
    const bar = e.target.closest('.bar[data-vol]'); if (!bar) return;
    e.preventDefault(); e.stopPropagation();
    S.hudHold = true;
    const setFrom = (ev) => { const r = bar.getBoundingClientRect(); setVolume(100 * (ev.clientX - r.left) / r.width, 'snap'); };
    setFrom(e);
    const up = () => { window.removeEventListener('pointermove', setFrom); window.removeEventListener('pointerup', up); S.hudHold = false; hideHudSoon(1400); };
    window.addEventListener('pointermove', setFrom); window.addEventListener('pointerup', up);
  });

  api.onSystem((m) => {
    const p = S.sys; S.sys = { ...m };
    if (!p || st().huds === false) return;
    if (hudEnabled('volume') && (m.volume !== p.volume || m.muted !== p.muted)) {
      if (m.volume < 0) return;
      if (S.hudHold) return; // you're dragging the bar: it already shows where you are
      showVolume(m.volume, m.muted);
    } else if (hudEnabled('caps') && m.caps !== p.caps) {
      showHud({ kind: 'caps', wing: 82, l: `<span class="ico">${I.caps}</span>`, r: `<span class="txt ${m.caps ? '' : 'dim'}">${m.caps ? 'On' : 'Off'}</span>` });
    } else if (hudEnabled('lang') && m.lang && m.lang !== p.lang) {
      showHud({ kind: 'lang', wing: 112, l: `<span class="ico">${I.keyboard}</span><span class="txt dim">${esc(short(langName(m.lang), 12))}</span>`, r: `<span class="txt">${esc(m.lang)}</span>` });
    } else if (hudEnabled('device') && m.device && m.device !== p.device) {
      const hp = /head|ear|bud|airpod|wh-|wf-|bluetooth|hands-free/i.test(m.device);
      showHud({ kind: 'device', wing: 124, ms: 2400, l: `<span class="ico">${hp ? I.headphones : I.volume}</span><span class="txt dim">${esc(short(m.device, 14))}</span>`, r: `<span class="txt">${m.volume}%</span>` });
    }
  });

  window.addEventListener('offline', () => showHud({ kind: 'net', wing: 96, ms: 2400, l: `<span class="ico">${I.wifiOff}</span>`, r: '<span class="txt dim">Offline</span>' }));
  window.addEventListener('online', () => showHud({ kind: 'net', wing: 96, ms: 1800, l: `<span class="ico">${I.wifi}</span>`, r: '<span class="txt">Online</span>' }));

  if (navigator.getBattery) {
    navigator.getBattery().then((b) => {
      S.battery = b;
      const pct = () => Math.round(b.level * 100);
      const batt = () => `<span class="batt"><i style="width:${pct()}%;${pct() <= 20 && !b.charging ? 'background:var(--danger)' : ''}"></i></span>`;
      b.addEventListener('chargingchange', () => showHud(b.charging
        ? { kind: 'charge', wing: 104, ms: 2600, l: `<span class="ico green">${I.bolt}</span><span class="txt green">Charging</span>`, r: `<span class="txt">${pct()}%</span>${batt()}` }
        : { kind: 'charge', wing: 104, ms: 2000, l: `<span class="ico">${I.battery}</span><span class="txt dim">On battery</span>`, r: `<span class="txt">${pct()}%</span>${batt()}` }));
      b.addEventListener('levelchange', () => {
        if (!b.charging && b.level <= 0.2 && !S.lowBatt) { S.lowBatt = true; notify({ icon: 'battery', title: 'Battery low', body: `${pct()}% left. Plug in soon.`, app: 'Atoll' }); }
        if (b.charging || b.level > 0.25) S.lowBatt = false;
      });
    }).catch(() => {});
  }

  /* ---------------- notifications ---------------- */
  // n: {title, body, app, icon, image, url, duration, actions:[{label, run | do:'open:<path>'|'folder:<path>'|'shelf:<path>'|'url:<u>'}], force}
  function notify(n) {
    if (st().notifications === false && !n.force) return;
    if (S.queue.length > 8) S.queue.shift(); // a flood (group chat) shouldn't block the notch for minutes
    S.queue.push(n);
    if (!S.notif && !S.toastBusy) nextNotif();
  }
  function notifPlace() {
    const p = st().notifPos || 'auto';
    if (p === 'auto') return S.mode === 'side' ? 'top-center' : 'notch';
    return p;
  }
  let toastSeq = 0;
  function showToast(n, actions) {
    const id = ++toastSeq;
    S.toastBusy = { id, n, actions };
    api.toast.show({
      id, pos: notifPlace(), title: n.title, body: n.body || '', app: n.image ? '' : n.app || '',
      iconSvg: I[n.icon] || '', iconText: I[n.icon] ? '' : (n.icon || ''), image: n.image || '',
      actions: actions.map((a) => ({ label: a.label, primary: !!a.primary })), clickable: !!(n.click || n.url),
      ms: n.duration || (actions.length ? 12000 : 5500),
      theme: st().theme === 'light' ? 'light' : 'dark', accent: st().accent || '#30d5c8',
      tint: getComputedStyle(root).getPropertyValue('--tint').trim()
    });
  }
  if (api.onToastEvent) api.onToastEvent((ev) => {
    const t = S.toastBusy;
    if (!t || ev.id !== t.id) return;
    if (ev.type === 'action' && t.actions[ev.i]) actionFor(t.actions[ev.i])();
    if (ev.type === 'click') { if (t.n.click) actionFor({ do: t.n.click })(); else if (t.n.url) api.openUrl(t.n.url); }
    if (ev.type === 'done') { S.toastBusy = null; setTimeout(nextNotif, 250); }
  });
  function actionFor(a) {
    if (a.run) return a.run;
    const [kind, ...rest] = String(a.do || '').split(':'); const arg = rest.join(':');
    if (kind === 'open') return () => api.openPath(arg);
    if (kind === 'folder') return () => api.showInFolder(arg);
    if (kind === 'url') return () => api.openUrl(arg);
    if (kind === 'shelf') return () => { S.store.shelf = [...new Set([...S.store.shelf, arg])]; save('shelf'); };
    return () => {};
  }
  function nextNotif() {
    const n = S.queue.shift();
    if (!n) return;
    const actions = [...(n.actions || [])];
    if (n.url) actions.push({ label: 'Open', primary: true, run: () => api.openUrl(n.url) });
    if (notifPlace() !== 'notch' && api.toast) { showToast(n, actions); return; }
    S.notif = n;
    if (S.expanded) { S.lastPage = S.page; S.lastPageAt = Date.now(); S.expanded = false; } // the notification takes over, like Alcove
    $('#n-icon').innerHTML = I[n.icon] || esc(n.icon || '') || I.bell;
    $('#notif').classList.toggle('has-img', !!n.image);
    if (n.image) $('#n-img').src = n.image;
    $('#n-title').textContent = n.title;
    $('#n-app').textContent = n.image ? '' : n.app || '';
    $('#n-body').textContent = n.body || '';
    const acts = $('#n-actions'); acts.innerHTML = '';
    for (const a of actions) {
      const b = document.createElement('button');
      b.className = 'pill small' + (a.primary ? ' accent' : '');
      b.textContent = a.label;
      b.addEventListener('click', (e) => { e.stopPropagation(); actionFor(a)(); dismissNotif(); });
      acts.appendChild(b);
    }
    $('#notif').onclick = () => { if (n.click) actionFor({ do: n.click })(); dismissNotif(); };
    n.ms = n.duration || (actions.length ? 12000 : 5000);
    if (!S.hover) armNotifTimer(n.ms); // while the pointer is on it, it waits for you
    S.lastLayout = ''; layout();
  }
  function armNotifTimer(ms) { clearTimeout(S.notifT); S.notifT = setTimeout(dismissNotif, ms); }
  function dismissNotif() {
    clearTimeout(S.notifT); S.notif = null;
    layout();
    setTimeout(nextNotif, 420);
  }
  api.onNotify((n) => notify(n));
  if (api.onShotSaved) api.onShotSaved((r) => {
    if (r.error) return notify({ icon: 'camera', title: 'Screenshot failed', body: r.error, app: 'Screenshot', force: true });
    const name = r.file.split(/[\\/]/).pop();
    notify({ image: r.thumb, title: 'Screenshot copied', body: `${r.width} × ${r.height} · ${name}`, app: 'Screenshot', force: true, duration: 7000, click: 'open:' + r.file,
      actions: [{ label: 'Open', primary: true, do: 'open:' + r.file }, { label: 'Folder', do: 'folder:' + r.file }] });
  });

  /* ---------------- placement & move mode ---------------- */
  const guide = document.createElement('div'); guide.id = 'snap-guide'; document.body.appendChild(guide);
  if (api.onSnapGuide) api.onSnapGuide(g => {
    guide.style.display = g ? 'block' : 'none';
    if (!g) return;
    guide.className = g.axis + (g.matched ? ' matched' : '');
    guide.style.left = g.axis === 'x' ? g.at + 'px' : '0';
    guide.style.top = g.axis === 'y' ? g.at + 'px' : '0';
  });
  if (api.onPlace) api.onPlace((p) => {
    p = p || {};
    const was = S.mode;
    S.mode = p.mode === 'side' ? 'side' : 'top';
    S.cutout = S.mode === 'top' ? p.cutout || null : null;
    if (S.mode === 'side') { S.side = p.side === 'left' ? 'left' : 'right'; S.center = p.center || 330; S.floating = (p.inset || 0) > 0; }
    else { S.offset = p.offset || 0; S.top = p.top || 0; S.floating = !!p.floating; }
    if (was !== S.mode) { applyLayoutDom(); if (!pagesFor().includes(S.page)) S.page = choosePage(); renderNav(); if (S.expanded) renderPanel(true); }
    S.lastLayout = ''; layout();
  });
  function setMoving(on) {
    S.moving = on; S.expanded = false; S.pinned = false;
    if (on && api.moveMode) api.moveMode(true);
    clearTimeout(S.moveT);
    if (on) S.moveT = setTimeout(() => setMoving(false), 60000);
    S.lastLayout = ''; layout();
  }
  if (api.onMoveMode) api.onMoveMode((on) => setMoving(!!on));
  $('#mv-done').addEventListener('click', (e) => { e.stopPropagation(); setMoving(false); });
  $('#mv-done').addEventListener('mousedown', (e) => e.stopPropagation());
  island.addEventListener('mousedown', (e) => {
    if (!(S.moving || e.altKey) || e.button !== 0 || !api.dragNotch) return;
    e.preventDefault();
    const sr = shapeRect(), r = { left: sr.x, top: sr.y, width: sr.width };
    api.dragNotch(true, { x: e.clientX - (r.left + r.width / 2), y: e.clientY - r.top });
    clearTimeout(S.moveT);
    if (S.moving) S.moveT = setTimeout(() => setMoving(false), 60000);
    island.classList.add('dragging');
    const up = () => { api.dragNotch(false); island.classList.remove('dragging'); window.removeEventListener('mouseup', up); };
    window.addEventListener('mouseup', up);
  });

  /* ---------------- media & lyrics ---------------- */
  const mediaPos = () => {
    const m = S.media;
    if (!m.active) return 0;
    const p = m.position + (m.playing ? (performance.now() - S.mediaAt) / 1000 : 0);
    return m.duration > 0 ? Math.min(p, m.duration) : p;
  };

  // Timeline smoothing: while the same song keeps playing, small differences between the reported
  // position and where we expect it to be are reporting noise, not seeks, so the lyrics and the
  // progress bar don't twitch. Apple Music's position is especially jumpy, so it gets more slack.
  const isApple = (app) => /^com\.apple\.Music$|AppleInc\.AppleMusic|AppleMusic|iTunes/i.test(String(app || ''));
  const appleClock = {};
  let mediaEvents = 0, artEvents = 0;
  const acceptMedia = (m) => {
    mediaEvents++;
    const prev = S.media;
    m = { ...m, position: Math.max(0, Number(m.position) || 0), duration: Math.max(0, Number(m.duration) || (prev.key === m.key ? prev.duration : 0) || 0) };
    const wasPlaying = prev.playing;
    if (m && m.active && isApple(m.app)) {
      const now = performance.now();
      m = { ...m, position: window.AppleClock.reconcile(prev, m, (now - S.mediaAt) / 1000,
        appleClock, now, prev.key === m.key && Date.now() - (S.seekedAt || 0) < 1500) };
    } else if (m && m.active && prev.active && prev.key === m.key && prev.playing && m.playing) {
      const predicted = mediaPos();
      // Apple Music's own slider (posSource 'app') is exact: trust it; its media-session position isn't
      const slack = m.posSource === 'app' ? 0.4 : isApple(m.app) ? 3 : 0.75;
      const justSeeked = Date.now() - (S.seekedAt || 0) < 1500; // the player hasn't caught up with our seek yet
      if (justSeeked || Math.abs(m.position - predicted) < slack) {
        S.media = { ...m, position: prev.position }; // keep our running clock
        maybeRetryLyrics();
        if (playerShown()) renderMusic();
        return;
      }
    }
    S.media = m; S.mediaAt = performance.now();
    if (wasPlaying && !m.playing) S.pausedAt = Date.now();
    if (!m.active) { if (S.lyricsKey || S.lyrics) { S.lyricsRequest++; S.lyrics = null; S.lyricsKey = null; S.lyricIdx = -1; renderLyricsList(); } }
    // a song whose lookup failed is asked again only after the wait; a new song right away
    else if (m.key !== S.lyricsKey && (m.key !== S.lyricsFailKey || Date.now() >= S.lyricsRetryAt)) loadLyrics(m);
    if (playerShown()) renderMusic();
    if (S.expanded && S.page === 'lyrics') renderLyricsHead();
    layout();
  };
  api.onMedia(acceptMedia);
  if (api.getMediaSnapshot) {
    const seen = mediaEvents;
    const seenArt = artEvents;
    api.getMediaSnapshot().then(m => {
      if (!m) return;
      if (mediaEvents === seen) acceptMedia(m);
      if (m.cover && artEvents === seenArt) acceptArt(m.cover);
    }).catch(() => {});
  }

  // the player refused a jump we asked for (Apple Music without its own controls reachable)
  if (api.onMediaNote) api.onMediaNote((n) => { if (n && n.kind === 'noseek') { S.media.canSeek = false; renderMusic(); cantSeek(); } });
  // a HUD shown from inside the open panel appears once the panel closes; while open, a short notification instead
  function showHudSoon(h) {
    if (!S.expanded) return showHud(h);
    const tip = $('#panel-tip');
    tip.textContent = isApple(S.media.app) ? 'Apple Music didn’t let Atoll jump: use its own progress bar' : 'This player can’t jump to a time';
    tip.classList.add('on'); clearTimeout(S.tipT); S.tipT = setTimeout(() => tip.classList.remove('on'), 2600);
  }

  function acceptArt(a) {
    if (!S.media.active || a.key !== S.media.key) return;
    // keep the cover as a small blob instead of a long base64 string in memory
    let url = a.data;
    if (a.data && a.data.startsWith('data:')) {
      try {
        const [head, b64] = a.data.split(',');
        const bin = atob(b64); const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        url = URL.createObjectURL(new Blob([bytes], { type: head.slice(5).split(';')[0] || 'image/png' }));
      } catch (_) {}
    }
    if (S.art && S.art.startsWith('blob:') && S.art !== url) URL.revokeObjectURL(S.art);
    S.artKey = a.key; S.art = url;
    root.style.setProperty('--tint', '#ffffff');
    if (url) tintFrom(url);
    if (S.expanded) renderPanel(false);
    S.lastLayout = ''; layout();
  }
  api.onArt(a => { artEvents++; acceptArt(a); });

  function tintFrom(src) {
    const img = new Image();
    img.onload = () => {
      if (S.art !== src) return;
      const c = document.createElement('canvas'); c.width = c.height = 16;
      const g = c.getContext('2d'); g.drawImage(img, 0, 0, 16, 16);
      const d = g.getImageData(0, 0, 16, 16).data;
      let r = 0, gg = 0, b = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) {
        const R = d[i], G = d[i + 1], B = d[i + 2];
        const max = Math.max(R, G, B), min = Math.min(R, G, B);
        if (max > 80 && (max - min) / max > 0.35) { r += R; gg += G; b += B; n++; }
      }
      if (!n) return;
      r /= n; gg /= n; b /= n;
      const k = 225 / Math.max(r, gg, b, 1);
      root.style.setProperty('--tint', `rgb(${Math.min(255, r * k) | 0}, ${Math.min(255, gg * k) | 0}, ${Math.min(255, b * k) | 0})`);
    };
    img.src = src;
  }

  function maybeRetryLyrics() {
    if (S.media.active && S.lyricsFailKey === S.media.key && Date.now() >= S.lyricsRetryAt && !(S.lyrics && S.lyrics.loading)) loadLyrics(S.media);
  }
  async function loadLyrics(m, force = false) {
    const request = ++S.lyricsRequest;
    S.lyricsFailKey = null;
    S.lyricsKey = m.key; S.lyrics = { loading: true }; S.lyricIdx = -1;
    renderLyricsList();
    let r;
    try { r = await api.getLyrics({ title: m.title, artist: m.artist, album: m.album, duration: m.duration, force }); }
    catch (e) { r = { error: 'unreachable', detail: e.message }; }
    if (request !== S.lyricsRequest || S.lyricsKey !== m.key || S.media.key !== m.key) return;
    if (!r || r.error) {
      const wait = Math.max(30e3, (r && r.retryIn) || 60e3);
      S.lyrics = { error: (r && r.error) || 'unreachable', detail: r && r.detail, until: Date.now() + wait }; S.lyricsKey = null; S.lyricsFailKey = m.key; S.lyricsRetryAt = Date.now() + wait;
    }
    else {
      S.lyrics = r;
      if (r.retryIn) { S.lyricsFailKey = m.key; S.lyricsRetryAt = Date.now() + Math.max(30000, r.retryIn); }
    }
    S.trans = null; S.transKey = null;
    renderLyricsList();
    if (S.expanded && S.page === 'lyrics') renderLyricsHead();
    loadTranslation();
  }

  // Translation + romanization for the whole song, fetched once per track
  function lyricLines() {
    const L = S.lyrics;
    if (!L) return null;
    if (L.synced) return L.synced.map((l) => l.text);
    if (L.plain) return L.plain.split('\n');
    return null;
  }
  async function loadTranslation() {
    const lines = lyricLines();
    const key = S.lyricsKey;
    if (!lines || !key || (!st().translateLyrics && !st().showRomanization)) return;
    if (S.transKey === key) return;
    S.transKey = key;
    const request = S.translationRequest = (S.translationRequest || 0) + 1;
    let r;
    try { r = await api.translate(key, lines, st().translateTo || 'en', st().understoodLanguages || []); } catch (_) { r = null; }
    if (S.lyricsKey !== key || S.translationRequest !== request) return;
    if (!r || !r.ok) { S.trans = null; S.transKey = null; return; }
    S.trans = r.data;
    renderLyricsHead();
    renderLyricsList();
    S.lastLayout = ''; layout();
  }
  function transFor(i) {
    if (!S.trans || S.transKey !== S.lyricsKey || i < 0) return { tr: '', rm: '' };
    const it = S.trans.items[i] || {};
    return { tr: st().translateLyrics && !S.trans.same && !S.trans.skipped ? it.tr || '' : '', rm: st().showRomanization ? it.rom || '' : '' };
  }
  function currentTranslation() { return transFor(lyricIndex()).tr; }
  const lyricHtml = (text, i) => {
    const t = transFor(i);
    return `${esc(text) || '♪'}${t.rm ? `<span class="rm">${esc(t.rm)}</span>` : ''}${t.tr ? `<span class="tr">${esc(t.tr)}</span>` : ''}`;
  };
  function lyricIndex() {
    const L = S.lyrics && S.lyrics.synced;
    if (!L || !S.media.active) return -1;
    const p = mediaPos() + (Number(st().lyricOffset) || 0); // Settings → Music & Lyrics → Lyrics timing
    let i = -1;
    for (let k = 0; k < L.length; k++) { if (L[k].t <= p) i = k; else break; }
    return i;
  }
  function currentLyric() {
    const L = S.lyrics && S.lyrics.synced;
    if (!L) return null;
    const i = lyricIndex();
    return i < 0 ? '♪' : L[i].text || '♪';
  }

  // Lyrics page: every line sits in an <ol> that slides so the sung line is in the middle
  function renderHomeLyrics() {
    const ol = $('#m-lyr'), empty = $('#m-lyr-empty');
    const L = S.lyrics;
    ol.className = ''; ol.innerHTML = ''; ol.style.transform = '';
    if (!lyricsShown()) { ol.dataset.released = '1'; return; }
    delete ol.dataset.released;
    let msg = '', cta = false;
    const svcName = (k) => (k === 'spotify' ? 'Spotify' : 'Apple Music');
    const serviceOf = (app) => (isApple(app) ? 'apple' : 'spotify');
    const inMin = (t) => { const m = Math.max(1, Math.round((t - Date.now()) / 60e3)); return m <= 1 ? 'in a minute' : `in ${m} minutes`; };
    if (!S.media.active) msg = 'Lyrics show up here when a song plays.';
    else if (!L || L.loading) msg = 'Looking for lyrics…';
    else if (L.unsupported) msg = 'Lyrics come from Spotify or Apple Music. Play a song there to see them.';
    else if (L.needsConnect) { cta = true; msg = `Connect ${svcName(L.needsConnect)} to see synced lyrics for songs you play in it.`; }
    else if (L.error) msg = `Couldn’t load lyrics from ${svcName(L.service || serviceOf(S.media.app))}. Trying again ${inMin(L.until)}.`;
    else if (L.instrumental) msg = '♪ Instrumental';
    else if (L.synced) ol.innerHTML = L.synced.map((l, i) => `<li data-i="${i}">${lyricHtml(l.text, i)}</li>`).join('');
    else if (L.plain) { ol.className = 'plain'; ol.innerHTML = L.plain.split('\n').map((t, i) => (t.trim() ? `<li>${lyricHtml(t, i)}</li>` : '')).join(''); }
    else msg = `${svcName(L.service || serviceOf(S.media.app))} has no lyrics for “${S.media.title}”.`;
    empty.innerHTML = msg ? `<span>${esc(msg)}${cta ? `<button class="lyr-cta" data-act="lyr-sources">Connect ${svcName(L.needsConnect)}</button>` : ''}</span>` : '';
    if (msg && L && !L.loading && !L.instrumental && !L.unsupported && !L.needsConnect && S.media.active) {
      empty.querySelector('span').insertAdjacentHTML('beforeend', '<button class="lyr-cta" data-act="lyr-retry">Try again</button>');
    }
    if (L && L.error && L.detail) empty.title = L.detail; else empty.removeAttribute('title');
    S.homeLyrIdx = -2;
    placeHomeLyrics(true);
  }
  $('#m-lyr-empty').addEventListener('click', (e) => { if (e.target.closest('[data-act="lyr-retry"]')) { if (!(S.lyrics && S.lyrics.loading)) loadLyrics(S.media, true); return; } if (e.target.closest('[data-act="lyr-sources"]')) { close(); if (api.openSettings) api.openSettings('music'); } });
  function placeHomeLyrics(instant) {
    const ol = $('#m-lyr');
    if (!lyricsShown() || ol.classList.contains('plain')) return;
    const items = ol.children;
    if (!items.length) return;
    const i = Math.max(0, S.lyricIdx);
    if (i === S.homeLyrIdx && !instant) return;
    S.homeLyrIdx = i;
    for (let k = 0; k < items.length; k++) items[k].classList.toggle('on', k === S.lyricIdx);
    const li = items[i];
    const available = $('#m-lyrics').clientHeight;
    for (const item of items) item.style.maxHeight = Math.max(40, available - 12) + 'px';
    $('#m-lyrics').classList.toggle('long-line', li.scrollHeight > li.clientHeight);
    const center = available / 2;
    if (instant) { ol.style.transition = 'none'; requestAnimationFrame(() => (ol.style.transition = '')); }
    ol.style.transform = `translateY(${center - li.offsetTop - li.offsetHeight / 2}px)`;
  }
  if (window.ResizeObserver) new ResizeObserver(() => { S.homeLyrIdx = -2; placeHomeLyrics(true); }).observe($('#m-lyrics'));
  $('#m-lyr').addEventListener('click', (e) => {
    const li = e.target.closest('li[data-i]');
    if (li && S.lyrics && S.lyrics.synced) seek(S.lyrics.synced[+li.dataset.i].t);
  });
  function renderLyricsList() { renderHomeLyrics(); }
  function updateLyrics(force) {
    const i = lyricIndex();
    if (i === S.lyricIdx && !force) return;
    S.lyricIdx = i;
    placeHomeLyrics(force);
    if (!S.expanded) layout();
  }
  function renderLyricsHead() {
    const m = S.media;
    setText($('#ly-title'), m.active ? m.title : 'Not playing');
    const src = S.lyrics && S.lyrics.source && S.lyrics.source ? ` · lyrics from ${S.lyrics.source}` : '';
    setText($('#ly-artist'), m.active ? (m.artist || '') + src : '');
    const a = $('#ly-art');
    if (artOk()) { if (a.src !== S.art) a.src = S.art; a.style.visibility = ''; } else a.style.visibility = 'hidden';
    const t = $('#m-tr-toggle'); t.innerHTML = I.translate; t.classList.toggle('on', !!st().translateLyrics);
    // The online translator can refuse this network (rate limit / "unusual traffic"); romanization is local and still shows.
    const down = !!(S.trans && S.trans.partial && S.transKey === S.lyricsKey);
    t.classList.toggle('unavailable', down);
    t.title = down ? 'Translation unavailable: Google is refusing requests from this network right now. Romanization still works. Try again later.' : 'Translation';
  }
  $('#m-tr-toggle').addEventListener('click', () => {
    st().translateLyrics = !st().translateLyrics; save('settings'); renderLyricsHead();
    if (st().translateLyrics && !S.trans) loadTranslation();
    renderLyricsList(); updateLyrics(true);
  });
  const bumpLyrics = (d) => { st().lyricSize = Math.max(14, Math.min(40, (st().lyricSize || 26) + d)); save('settings'); applyLyricSize(); S.homeLyrIdx = -2; requestAnimationFrame(() => placeHomeLyrics(true)); };
  $('#lyr-smaller').addEventListener('click', () => bumpLyrics(-2));
  $('#lyr-bigger').addEventListener('click', () => bumpLyrics(2));

  const canSeek = () => S.media.active && S.media.canSeek !== false;
  function cantSeek() {
    showHudSoon({ kind: 'note', wing: 150, ms: 2600, l: `<span class="ico">${I.music}</span>`, r: `<span class="txt dim">${isApple(S.media.app) ? 'Apple Music won’t jump' : 'This player can’t jump'}</span>` });
  }
  function seek(t) {
    if (!S.media.active) return;
    if (!canSeek()) { cantSeek(); return; }
    api.media('seek', t);
    S.media.position = t; S.mediaAt = performance.now(); S.seekedAt = Date.now();
    updateLyrics(true); renderProgress();
  }
  function togglePlay() {
    api.media('toggle');
    if (S.media.active) {
      S.media.position = mediaPos(); S.mediaAt = performance.now();
      if (S.media.playing) S.pausedAt = Date.now();
      S.media.playing = !S.media.playing; renderMusic(); layout();
    }
  }

  // Called often (Apple Music's position arrives twice a second): only touch what actually changed
  const setAttr = (el, k, v) => { if (el[k] !== v) el[k] = v; };
  function renderMusic() {
    const m = S.media;
    const music = $('#music'), bar = $('#m-bar');
    if (music.classList.contains('idle') === !!m.active) music.classList.toggle('idle', !m.active);
    const locked = !!m.active && m.canSeek === false;
    if (bar.classList.contains('locked') !== locked) bar.classList.toggle('locked', locked);
    setAttr(bar, 'title', locked ? 'This player doesn’t allow jumping' : '');
    setHtml($('#m-art-empty'), I.music);
    const hasArt = !!artOk();
    if ($('#np-art').classList.contains('has') !== hasArt) $('#np-art').classList.toggle('has', hasArt);
    if (hasArt && $('#m-art').src !== S.art) $('#m-art').src = S.art;
    setText($('#m-title'), m.active ? m.title : 'Not playing');
    setText($('#m-artist'), m.active ? ([m.artist, ...(api.platform === 'darwin' ? [m.album] : [])].filter(Boolean).join(' · ') || '—') : 'Play something in Spotify, YouTube or any media app');
    setText($('#m-app'), m.active ? appName(m.app) : '');
    setHtml($('#m-toggle'), m.active && m.playing ? I.pause : I.play);
    setHtml($('[data-media="prev"]'), I.prev);
    setHtml($('[data-media="next"]'), I.next);
    setHtml($('#np-lyrics'), I.lyrics);
    setAttr($('#np-viz'), 'className', `viz big ${st().smoothViz === false ? '' : 'smooth'} ${m.playing ? '' : 'paused'}`);
    const vis = m.active ? '' : 'hidden';
    if ($('#np-viz').style.visibility !== vis) $('#np-viz').style.visibility = vis;
    renderProgress();
  }
  function appName(id) {
    if (!id) return '';
    const s = id.toLowerCase();
    if (s.includes('spotify')) return 'Spotify';
    if (s.includes('chrome')) return 'Chrome';
    if (s.includes('msedge')) return 'Edge';
    if (s.includes('firefox')) return 'Firefox';
    if (isApple(id)) return 'Apple Music';
    if (s.includes('zune') || s.includes('music')) return 'Media Player';
    if (s.includes('apple')) return 'Apple Music';
    return id.replace(/\.exe$/i, '').split(/[!\\]/).pop();
  }
  // Alcove-style times: elapsed on the left, remaining (−) on the right
  function renderProgress(preview) {
    const m = S.media;
    const p = Math.max(0, Math.min(m.duration > 0 ? m.duration : Infinity, preview ?? mediaPos()));
    setText($('#m-pos'), mmss(p));
    setText($('#m-dur'), m.duration > 0 ? '−' + mmss(m.duration - p) : '0:00');
    const pct = m.duration > 0 ? (100 * p / m.duration) : 0;
    $('#m-bar .fill i').style.transform = `scaleX(${(pct / 100).toFixed(5)})`;
    $('#m-bar .kt').style.left = `${pct.toFixed(3)}%`;
  }
  // scrub: the bar thickens, a knob appears, times preview, release to seek
  $('#m-bar').addEventListener('pointerdown', (e) => {
    const m = S.media; if (!m.active || !m.duration) return;
    if (!canSeek()) { cantSeek(); return; }
    e.preventDefault(); e.stopPropagation();
    const bar = $('#m-bar'); bar.classList.add('scrub'); S.dragging = true;
    let t = 0;
    const at = (ev) => { const r = bar.getBoundingClientRect(); t = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)) * m.duration; renderProgress(t); };
    at(e);
    const up = () => { window.removeEventListener('pointermove', at); window.removeEventListener('pointerup', up); bar.classList.remove('scrub'); S.dragging = false; seek(t); };
    window.addEventListener('pointermove', at); window.addEventListener('pointerup', up);
  });
  $$('[data-media]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    const cmd = b.dataset.media;
    if (cmd === 'toggle') return togglePlay();
    api.media(cmd);
    const art = $('#np-art');
    art.animate([{ transform: 'none' }, { transform: `translateX(${cmd === 'next' ? -10 : 10}px) scale(.94)`, opacity: .5 }, { transform: 'none' }], { duration: 380, easing: 'ease-out' });
  }));
  $('#np-art').addEventListener('click', () => { if (S.media.active && api.openPlayer) api.openPlayer(S.media.app); });
  $('#np-lyrics').addEventListener('click', () => goPage('lyrics'));

  /* ---------------- focus timer ---------------- */
  const modeLen = (mode) => (mode === 'focus' ? st().focusMin : st().breakMin) * 60;
  function timerRemaining() {
    const T = S.timer;
    if (T.running) return Math.max(0, (T.endAt - Date.now()) / 1000);
    return T.remaining ?? modeLen(T.mode);
  }
  function timerStart() { const T = S.timer; T.endAt = Date.now() + timerRemaining() * 1000; T.running = true; T.remaining = null; renderFocus(); renderNav(); layout(); }
  function timerPause() { const T = S.timer; T.remaining = timerRemaining(); T.running = false; renderFocus(); renderNav(); layout(); }
  function timerReset() { Object.assign(S.timer, { running: false, remaining: null }); renderFocus(); layout(); }
  function focusStats() {
    const f = S.store.focus, today = new Date().toDateString();
    if (f.date !== today) { f.date = today; f.sessionsToday = 0; save('focus'); }
    return f;
  }
  function timerFinish(natural) {
    const T = S.timer;
    const was = T.mode;
    Object.assign(T, { running: false, remaining: null, mode: was === 'focus' ? 'break' : 'focus' });
    if (was === 'focus') { const f = focusStats(); if (natural) { f.sessionsToday++; save('focus'); } }
    if (natural) {
      chime(was === 'focus' ? 'done' : 'start');
      notify(was === 'focus'
        ? { icon: 'timer', title: 'Focus session done', body: `Nice work. Take a ${st().breakMin}-minute break.`, app: 'Focus', actions: [{ label: 'Start break', primary: true, run: timerStart }] }
        : { icon: 'timer', title: 'Break’s over', body: 'Ready for another round?', app: 'Focus', actions: [{ label: 'Start focus', primary: true, run: timerStart }] });
    }
    renderFocus(); layout();
  }
  function renderFocus() {
    const rem = timerRemaining(), T = S.timer;
    setText($('#f-time'), mmss(rem));
    setText($('#f-mode'), `${T.mode === 'focus' ? 'Focus' : 'Break'} · ${focusStats().sessionsToday} today`);
    $('#f-ring .fill').style.strokeDashoffset = String(326.73 * (1 - rem / modeLen(T.mode)));
    $('#f-ring .fill').style.stroke = T.mode === 'focus' ? 'var(--accent)' : '#64d2ff';
    setText($('#f-start'), T.running ? 'Pause' : (T.remaining != null ? 'Resume' : 'Start'));
  }
  $('#f-start').addEventListener('click', () => (S.timer.running ? timerPause() : timerStart()));
  $('#f-reset').addEventListener('click', timerReset);

  /* ---------------- water ---------------- */
  function water() {
    const w = S.store.water, today = new Date().toDateString();
    if (w.date !== today) { w.date = today; w.ml = 0; w.lastAt = 0; save('water'); }
    return w;
  }
  function addWater(ml) {
    const w = water(), goal = st().waterGoalMl;
    const before = w.ml;
    w.ml = Math.max(0, w.ml + ml); w.lastAt = Date.now();
    if (ml > 0) S.waterUndo.push(ml);
    save('water');
    if (before < goal && w.ml >= goal) notify({ icon: 'water', title: 'Daily water goal reached', body: `${w.ml} ml today. Well done!`, app: 'Water' });
    renderWater();
  }
  function renderWater() {
    const w = water(), goal = st().waterGoalMl;
    setText($('#w-ml'), `${w.ml} ml`);
    setText($('#w-goal'), `Water · goal ${goal}`);
    $('#w-ring .fill').style.strokeDashoffset = String(326.73 * (1 - Math.min(1, w.ml / goal)));
    setText($('#w-add'), `+ ${st().bottleMl}`);
  }
  $('#w-add').addEventListener('click', () => addWater(st().bottleMl));
  $('#w-undo').addEventListener('click', () => { const ml = S.waterUndo.pop(); if (ml) addWater(-ml); });
  function checkWater() {
    const every = st().waterEveryMin;
    if (!every || st().waterEnabled === false || st().waterReminders === false) return;
    const w = water(), hr = new Date().getHours();
    if (hr < 8 || hr >= 22 || w.ml >= st().waterGoalMl) return;
    const since = Date.now() - Math.max(w.lastAt || 0, S.startedAt, S.lastWaterNudge);
    if (since >= every * 60e3) {
      S.lastWaterNudge = Date.now();
      notify({ icon: 'water', title: 'Time for some water', body: `${w.ml} of ${st().waterGoalMl} ml so far today.`, app: 'Water', actions: [{ label: `+ ${st().bottleMl} ml`, primary: true, run: () => addWater(st().bottleMl) }] });
    }
  }

  /* ---------------- today: agenda + tasks + widgets ---------------- */
  function renderToday() {
    $('.today').classList.toggle('no-water', st().waterEnabled === false);
    renderAgenda(); renderTodos(); renderFocus(); renderWater();
  }
  function joinBtn(e) { return e.link ? `<button class="chip-btn" data-join="${esc(e.link)}">Join</button>` : ''; }
  function renderAgenda() {
    setText($('#ag-sub'), new Date().toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' }));
    const box = $('#agenda');
    if (!(st().icsUrl || st().calendarSource === 'apple')) { setHtml(box, '<div class="ag empty">No calendar yet · <a data-settings="calendar">connect one</a></div>'); return; }
    const now = Date.now();
    const evs = (S.cal.events || []).filter((e) => e.end > now).slice(0, 3);
    if (!evs.length) { setHtml(box, `<div class="ag empty">${S.cal.error ? esc(S.cal.error) : 'Nothing scheduled in the next 7 days'}</div>`); return; }
    setHtml(box, evs.map((e) => `<div class="ag"><i></i><span class="t">${e.allDay ? dayLabel(e.start) : (sameDay(e.start, now) ? '' : dayLabel(e.start) + ' ') + hhmm(e.start)}</span><span class="n">${esc(e.title)}</span>${joinBtn(e)}</div>`).join(''));
  }
  document.addEventListener('click', (e) => {
    const j = e.target.closest('[data-join]');
    if (j) { e.stopPropagation(); api.openUrl(j.dataset.join); }
    const g = e.target.closest('[data-settings]');
    if (g) { e.stopPropagation(); close(); if (api.openSettings) api.openSettings(g.dataset.settings); }
  });

  /* ---------------- tasks (local, or synced with Gavin's Todolist) ---------------- */
  const timePicker = $('#t-time-picker');
  const timeButton = $('#t-time-open');
  function closeTimePicker(restoreFocus = false) {
    timePicker.hidden = true;
    timeButton.setAttribute('aria-expanded', 'false');
    if (restoreFocus) timeButton.focus();
  }
  function setTaskTime(value) {
    $('#t-time').value = value;
    $('#t-time-label').textContent = value || 'Set time';
    closeTimePicker(true);
  }
  function applyTaskTime() {
    const hour = $('#t-hour'), minute = $('#t-minute');
    for (const input of [hour, minute]) {
      if (input.value === '' || !input.checkValidity()) { input.focus(); input.reportValidity(); return; }
    }
    setTaskTime(`${pad(Number(hour.value))}:${pad(Number(minute.value))}`);
  }
  timeButton.addEventListener('click', () => {
    if (!timePicker.hidden) { closeTimePicker(true); return; }
    const now = new Date();
    const parts = $('#t-time').value ? $('#t-time').value.split(':').map(Number) : [now.getHours(), now.getMinutes()];
    $('#t-hour').value = parts[0]; $('#t-minute').value = parts[1];
    timePicker.hidden = false;
    timeButton.setAttribute('aria-expanded', 'true');
    $('#t-hour').focus(); $('#t-hour').select();
  });
  $('#t-time-done').addEventListener('click', applyTaskTime);
  $('#t-time-clear').addEventListener('click', () => setTaskTime(''));
  timePicker.addEventListener('keydown', event => {
    if (event.key === 'Escape' || event.key === 'Enter') {
      event.preventDefault(); event.stopPropagation();
      if (event.key === 'Enter') applyTaskTime(); else closeTimePicker(true);
    }
  });
  document.addEventListener('pointerdown', event => {
    if (!event.target.closest('.task-time')) closeTimePicker();
  });
  document.addEventListener('focusin', event => {
    if (!event.target.closest('.task-time')) closeTimePicker();
  });
  window.addEventListener('blur', () => closeTimePicker());
  const remoteOn = () => !!(S.store.todolist && S.store.todolist.connected);
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  function dueFromTime(v) {
    if (!v) return null;
    const [h, m] = v.split(':').map(Number);
    const d = new Date(); d.setHours(h, m, 0, 0);
    if (d.getTime() < Date.now() - 60e3) d.setDate(d.getDate() + 1);
    return d.getTime();
  }
  const remoteDueMs = (t) => (t.due ? new Date(`${t.due}T${t.time || '23:59'}:00`).getTime() : null);
  function dueText(ms, hasTime = true) { return hasTime ? `${dayLabel(ms) === 'Today' ? '' : dayLabel(ms) + ' '}${hhmm(ms)}` : dayLabel(ms); }
  function todoItems() {
    if (remoteOn()) {
      const today = new Date().toDateString();
      return S.remote.tasks
        .filter((t) => !t.done || (t.doneAt && new Date(t.doneAt).toDateString() === today))
        .map((t) => ({ id: t.id, text: t.text, done: t.done, dueMs: remoteDueMs(t), hasTime: !!t.time, list: t.list }));
    }
    return S.store.todos.map((t) => ({ id: t.id, text: t.text, done: t.done, dueMs: t.due, hasTime: true, list: '' }));
  }
  async function loadRemote() {
    if (!remoteOn() || S.remote.loading) return;
    S.remote.loading = true;
    const r = await api.todo.list();
    S.remote.loading = false;
    S.remote.at = Date.now();
    if (r.ok) { S.remote.tasks = r.data; S.remote.error = null; }
    else { S.remote.error = r.error; if (r.code === 401) S.store.todolist = await api.todo.info(); }
    if (S.expanded && ['today', 'tasks'].includes(S.page)) renderTodos();
    if (S.expanded && S.page === 'home') renderHomeRow();
  }
  function renderTodoHead() {
    const tl = S.store.todolist || {};
    if (remoteOn()) {
      setHtml($('#t-head'), S.remote.error ? `<span style="color:var(--danger)">${esc(short(S.remote.error, 40))}</span>` : `Synced · ${esc(tl.name || tl.user)} · <a id="t-open">Open</a>`);
      const o = $('#t-open'); if (o) o.onclick = () => api.openUrl(tl.webUrl);
      $('#t-text').placeholder = 'Add a task… “call mum tomorrow 8pm”';
    } else {
      setHtml($('#t-head'), '<a data-settings="tasks">Sync with Gavin’s Todolist</a>');
      $('#t-text').placeholder = 'Add a task…';
    }
  }
  function renderTodos() {
    renderTodoHead();
    const list = $('#t-list');
    const items = todoItems().sort((a, b) => (a.done - b.done) || ((a.dueMs || 9e15) - (b.dueMs || 9e15)) || String(b.id).localeCompare(String(a.id)));
    if (!items.length) { list.innerHTML = `<li class="empty">${remoteOn() && S.remote.loading && !S.remote.at ? 'Loading your tasks…' : 'Nothing to do. Enjoy the calm.'}</li>`; return; }
    const now = Date.now();
    list.innerHTML = items.slice(0, 100).map((t) => `
      <li data-id="${esc(t.id)}" class="${t.done ? 'done' : ''} ${!t.done && t.dueMs && t.dueMs < now ? 'overdue' : ''}">
        <button class="t-check" data-act="toggle">${t.done ? I.check : ''}</button>
        <span class="t-txt">${esc(t.text)}</span>
        ${t.list ? `<span class="t-list-name">${esc(t.list)}</span>` : ''}
        ${t.dueMs ? `<span class="t-due">${esc(dueText(t.dueMs, t.hasTime))}</span>` : ''}
        ${remoteOn() ? '' : `<button class="t-del" data-act="del" title="Delete">${I.x}</button>`}
      </li>`).join('');
  }
  $('#t-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = $('#t-text').value.trim();
    if (!text) return;
    const dueMs = dueFromTime($('#t-time').value);
    $('#t-text').value = ''; setTaskTime('');
    if (remoteOn()) {
      const d = dueMs ? new Date(dueMs) : null;
      S.remote.tasks.unshift({ id: 'tmp' + Date.now(), text, done: false, due: d ? ymd(d) : null, time: d ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : null, list: '' });
      renderTodos();
      const r = await api.todo.add(text, d ? ymd(d) : null, d ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : null);
      if (!r.ok) S.remote.error = r.error;
      await loadRemote();
      return;
    }
    S.store.todos.push({ id: Date.now(), text, due: dueMs, done: false, notified: false });
    save('todos');
    renderTodos();
  });
  $('#t-text').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#t-form').requestSubmit(); } });
  $('#t-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const raw = b.closest('li').dataset.id;
    if (b.dataset.act === 'toggle') toggleTodo(remoteOn() ? raw : +raw);
    if (b.dataset.act === 'del') { S.store.todos = S.store.todos.filter((t) => t.id !== +raw); save('todos'); renderTodos(); }
  });
  async function toggleTodo(id, force) {
    if (remoteOn()) {
      const t = S.remote.tasks.find((x) => x.id === id); if (!t || String(id).startsWith('tmp')) return;
      const done = force ?? !t.done;
      t.done = done; t.doneAt = done ? Date.now() : null;
      renderTodos();
      const r = await api.todo.update(id, { done });
      if (!r.ok) { t.done = !done; S.remote.error = r.error; renderTodos(); }
      else loadRemote();
      return;
    }
    const t = S.store.todos.find((x) => x.id === id); if (!t) return;
    t.done = force ?? !t.done; save('todos'); renderTodos();
  }
  function snooze(id) {
    const t = S.store.todos.find((x) => x.id === id); if (!t) return;
    t.due = Date.now() + 10 * 60e3; t.notified = false; save('todos'); renderTodos();
  }
  function checkTodos() {
    for (const t of S.store.todos) {
      if (!t.done && t.due && t.due <= Date.now() && !t.notified) {
        t.notified = true; save('todos');
        notify({ icon: 'todo', title: t.text, body: `Reminder · due ${hhmm(t.due)}`, app: 'Tasks', duration: 20000,
          actions: [{ label: 'Done', primary: true, run: () => toggleTodo(t.id, true) }, { label: 'Snooze 10m', run: () => snooze(t.id) }] });
      }
    }
  }
  function checkRemoteReminders() {
    if (!remoteOn() || st().todolistReminders === false) return;
    const now = Date.now(), sent = S.store.remoteNotified || (S.store.remoteNotified = {});
    let changed = false;
    for (const t of S.remote.tasks) {
      if (t.done || !t.due || !t.time) continue;
      const due = remoteDueMs(t), sig = `${t.due} ${t.time}`;
      const snoozedTill = S.snoozed.get(t.id);
      if (snoozedTill && now < snoozedTill) continue;
      if (due > now || now - due > 6 * 3600e3 || (sent[t.id] === sig && !snoozedTill)) continue;
      S.snoozed.delete(t.id);
      sent[t.id] = sig; changed = true;
      notify({ icon: 'todo', title: t.text, body: `Due ${hhmm(due)}${t.list ? ' · ' + t.list : ''} · Gavin’s Todolist`, app: 'Tasks', duration: 20000,
        actions: [{ label: 'Done', primary: true, run: () => toggleTodo(t.id, true) }, { label: 'Snooze 10m', run: () => S.snoozed.set(t.id, Date.now() + 10 * 60e3) }] });
    }
    if (changed) save('remoteNotified');
  }

  /* ---------------- clipboard history (like Windows + V) ---------------- */
  const ago = (t) => {
    const m = Math.round((Date.now() - t) / 60e3);
    if (m < 1) return 'just now';
    if (m < 60) return `${m} min ago`;
    if (m < 24 * 60) return `${Math.round(m / 60)} h ago`;
    return new Date(t).toLocaleDateString([], { day: 'numeric', month: 'short' });
  };
  async function loadClips() {
    if (api.clip) S.clips = await api.clip.list();
    if (api.clip && api.clip.status) { try { S.clipStatus = await api.clip.status(); } catch (_) {} }
    if (S.expanded && S.page === 'clipboard') renderClips();
  }
  if (api.onClips) api.onClips((list) => { S.clips = list; if (S.expanded && S.page === 'clipboard') renderClips(); });
  if (api.onClipStatus) api.onClipStatus((st2) => { S.clipStatus = st2; if (S.expanded && S.page === 'clipboard') renderClips(); });
  // why the last copy didn't show up (shown only when it's more recent than the newest saved item)
  const SKIP_TEXT = { private: 'The last copy was marked private by its app (e.g. a password manager), so it wasn’t saved.',
    locked: 'Couldn’t read the last copy: the app was still holding the clipboard.', empty: 'The last copy had nothing Atoll can keep (only text and images are saved).',
    error: 'Couldn’t read the last copy.' };
  function clipSkipNote() {
    const k = S.clipStatus && S.clipStatus.skip;
    if (!k || !SKIP_TEXT[k.reason] || Date.now() - k.at > 10 * 60e3) return '';
    if (S.clips[0] && S.clips[0].at > k.at) return '';
    const why = (S.clipStatus.error || S.clipStatus.helperError || '').slice(0, 120);
    return SKIP_TEXT[k.reason] + ((k.reason === 'error' || k.reason === 'locked') && why ? ` (${why})` : '');
  }
  function filteredClips() {
    const q = $('#cb-search').value.trim().toLowerCase();
    const list = S.clips.filter((c) => !q || (c.type === 'text' ? c.text.toLowerCase().includes(q) : 'image picture screenshot'.includes(q)));
    return [...list.filter((c) => c.pinned), ...list.filter((c) => !c.pinned)];
  }
  function renderClips() {
    const paused = !!st().clipboardPaused;
    const note = paused ? '' : clipSkipNote();
    setText($('#cb-status'), paused ? 'Paused: new copies aren’t saved.' : note || `${S.clips.length} saved · ${st().pasteOnPick === false ? 'click to copy' : 'click to paste'}${S.clips[0] ? ' · newest ' + ago(S.clips[0].at) : ''}`);
    $('#cb-status').classList.toggle('warn', !!note);
    $('#cb-status').title = note || '';
    setText($('#cb-pause'), paused ? 'Resume' : 'Pause');
    $('#cb-pause').classList.toggle('on', paused);
    const box = $('#cb-list');
    const list = filteredClips();
    S.cbSel = Math.min(S.cbSel, Math.max(0, list.length - 1));
    if (!list.length) {
      box.innerHTML = `<div class="empty">${paused ? 'Clipboard history is paused.' : S.clips.length ? 'Nothing matches.' : `Copy something and it shows up here.<br>Open this anytime with <span class="kbd">${esc((st().shortcuts || {}).clipboard || 'Alt+Shift+V')}</span>`}</div>`;
      return;
    }
    box.innerHTML = list.map((c, i) => `
      <div class="cb ${c.pinned ? 'pinned' : ''} ${i === S.cbSel ? 'sel' : ''}" data-id="${esc(c.id)}" ${c.type === 'image' ? 'draggable="true"' : ''}>
        <div class="tools">
          <button class="pin" data-act="pin" title="${c.pinned ? 'Unpin' : 'Pin (kept forever)'}">${c.pinned ? I.starOn : I.star}</button>
          <button class="del" data-act="del" title="Delete">${I.x}</button>
        </div>
        ${c.type === 'image' ? `<img class="img" src="${c.thumb}" alt="">` : `<div class="txt">${esc(c.text.length > 400 ? c.text.slice(0, 400) + '…' : c.text)}</div>`}
        <div class="meta"><span>${c.type === 'image' ? `Image · ${c.w}×${c.h}` : `${c.text.length} chars`}</span><span>${ago(c.at)}</span></div>
      </div>`).join('');
  }
  async function useClip(id) {
    if (!id) return;
    await api.clip.use(id, true);
    close();
    setTimeout(() => showHud({ kind: 'clip', wing: 92, ms: 1500, l: `<span class="ico">${I.clipboard}</span>`, r: `<span class="txt">${st().pasteOnPick === false ? 'Copied' : 'Pasted'}</span>` }), 540);
  }
  $('#cb-list').addEventListener('click', (e) => {
    const card = e.target.closest('.cb'); if (!card) return;
    const act = e.target.closest('[data-act]');
    const c = S.clips.find((x) => x.id === card.dataset.id); if (!c) return;
    if (act && act.dataset.act === 'pin') { api.clip.pin(c.id, !c.pinned); return; }
    if (act && act.dataset.act === 'del') {
      card.animate([{ transform: 'none', opacity: 1 }, { transform: 'scale(.9)', opacity: 0 }], { duration: 160, easing: 'ease-in' }).onfinish = () => api.clip.remove(c.id);
      return;
    }
    useClip(c.id);
  });
  $('#cb-list').addEventListener('dragstart', (e) => { const card = e.target.closest('.cb'); if (!card) return; e.preventDefault(); api.clip.drag(card.dataset.id); });
  $('#cb-search').addEventListener('input', () => { S.cbSel = 0; renderClips(); });
  $('#cb-search').addEventListener('keydown', (e) => {
    const list = filteredClips();
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { S.cbSel = Math.min(list.length - 1, S.cbSel + (e.key === 'ArrowDown' ? 2 : 1)); renderClips(); e.preventDefault(); e.stopPropagation(); }
    if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { S.cbSel = Math.max(0, S.cbSel - (e.key === 'ArrowUp' ? 2 : 1)); renderClips(); e.preventDefault(); e.stopPropagation(); }
    if (e.key === 'Enter') { e.preventDefault(); useClip(list[S.cbSel] && list[S.cbSel].id); }
  });
  $('#cb-pause').addEventListener('click', () => { st().clipboardPaused = !st().clipboardPaused; save('settings'); renderClips(); });
  $('#cb-clear').addEventListener('click', () => api.clip.clear());

  /* ---------------- files ---------------- */
  const baseName = (p) => p.split(/[\\/]/).pop();
  async function iconFor(p) {
    if (S.icons.has(p)) return S.icons.get(p);
    const url = await api.fileIcon(p);
    S.icons.set(p, url);
    return url;
  }
  const genericFile = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#9a9aa1" stroke-width="1.6"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>');
  function renderShelf() {
    const files = S.store.shelf;
    $('#shelf-empty').style.display = files.length ? 'none' : '';
    const grid = $('#shelf-grid');
    grid.innerHTML = files.map((p, i) => `
      <div class="file" draggable="true" data-i="${i}" title="${esc(p)}">
        <img src="${genericFile}" alt="">
        <span>${esc(baseName(p))}</span>
        <button class="x" data-act="rm" title="Remove from shelf">${I.x}</button>
      </div>`).join('');
    $$('.file', grid).forEach(async (el) => { const url = await iconFor(files[+el.dataset.i]); if (url) $('img', el).src = url; });
  }
  $('#shelf-grid').addEventListener('click', (e) => {
    const f = e.target.closest('.file'); if (!f) return;
    const p = S.store.shelf[+f.dataset.i];
    if (e.target.closest('[data-act="rm"]')) {
      f.animate([{ transform: 'none', opacity: 1 }, { transform: 'scale(.8)', opacity: 0 }], { duration: 160, easing: 'ease-in' }).onfinish = () => { S.store.shelf = S.store.shelf.filter((x) => x !== p); save('shelf'); renderShelf(); };
      return;
    }
    api.openPath(p);
  });
  $('#shelf-grid').addEventListener('dragstart', (e) => { const f = e.target.closest('.file'); if (!f) return; e.preventDefault(); api.startDrag(S.store.shelf[+f.dataset.i]); });
  const drop = $('#shelf-drop');
  island.addEventListener('dragenter', (e) => {
    if (!e.dataTransfer || ![...e.dataTransfer.types].includes('Files')) return;
    if (S.page !== 'files' || !S.expanded) { S.expanded = true; S.page = 'files'; renderDots(); renderPanel(true); layout(); }
  });
  document.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  document.addEventListener('dragleave', (e) => { if (!e.relatedTarget) drop.classList.remove('over'); });
  document.addEventListener('drop', (e) => {
    e.preventDefault(); drop.classList.remove('over');
    const paths = [...(e.dataTransfer?.files || [])].map((f) => api.pathForFile(f)).filter(Boolean);
    if (!paths.length) return;
    S.store.shelf = [...new Set([...S.store.shelf, ...paths])].slice(-40);
    save('shelf'); renderShelf();
  });
  $('#shelf-shot-area').addEventListener('click', () => { close(); setTimeout(() => api.shot && api.shot('area'), 250); });
  $('#shelf-shot-full').addEventListener('click', () => { close(); setTimeout(() => api.shot && api.shot('full'), 250); });

  /* ---------------- calendar ---------------- */
  async function loadCalendar() { S.cal = await api.getCalendar(); if (S.expanded && S.page === 'today') renderAgenda(); if (S.expanded && S.page === 'calendar') renderCalPage(); }
  api.onCalendar((c) => { S.cal = c; if (S.expanded && S.page === 'today') renderAgenda(); if (S.expanded && S.page === 'calendar') renderCalPage(); if (S.expanded && S.page === 'home') renderHomeRow(); layout(); });
  function checkMeetings() {
    const lead = (st().meetingHeadsUpMin || 5) * 60e3, now = Date.now();
    for (const e of S.cal.events || []) {
      if (e.allDay || S.notified.has(e.id)) continue;
      const dt = e.start - now;
      if (dt <= lead && dt > -2 * 60e3) {
        S.notified.add(e.id);
        chime('start');
        notify({ icon: 'calendar', title: e.title, body: `${dt > 30e3 ? 'Starts ' + rel(dt) : 'Starting now'} · ${hhmm(e.start)}${e.location ? ' · ' + e.location : ''}`, app: 'Calendar', duration: 25000,
          actions: e.link ? [{ label: `Join ${provider(e.link)}`, primary: true, run: () => api.openUrl(e.link) }] : [] });
      }
    }
  }

  /* ---------------- Tabs layout: clock, Home cards, Calendar, Stats ---------------- */
  function renderClock() {
    const now = new Date();
    setText($('#tb-clock'), now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
    setText($('#tb-date'), now.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }));
  }
  const openCount = () => todoItems().filter((t) => !t.done).length;
  function renderHomeRow() {
    const box = $('#home-row');
    const ev = nextMeeting();
    let cal;
    if (!(st().icsUrl || st().calendarSource === 'apple')) cal = `<div class="mini cal" data-go="calendar"><span class="k">Calendar</span><b>Connect your calendar</b><span>See your next meeting and join in one click.</span><button class="chip-btn" data-settings="calendar">Set up</button></div>`;
    else if (!ev) cal = `<div class="mini cal" data-go="calendar"><span class="k">Calendar</span><b>Nothing scheduled</b><span>${S.cal.error ? esc(S.cal.error) : 'Your next 7 days are clear.'}</span></div>`;
    else {
      const dt = ev.start - Date.now();
      const when = ev.allDay ? dayLabel(ev.start) : dt <= 0 ? 'Now' : sameDay(ev.start, Date.now()) && dt < 6 * 3600e3 ? rel(dt) : `${dayLabel(ev.start)} ${hhmm(ev.start)}`;
      cal = `<div class="mini cal" data-go="calendar"><span class="k">${dt <= 0 ? 'Happening now' : 'Up next'}</span><b>${esc(ev.title)}</b><span>${ev.allDay ? 'All day' : hhmm(ev.start) + ' – ' + hhmm(ev.end)} · ${esc(when)}</span>${ev.link ? joinBtn(ev) : ''}</div>`;
    }
    const T = S.timer, n = openCount(), w = water(), withWater = st().waterEnabled !== false;
    box.classList.toggle('water', withWater);
    setHtml(box, cal +
      `<button class="mini" data-act="focus">${I.timer}<b>${mmss(timerRemaining())}</b><span>${T.running ? (T.mode === 'focus' ? 'Focusing · tap to pause' : 'On a break') : T.remaining != null ? 'Paused · tap to resume' : 'Tap to focus'}</span></button>` +
      `<button class="mini" data-go="tasks">${I.todo}<b>${n}</b><span>${n === 1 ? 'task left' : 'tasks left'}${remoteOn() ? ' · synced' : ''}</span></button>` +
      (withWater ? `<button class="mini" data-act="water">${I.water}<b>${w.ml} ml</b><span>of ${st().waterGoalMl} · tap +${st().bottleMl}</span></button>` : ''));
  }
  $('#home-row').addEventListener('click', (e) => {
    if (e.target.closest('[data-join], [data-settings]')) return; // handled globally
    const a = e.target.closest('[data-act]'), g = e.target.closest('[data-go]');
    if (a && a.dataset.act === 'focus') { S.timer.running ? timerPause() : timerStart(); renderHomeRow(); return; }
    if (a && a.dataset.act === 'water') { addWater(st().bottleMl); renderHomeRow(); return; }
    if (g) goPage(g.dataset.go);
  });

  function renderCalPage() {
    const box = $('#cal-page');
    if (!(st().icsUrl || st().calendarSource === 'apple')) { setHtml(box, '<div class="cal-empty"><b>Connect your calendar</b>Connect Apple Calendar or paste an iCal link in Settings<br><a data-settings="calendar">Open calendar settings</a></div>'); return; }
    const now = Date.now();
    const evs = (S.cal.events || []).filter((e) => e.end > now - 3600e3);
    if (!evs.length) { setHtml(box, `<div class="cal-empty"><b>${S.cal.error ? 'Couldn’t load your calendar' : 'Nothing in the next 7 days'}</b>${S.cal.error ? esc(S.cal.error) : 'Enjoy the free time.'}</div>`); return; }
    let html = '', last = '';
    for (const e of evs) {
      const d = dayLabel(e.start);
      if (d !== last) { html += `<div class="cal-day">${esc(d)}</div>`; last = d; }
      html += `<div class="cal-ev ${e.end < now ? 'past' : ''}"><i></i><span class="t">${e.allDay ? 'All day' : `${hhmm(e.start)} – ${hhmm(e.end)}`}</span><span class="n"><b>${esc(e.title)}</b>${e.location ? `<span>${esc(e.location)}</span>` : ''}</span>${e.end >= now ? joinBtn(e) : ''}</div>`;
    }
    setHtml(box, html);
  }

  // Stats: polled once a second only while the Stats tab is on screen
  const bytes = (n) => { const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; } return `${n.toFixed(n < 10 && i ? 1 : 0)} ${u[i]}`; };
  function spark(data, max, color) {
    if (data.length < 2) return '<svg class="spark"></svg>';
    const W = 150, H = 44, n = data.length;
    const pts = data.map((v, i) => `${((i / (n - 1)) * W).toFixed(1)},${(H - 2 - (Math.min(v, max) / max) * (H - 4)).toFixed(1)}`).join(' ');
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><polygon points="0,${H} ${pts} ${W},${H}" fill="${color}" opacity=".15"/><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.6" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>`;
  }
  function startStats() {
    if (S.statsT) return;
    S.cpuHist = []; S.netHist = [];
    if (api.statsActive) api.statsActive(true);
    pollStats(); S.statsT = setInterval(pollStats, 1000);
  }
  function stopStats() {
    if (!S.statsT) return;
    clearInterval(S.statsT); S.statsT = 0;
    if (api.statsActive) api.statsActive(false);
  }
  async function pollStats() {
    if (!(S.expanded && S.page === 'stats')) return stopStats();
    let x; try { x = await api.getStats(); } catch (_) { return; }
    if (!(S.expanded && S.page === 'stats')) return;
    S.cpuHist.push(x.cpu); S.netHist.push(x.down);
    if (S.cpuHist.length > 40) S.cpuHist.shift();
    if (S.netHist.length > 40) S.netHist.shift();
    const memPct = Math.round(100 * x.memUsed / x.memTotal);
    const b = S.battery;
    const noBatt = !b || (b.level === 1 && b.charging && b.chargingTime === 0);
    const pct = b ? Math.round(b.level * 100) : 0;
    const up = Math.floor(x.uptime / 3600);
    setHtml($('#stats-page'), `
      <div class="stat"><div class="k">${I.cpu}CPU</div><div class="v">${x.cpu}<small>%</small></div><div class="s">${x.cores} cores</div>${spark(S.cpuHist, 100, 'var(--accent)')}</div>
      <div class="stat"><div class="k">${I.memory}Memory</div><div class="v">${memPct}<small>%</small></div><div class="s">${bytes(x.memUsed)} of ${bytes(x.memTotal)}</div><div class="meter"><i style="width:${memPct}%"></i></div></div>
      <div class="stat"><div class="k">${I.down}Network</div><div class="v" style="font-size:20px">${bytes(x.down)}/s</div><div class="s">↑ ${bytes(x.up)}/s</div>${spark(S.netHist, Math.max(1e5, ...S.netHist), '#64d2ff')}</div>
      <div class="stat"><div class="k">${I.battery}Battery</div><div class="v">${noBatt ? '—' : pct + '<small>%</small>'}</div><div class="s">${noBatt ? 'Plugged in' : b.charging ? 'Charging' : 'On battery'} · up ${up}h ${Math.floor((x.uptime % 3600) / 60)}m</div><div class="meter"><i style="width:${noBatt ? 100 : pct}%;background:${!noBatt && pct <= 20 ? 'var(--danger)' : 'var(--green)'}"></i></div></div>
      <div class="stats-foot">${x.atollMem ? `${x.memoryScope ? 'Host + helper' : 'Atoll itself'}: ${bytes(x.atollMem)} · ${Object.entries(x.atollParts || {}).sort((a, c) => c[1] - a[1]).map(([k, v]) => `${esc(k)} ${bytes(v)}`).join(' · ')}` : ''}</div>`);
  }

  /* ---------------- settings changed (in the settings window) ---------------- */
  api.onStore((s) => {
    const before = S.store;
    S.store = s;
    if (S.hud && ['volume','caps','lang','device','charge','net'].includes(S.hud.kind) && !hudEnabled(S.hud.kind)) S.hud = null;
    applyLook(); applyLyricSize();
    const b = before.settings || {}, a = s.settings || {};
    if (b.translateLyrics !== a.translateLyrics || b.showRomanization !== a.showRomanization || b.translateTo !== a.translateTo || JSON.stringify(b.understoodLanguages || []) !== JSON.stringify(a.understoodLanguages || [])) { S.translationRequest = (S.translationRequest || 0) + 1; S.trans = null; S.transKey = null; loadTranslation(); renderLyricsList(); }
    if ((before.todolist || {}).connected !== (s.todolist || {}).connected) { S.remote = { tasks: [], error: null, loading: false, at: 0 }; loadRemote(); }
    S.wingKey.r = ''; S.lastLayout = '';
    if (b.layout !== a.layout) { applyLayoutDom(); if (!pagesFor().includes(S.page)) S.page = choosePage(); if (S.expanded) renderPanel(true); }
    renderNav(); layout();
    if (S.expanded) renderPanel(false);
  });
  if (api.onLyricsSources) api.onLyricsSources(() => {
    if (S.media.active) loadLyrics(S.media, true);
  });

  /* ---------------- small animations, driven sparingly ---------------- */
  // Stepped visualizer (only when "Smooth visualizer" is off): a few steps a second
  const EQ = [[.45, .9, .6, .3, .7], [.8, .4, .95, .55, .35], [.35, .7, .5, .85, .6], [.95, .55, .3, .7, .45], [.5, .3, .8, .45, .9]];
  let eqStep = 0;
  setInterval(() => {
    if (st().smoothViz !== false || !S.media.playing || document.hidden) return;
    const v = EQ[eqStep++ % EQ.length];
    $$('.viz:not(.smooth) i').forEach((b, i) => b.style.setProperty('--s', v[i % 5]));
  }, 300);
  setInterval(() => {
    if (S.expanded || document.hidden || !st().mascot) return; // nothing to blink without the mascot's eyes
    island.classList.add('blink'); setTimeout(() => island.classList.remove('blink'), 130);
  }, 5200);

  // While closed for a while, drop the heavy lists; they're rebuilt when you open it.
  function releaseIdle() {
    if (S.expanded) return;
    for (const sel of ['#cb-list', '#shelf-grid', '#t-list', '#cal-page', '#stats-page', '#home-row']) { const el = $(sel); if (el) { el.innerHTML = ''; el.__h = null; } }
    const ol = $('#m-lyr'); if (ol) { ol.innerHTML = ''; ol.dataset.released = '1'; }
    S.icons.clear();
  }
  setInterval(() => { if (!S.expanded && Date.now() - S.lastHoverAt > 20000) releaseIdle(); }, 20000);

  /* ---------------- loops ---------------- */
  setInterval(() => {
    if (document.hidden || !S.media.active || !S.media.playing) return;
    const seen = S.expanded ? lyricsShown() : (st().lyricsInNotch && S.lyrics && S.lyrics.synced);
    if (seen) updateLyrics(false);
    if (playerShown() && !$('#m-bar').classList.contains('scrub')) renderProgress();
  }, 200);

  let tick = 0;
  setInterval(() => {
    tick++;
    maybeRetryLyrics();
    if (S.timer.running && timerRemaining() <= 0) timerFinish(true);
    if (S.expanded && ['today', 'focus'].includes(S.page)) renderFocus();
    if (S.expanded && S.page === 'home' && (S.timer.running || tick % 15 === 0)) renderHomeRow();
    if (S.expanded && isTabs()) renderClock();
    if (tick % 60 === 0 && remoteOn()) loadRemote();
    if (tick % 15 === 0) { checkTodos(); checkRemoteReminders(); checkMeetings(); checkWater(); }
    layout(); // cheap: only touches the DOM when something actually changed
  }, 1000);

  /* ---------------- boot ---------------- */
  applyLook();
  applyLyricSize();
  applyLayoutDom();
  renderNav();
  loadClips();
  if (api.askPlace) api.askPlace();
  await loadCalendar();
  loadRemote();
  layout();
  setTimeout(() => { checkTodos(); checkMeetings(); }, 2000);

  window.__atoll = { S, notify, showHud, volHud, layout, open, close, goPage, timerStart, setMoving, shapeRect };
})();
