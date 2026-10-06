import { createStage } from './stage/scene.js';
import { clamp, smoothstep, windowOpacity } from './math.js';
import { initAudio, toggleSound, armAutoplay, onMusicStart } from './audio.js';

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const PROGRESS_EASE = reduceMotion ? 18 : 5;      // reduced motion: follow the scroll almost instantly, no gliding
const FRAME_MAX = 0.05;
const MOUSE_EASE = 3;

const journey = document.getElementById('journey');
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

const captions = [];
for (const el of document.querySelectorAll('.caption')) {
  captions.push({
    el,
    w: el.dataset.window.split(',').map(Number),
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
    const span = journey.offsetHeight - window.innerHeight;
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

// ── mouse / gyroscope state ──────────────────────────────────
let rawMX = 0, rawMY = 0;
let smoothMX = 0, smoothMY = 0;
let useGyro = false;

window.addEventListener('mousemove', (e) => {
  if (!useGyro) {
    rawMX = (e.clientX / window.innerWidth) * 2 - 1;
    rawMY = (e.clientY / window.innerHeight) * 2 - 1;
  }
});

function initGyroscope() {
  function handleOrientation(e) {
    if (e.gamma === null) return;
    useGyro = true;
    rawMX = clamp(e.gamma / 30, -1, 1);
    rawMY = clamp((e.beta - 45) / 30, -1, 1);
  }

  if (typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function') {
    document.addEventListener('click', () => {
      DeviceOrientationEvent.requestPermission()
        .then(state => {
          if (state === 'granted') {
            window.addEventListener('deviceorientation', handleOrientation);
          }
        })
        .catch(() => {});
    }, { once: true });
  } else if ('DeviceOrientationEvent' in window) {
    window.addEventListener('deviceorientation', handleOrientation);
  }
}

if (/mobi|android|iphone|ipad/i.test(navigator.userAgent)) {
  initGyroscope();
}

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

glCanvas.addEventListener('touchstart', (e) => {
  if (e.touches.length !== 1) return;
  onDragStart(e.touches[0].clientX, e.touches[0].clientY);
}, { passive: true });
window.addEventListener('touchmove', (e) => {
  if (isDragging && e.touches.length === 1) {
    onDragMove(e.touches[0].clientX, e.touches[0].clientY, true);
  }
}, { passive: true });
window.addEventListener('touchend', () => { if (isDragging) onDragEnd(); });
window.addEventListener('touchcancel', () => { if (isDragging) onDragEnd(); });   // the browser took the gesture over (scrolling)

// ── scroll state ─────────────────────────────────────────────
let targetP = 0;
let progress = 0;
let lastT = performance.now();
let lastSection = -1;
let stage = null;
let lenis = null;

function readScroll() {
  if (lenis) {
    const limit = lenis.limit;
    targetP = limit > 0 ? clamp(lenis.scroll / limit, 0, 1) : 0;
  } else {
    const span = journey.offsetHeight - window.innerHeight;
    targetP = span > 0 ? clamp(window.scrollY / span, 0, 1) : 0;
  }
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
window.addEventListener('resize', () => {
  readScroll();
  if (stage) stage.resize();
});
readScroll();
progress = targetP;
init();
requestAnimationFrame(frame);
