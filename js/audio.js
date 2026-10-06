// Sound: one looping background raga (assets/score.mp3: "Indian Classical Raga" by Alex Morgan, Pixabay;
// the original is in audio/, prepared by tools/ for a seamless loop). Nothing else plays: no notes on
// scroll or on the chapter dots.
// (tools/make_score.py can synthesize an alternative score from scratch.)

const MUSIC_URL = 'assets/score.mp3';
const MUSIC_LEVEL = 0.42;                            // the track is mastered loud and bass-heavy; keep it under the page
const FADE_IN = 6;                                   // seconds

let ctx = null;
let enabled = true;
let masterGain = null;
let musicGain = null;
let musicEl = null;

// Browsers refuse to play sound until the visitor has clicked, tapped or pressed a key on the page
// (scrolling does not count). So: set everything up right away, and start the music the moment the
// first of those happens. Anything that calls initAudio() during such a gesture starts it too.
let started = false;          // the music is actually playing
let unlockedAt = 0;           // when the first gesture started it
const startListeners = [];

function onStarted() {
  if (started) return;
  started = true;
  unlockedAt = performance.now();
  for (const cb of startListeners) cb();
}

export function onMusicStart(cb) {
  if (started) cb(); else startListeners.push(cb);
}

export function armAutoplay() {
  initAudio();                                       // tries immediately; works if the browser allows it
  const events = ['pointerdown', 'keydown', 'touchend', 'click'];
  const unlock = () => {
    initAudio();
    if (started) events.forEach((e) => window.removeEventListener(e, unlock, true));
  };
  events.forEach((e) => window.addEventListener(e, unlock, true));
}

export function initAudio() {
  if (ctx) {                                         // already set up: just make sure it is running
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    if (enabled && musicEl && musicEl.paused) playMusic();
    return;
  }
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
  } catch { return; }

  masterGain = ctx.createGain();
  masterGain.gain.value = enabled ? 1 : 0;
  masterGain.connect(ctx.destination);

  startMusic();
}

function startMusic() {
  musicEl = new Audio(MUSIC_URL);
  musicEl.loop = true;
  musicEl.preload = 'auto';
  musicGain = ctx.createGain();
  musicGain.gain.value = 0;
  try {
    ctx.createMediaElementSource(musicEl).connect(musicGain).connect(masterGain);
  } catch { return; }
  if (enabled) playMusic();
}

function playMusic() {
  if (!musicEl) return;
  const now = ctx.currentTime;
  musicGain.gain.cancelScheduledValues(now);
  musicGain.gain.setValueAtTime(musicGain.gain.value, now);
  musicGain.gain.linearRampToValueAtTime(MUSIC_LEVEL, now + FADE_IN);
  musicEl.play().then(onStarted, () => {});          // refused until the first gesture; initAudio runs again then
}

export function toggleSound() {
  const firstGesture = !started;
  initAudio();
  // the very first tap on the button is what starts the music, so it must not also switch it off
  if (firstGesture || performance.now() - unlockedAt < 400) return enabled;
  enabled = !enabled;
  if (masterGain) {
    const now = ctx.currentTime;
    masterGain.gain.cancelScheduledValues(now);
    masterGain.gain.setValueAtTime(masterGain.gain.value, now);
    masterGain.gain.linearRampToValueAtTime(enabled ? 1 : 0, now + 0.6);
  }
  if (musicEl) {
    if (enabled) {
      playMusic();
    } else {
      const el = musicEl;
      setTimeout(() => { if (!enabled) el.pause(); }, 700);   // stop decoding once it has faded out
    }
  }
  return enabled;
}
