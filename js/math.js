export function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function smoothstep(edge0, edge1, x) {
  if (edge1 === edge0) return x >= edge0 ? 1 : 0;
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function windowOpacity(w, p) {
  if (p < w[0] || p > w[3]) return 0;
  if (p >= w[1] && p <= w[2]) return 1;
  if (p < w[1]) return smoothstep(w[0], w[1], p);
  return 1 - smoothstep(w[2], w[3], p);
}

export function interpKeyframes(keyframes, progress, valueCount) {
  let idx = 0;
  for (let j = 0; j < keyframes.length - 1; j++) {
    if (progress >= keyframes[j][0] && progress <= keyframes[j + 1][0]) {
      idx = j;
      break;
    }
  }
  if (progress >= keyframes[keyframes.length - 1][0]) idx = keyframes.length - 2;

  const a = keyframes[idx];
  const b = keyframes[idx + 1];
  const range = b[0] - a[0];
  const t = range > 0 ? smoothstep(0, 1, (progress - a[0]) / range) : 0;

  if (valueCount === 1) return lerp(a[1], b[1], t);
  const result = [];
  for (let k = 0; k < valueCount; k++) result.push(lerp(a[1][k], b[1][k], t));
  return result;
}
