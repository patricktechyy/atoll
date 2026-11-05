const path = require('node:path');
const { capabilities } = require('./platform');

function readSafeAreas() {
  return require(path.join(process.resourcesPath, 'helper', 'platform.node')).screenSafeAreas();
}

function displayCutout(display, caps = capabilities(), read = readSafeAreas) {
  if (!caps.displaySafeArea) return null;
  try {
    const area = read().find((area) => String(area.id) === String(display.id));
    if (area && Number.isFinite(area.top) && area.top >= 0) {
      if (area.top === 0) return null;
      if (Number.isFinite(area.left) && area.left >= 0 && Number.isFinite(area.width) && area.width > 0 && area.left + area.width <= display.bounds.width) {
        return { x: area.left, y: 0, width: area.width, height: area.top };
      }
    }
  } catch (_) { /* Older/missing native module: reserve the internal display's entire top row. */ }
  // Never infer a notch from the menu bar alone. This conservative fallback applies only when
  // native geometry is unavailable, only on the internal screen, and is recalculated each time.
  const inset = display.workArea?.y - display.bounds.y;
  return display.internal && Number.isFinite(inset) && inset > 0 ? { x: 0, y: 0, width: display.bounds.width, height: inset } : null;
}

function windowCutout(display, bounds, zoom) {
  const cutout = displayCutout(display);
  return cutout && { x: (display.bounds.x + cutout.x - bounds.x) / zoom, y: (display.bounds.y - bounds.y) / zoom, width: cutout.width / zoom, height: cutout.height / zoom };
}

module.exports = { displayCutout, windowCutout };
