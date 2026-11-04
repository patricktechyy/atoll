// Shared by the renderer and deterministic tests. Catch up to Apple's slider;
// smooth backward noise and corroborate discontinuities before accepting seeks.
(function (root) {
  function reconcile(previous, next, elapsed, state, now, justSeeked = false) {
    const position = typeof next.position === 'number' ? next.position : NaN;
    const source = next.posSource === 'app' ? 'app' : 'session';
    if (!previous.active || previous.key !== next.key || state.key !== next.key) {
      state.key = next.key; state.pending = null; state.source = source;
      state.appAt = source === 'app' ? now : -Infinity;
      return Number.isFinite(position) ? Math.max(0, position) : 0;
    }
    const dt = Math.max(0, elapsed);
    let predicted = previous.position + (previous.playing ? dt : 0);
    if (next.duration > 0) predicted = Math.min(next.duration, predicted);
    if (source === 'app') state.appAt = now;
    if (justSeeked || !Number.isFinite(position)) { state.pending = null; return predicted; }
    // The first real slider reading replaces the unreliable session estimate.
    // Requiring a moving sequence here could leave a coarse/frozen slider unable
    // to correct a clock that started several seconds behind the music.
    if (source === 'app' && (state.source !== 'app' || previous.playing !== next.playing)) {
      state.source = source; state.pending = null;
      return Math.max(0, position);
    }
    // A brief UIA failure must not switch the clock to a conflicting Windows report.
    if (source === 'session' && now - state.appAt < 8000) { state.pending = null; return predicted; }
    state.source = source;
    const error = position - predicted;
    if (Math.abs(error) <= (source === 'app' ? 1.5 : 3)) {
      state.pending = null;
      if (Math.abs(error) <= 0.25) return predicted;
      // Catch up to the player's slider immediately for small forward errors.
      // A slow 15% slew used to keep lyrics late even with a valid app clock.
      if (source === 'app' && error > 0) return Math.max(0, position);
      // Never move backward under ordinary playback. Allow at most 15% clock slew.
      const adjustment = Math.min(dt, 1) * 0.15;
      return Math.max(0, predicted + Math.max(-adjustment, Math.min(adjustment, error)));
    }
    const pending = state.pending;
    const consistent = pending && pending.source === source && pending.playing === next.playing &&
      Math.abs(position - pending.position - (next.playing ? (now - pending.at) / 1000 : 0)) < 1.5;
    if (!consistent) {
      state.pending = { source, position, firstPosition: position, playing: next.playing, at: now, first: now, count: 1 };
      return predicted;
    }
    pending.position = position; pending.at = now; pending.count++;
    const confirmMs = source === 'app' ? 500 : 1000;
    // Frozen reports are not evidence of a seek while the player claims it is playing.
    const progressed = !next.playing || position - pending.firstPosition >= 0.2;
    if (pending.count >= 3 && now - pending.first >= confirmMs && progressed) {
      state.pending = null;
      return Math.max(0, position);
    }
    return predicted;
  }
  if (typeof module === 'object' && module.exports) module.exports = { reconcile };
  else root.AppleClock = { reconcile };
})(typeof window === 'object' ? window : globalThis);
