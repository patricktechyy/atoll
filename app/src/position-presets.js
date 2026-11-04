const key = p => p && p.mode === 'side' ? (p.side === 'left' ? 'left' : 'right') : 'top';
function remember(settings) {
  settings.positionPresets = { ...(settings.positionPresets || {}), [key(settings.position)]: { ...settings.position } };
}
function select(settings, mode, height = 900) {
  remember(settings);
  const display = (settings.position || {}).display || 'primary';
  // the screen is a global choice: a remembered layout keeps its offsets but not an older screen
  settings.position = { ...(settings.positionPresets[mode] || (mode === 'top'
    ? { mode: 'top', frac: 0.5, top: 0 }
    : { mode: 'side', side: mode, cy: height / 2, inset: 0 })), display };
  remember(settings);
  return settings.position;
}
function cycle(settings, height) { const order = ['top', 'right', 'left']; return select(settings, order[(order.indexOf(key(settings.position)) + 1) % 3], height); }
module.exports = { key, remember, select, cycle };
