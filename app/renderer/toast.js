// A notification card that pops up somewhere on the screen (top centre, a corner…),
// with the same spring physics as the notch. Clicks go back to the notch, which runs the action.
(function () {
  const api = window.toastApi || { onShow() {}, event(e) { console.log('event', JSON.stringify(e)); }, interactive() {}, ready() {} };
  const $ = (s) => document.querySelector(s);
  const card = $('#card');
  const M = window.Motion;
  let cur = null, timer = 0, left = 0, startedAt = 0, barAnim = null, leaving = false;

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // where it comes from: drops down from the top, rises from the bottom
  function frames(pos) {
    if (pos === 'top-center') return [{ transform: 'scale(.35, .2) translateY(-60px)', opacity: 0.4, filter: 'blur(6px)' }, { transform: 'none', opacity: 1, filter: 'none' }];
    const fromTop = pos.startsWith('top');
    return [{ transform: `translateY(${fromTop ? -26 : 26}px) scale(.9)`, opacity: 0, filter: 'blur(4px)' }, { transform: 'none', opacity: 1, filter: 'none' }];
  }
  const origin = (pos) => (pos === 'top-center' ? '50% 0' : pos.startsWith('top') ? '50% 0' : '50% 100%');

  function show(n) {
    cur = n; leaving = false;
    document.documentElement.dataset.theme = n.theme;
    document.documentElement.style.setProperty('--accent', n.accent);
    if (n.tint) document.documentElement.style.setProperty('--tint', n.tint);
    card.className = `p-${n.pos}${n.image ? ' img' : ''}`;
    card.style.transformOrigin = origin(n.pos);
    const notif = $('#notif');
    notif.classList.toggle('has-img', !!n.image);
    $('#n-icon').innerHTML = n.iconSvg || esc(n.iconText) || '';
    if (n.image) $('#n-img').src = n.image;
    $('#n-title').textContent = n.title || '';
    $('#n-app').textContent = n.app || '';
    $('#n-body').textContent = n.body || '';
    const acts = $('#n-actions'); acts.innerHTML = '';
    (n.actions || []).forEach((a, i) => {
      const b = document.createElement('button');
      b.className = 'pill small' + (a.primary ? ' accent' : '');
      b.textContent = a.label;
      b.onclick = (e) => { e.stopPropagation(); api.event({ id: n.id, type: 'action', i }); hide(); };
      acts.appendChild(b);
    });
    card.style.opacity = 1;
    card.animate(frames(n.pos), { duration: M.open.duration, easing: M.open.easing, fill: 'both' });
    left = n.ms; run();
  }

  function run() {
    clearTimeout(timer);
    startedAt = Date.now();
    timer = setTimeout(hide, left);
    const bar = $('#bar i');
    if (barAnim) barAnim.cancel();
    const from = left / cur.ms;
    barAnim = bar.animate([{ transform: `scaleX(${from})` }, { transform: 'scaleX(0)' }], { duration: left, easing: 'linear', fill: 'forwards' });
  }
  function pause() {
    if (!cur || leaving) return;
    clearTimeout(timer);
    left = Math.max(1500, left - (Date.now() - startedAt));
    if (barAnim) barAnim.pause();
  }

  function hide() {
    if (!cur || leaving) return;
    leaving = true;
    clearTimeout(timer);
    const n = cur;
    const out = card.animate([...frames(n.pos)].reverse(), { duration: Math.round(M.close.duration * 0.8), easing: M.close.easing, fill: 'both' });
    out.onfinish = () => { card.style.opacity = 0; cur = null; api.interactive(false); api.event({ id: n.id, type: 'done' }); };
  }

  card.addEventListener('mouseenter', () => { api.interactive(true); pause(); });
  card.addEventListener('mouseleave', () => { api.interactive(false); if (cur && !leaving) { left = Math.min(left, 3000); run(); } });
  card.addEventListener('click', () => { if (!cur) return; if (cur.clickable) api.event({ id: cur.id, type: 'click' }); hide(); });

  api.onShow(show);
  api.ready();
  window.__toast = { show, hide };
})();
