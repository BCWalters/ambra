export function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

export function leafSegments(progress, width, count = 24, curl = 0.65) {
  const p = clamp(progress);
  const length = width / count;
  let x = 0;
  let z = 0;
  return Array.from({ length: count }, (_, index) => {
    const t = (index + 0.5) / count;
    const angle = -Math.PI * p + curl * Math.sin(Math.PI * p) * (2 * t - 1);
    const segment = { x, z, angle, width: length, offset: index * length };
    x += length * Math.cos(angle);
    z -= length * Math.sin(angle);
    return segment;
  });
}

export function shouldCommit(progress, velocity, threshold = 0.4) {
  if (progress >= threshold) return true;
  if (velocity < -0.45) return false;
  if (velocity > 0.45) return true;
  return false;
}

export function easedProgress(time) {
  const t = clamp(time);
  return t * t * (3 - 2 * t);
}
