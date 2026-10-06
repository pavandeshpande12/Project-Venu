"""Builds the flute body textures at 8192 x 1152 (about 2200 px per world unit in both directions):

  body_color.png   albedo: lacquered bamboo, node rings, thread-wrapped bands, gold filigree, burnt hole edges
  body_normal.png  relief: thread ridges, raised gold filigree, grain micro-bump
  body_orm.png     glTF packing: G = roughness, B = metallic (gold filigree is real metal; the lacquer is glossy)

Texture space matches the model's UVs:  u = around the flute (u = theta / 2pi + 0.5, theta = atan2(z, y); the holes
face theta = 0), v = along it (v = 0 at x = -1.9 .. v = 1 at x = +1.9).  Image row 0 is v = 1.

Needs tools/_work/grain_8k.png (from make_bamboo_blender.py -- 1152 8192 ...).
Run:  python tools/make_flute_textures.py
"""
import math
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

Image.MAX_IMAGE_PIXELS = None
rng = np.random.default_rng(1008)

L = 3.8
XMIN, XMAX = -1.9, 1.9
R = 0.082                                  # the body's mean radius, to turn angles into arc length
HOLE_X = [-0.2, 0.15, 0.5, 0.95, 1.2, 1.42]
BLOW_X = -1.45
BAND_X = [-1.62, -1.12, -0.45, 1.07]       # centres of the four thread-wrapped bands
JOINT_X = [-0.7, 0.75, 1.6]                # bamboo growth nodes
BAND_W = 0.052                             # half-width of a band's red section
ORN_LO, ORN_HI = -1.02, 1.30               # where the filigree runs

grain = np.asarray(Image.open('tools/_work/grain_8k.png').convert('RGB'), dtype=np.float32) / 255.0
H, W = grain.shape[:2]
PPU_X = H / L                              # pixels per unit along the flute
PPU_A = W / (2 * math.pi * R)              # pixels per unit of arc around it
print('texture', W, 'x', H, ' px/unit along', round(PPU_X), 'around', round(PPU_A))

rows = np.arange(H, dtype=np.float32)
cols = np.arange(W, dtype=np.float32)
X = (XMAX - L * (rows + 0.5) / H)[:, None].astype(np.float32)                      # H x 1
THETA = (((cols + 0.5) / W - 0.5) * 2 * math.pi)[None, :].astype(np.float32)       # 1 x W
ARC = THETA * R


def smooth(a, b, v):
    t = np.clip((v - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def blur(a, px):
    """Gaussian-ish blur of a float array via PIL (fast on big images)."""
    img = Image.fromarray(np.clip(a * 255, 0, 255).astype(np.uint8), 'L').filter(ImageFilter.GaussianBlur(px))
    return np.asarray(img, dtype=np.float32) / 255.0


# ── 1. gold filigree, drawn as a mask (supersampled, then reduced) ────────────
SS = 2
CELL_X, CELL_A = 0.108, 2 * math.pi * R / 6         # cell size along / around (6 cells around the flute)
canvas = Image.new('L', (W * SS, H * SS), 0)
draw = ImageDraw.Draw(canvas)


def to_px(x, a):
    """world (x along, a = arc around, 0 = the hole line) -> supersampled pixel"""
    return ((a / (2 * math.pi * R) + 0.5) * W * SS, (XMAX - x) / L * H * SS)


def stroke(points, w0, w1):
    """a tapered stroke through world-space points: width goes w0 -> w1 (world units)"""
    pts = [to_px(*p) for p in points]
    n = len(pts)
    for i in range(n - 1):
        (x0, y0), (x1, y1) = pts[i], pts[i + 1]
        seg = max(1, int(math.hypot(x1 - x0, y1 - y0) / 0.7))
        for s in range(seg):
            t = (i + s / seg) / (n - 1)
            r = (w0 + (w1 - w0) * t) * PPU_X * SS / 2
            cx, cy = x0 + (x1 - x0) * s / seg, y0 + (y1 - y0) * s / seg
            draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=255)


def spiral_points(cx, ca, r0, r1, turns, start, direction, n=140):
    pts = []
    for k in range(n + 1):
        t = k / n
        ang = start + direction * t * turns * 2 * math.pi
        r = r0 * (r1 / r0) ** (t ** 0.85)
        pts.append((cx + r * math.cos(ang), ca + r * math.sin(ang)))
    return pts


def leaf(bx, ba, tip_dx, tip_da, width):
    """a pointed leaf from base to tip, drawn as a filled polygon with a slight curve"""
    n = 18
    left, right = [], []
    length = math.hypot(tip_dx, tip_da)
    ux, ua = tip_dx / length, tip_da / length
    px, pa = -ua, ux
    for k in range(n + 1):
        t = k / n
        w = width * math.sin(math.pi * t ** 0.8) * 0.5
        bend = 0.18 * length * math.sin(math.pi * t) * 0.5
        cx_, ca_ = bx + tip_dx * t + px * bend, ba + tip_da * t + pa * bend
        left.append(to_px(cx_ + px * w, ca_ + pa * w))
        right.append(to_px(cx_ - px * w, ca_ - pa * w))
    draw.polygon(left + right[::-1], fill=255)


def dot(x, a, r):
    px, py = to_px(x, a)
    rr = r * PPU_X * SS
    draw.ellipse([px - rr, py - rr, px + rr, py + rr], fill=255)


def zone_ok(x, a):
    """keep the filigree off the holes, bands and growth nodes"""
    if not (ORN_LO < x < ORN_HI):
        return False
    if any(abs(x - j) < 0.075 for j in JOINT_X) or any(abs(x - b) < 0.098 for b in BAND_X):
        return False
    return all(math.hypot(x - h, a) > 0.062 for h in HOLE_X)


cells = 0
x_cells = np.arange(ORN_LO + CELL_X / 2, ORN_HI, CELL_X)
for ix, cx in enumerate(x_cells):
    for ia in range(6):
        ca = (ia - 2.5) * CELL_A + (CELL_A / 2) * (ix % 2)
        if ca > math.pi * R:
            ca -= 2 * math.pi * R
        if not zone_ok(cx, ca):
            continue
        r = np.random.default_rng(ix * 31 + ia * 7 + 5)
        d = 1 if (ix + ia) % 2 == 0 else -1
        scale = r.uniform(0.74, 0.92)
        start = r.uniform(0, 2 * math.pi)
        # the main scroll, thick at the outside, tapering to a hairline at the heart
        sp = spiral_points(cx, ca, 0.052 * scale, 0.006, r.uniform(1.5, 1.95), start, d)
        if not all(zone_ok(px_, pa_) for px_, pa_ in sp[::6]):
            continue
        stroke(sp, 0.0090 * scale, 0.0021)
        # an echo line just inside, like the fine double lines in the reference
        sp2 = spiral_points(cx, ca, 0.040 * scale, 0.010, 1.3, start + 0.25 * d, d, n=100)
        stroke(sp2, 0.0027, 0.0014)
        # the stem leaves the scroll and runs toward the neighbouring cell
        ex, ea = sp[0]
        tx, ta = math.cos(start + d * math.pi / 2), math.sin(start + d * math.pi / 2)
        reach = r.uniform(0.07, 0.10)
        stem = [(ex + tx * reach * s_ + (-ta) * 0.012 * math.sin(math.pi * s_), ea + ta * reach * s_ + tx * 0.012 * math.sin(math.pi * s_))
                for s_ in np.linspace(0, 1, 28)]
        if all(zone_ok(px_, pa_) for px_, pa_ in stem):
            stroke(stem, 0.0078 * scale / 0.9, 0.0028)
            # leaves along the stem
            for k, frac in enumerate((0.35, 0.7)):
                bx, ba = stem[int(frac * 27)]
                side = 1 if k % 2 == 0 else -1
                lx, la = tx * 0.4 + (-ta) * side * 0.9, ta * 0.4 + tx * side * 0.9
                ln = math.hypot(lx, la)
                tipx, tipa = bx + lx / ln * 0.044 * scale, ba + la / ln * 0.044 * scale
                if zone_ok(tipx, tipa) and zone_ok((bx + tipx) / 2, (ba + tipa) / 2):
                    leaf(bx, ba, lx / ln * 0.046 * scale, la / ln * 0.046 * scale, 0.026 * scale)
        # punched dots in the open spaces
        for k in range(3):
            ang = start + d * (math.pi * 0.6 + k * 0.9)
            dot(cx + 0.062 * scale * math.cos(ang), ca + 0.062 * scale * math.sin(ang), 0.0034)
        dot(cx, ca, 0.0040)
        cells += 1
# fill pass: small satellite curls and leaves wherever the first pass left bare wood
fill_rng = np.random.default_rng(77)
filled = 0
for cx in np.arange(ORN_LO + 0.03, ORN_HI - 0.02, 0.046):
    for ca in np.arange(-math.pi * R, math.pi * R, 0.043):
        if not zone_ok(cx, ca) or not zone_ok(cx + 0.02, ca + 0.02) or not zone_ok(cx - 0.02, ca - 0.02):
            continue
        px, py = to_px(cx, ca)
        rad = 0.027 * PPU_X * SS
        if canvas.crop((int(px - rad), int(py - rad), int(px + rad), int(py + rad))).getbbox() is not None:
            continue
        d = 1 if fill_rng.random() < 0.5 else -1
        start = fill_rng.uniform(0, 2 * math.pi)
        sp = spiral_points(cx, ca, 0.0225, 0.004, fill_rng.uniform(1.3, 1.7), start, d, n=90)
        stroke(sp, 0.0058, 0.0016)
        dot(cx, ca, 0.0030)
        ex, ea = sp[0]
        ang = start + d * math.pi / 2
        tipx, tipa = ex + math.cos(ang) * 0.03, ea + math.sin(ang) * 0.03
        if zone_ok(tipx, tipa):
            stroke([(ex, ea), ((ex + tipx) / 2 + 0.004, (ea + tipa) / 2), (tipx, tipa)], 0.0052, 0.0020)
            leaf(ex + (tipx - ex) * 0.55, ea + (tipa - ea) * 0.55, -math.sin(ang) * 0.03 * d, math.cos(ang) * 0.03 * d, 0.017)
        filled += 1
print('filigree cells drawn:', cells, '+ fill curls:', filled)

gold = np.asarray(canvas.resize((W, H), Image.LANCZOS), dtype=np.float32) / 255.0
# the filigree must not spill over features
for jx in JOINT_X:
    gold *= smooth(0.06, 0.085, np.abs(X - jx))
for bx in BAND_X:
    gold *= smooth(0.098, 0.115, np.abs(X - bx))
for hx in HOLE_X:
    gold *= smooth(0.058, 0.074, np.sqrt((X - hx) ** 2 + ARC ** 2))

# ── 2. thread-wrapped bands ──────────────────────────────────────────────────
THREAD_P = 0.0042                                   # one thread's diameter
ridge = np.zeros((H, W), np.float32)                # 0..1 profile of the wound threads
band_red = np.zeros((H, 1), np.float32)
band_green = np.zeros((H, 1), np.float32)
band_gold_line = np.zeros((H, 1), np.float32)
for bx in BAND_X:
    dx = X - bx
    ad = np.abs(dx)
    band_red = np.maximum(band_red, 1.0 - smooth(BAND_W - 0.0012, BAND_W + 0.0012, ad))
    band_green = np.maximum(band_green, 1.0 - smooth(BAND_W * 0.46 - 0.0012, BAND_W * 0.46 + 0.0012, ad))
    for side in (-1, 1):                            # a gold thread either side
        c = BAND_W + 0.0105
        band_gold_line = np.maximum(band_gold_line, 1.0 - smooth(0.0016, 0.0024, np.abs(dx - side * c)))
    wrapped = (ad < BAND_W + 0.0135).astype(np.float32)
    phase = dx / THREAD_P + THETA / (2 * math.pi) * 1.0     # a slight spiral, so the threads lie at an angle
    prof = 0.5 + 0.5 * np.cos(2 * math.pi * phase)
    prof = prof ** 0.7                                       # rounder, like a cord
    ridge = np.maximum(ridge, prof * wrapped)
band_mask = np.maximum(np.maximum(band_red, band_green), band_gold_line)

# ── 3. bamboo base: lacquered brown, gentle shading, growth nodes, speckle ─────
gm = grain.mean(axis=2, keepdims=True)
base = np.clip(gm + (grain - gm) * 0.6 + (gm - gm.mean()) * 0.55, 0, 1)      # calmer: bamboo fibre is fine and even
tint = np.array([0.82, 0.54, 0.25], np.float32)
col = base * 0.50 + tint * base * 0.98
col *= (1.0 + 0.10 * np.sin(X * 2.1 + 0.8))[..., None]       # slow tone variation along the length
spots = (rng.random((H // 16, W // 16)) > 0.9965).astype(np.float32)
spots = np.asarray(Image.fromarray((spots * 255).astype(np.uint8)).resize((W, H), Image.BICUBIC), np.float32) / 255.0
col *= (1 - 0.35 * blur(spots, 1.2))[..., None]               # tiny dark pores and flecks
node_ring = np.zeros((H, 1), np.float32)
for jx in JOINT_X:
    node_ring = np.maximum(node_ring, np.exp(-((X - jx) ** 2) / (2 * 0.0065 ** 2)))
    node_ring = np.maximum(node_ring, 0.55 * np.exp(-((X - jx) ** 2) / (2 * 0.022 ** 2)))
col = col * (1 - 0.42 * node_ring[..., None]) + np.array([0.22, 0.12, 0.05], np.float32) * (0.42 * node_ring[..., None])

# burnt edges: bamboo holes are scorched when they are bored
burn = np.zeros((H, W), np.float32)
for hx in HOLE_X + [BLOW_X]:
    big = 1.35 if hx == BLOW_X else 1.0
    dist = np.sqrt((X - hx) ** 2 + ARC ** 2)
    burn = np.maximum(burn, 1.0 - smooth(0.034 * big, 0.050 * big, dist))
col = col * (1 - 0.78 * burn[..., None]) + np.array([0.07, 0.035, 0.02], np.float32) * (0.78 * burn[..., None])

# bands: thread colours with the winding ridges shading them
red_c = np.array([0.55, 0.11, 0.08], np.float32)
green_c = np.array([0.10, 0.36, 0.17], np.float32)
gold_c = np.array([1.0, 0.78, 0.30], np.float32)
shade = (0.62 + 0.38 * ridge)[..., None]
thread_noise = (0.94 + 0.12 * rng.random((H // 4, W // 4))).astype(np.float32)
thread_noise = np.asarray(Image.fromarray(((thread_noise - 0.9) * 2000).clip(0, 255).astype(np.uint8)).resize((W, H), Image.BICUBIC), np.float32) / 255.0 * 0.5 + 0.85
shade = shade * thread_noise[..., None]
col = col * (1 - band_red[..., None]) + red_c * shade * band_red[..., None]
col = col * (1 - band_green[..., None]) + green_c * shade * band_green[..., None]
col = col * (1 - band_gold_line[..., None]) + gold_c * (0.55 + 0.45 * ridge[..., None]) * band_gold_line[..., None]

# filigree: shaded gold, brighter on its raised top, darker toward the edge
core = blur(gold, 2.2)
gold_shade = (0.62 + 0.55 * core)[..., None]
halo = np.clip(blur(gold, 7.0) * 2.2, 0, 1) * (1 - gold)                    # a dark inlay edge around the gold: contrast from far away
col = col * (1 - 0.42 * halo[..., None])
col = col * (1 - gold[..., None]) + gold_c * gold_shade * gold[..., None]

colour = np.clip(col, 0, 1)
Image.fromarray((colour * 255 + 0.5).astype(np.uint8)).save('tools/_work/body_color.png')
print('colour saved')

# ── 4. height -> normal map (heights in world units, so the slopes are physically right) ────
h_gold = blur(gold, 1.6) * 0.0034
h_ridge = ridge * 0.0013
h_node = node_ring[:, :1] * 0.0009 * np.ones((1, W), np.float32)
h_grain = (grain.mean(axis=2) - 0.5) * 0.0010
h_burn = -burn * 0.0008
height = h_gold + h_ridge + h_node + h_grain + h_burn
dz_dx = (np.roll(height, -1, axis=0) - np.roll(height, 1, axis=0)) * 0.5 * PPU_X       # per world unit, +down the image = -x
dz_da = (np.roll(height, -1, axis=1) - np.roll(height, 1, axis=1)) * 0.5 * PPU_A
nx = -dz_da                                        # image right = +a
ny = dz_dx                                         # image up = +x (OpenGL: +Y up in the image)
nz = np.ones_like(nx)
ln = np.sqrt(nx * nx + ny * ny + nz * nz)
normal = np.stack([nx / ln, ny / ln, nz / ln], axis=-1) * 0.5 + 0.5
Image.fromarray((normal * 255 + 0.5).astype(np.uint8)).save('tools/_work/body_normal.png')
print('normal saved')

# ── 5. roughness / metallic packed the glTF way (G = roughness, B = metallic) ───
rough = 0.30 + 0.10 * (1 - grain.mean(axis=2))                 # lacquer: glossy, a touch less over the pores
rough = rough * (1 - band_mask) + (0.62 + 0.18 * (1 - ridge)) * band_mask
rough = rough * (1 - burn) + 0.85 * burn
rough = rough * (1 - gold) + (0.26 + 0.12 * (1 - core)) * gold
rough = np.clip(rough * (1 - 0.0 * node_ring), 0.05, 1.0)
metal = gold * 0.96 + band_gold_line * 0.75
metal = np.clip(metal, 0, 1)
scratch_img = Image.new('L', (W, H), 0)
sd = ImageDraw.Draw(scratch_img)
sr = np.random.default_rng(404)
for _ in range(1500):
    cx_, cy_ = sr.uniform(0, W), sr.uniform(0, H)
    ln_ = sr.uniform(0.012, 0.11) * PPU_X
    ang_ = math.radians(90 + sr.normal(0, 18)) if sr.random() < 0.82 else sr.uniform(0, math.pi)       # mostly lengthwise
    sd.line([(cx_, cy_), (cx_ + math.cos(ang_) * ln_, cy_ + math.sin(ang_) * ln_)], fill=int(sr.uniform(40, 150)), width=1)
scratches = np.asarray(scratch_img, dtype=np.float32) / 255.0
rough = np.clip(rough + scratches * 0.38 * (1 - gold), 0.05, 1.0)       # not on the metal
orm = np.stack([np.ones_like(rough), rough, metal], axis=-1)
Image.fromarray((orm * 255 + 0.5).astype(np.uint8)).save('tools/_work/body_orm.png')
print('orm saved')
