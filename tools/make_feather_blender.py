"""Builds the peacock feather in Blender and renders it flat (unlit albedo, transparent background).

Run:  D:/Blender/app/blender.exe -b -P tools/make_feather_blender.py
Writes tools/feather_blender.png (1024x2048). Convert with tools/finish_feather.py.

Units: the image is 1 wide x 2 tall; x in [-0.5, 0.5], y in [-1, 1]. The quill ends at the bottom centre.
"""
import bpy, bmesh, math, random, os, sys
from mathutils import Vector

# `-- back` renders the BACK LAYER used for depth: the same feather but with no eye and no wisps, and a different
# random scatter of barbs, so the layers behind the main one never show a second eye
BACK = 'back' in sys.argv
random.seed(29 if BACK else 11)
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'feather_back.png' if BACK else 'feather_blender.png')

# ── scene ────────────────────────────────────────────────────────────────────
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = 40
scene.cycles.use_denoising = False
scene.cycles.transparent_max_bounces = 64
scene.render.film_transparent = True
scene.render.resolution_x, scene.render.resolution_y = 1024, 2048
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
scene.view_settings.view_transform = 'Standard'
scene.view_settings.look = 'None'

cam_data = bpy.data.cameras.new('cam')
cam_data.type = 'ORTHO'
cam_data.ortho_scale = 2.0
cam = bpy.data.objects.new('cam', cam_data)
cam.location = (0, 0, 5)
scene.collection.objects.link(cam)
scene.camera = cam


# ── helpers ──────────────────────────────────────────────────────────────────
def srgb_to_lin(c):
    # the colour attribute is already read as sRGB, so just normalise (a pow(2.2) here darkened everything)
    return tuple(v / 255.0 for v in c)


def lerp(a, b, k):
    return tuple(a[i] + (b[i] - a[i]) * k for i in range(len(a)))


def bez(p0, p1, p2, t):
    u = 1 - t
    return Vector((u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
                   u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y, 0))


SP0, SP1, SP2 = Vector((-0.02, -0.988, 0)), Vector((-0.07, -0.05, 0)), Vector((0.2, 0.93, 0))


def spine(t):
    return bez(SP0, SP1, SP2, t)


def tangent(t):
    d = spine(min(1, t + 0.01)) - spine(max(0, t - 0.01))
    d.normalize()
    return d


# one mesh, one colour layer (RGBA per vertex)
bm = bmesh.new()
col_layer = bm.loops.layers.color.new('Col')


def ribbon(points, widths, colors, z=0.0):
    """Flat strip along `points` with per-point width and RGBA colour."""
    verts = []
    n = len(points)
    for i, p in enumerate(points):
        a = points[max(0, i - 1)]
        b = points[min(n - 1, i + 1)]
        d = b - a
        d.normalize()
        nrm = Vector((-d.y, d.x, 0))
        w = widths[i] * 0.5
        verts.append((bm.verts.new(p + nrm * w + Vector((0, 0, z))),
                      bm.verts.new(p - nrm * w + Vector((0, 0, z)))))
    for i in range(n - 1):
        f = bm.faces.new((verts[i][0], verts[i][1], verts[i + 1][1], verts[i + 1][0]))
        for loop, vi in zip(f.loops, (i, i, i + 1, i + 1)):
            c = colors[vi]
            loop[col_layer] = (*srgb_to_lin(c[:3]), c[3])


def disc(cx, cy, rx, ry, color, z, segs=72):
    c = bm.verts.new((cx, cy, z))
    ring = [bm.verts.new((cx + rx * math.cos(i / segs * math.tau),
                          cy + ry * math.sin(i / segs * math.tau), z)) for i in range(segs)]
    for i in range(segs):
        f = bm.faces.new((c, ring[i], ring[(i + 1) % segs]))
        for loop in f.loops:
            loop[col_layer] = (*srgb_to_lin(color), 1.0)


EYE_T = 0.76
LMAX = 0.49


def barb_colors(t):
    near = max(0.0, 1 - abs(t - EYE_T) / 0.16)
    root = lerp((10, 84, 36), (18, 120, 108), near)
    tip = lerp((96, 214, 84), (176, 170, 60), near)
    root = lerp(root, (6, 44, 26), random.random() * 0.4)
    tip = lerp(tip, (46, 176, 70), random.random() * 0.5)
    if random.random() < 0.18:  # a little blue-teal iridescent drift on some barbs
        tip = lerp(tip, (40, 190, 170), 0.6)
    return root, tip


def noise1(x):  # cheap smooth noise in [-1, 1]
    i = math.floor(x)
    f = x - i
    a = math.sin(i * 127.1) * 43758.5453
    b = math.sin((i + 1) * 127.1) * 43758.5453
    a = (a - math.floor(a)) * 2 - 1
    b = (b - math.floor(b)) * 2 - 1
    f = f * f * (3 - 2 * f)
    return a + (b - a) * f


def barb(p, dirv, length, width, root, tip, a0, a1, droop, tan, z, shade, segs=10):
    c = p + dirv * length * 0.5 + tan * length * droop
    e = p + dirv * length
    pts, ws, cols = [], [], []
    for i in range(segs + 1):
        k = i / segs
        pts.append(bez(p, c, e, k))
        ws.append(width * (1 - 0.55 * k))
        col = tuple(v * shade * (0.82 + 0.18 * k) for v in lerp(root, tip, k))
        cols.append((*col, a0 + (a1 - a0) * k))
    ribbon(pts, ws, cols, z)


# ── long, fine wisps with curled ends, low on the feather (as in the reference) ──────────
def curl_tail(end, heading, side, turns=1.15, radius=0.032, width=0.0034, col=(70, 170, 80)):
    """continue a barb past its tip as a small spiral, like the curling wisps on a peacock feather"""
    pts, ws, cols = [], [], []
    n = 22
    # the spiral starts tangent to the barb's heading and curls toward `side`
    perp = Vector((-heading.y, heading.x, 0)) * side
    centre = end + perp * radius
    a0 = math.atan2(end.y - centre.y, end.x - centre.x)
    for i in range(n + 1):
        t = i / n
        ang = a0 + side * t * turns * math.tau
        r = radius * (1 - 0.82 * t)
        pts.append(Vector((centre.x + r * math.cos(ang), centre.y + r * math.sin(ang), 0)))
        ws.append(width * (1 - 0.6 * t))
        cols.append((*col, 0.9 - 0.4 * t))
    ribbon(pts, ws, cols, -0.015)


for side in (-1, 1):
    for _ in range(0 if BACK else 13):
        t = random.uniform(0.10, 0.52)
        p = spine(t)
        T = tangent(t)
        N = Vector((-T.y * side, T.x * side, 0))
        phi = math.radians(random.uniform(52, 80))
        dv = T * math.cos(phi) + N * math.sin(phi)
        col = lerp((50, 150, 64), (120, 205, 105), random.random())
        Lw = LMAX * random.uniform(0.52, 0.86)
        barb(p, dv, Lw, 0.0036, col, col, 0.9, 0.5, 0.2, T, -0.02, 1.0)
        c_ = p + dv * Lw * 0.5 + T * Lw * 0.2
        e_ = p + dv * Lw
        heading = (e_ - c_)
        heading.normalize()
        if random.random() < 0.8:
            curl_tail(e_, heading, side * random.choice((-1, 1)), turns=random.uniform(0.8, 1.4),
                      radius=random.uniform(0.022, 0.04), col=col)

# ── main barbs: sweeping, grouped into clumps with gaps between them, pale at the edges ────
N_SIDE = 900
items = []
for side in (-1, 1):
    for i in range(N_SIDE):
        items.append((0.085 + 0.90 * (i + random.random() * 0.6) / N_SIDE, side))
for t, side in items:
    # clumps: the vane parts into groups, so some barbs are dropped where the noise says "gap"
    gap = noise1(t * 62 + side * 9.0)
    if gap > 0.42 and random.random() < 0.6:
        continue
    p = spine(t)
    T = tangent(t)
    N = Vector((-T.y * side, T.x * side, 0))
    u = (t - 0.06) / 0.94
    outline = math.sin(math.pi * min(1, max(0, u)) ** 0.78) ** 0.85
    near_eye = max(0.0, 1 - abs(t - EYE_T) / 0.10)
    outline *= 1 - 0.30 * near_eye
    clump = noise1(t * 38 + side * 11.0)
    L = LMAX * outline * random.uniform(0.80, 1.10) * (1 + 0.10 * clump) + 0.02
    # swept strongly toward the tip; each clump leans a little differently
    phi = math.radians(22 + 40 * (1 - t) + 7 * clump + random.uniform(-2.0, 2.0))
    dv = T * math.cos(phi) + N * math.sin(phi)
    root, tip = barb_colors(t)
    tip = lerp(tip, (150, 225, 130), 0.35)               # paler, more translucent toward the edges
    z = random.uniform(-0.01, 0.01)
    shade = 0.88 + 0.12 * random.random()
    barb(p, dv, L, 0.0038, root, tip, 1.0, 0.32, 0.16, T, z, shade)

# ── quill: brown at the base, going dark green up the spine ──────────────────
pts, ws, cols = [], [], []
for i in range(161):
    t = i / 160
    pts.append(spine(t))
    ws.append(0.0125 - 0.0075 * t)
    cols.append((*lerp((92, 74, 52), (22, 52, 30), min(1, t / 0.28)), 1.0))
ribbon(pts, ws, cols, 0.012)

# ── the eye: concentric rings ────────────────────────────────────────────────
ex, ey = spine(EYE_T).x + 0.006, spine(EYE_T).y
rings = [  # rx, ry, colour
    (0.205, 0.285, (20, 52, 40)),
    (0.192, 0.268, (46, 92, 60)),
    (0.178, 0.248, (150, 120, 40)),
    (0.164, 0.228, (34, 112, 88)),
    (0.135, 0.190, (82, 42, 136)),
    (0.115, 0.162, (230, 164, 26)),
    (0.100, 0.140, (216, 122, 30)),
    (0.082, 0.120, (24, 150, 176)),
    (0.050, 0.077, (8, 22, 52)),
]
for i, (rx, ry, c) in enumerate(rings):
    if not BACK:
        disc(ex, ey, rx, ry, c, 0.02 + i * 0.002)

mesh = bpy.data.meshes.new('feather')
bm.to_mesh(mesh)
bm.free()
obj = bpy.data.objects.new('feather', mesh)
scene.collection.objects.link(obj)

# ── material: vertex colour as emission (flat albedo), vertex alpha as opacity ─
mat = bpy.data.materials.new('feather')
mat.use_nodes = True
nt = mat.node_tree
nt.nodes.clear()
attr = nt.nodes.new('ShaderNodeAttribute')
attr.attribute_name = 'Col'
em = nt.nodes.new('ShaderNodeEmission')
tr = nt.nodes.new('ShaderNodeBsdfTransparent')
mix = nt.nodes.new('ShaderNodeMixShader')
out = nt.nodes.new('ShaderNodeOutputMaterial')
nt.links.new(attr.outputs['Color'], em.inputs['Color'])
nt.links.new(attr.outputs['Alpha'], mix.inputs['Fac'])
nt.links.new(tr.outputs['BSDF'], mix.inputs[1])
nt.links.new(em.outputs['Emission'], mix.inputs[2])
nt.links.new(mix.outputs['Shader'], out.inputs['Surface'])
obj.data.materials.append(mat)

scene.render.filepath = OUT
bpy.ops.render.render(write_still=True)
print('rendered', OUT)
