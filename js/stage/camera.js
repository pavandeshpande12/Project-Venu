import * as THREE from 'three';
import { smoothstep, lerp } from '../math.js';

// [progress, [posX, posY, posZ], [targetX, targetY, targetZ], fit, portraitShift]
// fit = 1 for the full-flute shots, which pull back on narrow screens to keep the flute in frame
const KEYFRAMES = [
  [0.00,  [0, 0.35, 3.2],     [0, 0, 0],            1, 0],
  [0.10,  [0, 0.35, 3.2],     [0, 0, 0],            1, 0],
  [0.16,  [-1.2, 0.03, 0.9],  [-1.45, -0.055, 0],   0, 0],
  [0.25,  [-1.2, 0.03, 0.9],  [-1.45, -0.055, 0],   0, 0],
  [0.31,  [-0.2, 0.22, 1.1],  [0, 0, 0],            0, 0],
  [0.40,  [-0.2, 0.22, 1.1],  [0, 0, 0],            0, 0],
  [0.46,  [0.4, 0.16, 0.55],  [0.3, 0.02, 0],       0, 0],
  [0.55,  [0.4, 0.16, 0.55],  [0.3, 0.02, 0],       0, 0],
  [0.61,  [0.75, -0.02, 1.1], [0.75, -0.17, 0],     0, 0],
  [0.70,  [0.75, -0.02, 1.1], [0.75, -0.17, 0],     0, 0],
  [0.76,  [0.55, 0.0, 3.9],   [0.55, -0.06, 0],      0, 1],
  [0.85,  [0.55, 0.0, 3.9],   [0.55, -0.06, 0],      0, 1],
  [0.92,  [0, 0.4, 3.2],      [0, 0, 0],            1, 0],
  [1.00,  [0, 0.6, 3.5],      [0, 0.2, 0],          1, 0],
];

const PARALLAX_SCALE = 0.045;
const WIDE_Z = 3.2;        // z of the full-flute shots (hero, closing)
const FIT_HALF_WIDTH = 2.3; // half-width of flute + feather that must stay in frame on wide (non-tilted) screens
const PORTRAIT_SHIFT = 2.5;  // sideways shift (world units) for shots flagged portraitShift, on tall screens
const PORTRAIT_LIFT = 0.35;  // upward shift (world units) for the same shots
const PORTRAIT_TILT = 0;     // radians of extra roll for the full-flute shots on tall screens (0 = lies straight; try -0.3 for a slant)
const TILT_HALF_WIDTH = 2.5;  // half-width the tilted flute needs
const MAX_FIT = 7;         // safety cap on the pull-back (a real phone needs about 4-5)

export function createCameraPath(camera) {
  const pos = new THREE.Vector3();
  const target = new THREE.Vector3();
  let fitWeight = 0;
  let shiftWeight = 0;
  let tallness = 0;
  let zoomGoal = 1, zoomNow = 1, zoomFx = 0, zoomFy = 0;   // pinch zoom: 1 = the normal view; fx, fy = where on the screen (-1..1) it zooms toward

  function interpolate(progress) {
    let idx = 0;
    for (let j = 0; j < KEYFRAMES.length - 1; j++) {
      if (progress >= KEYFRAMES[j][0] && progress <= KEYFRAMES[j + 1][0]) {
        idx = j;
        break;
      }
    }
    if (progress >= KEYFRAMES[KEYFRAMES.length - 1][0]) idx = KEYFRAMES.length - 2;

    const a = KEYFRAMES[idx];
    const b = KEYFRAMES[idx + 1];
    const range = b[0] - a[0];
    const t = range > 0 ? smoothstep(0, 1, (progress - a[0]) / range) : 0;

    pos.set(
      lerp(a[1][0], b[1][0], t),
      lerp(a[1][1], b[1][1], t),
      lerp(a[1][2], b[1][2], t)
    );
    target.set(
      lerp(a[2][0], b[2][0], t),
      lerp(a[2][1], b[2][1], t),
      lerp(a[2][2], b[2][2], t)
    );
    fitWeight = lerp(a[3], b[3], t);
    shiftWeight = lerp(a[4], b[4], t);
  }

  return {
    update(progress, mouseX = 0, mouseY = 0, dt = 0.016) {
      interpolate(progress);

      // only the full-flute shots pull back; close-ups keep their framing
      const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      tallness = THREE.MathUtils.clamp((0.8 - camera.aspect) / 0.3, 0, 1);
      const need = THREE.MathUtils.lerp(FIT_HALF_WIDTH, TILT_HALF_WIDTH, tallness);       // tilted, it needs less width
      const fit = THREE.MathUtils.clamp(need / (halfH * camera.aspect) / WIDE_Z, 1, MAX_FIT);
      pos.z *= 1 + (fit - 1) * fitWeight;
      // on tall screens the whole flute is a thin line near the middle, so sit it a little lower, under the title
      if (camera.aspect < 0.8) {
        const sink = 0.07 * 2 * halfH * pos.z * fitWeight;
        pos.y += sink;
        target.y += sink;
      }

      // tall screens: slide the view toward the feather end so the ferrule stays in frame
      const tall = Math.max(0, 1 - camera.aspect) * shiftWeight;
      pos.x += PORTRAIT_SHIFT * tall;
      target.x += PORTRAIT_SHIFT * tall;
      // ...and up, so the hanging tassels clear the caption text below
      pos.y -= PORTRAIT_LIFT * tall;
      target.y -= PORTRAIT_LIFT * tall;

      // pinch zoom (phones): move in toward the pinched spot. Only the full-flute shots zoom; the close-ups already are close
      zoomNow += (zoomGoal - zoomNow) * (1 - Math.exp(-9 * (dt || 0.016)));
      const z = 1 + (zoomNow - 1) * fitWeight;
      if (z > 1.001) {
        const d = Math.abs(pos.z - target.z);
        const k = 1 - 1 / z;
        const ox = zoomFx * d * halfH * camera.aspect * k;
        const oy = zoomFy * d * halfH * k;
        pos.x += ox; target.x += ox;
        pos.y += oy; target.y += oy;
        pos.z = target.z + (pos.z - target.z) / z;
      }

      const dist = pos.distanceTo(target);
      const scale = dist * PARALLAX_SCALE;
      pos.x += mouseX * scale;
      pos.y -= mouseY * scale * 0.5;

      camera.position.copy(pos);
      camera.lookAt(target);
    },
    get target() { return target; },
    setZoom(z, fx = 0, fy = 0) { zoomGoal = Math.min(3.6, Math.max(1, z)); zoomFx = fx; zoomFy = fy; },
    get zoomGoal() { return zoomGoal; },
    // extra roll for the flute, only in the full-flute shots and only on tall screens
    get portraitTilt() { return PORTRAIT_TILT * tallness * fitWeight; },
  };
}
