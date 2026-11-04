// Area picker drawn over a frozen copy of the screen.
(function () {
  const $ = (s) => document.querySelector(s);
  const box = $('#box'), size = $('#size'), hint = $('#hint'), lx = $('#lx'), ly = $('#ly');
  let start = null;

  const api = window.snip || { onImage() {}, ready() {}, done(r) { console.log('done', JSON.stringify(r)); } };
  api.onImage((b64) => {
    $('#shot').onload = () => api.ready();
    $('#shot').src = 'data:image/jpeg;base64,' + b64;
  });

  const rect = (e) => {
    const x = Math.min(start.x, e.clientX), y = Math.min(start.y, e.clientY);
    return { x, y, w: Math.abs(e.clientX - start.x), h: Math.abs(e.clientY - start.y) };
  };
  const draw = (r) => {
    Object.assign(box.style, { display: 'block', left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' });
    size.textContent = `${Math.round(r.w * devicePixelRatio)} × ${Math.round(r.h * devicePixelRatio)}`;
    Object.assign(size.style, { display: 'block', left: r.x + 'px', top: Math.max(4, r.y - 26) + 'px' });
  };

  window.addEventListener('mousemove', (e) => {
    lx.style.top = e.clientY + 'px'; ly.style.left = e.clientX + 'px';
    if (start) draw(rect(e));
  });
  window.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return api.done(null);
    start = { x: e.clientX, y: e.clientY };
    document.body.classList.remove('full');
    hint.style.opacity = 0; lx.style.display = ly.style.display = 'none';
    draw({ x: start.x, y: start.y, w: 0, h: 0 });
  });
  window.addEventListener('mouseup', (e) => {
    if (!start) return;
    const r = rect(e);
    start = null;
    api.done(r);
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') api.done(null);
    if (e.key === 'Enter') api.done({ x: 0, y: 0, w: innerWidth, h: innerHeight });
  });
  window.addEventListener('contextmenu', (e) => { e.preventDefault(); api.done(null); });
})();
