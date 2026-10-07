import { createStage } from './stage/scene.js';
import { clamp, smoothstep, windowOpacity } from './math.js';
import { initAudio, toggleSound, armAutoplay, onMusicStart } from './audio.js';

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const phone = matchMedia('(pointer: coarse)').matches && Math.min(innerWidth, innerHeight) < 700;
const PROGRESS_EASE = reduceMotion ? 18 : phone ? 9 : 5;   // phones follow the thumb more closely; reduced motion: almost instantly
const FRAME_MAX = 0.05;
const MOUSE_EASE = 3;

const journey = document.getElementById('journey');
// a mouse wheel covers 8 screens easily, a thumb does not: the journey is shorter on phones (the chapters keep their order)
if (matchMedia('(pointer: coarse)').matches && Math.min(innerWidth, innerHeight) < 700) journey.style.height = CSS.supports('height', '1lvh') ? '540lvh' : '540vh';   // lvh: the full-size screen, so the length cannot change with the address bar
const soundBtn = document.getElementById('sound-btn');
const scrollPrompt = document.getElementById('scroll-prompt');
const loader = document.getElementById('loader');
const progressBar = document.getElementById('progress-bar');

// ── custom cursor + golden trail ─────────────────────────────
const cursorDot = document.querySelector('.cursor-dot');
const cursorRing = document.querySelector('.cursor-ring');
if (cursorDot && matchMedia('(hover: hover)').matches) {
  let cx = -100, cy = -100, rx = -100, ry = -100;

  // trail canvas
  const trailCanvas = document.createElement('canvas');
  trailCanvas.id = 'cursor-trail';
  trailCanvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:9998;';
  document.body.appendChild(trailCanvas);
  const tCtx = trailCanvas.getContext('2d');
  const trailParticles = [];
  let lastTrailX = -1, lastTrailY = -1;

  function resizeTrail() {
    trailCanvas.width = window.innerWidth;
    trailCanvas.height = window.innerHeight;
  }
  resizeTrail();
  window.addEventListener('resize', resizeTrail);

  document.addEventListener('mousemove', (e) => {
    cx = e.clientX; cy = e.clientY;
    cursorDot.style.left = cx + 'px';
    cursorDot.style.top = cy + 'px';

    const dx = cx - lastTrailX;
    const dy = cy - lastTrailY;
    if (!reduceMotion && lastTrailX >= 0 && (dx * dx + dy * dy) > 16) {
      for (let i = 0; i < 2; i++) {
        trailParticles.push({
          x: cx + (Math.random() - 0.5) * 6,
          y: cy + (Math.random() - 0.5) * 6,
          vx: (Math.random() - 0.5) * 0.4,
          vy: -Math.random() * 0.5 - 0.2,
          life: 1,
          size: 1.5 + Math.random() * 2,
        });
      }
      lastTrailX = cx; lastTrailY = cy;
    }
    if (lastTrailX < 0) { lastTrailX = cx; lastTrailY = cy; }
  });

  const interactives = 'button, a, [role="button"]';
  document.addEventListener('mouseover', (e) => {
    if (e.target.closest(interactives)) document.body.classList.add('cursor-hover');
  });
  document.addEventListener('mouseout', (e) => {
    if (e.target.closest(interactives)) document.body.classList.remove('cursor-hover');
  });
  (function ringLoop() {
    rx += (cx - rx) * 0.15;
    ry += (cy - ry) * 0.15;
    cursorRing.style.left = rx + 'px';
    cursorRing.style.top = ry + 'px';

    tCtx.clearRect(0, 0, trailCanvas.width, trailCanvas.height);
    for (let i = trailParticles.length - 1; i >= 0; i--) {
      const p = trailParticles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.life -= 0.025;
      if (p.life <= 0) { trailParticles.splice(i, 1); continue; }
      tCtx.globalAlpha = p.life * 0.6;
      tCtx.fillStyle = `rgba(201,168,76,${p.life})`;
      tCtx.beginPath();
      tCtx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
      tCtx.fill();
    }

    requestAnimationFrame(ringLoop);
  })();
}

// on a phone the journey is shorter, so each caption stays fully visible for longer and fades faster:
// [start, fully in, fully out, end]  ->  the fades shrink to half, and the middle stretches to fill the gap
function captionWindow([a, b, c, d]) {
  if (!phone || a === b) return [a, b, c, d];     // the hero caption is visible from the very top; leave it
  const fade = Math.min(b - a, d - c) * 0.5;
  return [a, a + fade, d - fade, d];
}

const captions = [];
for (const el of document.querySelectorAll('.caption')) {
  captions.push({
    el,
    w: captionWindow(el.dataset.window.split(',').map(Number)),
    ch: Number(el.dataset.chapter || 0),
  });
}

// ── hole-button navigation ───────────────────────────────────
const holesNav = document.getElementById('holes');
const holeButtons = holesNav.querySelectorAll('button');
const sectionCenters = [0.19, 0.34, 0.49, 0.64, 0.79, 0.96];

for (let i = 0; i < holeButtons.length; i++) {
  holeButtons[i].addEventListener('click', () => {
    initAudio();
    // ripple effect
    holeButtons[i].classList.remove('ripple');
    void holeButtons[i].offsetWidth;
    holeButtons[i].classList.add('ripple');
    const span = scrollSpan();
    if (lenis) {
      lenis.scrollTo(sectionCenters[i] * span);
    } else {
      window.scrollTo({ top: sectionCenters[i] * span, behavior: 'smooth' });
    }
  });
}

// ── sound toggle ─────────────────────────────────────────────
soundBtn.addEventListener('click', () => {
  const on = toggleSound();
  soundBtn.classList.toggle('muted', !on);
});
armAutoplay();
onMusicStart(() => document.body.classList.add('sound-on'));

// ── mouse state (a gentle parallax on desktop) ───────────────
let rawMX = 0, rawMY = 0;
let smoothMX = 0, smoothMY = 0;

window.addEventListener('mousemove', (e) => {
  rawMX = (e.clientX / window.innerWidth) * 2 - 1;
  rawMY = (e.clientY / window.innerHeight) * 2 - 1;
});

// (the phone's motion sensor no longer moves the camera: it made the scene drift with every tremor of the hand)

// ── drag-to-rotate ──────────────────────────────────────────
const glCanvas = document.getElementById('gl');
let isDragging = false;
let dragStartX = 0, dragStartY = 0;
let dragAccX = 0, dragAccY = 0;
const DRAG_SENSITIVITY = 0.006;

function onDragStart(x, y) {
  isDragging = true;
  dragStartX = x;
  dragStartY = y;
  if (stage) stage.setDragging(true);
  glCanvas.style.cursor = 'grabbing';
}
function onDragMove(x, y, touch = false) {
  if (!isDragging) return;
  const dx = x - dragStartX;
  const dy = touch ? 0 : y - dragStartY;      // touch: only sideways spins the flute; up/down scrolls the page
  dragStartX = x;
  dragStartY = y;
  dragAccX = clamp(dragAccX + dy * DRAG_SENSITIVITY, -1.2, 1.2);
  dragAccY = clamp(dragAccY + dx * DRAG_SENSITIVITY, -Math.PI, Math.PI);
  if (stage) stage.setDrag(dragAccX, dragAccY);
}
function onDragEnd() {
  isDragging = false;
  if (stage) stage.setDragging(false);
  glCanvas.style.cursor = '';
}

glCanvas.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  onDragStart(e.clientX, e.clientY);
});
window.addEventListener('mousemove', (e) => {
  if (isDragging) onDragMove(e.clientX, e.clientY);
});
window.addEventListener('mouseup', () => { if (isDragging) onDragEnd(); });

// ── pinch to zoom, double-tap to zoom (phones) ──────────────
let pinch = null;                 // { dist, zoom, fx, fy } while two fingers are down
let zoomAtProgress = 0;           // the scroll position where the zoom happened
let lastTap = { t: 0, x: 0, y: 0 };
const touchHint = document.getElementById('touch-hint');
let hintActive = true;
const pinchDist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
const toScreenFocus = (x, y) => [(x / innerWidth) * 2 - 1, -((y / innerHeight) * 2 - 1)];
function zoomTo(z, x, y) {
  if (!stage) return;
  const [fx, fy] = toScreenFocus(x, y);
  stage.setZoom(z, fx, fy);
  zoomAtProgress = progress;
  if (touchHint) { hintActive = false; touchHint.style.opacity = '0'; }
}

glCanvas.addEventListener('touchstart', (e) => {
  if (e.touches.length === 2) {                    // two fingers: pinch, not rotate
    if (isDragging) onDragEnd();
    const t = e.touches;
    pinch = { dist: pinchDist(t), zoom: stage ? stage.zoom : 1,
              x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 };
    return;
  }
  if (e.touches.length !== 1) return;
  const { clientX: x, clientY: y } = e.touches[0];
  const now = performance.now();
  if (now - lastTap.t < 320 && Math.hypot(x - lastTap.x, y - lastTap.y) < 40) {   // double-tap
    zoomTo(stage && stage.zoom > 1.2 ? 1 : 2.4, x, y);
    lastTap.t = 0;
  } else {
    lastTap = { t: now, x, y };
  }
  onDragStart(x, y);
}, { passive: true });
window.addEventListener('touchmove', (e) => {
  if (pinch && e.touches.length === 2) {
    zoomTo(pinch.zoom * (pinchDist(e.touches) / pinch.dist), pinch.x, pinch.y);
    return;
  }
  if (isDragging && e.touches.length === 1) {
    onDragMove(e.touches[0].clientX, e.touches[0].clientY, true);
  }
}, { passive: true });
window.addEventListener('touchend', (e) => { if (e.touches.length < 2) pinch = null; if (isDragging) onDragEnd(); });
window.addEventListener('touchcancel', () => { pinch = null; if (isDragging) onDragEnd(); });   // the browser took the gesture over (scrolling)

// ── scroll state ─────────────────────────────────────────────
let targetP = 0;
let progress = 0;
let lastT = performance.now();
let lastSection = -1;
let stage = null;
let lenis = null;

// Scroll progress is measured against the LARGEST screen height (address bar hidden), which never changes.
// Measuring against the current height made the whole scene jump every time the phone's address bar slid in or out.
const lvhProbe = document.createElement('div');
lvhProbe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:100lvh;visibility:hidden;pointer-events:none';
document.body.appendChild(lvhProbe);
let refHeight = window.innerHeight;
function measureRefHeight() {
  const h = lvhProbe.offsetHeight;
  refHeight = h > 0 ? h : Math.max(refHeight, window.innerHeight);
}
measureRefHeight();
const scrollSpan = () => Math.max(1, journey.offsetHeight - refHeight);

function readScroll() {
  const y = lenis ? lenis.scroll : window.scrollY;
  targetP = clamp(y / scrollSpan(), 0, 1);
}

function detectSection(p) {
  if (p < 0.13) return 0;
  if (p < 0.28) return 1;
  if (p < 0.43) return 2;
  if (p < 0.58) return 3;
  if (p < 0.73) return 4;
  if (p < 0.89) return 5;
  return 6;
}

// ── overlay updates ──────────────────────────────────────────
function updateOverlays() {
  for (const c of captions) {
    const op = windowOpacity(c.w, progress);
    c.el.style.opacity = op.toFixed(3);
    const vis = op > 0.001;
    c.el.style.visibility = vis ? 'visible' : 'hidden';
    c.el.classList.toggle('visible', op > 0.3);
    c.el.style.setProperty('--rise', `${((1 - op) * 20).toFixed(1)}px`);
  }

  const section = detectSection(progress);
  holesNav.classList.toggle('on-hero', section === 0);
  for (let j = 0; j < holeButtons.length; j++) {
    holeButtons[j].classList.toggle('active', j + 1 === section);
  }
  if (section !== lastSection && section >= 1) {
    if (stage) stage.triggerPulse();
    lastSection = section;
  }
  if (section === 0 && lastSection !== 0) lastSection = 0;

  scrollPrompt.style.opacity = (1 - smoothstep(0.015, 0.06, progress)).toFixed(3);
  if (touchHint && hintActive) touchHint.style.opacity = (1 - smoothstep(0.015, 0.06, progress)).toFixed(3);
  progressBar.style.width = `${(progress * 100).toFixed(1)}%`;
}

// ── frame loop ───────────────────────────────────────────────
function frame(now) {
  const dt = Math.min(FRAME_MAX, (now - lastT) / 1000);
  lastT = now;

  if (lenis) lenis.raf(now);
  readScroll();

  progress += (targetP - progress) * (1 - Math.exp(-PROGRESS_EASE * dt));
  if (Math.abs(targetP - progress) < 0.0001) progress = targetP;

  const mouseEase = 1 - Math.exp(-MOUSE_EASE * dt);
  smoothMX += (rawMX - smoothMX) * mouseEase;
  smoothMY += (rawMY - smoothMY) * mouseEase;

  if (stage && stage.zoom > 1 && Math.abs(progress - zoomAtProgress) > 0.012) stage.setZoom(1, 0, 0);   // scrolled on: back to the normal view
  if (!isDragging) {
    const decay = Math.pow(0.35, dt);              // eases back to rest over about a second
    dragAccX *= decay;
    dragAccY *= decay;
    if (Math.abs(dragAccX) < 0.001) dragAccX = 0;
    if (Math.abs(dragAccY) < 0.001) dragAccY = 0;
    if (stage) stage.setDrag(dragAccX, dragAccY);   // hand the easing-back values to the flute
  }

  if (stage) {
    stage.setMouse(smoothMX, smoothMY);
    stage.update(progress, now / 1000, dt);
  }
  updateOverlays();
  requestAnimationFrame(frame);
}

// ── the gate ─────────────────────────────────────────────────
// Loading ends with an invitation. Pressing "enter" is the visitor's first gesture, so it starts the music.
function waitAtGate() {
  return new Promise((resolve) => {
    const button = document.getElementById('enter-btn');
    loader.querySelector('.label').textContent = 'the flute is tuned';
    loader.classList.add('ready');
    setTimeout(() => button.focus({ preventScroll: true }), 200);   // it only becomes focusable once it is visible
    const onKey = (e) => {                             // Enter or Space anywhere on the gate works too
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); button.click(); }
    };
    window.addEventListener('keydown', onKey);
    button.addEventListener('click', () => {
      window.removeEventListener('keydown', onKey);
      initAudio();                                     // must run inside this click for the browser to allow sound
      resolve();
    }, { once: true });
  });
}

// ── ?debug: a small read-out of speed and resolution, for finding out what a real phone does ──
if (new URLSearchParams(location.search).has('debug')) {
  const box = document.createElement('pre');
  box.style.cssText = 'position:fixed;left:6px;bottom:6px;z-index:99999;margin:0;padding:6px 8px;font:11px/1.35 monospace;color:#9f9;background:rgba(0,0,0,.72);pointer-events:none;white-space:pre-wrap;max-width:94vw';
  document.body.appendChild(box);
  let frames = 0, worst = 0, t0 = performance.now(), last = performance.now();
  (function loop(now) {
    frames++; worst = Math.max(worst, now - last); last = now;
    if (now - t0 > 700) {
      const i = stage ? stage.info() : null;
      box.textContent = `${Math.round(frames * 1000 / (now - t0))} fps   worst frame ${Math.round(worst)} ms
` +
        (i ? `drawn ${i.width}x${i.height} (x${i.ratio.toFixed(2)})  quality ${i.quality}
${i.gpu}
${i.calls} draw calls, ${Math.round(i.triangles / 1000)}k triangles` : 'loading...') +
        `
screen ${innerWidth}x${innerHeight}  scroll ${(progress * 100).toFixed(1)}%`;
      frames = 0; worst = 0; t0 = now;
    }
    requestAnimationFrame(loop);
  })(performance.now());
}

// ── init ─────────────────────────────────────────────────────
async function init() {
  const fill = loader.querySelector('.loader-fill');
  const loaderHoles = loader.querySelectorAll('.lf-hole');

  let shown = 0;
  function onProgress(p) {
    p = shown = Math.max(shown, p);   // never slide backwards
    if (fill) fill.style.width = `${Math.round(p * 100)}%`;
    loaderHoles.forEach((hole, i) => hole.classList.toggle('on', p >= (i + 1) / (loaderHoles.length + 1)));
  }

  try {
    stage = await createStage(document.getElementById('gl'), onProgress);
    onProgress(1);
    await new Promise(r => setTimeout(r, 400));
    await waitAtGate();
    loader.classList.add('gone');
    document.documentElement.classList.remove('gated');
    loader.addEventListener('transitionend', () => loader.remove(), { once: true });
  } catch (error) {
    console.error('3D stage failed to load:', error);
    loader.querySelector('.label').textContent = 'Could not render on this device.';
    loader.querySelector('.loader-flute').style.display = 'none';
  }

  if (reduceMotion) return;                          // native scrolling, no smoothing
  try {
    const { default: Lenis } = await import('../vendor/lenis.mjs');
    lenis = new Lenis({
      duration: 1.4,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      orientation: 'vertical',
      smoothWheel: true,
    });
  } catch {
    // Lenis unavailable — native scroll works fine as fallback
  }
}

// ── return to top ────────────────────────────────────────────
document.getElementById('return-top')?.addEventListener('click', () => {
  if (lenis) {
    lenis.scrollTo(0);
  } else {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
});

document.documentElement.classList.add('gated');          // no scrolling behind the loader
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
window.scrollTo(0, 0);
window.addEventListener('scroll', readScroll, { passive: true });
let lastWidth = window.innerWidth, resizeTimer = 0;
window.addEventListener('resize', () => {
  if (window.innerWidth !== lastWidth) { lastWidth = window.innerWidth; measureRefHeight(); }
  readScroll();
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (stage) stage.resize(); }, 180);   // the address bar fires several; rebuild once, when it settles
});
readScroll();
progress = targetP;
init();
requestAnimationFrame(frame);
