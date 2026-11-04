// Coordinates and threshold are Windows device-independent pixels.
module.exports = function snapPosition(value, length) {
  const target = [0.25, 0.5, 0.75].map(f => f * length)
    .reduce((a, b) => Math.abs(a - value) <= Math.abs(b - value) ? a : b);
  return { target, matched: Math.abs(target - value) <= 16 };
};
