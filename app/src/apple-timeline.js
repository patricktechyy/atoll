// UI Automation ranges are control units, not necessarily seconds.
function sliderScale(min, max, duration) {
  const span = max - min;
  if (![min, max, duration].every(Number.isFinite) || span <= 0 || duration <= 0) return null;
  const near = (a, b) => Math.abs(a - b) <= Math.max(0.02, Math.abs(b) * 0.02);
  // Seconds, a normalized fraction/percentage, or milliseconds. Reject stale ranges
  // from another song instead of replacing the media session's duration with them.
  if (!(near(span, duration) || near(span, 1) || near(span, 100) || near(span, duration * 1000))) return null;
  return duration / span;
}
function sliderSeconds(value, min, max, duration) {
  const scale = sliderScale(min, max, duration);
  if (scale === null || !Number.isFinite(value) || value < min || value > max) return null;
  return (value - min) * scale;
}
function sliderValue(seconds, min, max, duration) {
  const scale = sliderScale(min, max, duration);
  return scale === null || !Number.isFinite(seconds) ? null : min + Math.max(0, Math.min(duration, seconds)) / scale;
}
// A cached session sample is still anchored at its original receipt time. Slider
// failures and snapshot requests must not replay it as if it had just arrived.
function projectMedia(media, now) {
  if (!media || !media.active || !Number.isFinite(media.positionAt)) return media;
  const elapsed = media.playing ? Math.max(0, now - media.positionAt) / 1000 : 0;
  return { ...media, position: Math.max(0, Math.min(media.duration > 0 ? media.duration : Infinity,
    media.position + elapsed)), positionAt: now };
}
module.exports = { sliderScale, sliderSeconds, sliderValue, projectMedia };
