"""Synthesizes the site's background score: a tanpura drone under a slow bansuri alap in raga Yaman.

Everything is additive synthesis + a synthetic room reverb, rendered to a seamlessly looping stereo WAV.
Sa = D. Just-intonation ratios (Yaman uses the sharp Ma, 45/32).

Run:  python tools/make_score.py            -> tools/_work/score.wav
Then: blender -b -P tools/encode_audio.py   (mixes down to assets/score.mp3)
"""
import numpy as np
from scipy.signal import butter, sosfilt, fftconvolve

SR = 44100
DUR = 104.0                      # seconds; the loop point is DUR
N = int(SR * DUR)
SA = 146.83                      # D3, the tanpura's Sa (the flute plays an octave up)
rng = np.random.default_rng(108)

# ratios from Sa (lower octave marked with a trailing _, upper with a leading ^)
R = {'N_': 15 / 16, 'D_': 5 / 6, 'P_': 3 / 4, 'S': 1.0, 'R': 9 / 8, 'G': 5 / 4, 'M': 45 / 32,
     'P': 3 / 2, 'D': 5 / 3, 'N': 15 / 8, '^S': 2.0, '^R': 9 / 4}


def smooth(x):
    x = np.clip(x, 0.0, 1.0)
    return x * x * (3 - 2 * x)


def add_wrapped(buf, start, sig):
    """Overlap-add `sig` into `buf` at `start`, wrapping past the end so the loop is seamless."""
    n = len(sig)
    start %= len(buf)
    first = min(n, len(buf) - start)
    buf[start:start + first] += sig[:first]
    if first < n:
        buf[:n - first] += sig[first:]


# ── tanpura ──────────────────────────────────────────────────────────────────
def pluck(freq, length=7.0):
    t = np.arange(int(SR * length)) / SR
    out = np.zeros_like(t)
    for h in range(1, 31):
        f = freq * h * (1 + 0.00005 * h * h)           # slight stiffness
        if f > 6500:
            break
        decay = 5.0 / (1 + 0.12 * h)
        base = h ** -1.05 * np.exp(-t / decay)
        # jivari: the string rattling over the flat bridge makes the upper harmonics bloom after the pluck
        bloom = np.exp(-((t - (0.12 + 0.17 * np.sqrt(h))) ** 2) / (2 * 0.32 ** 2)) if h >= 3 else 0
        amp = base * (1 + 2.4 * bloom * np.exp(-t / 3.0))
        out += amp * np.sin(2 * np.pi * f * t + rng.uniform(0, 6.28))
    out *= np.minimum(t / 0.012, 1.0)                  # tiny attack, no click
    return out


tanpura = np.zeros((N, 2))
cycle = [('P_', 0.50), ('S', 0.0), ('S', -0.3), ('S_low', 0.25)]
PERIOD = 1.62                                          # seconds per string
n_plucks = int(DUR / PERIOD)
PERIOD = DUR / n_plucks                                # an exact fit, so the pattern loops
for i in range(n_plucks):
    name, pan = cycle[i % 4]
    f = SA * (0.75 if name == 'P_' else 0.5 if name == 'S_low' else 1.0) * 1.0
    if name == 'S':
        f = SA
    sig = pluck(f) * (0.9 if name == 'S_low' else 1.0)
    left, right = np.sqrt((1 - pan) / 2), np.sqrt((1 + pan) / 2)
    start = int(i * PERIOD * SR)
    for ch, g in ((0, left), (1, right)):
        add_wrapped(tanpura[:, ch], start, sig * g)
tanpura *= 0.045


# ── bansuri ──────────────────────────────────────────────────────────────────
HARM = [1.0, 0.30, 0.11, 0.045, 0.018]
bp = butter(2, [700, 3000], btype='band', fs=SR, output='sos')


def bansuri_phrase(notes, glide=0.3, vib_start=0.9):
    """notes = [(ratio_name, hold_seconds), ...] played legato with meend (glides) between them."""
    total = sum(d for _, d in notes) + 0.9
    n = int(total * SR)
    t = np.arange(n) / SR
    # pitch contour: hold each note, glide into the next
    f = np.full(n, SA * 2 * R[notes[0][0]])
    pos = 0.0
    for k, (name, hold) in enumerate(notes):
        target = SA * 2 * R[name]
        a = int((pos if k == 0 else pos - glide / 2) * SR)
        if k > 0:
            prev = SA * 2 * R[notes[k - 1][0]]
            g0, g1 = int((pos - glide / 2) * SR), int((pos + glide / 2) * SR)
            ramp = smooth((np.arange(g1 - g0)) / max(1, g1 - g0))
            f[g0:g1] = prev + (target - prev) * ramp
            f[g1:] = target
        else:
            f[:] = target
        pos += hold
    # vibrato grows in during long holds
    vib = np.sin(2 * np.pi * 5.0 * t + 0.4) * smooth((t - vib_start) / 1.8) * 0.0032
    vib *= 0.6 + 0.4 * np.sin(2 * np.pi * 0.13 * t)
    f = f * (1 + vib)
    phase = 2 * np.pi * np.cumsum(f) / SR
    tone = np.zeros(n)
    for h, a in enumerate(HARM, start=1):
        tone += a * np.sin(h * phase + h * 0.3)
    # breath: gentle dynamics, a soft dip at each note change, a slow tremor
    env = smooth(t / 0.45) * smooth((total - 0.35 - t) / 0.7)
    pos = 0.0
    for k, (_, hold) in enumerate(notes[:-1]):
        pos += hold
        env *= 1 - 0.12 * np.exp(-((t - pos) ** 2) / (2 * 0.15 ** 2))
    env *= 1 + 0.04 * np.sin(2 * np.pi * 0.37 * t + 1.1)
    breath = sosfilt(bp, rng.normal(size=n)) * (0.05 + 0.95 * np.exp(-t / 0.22))
    sig = tone * env + breath * env * 0.10
    # round the top off so the tone is warm, never edgy
    sig = sosfilt(butter(2, 4200, btype='low', fs=SR, output='sos'), sig)
    return sig * 0.21


# the alap: slow, with silences, climbing from the lower Ni to the upper Sa and settling back to Sa
PHRASES = [
    (4.0,  [('N_', 2.4), ('R', 2.0), ('G', 3.6)]),
    (13.5, [('N_', 1.6), ('R', 1.6), ('G', 2.0), ('M', 2.6), ('G', 1.4), ('R', 3.4)]),
    (27.5, [('R', 1.4), ('G', 1.4), ('M', 1.8), ('P', 3.4), ('M', 1.4), ('G', 2.0), ('R', 2.2)]),
    (42.5, [('G', 1.6), ('M', 1.6), ('P', 1.6), ('D', 2.2), ('N', 2.8), ('D', 1.2), ('P', 2.0), ('M', 3.2)]),
    (60.0, [('M', 1.4), ('P', 1.4), ('D', 1.6), ('N', 2.0), ('^S', 4.4), ('N', 1.4), ('D', 2.2), ('P', 2.6)]),
    (78.0, [('P', 1.6), ('M', 1.6), ('G', 1.8), ('R', 2.2), ('N_', 1.8), ('R', 1.6), ('S', 5.2)]),
]
bans = np.zeros((N, 2))
for k, (start_s, notes) in enumerate(PHRASES):
    sig = bansuri_phrase(notes)
    pan = (-0.18, 0.12, -0.08, 0.2, 0.0, -0.12)[k]
    left, right = np.sqrt((1 - pan) / 2), np.sqrt((1 + pan) / 2)
    start = int(start_s * SR)
    add_wrapped(bans[:, 0], start, sig * left)
    add_wrapped(bans[:, 1], start, sig * right)


# ── reverb: a synthetic hall, convolved circularly so the loop stays seamless ────
def impulse(seconds, seed):
    r = np.random.default_rng(seed)
    n = int(SR * seconds)
    t = np.arange(n) / SR
    noise = r.normal(size=n) * np.exp(-t / (seconds / 5.5))
    lp = butter(2, 3200, btype='low', fs=SR, output='sos')
    noise = sosfilt(lp, noise) * np.minimum(t / 0.03, 1.0)
    noise[: int(0.012 * SR)] *= 0.2
    return noise / np.sqrt(np.sum(noise ** 2))


def wet(x, ir_l, ir_r):
    out = np.zeros_like(x)
    for ch, ir in ((0, ir_l), (1, ir_r)):
        full = fftconvolve(x[:, ch], ir)
        out[:, ch] = full[:len(x)]
        tail = full[len(x):]
        out[:len(tail), ch] += tail                     # wrap the tail back to the start
    return out


ir_l, ir_r = impulse(2.8, 7), impulse(2.8, 21)
mix = tanpura * 1.0 + wet(tanpura, ir_l, ir_r) * 0.35
mix += bans * 1.0 + wet(bans, ir_l, ir_r) * 0.5

# gentle high-cut and a touch of low-cut so it sits behind the page
mix = sosfilt(butter(2, 7000, btype='low', fs=SR, output='sos'), mix, axis=0)
mix = sosfilt(butter(2, 55, btype='high', fs=SR, output='sos'), mix, axis=0)
mix *= 0.82 / np.max(np.abs(mix))

pcm = (np.clip(mix, -1, 1) * 32767).astype(np.int16)
import wave
with wave.open('tools/_work/score.wav', 'wb') as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())

# ── checks ───────────────────────────────────────────────────────────────────
peak = np.max(np.abs(mix))
rms = np.sqrt(np.mean(mix ** 2))
jump = np.max(np.abs(mix[0] - mix[-1]))
print(f'duration {DUR}s  peak {peak:.2f}  rms {rms:.3f} ({20 * np.log10(rms):.1f} dBFS)  loop seam jump {jump:.4f}')
seg = int(SR * 4)
levels = [np.sqrt(np.mean(mix[i:i + seg] ** 2)) for i in range(0, N - seg, seg)]
print('4s loudness (dBFS):', ' '.join(f'{20 * np.log10(l + 1e-9):.0f}' for l in levels))
