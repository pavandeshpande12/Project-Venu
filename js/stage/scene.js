import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createRenderer, createComposer, getQuality } from './renderer.js';
import { loadFlute, swayFeather } from './flute.js';
import { createCameraPath } from './camera.js';
import { Particles, DustMotes } from './particles.js';
import { smoothstep, interpKeyframes } from '../math.js';

const BACKGROUND = 0x080810;
const REDUCE_MOTION = matchMedia('(prefers-reduced-motion: reduce)').matches;

const BG_COLORS = [
  [0,    [8, 8, 16]],
  [0.13, [12, 10, 18]],
  [0.28, [10, 12, 8]],
  [0.43, [14, 10, 6]],
  [0.58, [12, 8, 10]],
  [0.73, [6, 14, 16]],
  [0.89, [10, 6, 16]],
  [1.0,  [6, 4, 10]],
];

const AMBIENT_COLORS = [
  [0,    [201, 168, 76]],
  [0.13, [212, 155, 100]],
  [0.28, [150, 135, 55]],
  [0.43, [201, 168, 76]],
  [0.58, [165, 125, 50]],
  [0.73, [42, 138, 138]],
  [0.89, [110, 70, 150]],
  [1.0,  [110, 70, 150]],
];

const TILT = [
  [0, 0],       [0.10, 0],
  [0.16, -0.02],[0.25, -0.02],
  [0.31, 0.015],[0.40, 0.015],
  [0.46, -0.01],[0.55, -0.01],
  [0.61, 0.025],[0.70, 0.025],
  [0.76, -0.035],[0.85, -0.035],
  [0.92, 0],    [1.0, 0],
];

function createLights(scene, renderer) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.18;
  pmrem.dispose();

  const key = new THREE.SpotLight(0xfff0d0, 190, 0, 0.5, 0.8, 2);
  key.position.set(-4, 10, 12);
  key.target.position.set(0, 0, 0);
  key.castShadow = true;
  const shadowRes = getQuality() === 'high' ? 1024 : 512;
  key.shadow.mapSize.set(shadowRes, shadowRes);
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;

  const rim = new THREE.DirectionalLight(0xc9a84c, 1.4);
  rim.position.set(6, 4, -4);

  const fill = new THREE.DirectionalLight(0x4a6090, 0.5);
  fill.position.set(-6, 2, -2);

  const accent = new THREE.PointLight(0xc9a84c, 2, 8, 2);
  accent.position.set(0, 0.5, 1);

  scene.add(key, key.target, rim, fill, accent);
  return { key, rim, fill, accent };
}

export async function createStage(canvas, onProgress) {
  const renderer = createRenderer(canvas);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BACKGROUND);
  scene.fog = new THREE.FogExp2(BACKGROUND, 0.06);

  const camera = new THREE.PerspectiveCamera(
    35, window.innerWidth / window.innerHeight, 0.01, 50
  );

  if (onProgress) onProgress(0.2);

  // the model download is the slow part: spread it over the 0.2 -> 0.5 stretch of the loading bar
  const flute = await loadFlute((k) => onProgress && onProgress(0.2 + 0.3 * k));
  scene.add(flute);
  if (onProgress) onProgress(0.5);

  const lights = createLights(scene, renderer);
  const cameraPath = createCameraPath(camera);

  const particles = new Particles();
  scene.add(particles.points);
  const dust = new DustMotes();
  scene.add(dust.points);
  if (onProgress) onProgress(0.7);

  const { composer, bloom, film, bokeh } = createComposer(renderer, scene, camera);
  if (onProgress) onProgress(0.9);

  try { await renderer.compileAsync(scene, camera); } catch {}
  if (onProgress) onProgress(1);

  let mx = 0, my = 0;
  let pulseT = 0;
  const baseBloomStrength = bloom.strength;
  const baseFogDensity = scene.fog.density;
  const baseEnvIntensity = scene.environmentIntensity;
  const baseToneExposure = renderer.toneMappingExposure;

  let dragRX = 0, dragRY = 0;
  let spinX = 0, spinY = 0;
  let dragging = false;

  function setMouse(x, y) { mx = x; my = y; }
  function triggerPulse() { pulseT = 1; }
  function setDrag(rx, ry) { dragRX = rx; dragRY = ry; }
  function setDragging(v) { dragging = v; }

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    composer.setSize(w, h);
  }

  // if the device cannot keep up, quietly draw fewer pixels (never goes back up, so it cannot flip-flop)
  let age = 0, slow = 0, frameEma = 1 / 60;
  function watchSpeed(dt) {
    age += dt;
    frameEma += (dt - frameEma) * 0.06;
    if (age < 4) return;                                   // skip start-up (shader compiling, textures arriving)
    slow = frameEma > 1 / 34 ? slow + dt : Math.max(0, slow - dt * 2);
    const ratio = renderer.getPixelRatio();
    if (slow > 2 && ratio > 1) {
      renderer.setPixelRatio(Math.max(1, ratio * 0.8));
      resize();
      slow = 0;
    }
  }

  function update(progress, wallTime, dt) {
    watchSpeed(dt);
    const time = REDUCE_MOTION ? 0 : wallTime;       // reduced motion: nothing sways, drifts or flickers on its own
    cameraPath.update(progress, mx, my);

    const tilt = interpKeyframes(TILT, progress, 1);
    flute.rotation.z = tilt + cameraPath.portraitTilt;

    // ease toward the drag target: the flute follows the finger smoothly instead of jumping to it
    const follow = 1 - Math.exp(-(dragging ? 16 : 5) * dt);
    spinY += (dragRY - spinY) * follow;
    spinX += (dragRX - spinX) * follow;
    flute.rotation.y = spinY;
    flute.rotation.x = 0.25 + spinX;

    const bg = interpKeyframes(BG_COLORS, progress, 3);
    scene.background.setRGB(bg[0] / 255, bg[1] / 255, bg[2] / 255);
    scene.fog.color.setRGB(bg[0] / 255, bg[1] / 255, bg[2] / 255);

    const fluteOpacity = 1 - smoothstep(0.87, 0.92, progress);
    flute.visible = fluteOpacity > 0.01;

    const ac = interpKeyframes(AMBIENT_COLORS, progress, 3);
    lights.accent.color.setRGB(ac[0] / 255, ac[1] / 255, ac[2] / 255);

    const pGlow = pulseT * pulseT;

    lights.accent.intensity = 2 + smoothstep(0.7, 0.8, progress) * 3 + pGlow * 3;
    lights.key.intensity = 190 + pGlow * 20;
    lights.rim.intensity = 1.4 + pGlow * 1;
    lights.fill.intensity = 0.5 + pGlow * 0.3;

    bloom.strength = baseBloomStrength + pGlow * 0.25;
    // phone screens (small, and often dimmed to save battery) get a little more light
    const tall = Math.min(1, Math.max(0, (0.8 - camera.aspect) / 0.3));
    renderer.toneMappingExposure = baseToneExposure * (1 + 0.28 * tall);
    // the fog gives depth to close-ups. When the camera pulls back (phones, to fit the whole flute) it must thin out,
    // or it would swallow most of the flute's light: keep the same total fog between camera and flute
    const camDist = camera.position.distanceTo(cameraPath.target);
    scene.fog.density = baseFogDensity * Math.min(1, 4.5 / camDist) ** 1.6;
    scene.environmentIntensity = baseEnvIntensity + pGlow * 0.1;

    if (pulseT > 0) pulseT = Math.max(0, pulseT - dt * 0.7);

    if (!REDUCE_MOTION) particles.update();
    particles.setIntensity(fluteOpacity + pGlow * 0.15);
    dust.update(time);

    swayFeather(flute.userData.feather, time);

    if (bokeh) {
      const focusDist = camera.position.distanceTo(cameraPath.target);
      bokeh.uniforms['focus'].value = focusDist;
      bokeh.uniforms['aperture'].value = 0.001 + (1 / (focusDist + 0.5)) * 0.003;
    }

    film.uniforms.uTime.value = time;

    composer.render();
  }

  resize();
  return { update, resize, setMouse, triggerPulse, setDrag, setDragging };
}
