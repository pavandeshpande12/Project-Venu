"""Draws the peacock feather texture (spine + barbs + eye) used on the flute.

Run:  python tools/make_feather.py
Writes assets/peacock-feather.webp (1024x2048) and assets/peacock-feather-sm.webp (512x1024).
The quill ends at the bottom-centre of the image so it can be seated in the flute's ferrule.
"""
import math, random
from PIL import Image, ImageDraw, ImageFilter

random.seed(7)
S = 2                       # supersample
W, H = 1024 * S, 2048 * S
LMAX = 470 * S              # longest barb

def bez(p0, p1, p2, t):
    u = 1 - t
    return (u*u*p0[0] + 2*u*t*p1[0] + t*t*p2[0], u*u*p0[1] + 2*u*t*p1[1] + t*t*p2[1])

# spine: from the quill base up to the tip, bending slightly
SP0, SP1, SP2 = (500*S, 2030*S), (470*S, 1050*S), (585*S, 70*S)
def spine(t): return bez(SP0, SP1, SP2, t)
def tangent(t):
    a, b = spine(max(0, t - 0.01)), spine(min(1, t + 0.01))
    dx, dy = b[0]-a[0], b[1]-a[1]; n = math.hypot(dx, dy)
    return dx/n, dy/n

def lerp(a, b, k): return tuple(a[i] + (b[i]-a[i])*k for i in range(len(a)))

EYE_T = 0.76

def barb_colors(t):
    near_eye = max(0.0, 1 - abs(t - EYE_T) / 0.16)
    root = lerp((10, 84, 36), (18, 120, 108), near_eye)
    tip  = lerp((96, 214, 84), (176, 170, 60), near_eye)
    root = lerp(root, (6, 40, 26), random.random()*0.4)
    tip  = lerp(tip,  (46, 176, 70), random.random()*0.5)
    return root, tip

def draw_barb(d, p, dirv, length, width, colors, alpha0=255, alpha1=70, droop=0.10, tan=(0, -1)):
    root, tip = colors
    c = (p[0] + dirv[0]*length*0.5 + tan[0]*length*droop, p[1] + dirv[1]*length*0.5 + tan[1]*length*droop)
    e = (p[0] + dirv[0]*length, p[1] + dirv[1]*length)
    n = 16
    prev = p
    for i in range(1, n + 1):
        k = i / n
        q = bez(p, c, e, k)
        col = lerp(root, tip, k)
        a = int(alpha0 + (alpha1 - alpha0) * k)
        d.line([prev, q], fill=(int(col[0]), int(col[1]), int(col[2]), a), width=max(1, int(width * (1 - 0.45*k))))
        prev = q

img = Image.new('RGBA', (W, H), (0, 0, 0, 0))

def layer(fn):
    global img
    L = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    fn(ImageDraw.Draw(L))
    img = Image.alpha_composite(img, L)

# ── long curling wisps low on the feather (like the reference) ───────────────
def wisps(d):
    for side in (-1, 1):
        for _ in range(9):
            t = random.uniform(0.14, 0.55)
            p = spine(t); T = tangent(t); N = (-T[1]*side, T[0]*side)
            phi = math.radians(random.uniform(62, 84))
            dv = (math.cos(phi)*T[0] + math.sin(phi)*N[0], math.cos(phi)*T[1] + math.sin(phi)*N[1])
            L = LMAX * random.uniform(0.7, 0.95)
            col = lerp((60, 160, 70), (110, 200, 100), random.random())
            draw_barb(d, p, dv, L, 4.5*S, (col, col), 210, 90, droop=0.16, tan=T)
layer(wisps)

# ── main barbs, drawn in bands so overlaps blend ─────────────────────────────
BANDS = 6
N_PER_SIDE = 520
all_barbs = []
for side in (-1, 1):
    for i in range(N_PER_SIDE):
        t = 0.085 + 0.90 * (i + random.random()*0.6) / N_PER_SIDE
        all_barbs.append((t, side))
all_barbs.sort()

def make_band(chunk):
    def fn(d):
        for t, side in chunk:
            p = spine(t); T = tangent(t); N = (-T[1]*side, T[0]*side)
            u = (t - 0.06) / 0.94
            outline = math.sin(math.pi * min(1, max(0, u)) ** 0.82) ** 0.8
            near_eye = max(0.0, 1 - abs(t - EYE_T) / 0.10)
            outline *= (1 - 0.25*near_eye)                 # barbs tuck in around the eye
            L = LMAX * outline * random.uniform(0.86, 1.08) + 20*S
            phi = math.radians(22 + 44*(1 - t) + random.uniform(-3, 3))
            dv = (math.cos(phi)*T[0] + math.sin(phi)*N[0], math.cos(phi)*T[1] + math.sin(phi)*N[1])
            draw_barb(d, p, dv, L, 2.8*S, barb_colors(t), 255, 130, droop=0.12, tan=T)
    return fn
chunk = len(all_barbs) // BANDS + 1
for b in range(BANDS):
    layer(make_band(all_barbs[b*chunk:(b+1)*chunk]))

# ── the spine / quill: bare and brown at the base, darker green above ────────
def quill(d):
    pts = [spine(k / 160) for k in range(161)]
    for i in range(160):
        t = i / 160
        w = int((13 - 8*t) * S * 0.75)
        base = lerp((92, 74, 52), (22, 52, 30), min(1, t / 0.28))
        d.line([pts[i], pts[i+1]], fill=(int(base[0]), int(base[1]), int(base[2]), 255), width=max(2, w))
layer(quill)

# ── the eye ──────────────────────────────────────────────────────────────────
def eye(d):
    cx, cy = spine(EYE_T)
    tx, ty = tangent(EYE_T)
    cx += 6*S
    rings = [  # (rx, ry, colour)
        (138, 192, (32, 112, 92)),
        (108, 152, (82, 42, 136)),
        (92, 130, (226, 160, 24)),
        (66, 96, (24, 150, 176)),
        (40, 62, (8, 22, 52)),
    ]
    for rx, ry, col in rings:
        d.ellipse([cx - rx*S*1.25, cy - ry*S*1.25, cx + rx*S*1.25, cy + ry*S*1.25], fill=col + (255,))
layer(eye)
soft = img.filter(ImageFilter.GaussianBlur(0.6 * S))
img = Image.alpha_composite(soft, img.filter(ImageFilter.GaussianBlur(0)))

out = img.resize((1024, 2048), Image.LANCZOS)
out.save('assets/peacock-feather.webp', 'WEBP', quality=90, method=6)
out.resize((512, 1024), Image.LANCZOS).save('assets/peacock-feather-sm.webp', 'WEBP', quality=88, method=6)
bg = Image.new('RGBA', out.size, (30, 40, 62, 255)); bg.alpha_composite(out)
bg.resize((256, 512)).save('tools/_preview.png')
print('ok', out.size)
