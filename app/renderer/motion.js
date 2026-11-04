// Motion, tuned to Alcove (measured frame by frame from a 120 fps screen recording):
//  • hover "breathe": ~9% wider, +5 px taller, ~170 ms, no wobble
//  • open: a spring with ~8% overshoot, peak at ~0.25 s, settled by ~0.5 s; width and height together
//  • close: critically damped (no bounce), ~0.45 s
//  • content: laid out at its final size, revealed by the growing shape, fading in from a blur
//
// The island's geometry is driven by real springs in JS (not CSS transitions) so that an
// interrupted animation (hover out while opening, a notification during a close…) keeps its
// velocity and bends smoothly to the new target instead of restarting.
(function () {
  const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  // mass = 1. stiffness k, damping c.  ζ = c / (2√k)
  const PRESETS = {
    open:    { k: 250, c: 19 },   // ζ≈0.6 → ~9% overshoot, peak ≈ 0.25 s (Alcove's open)
    close:   { k: 220, c: 30 },   // ζ≈1.0 → no overshoot, half-way at ~0.1 s, ~0.45 s (Alcove's close)
    breathe: { k: 700, c: 46 },   // ζ≈0.87 → ~170 ms, barely any overshoot
    morph:   { k: 330, c: 27 },   // ζ≈0.74 → activities / HUDs / notifications changing shape
    snap:    { k: 900, c: 60 }
  };

  // Many keys animated together on one rAF loop; retargeting keeps each key's velocity.
  function animator(apply, initial, onRest) {
    const s = {};
    for (const [k, v] of Object.entries(initial)) s[k] = { x: v, v: 0, to: v, p: PRESETS.open };
    let raf = 0, last = 0;
    const step = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000 || 1 / 60);
      last = now;
      let moving = false;
      const n = Math.max(1, Math.ceil(dt / (1 / 240))); // fixed sub-steps: stable at any frame rate
      const h = dt / n;
      for (const key in s) {
        const q = s[key];
        if (q.x === q.to && q.v === 0) continue;
        for (let i = 0; i < n; i++) {
          const a = -q.p.k * (q.x - q.to) - q.p.c * q.v;
          q.v += a * h; q.x += q.v * h;
        }
        if (Math.abs(q.x - q.to) < 0.05 && Math.abs(q.v) < 0.5) { q.x = q.to; q.v = 0; } else moving = true;
      }
      apply(val());
      raf = moving ? requestAnimationFrame(step) : 0;
      if (!moving && onRest) onRest();
    };
    const val = () => { const o = {}; for (const k in s) o[k] = s[k].x; return o; };
    return {
      to(target, preset = 'open', presetsPerKey = {}) {
        for (const [k, v] of Object.entries(target)) {
          if (!s[k]) s[k] = { x: v, v: 0, to: v, p: PRESETS.open };
          s[k].to = v;
          s[k].p = PRESETS[presetsPerKey[k] || preset] || PRESETS.open;
          if (reduce) { s[k].x = v; s[k].v = 0; }
        }
        if (reduce) { apply(val()); if (onRest) onRest(); return; }
        if (!raf) { last = performance.now(); raf = requestAnimationFrame(step); }
      },
      set(target) { for (const [k, v] of Object.entries(target)) s[k] = { x: v, v: 0, to: v, p: PRESETS.open }; apply(val()); },
      get: val,
      get busy() { return !!raf; }
    };
  }

  // Easing curves for the small CSS bits (buttons, chips, page slides): same springs as linear() curves.
  function curve({ k, c }) {
    const dt = 1 / 600; let x = 0, v = 0, t = 0; const out = [0]; let next = 1 / 60;
    while (t < 2) {
      v += (-k * (x - 1) - c * v) * dt; x += v * dt; t += dt;
      if (t >= next) { out.push(+x.toFixed(4)); next += 1 / 60; }
      if (t > 0.08 && Math.abs(x - 1) < 0.002 && Math.abs(v) < 0.05) break;
    }
    out.push(1);
    return { easing: `linear(${out.join(', ')})`, duration: Math.round(t * 1000) };
  }
  const root = document.documentElement.style;
  const css = reduce
    ? { open: { easing: 'ease-out', duration: 120 }, close: { easing: 'ease-out', duration: 120 }, content: { easing: 'ease-out', duration: 120 }, pop: { easing: 'ease-out', duration: 120 } }
    : { open: curve(PRESETS.open), close: curve(PRESETS.close), content: curve({ k: 380, c: 34 }), pop: curve({ k: 520, c: 30 }) };
  for (const [k, v] of Object.entries(css)) { root.setProperty(`--ease-${k}`, v.easing); root.setProperty(`--dur-${k}`, v.duration + 'ms'); }

  window.Motion = { animator, PRESETS, reduce, ...css };
})();
