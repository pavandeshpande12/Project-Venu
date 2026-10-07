"""Builds the whole flute in Blender and exports it as glTF for the site.

  - hollow bamboo body (tapered, with swollen growth nodes), real finger holes cut through the wall
  - chamfered holes, an open flared gold bell at the mouth end (cork inside), studded ferrule with finial
  - two cords with fringed green tassels as a separate node ("Tassels") so the page can sway them
  - colour + normal textures come from tools/make_flute_textures.py

Everything is modelled in the site's own axes: x along the flute, y up, z toward the viewer.
(B() converts to Blender's z-up; the glTF exporter converts back.)

Run:  blender -b -P tools/make_flute_blender.py [-- preview]
Writes assets/flute/flute.gltf (+ .bin + textures). With "preview" it also renders tools/_work/prev_*.png.
"""
import bpy, bmesh, math, os, random, sys
from mathutils import Vector, Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
WORK = os.path.join(HERE, '_work')
OUT_DIR = os.path.join(ROOT, 'assets', 'flute')
PREVIEW = 'preview' in sys.argv

# ── dimensions (same as the code-built flute) ────────────────────────────────
LENGTH = 3.8
HALF = LENGTH / 2
R_LEFT, R_RIGHT = 0.09, 0.075
WALL = 0.012
JOINTS = [-0.7, 0.75, 1.6]
FINGER_HOLES = [-0.2, 0.15, 0.5, 0.95, 1.2, 1.42]
BLOW_HOLE = -1.45
END_X, NECK_X, NECK_R = 1.74, 1.855, 0.078
AROUND = 64
RINGS = 240


def B(x, y, z):
    return (x, -z, y)


def lin(hexv):
    return tuple(((hexv >> s & 255) / 255.0) ** 2.2 for s in (16, 8, 0))


def radius_at(x):
    t = (x + HALF) / LENGTH
    return R_LEFT + (R_RIGHT - R_LEFT) * t


def body_radius(x):
    r = radius_at(x)
    for jx in JOINTS:
        d = x - jx
        if abs(d) < 0.05:
            r += math.sin(math.pi * (d + 0.05) / 0.1) ** 2 * 0.0065
    return r * (1 + math.sin(x * 14) * 0.0012 + math.sin(x * 31 + 1.7) * 0.0006)


def chaikin(points, iterations=2, closed=False):
    for _ in range(iterations):
        out = []
        n = len(points)
        rng = range(n) if closed else range(n - 1)
        if not closed:
            out.append(points[0])
        for i in rng:
            p, q = points[i], points[(i + 1) % n]
            out.append((0.75 * p[0] + 0.25 * q[0], 0.75 * p[1] + 0.25 * q[1]))
            out.append((0.25 * p[0] + 0.75 * q[0], 0.25 * p[1] + 0.75 * q[1]))
        if not closed:
            out.append(points[-1])
        points = out
    return points


bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

# ── materials ────────────────────────────────────────────────────────────────
def make_material(name, color=None, metallic=0.0, roughness=0.6, emission=None, emission_strength=0.0, double=False):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes['Principled BSDF']
    if color is not None:
        bsdf.inputs['Base Color'].default_value = (*color, 1.0)
    bsdf.inputs['Metallic'].default_value = metallic
    bsdf.inputs['Roughness'].default_value = roughness
    if emission is not None:
        bsdf.inputs['Emission Color'].default_value = (*emission, 1.0)
        bsdf.inputs['Emission Strength'].default_value = emission_strength
    m.use_backface_culling = not double
    return m


def image_node(nt, path, noncolor=False):
    n = nt.nodes.new('ShaderNodeTexImage')
    n.image = bpy.data.images.load(path)
    n.image.colorspace_settings.name = 'Non-Color' if noncolor else 'sRGB'
    n.extension = 'REPEAT'
    return n


body_mat = make_material('Bamboo', roughness=0.6)
nt = body_mat.node_tree
bsdf = nt.nodes['Principled BSDF']
col_tex = image_node(nt, os.path.join(WORK, 'body_color_4k.png'))
nrm_tex = image_node(nt, os.path.join(WORK, 'body_normal_4k.png'), noncolor=True)
orm_tex = image_node(nt, os.path.join(WORK, 'body_orm_4k.png'), noncolor=True)
nrm = nt.nodes.new('ShaderNodeNormalMap')
nrm.inputs['Strength'].default_value = 1.0
sep = nt.nodes.new('ShaderNodeSeparateColor')
nt.links.new(col_tex.outputs['Color'], bsdf.inputs['Base Color'])
nt.links.new(nrm_tex.outputs['Color'], nrm.inputs['Color'])
nt.links.new(nrm.outputs['Normal'], bsdf.inputs['Normal'])
nt.links.new(orm_tex.outputs['Color'], sep.inputs['Color'])
nt.links.new(sep.outputs['Green'], bsdf.inputs['Roughness'])
nt.links.new(sep.outputs['Blue'], bsdf.inputs['Metallic'])
bsdf.inputs['Coat Weight'].default_value = 0.3            # a thin layer of lacquer over the whole body
bsdf.inputs['Coat Roughness'].default_value = 0.24

inner_mat = make_material('BoreInner', lin(0x120a05), roughness=1.0)
gold_mat = make_material('Gold', lin(0xe0ac45), metallic=0.85, roughness=0.3,
                         emission=lin(0x3a2208), emission_strength=0.2, double=True)
green2_mat = make_material('TasselGreenLight', lin(0x34a04a), roughness=0.7,
                           emission=lin(0x06200c), emission_strength=0.3, double=True)
cord_mat = make_material('Cord', lin(0xb04fb0), roughness=0.6)
green_mat = make_material('TasselGreen', lin(0x1f7a30), roughness=0.7,
                          emission=lin(0x04140a), emission_strength=0.3, double=True)


def new_object(name, mesh, location=(0, 0, 0)):
    obj = bpy.data.objects.new(name, mesh)
    obj.location = location
    scene.collection.objects.link(obj)
    return obj


# ── bamboo body: thin tube, solidified inward, holes cut by boolean ──────────
bm = bmesh.new()
grid = []
for i in range(RINGS + 1):
    x = -HALF + LENGTH * i / RINGS
    r = body_radius(x)
    ring = []
    for j in range(AROUND):
        a = -math.pi + j / AROUND * math.tau
        ring.append(bm.verts.new(B(x, r * math.cos(a), r * math.sin(a))))
    grid.append(ring)
for i in range(RINGS):
    for j in range(AROUND):
        bm.faces.new((grid[i][j], grid[i][(j + 1) % AROUND], grid[i + 1][(j + 1) % AROUND], grid[i + 1][j]))
mesh = bpy.data.meshes.new('body')
bm.to_mesh(mesh)
bm.free()
body = new_object('Body', mesh)
mesh.materials.append(body_mat)
mesh.materials.append(inner_mat)
for p in mesh.polygons:
    p.use_smooth = True

sol = body.modifiers.new('wall', 'SOLIDIFY')
sol.thickness = WALL
sol.offset = -1.0
sol.use_rim = True
sol.material_offset = 1
sol.material_offset_rim = 0


def cutter(x, radius, oval=1.0):
    """bore through the wall with a chamfer at the outer edge. oval = across/along ratio (the blowing hole is oval)."""
    bmc = bmesh.new()
    segs = 48
    y_s = radius_at(x)                                  # the outside of the tube at this point
    levels = [(0.01, 1.0), (y_s - 0.012, 1.0), (y_s + 0.003, 1.34), (0.2, 1.34)]
    rings = [[bmc.verts.new(B(x + radius * m * math.cos(k / segs * math.tau), y, radius * m * oval * math.sin(k / segs * math.tau)))
              for k in range(segs)] for y, m in levels]
    bmc.faces.new(rings[0][::-1])
    bmc.faces.new(rings[-1])
    for i in range(len(rings) - 1):
        for k in range(segs):
            bmc.faces.new((rings[i][k], rings[i][(k + 1) % segs], rings[i + 1][(k + 1) % segs], rings[i + 1][k]))
    bmesh.ops.recalc_face_normals(bmc, faces=bmc.faces[:])   # closed volume: make normals point outward
    me = bpy.data.meshes.new('cut')
    bmc.to_mesh(me)
    bmc.free()
    ob = new_object('cutter', me)
    ob.hide_render = True
    return ob


cutters = [cutter(BLOW_HOLE, 0.047, oval=0.82)] + [cutter(hx, 0.030) for hx in FINGER_HOLES]
for c in cutters:
    mod = body.modifiers.new('hole', 'BOOLEAN')
    mod.operation = 'DIFFERENCE'
    mod.object = c
    mod.solver = 'EXACT'

dg = bpy.context.evaluated_depsgraph_get()
final = bpy.data.meshes.new_from_object(body.evaluated_get(dg))
for c in cutters:
    bpy.data.objects.remove(c)
bpy.data.objects.remove(body)

# cylindrical UVs, matching tools/make_flute_textures.py
bmf = bmesh.new()
bmf.from_mesh(final)
uvl = bmf.loops.layers.uv.verify()
for f in bmf.faces:
    us = []
    for loop in f.loops:
        co = loop.vert.co               # blender coords -> site coords
        xs, ys, zs = co.x, co.z, -co.y
        u = math.atan2(zs, ys) / math.tau + 0.5
        v = (xs + HALF) / LENGTH
        loop[uvl].uv = (u, v)
        us.append(u)
    if max(us) - min(us) > 0.5:         # face straddles the seam: unwrap past 1.0 (texture repeats)
        for loop in f.loops:
            if loop[uvl].uv[0] < 0.5:
                loop[uvl].uv = (loop[uvl].uv[0] + 1.0, loop[uvl].uv[1])
for f in bmf.faces:
    f.smooth = True
bmf.to_mesh(final)
bmf.free()
body = new_object('Body', final)
final.update()

# ── gold: hole rims, mouth collar, ferrule, beads ────────────────────────────
gold_bm = bmesh.new()


def add_lathe(bmx, profile, x0, closed=False, segs=64, flip=False):
    rings = []
    for (along, r) in [(p[0], p[1]) for p in profile]:
        rings.append([bmx.verts.new(B(x0 + along, r * math.cos(k / segs * math.tau), r * math.sin(k / segs * math.tau)))
                      for k in range(segs)])
    n = len(rings)
    rng = range(n) if closed else range(n - 1)
    for i in rng:
        a, b = rings[i], rings[(i + 1) % n]
        for k in range(segs):
            quad = (a[k], a[(k + 1) % segs], b[(k + 1) % segs], b[k])
            bmx.faces.new(quad[::-1] if flip else quad)


def add_beads(bmx, x, radius, count, size):
    for k in range(count):
        a = k / count * math.tau
        bmesh.ops.create_uvsphere(bmx, u_segments=8, v_segments=6, radius=size,
                                  matrix=Matrix.Translation(B(x, radius * math.cos(a), radius * math.sin(a))))


# ferrule: beaded collar, neck (the feather quill seats here), bulb, finial. profile = (along, radius)
ferrule = [(0.0, 0.082), (0.008, 0.094), (0.02, 0.098), (0.03, 0.1), (0.06, 0.1), (0.07, 0.098), (0.08, 0.092),
           (0.09, 0.083), (0.098, NECK_R + 0.004), (0.105, NECK_R), (0.135, NECK_R), (0.14, NECK_R + 0.003),
           (0.15, 0.09), (0.165, 0.108), (0.19, 0.118), (0.2, 0.121), (0.215, 0.122), (0.23, 0.118), (0.245, 0.108),
           (0.26, 0.09), (0.275, 0.07), (0.29, 0.05), (0.3, 0.036), (0.315, 0.026), (0.33, 0.02), (0.35, 0.014),
           (0.37, 0.008), (0.4, 0.0)]
add_lathe(gold_bm, chaikin(ferrule, 1), END_X, segs=72)
add_beads(gold_bm, END_X + 0.03, 0.1005, 26, 0.0058)
add_beads(gold_bm, END_X + 0.06, 0.1005, 26, 0.0058)
add_beads(gold_bm, END_X + 0.172, 0.1115, 28, 0.0052)
add_beads(gold_bm, END_X + 0.2, 0.1215, 30, 0.0058)
add_beads(gold_bm, END_X + 0.228, 0.1195, 28, 0.0052)
add_beads(gold_bm, END_X + 0.255, 0.0955, 22, 0.0045)

# the mouth end, as in the reference: a beaded collar ring on the body, a short run of bare bamboo,
# then a separate flared cup at the very end (the cork sits further inside the tube)
rb = body_radius(-HALF)
ring_x = -1.745
collar = [(-0.034, rb + 0.0005), (-0.028, rb + 0.011), (-0.016, rb + 0.0165), (0.016, rb + 0.0165), (0.028, rb + 0.011),
          (0.034, rb + 0.0005), (0.034, rb - 0.0015), (-0.034, rb - 0.0015)]
add_lathe(gold_bm, chaikin(collar, 2, closed=True), ring_x, closed=True, segs=72)
add_beads(gold_bm, ring_x - 0.014, rb + 0.0185, 22, 0.0046)
add_beads(gold_bm, ring_x + 0.014, rb + 0.0185, 22, 0.0046)

cup = [(-1.872, rb + 0.0005), (-1.884, rb + 0.009), (-1.90, rb + 0.02), (-1.925, 0.1055), (-1.95, 0.1175),
       (-1.972, 0.1235), (-1.99, 0.121), (-1.995, 0.1155), (-1.986, 0.1095), (-1.962, 0.1015), (-1.935, rb + 0.0045),
       (-1.905, rb + 0.0005), (-1.88, rb + 0.0005)]
add_lathe(gold_bm, chaikin(cup, 2, closed=True), 0.0, closed=True, segs=72)
add_beads(gold_bm, -1.9, rb + 0.0225, 24, 0.0046)
add_beads(gold_bm, -1.962, 0.1215, 28, 0.0046)
add_beads(gold_bm, -1.99, 0.1235, 30, 0.0043)

bmesh.ops.recalc_face_normals(gold_bm, faces=gold_bm.faces[:])
gold_me = bpy.data.meshes.new('gold')
for f in gold_bm.faces:
    f.smooth = True
gold_bm.to_mesh(gold_me)
gold_bm.free()
gold_me.materials.append(gold_mat)
new_object('Gold', gold_me)

# ── cork: a real bansuri is stopped at the blowing end, just past the embouchure; only the far end is open ──
cork_mat = make_material('Cork', lin(0xc09258), roughness=0.95)
CORK_FACE = -HALF + 0.045          # the face you would see looking into the tube, set back from the rim
CORK_DEPTH = 0.07
cork_r = body_radius(CORK_FACE) - WALL - 0.0006
cb = bmesh.new()
segs = 56
front = [cb.verts.new(B(CORK_FACE, cork_r * math.cos(k / segs * math.tau), cork_r * math.sin(k / segs * math.tau))) for k in range(segs)]
back = [cb.verts.new(B(CORK_FACE + CORK_DEPTH, cork_r * math.cos(k / segs * math.tau), cork_r * math.sin(k / segs * math.tau))) for k in range(segs)]
dome = cb.verts.new(B(CORK_FACE - 0.0015, 0.0, 0.0))                   # a very slight dome on the visible face
for k in range(segs):
    cb.faces.new((dome, front[(k + 1) % segs], front[k]))
    cb.faces.new((front[k], front[(k + 1) % segs], back[(k + 1) % segs], back[k]))
cb.faces.new(back)
bmesh.ops.recalc_face_normals(cb, faces=cb.faces[:])
for f in cb.faces:
    f.smooth = True
cork_me = bpy.data.meshes.new('cork')
cb.to_mesh(cork_me)
cb.free()
cork_me.materials.append(cork_mat)
new_object('Cork', cork_me)

# ── tassels: own node, origin at the pivot where the cords leave the collar ──
PIVOT = (END_X + 0.045, -0.1, 0.0)
tb = bmesh.new()


def local(x, y, z):
    return B(x - PIVOT[0], y - PIVOT[1], z - PIVOT[2])


def tube(bmx, x, z, y_top, y_bot, r0, r1, mat, segs=10):
    top = [bmx.verts.new(local(x + r0 * math.cos(k / segs * math.tau), y_top, z + r0 * math.sin(k / segs * math.tau))) for k in range(segs)]
    bot = [bmx.verts.new(local(x + r1 * math.cos(k / segs * math.tau), y_bot, z + r1 * math.sin(k / segs * math.tau))) for k in range(segs)]
    for k in range(segs):
        f = bmx.faces.new((top[k], top[(k + 1) % segs], bot[(k + 1) % segs], bot[k]))
        f.material_index = mat


cords = [(-0.008, 0.007, 0.13), (0.008, -0.007, 0.21)]
STRANDS = 46
for ci, (dx, dz, ln) in enumerate(cords):
    x, z = PIVOT[0] + dx, PIVOT[2] + dz
    y0 = PIVOT[1]
    tube(tb, x, z, y0, y0 - ln, 0.0028, 0.0028, 0, segs=6)                    # cord
    tube(tb, x, z, y0 - ln + 0.002, y0 - ln - 0.018, 0.0095, 0.0125, 1)       # gold cap
    sy = y0 - ln - 0.018                                                      # strands hang from the cap's lower rim
    r_top = 0.0115
    rr = random.Random(ci * 91 + 7)
    for k in range(STRANDS):
        a = k / STRANDS * math.tau + rr.uniform(-0.03, 0.03)
        length = 0.088 + rr.uniform(-0.007, 0.007)
        flare = 0.0175 + rr.uniform(-0.003, 0.003)
        curl = rr.uniform(-0.002, 0.002)
        ea = (-math.sin(a), math.cos(a))                                      # across the strand
        ring = []
        for j in range(7):
            t = j / 6
            rad = r_top + flare * (t ** 0.55) - 0.0042 * (t ** 3)             # swells out, then draws back in
            px, pz = x + math.cos(a) * rad + ea[0] * curl * t, z + math.sin(a) * rad + ea[1] * curl * t
            py = sy - length * t
            w = (0.0042 - 0.0022 * t) * 0.5
            ring.append((tb.verts.new(local(px + ea[0] * w, py, pz + ea[1] * w)),
                         tb.verts.new(local(px - ea[0] * w, py, pz - ea[1] * w))))
        mat = 2 if k % 3 else 3                                               # two greens, so it reads as separate strands
        for j in range(6):
            f = tb.faces.new((ring[j][0], ring[j][1], ring[j + 1][1], ring[j + 1][0]))
            f.material_index = mat

# the gold ring, in the plane across the flute, hanging just under the collar
RING_R, RING_T, RN, RM = 0.0135, 0.0028, 28, 6
ring_rows = []
for k in range(RN):
    a = k / RN * math.tau
    cz, cy = RING_R * math.cos(a), RING_R * math.sin(a) + RING_R
    row = []
    for m in range(RM):
        b = m / RM * math.tau
        row.append(tb.verts.new(local(PIVOT[0] + RING_T * math.sin(b),
                                      PIVOT[1] + cy + RING_T * math.cos(b) * math.sin(a),
                                      PIVOT[2] + cz + RING_T * math.cos(b) * math.cos(a))))
    ring_rows.append(row)
for k in range(RN):
    for m in range(RM):
        f = tb.faces.new((ring_rows[k][m], ring_rows[(k + 1) % RN][m], ring_rows[(k + 1) % RN][(m + 1) % RM], ring_rows[k][(m + 1) % RM]))
        f.material_index = 1
tb.faces.ensure_lookup_table()
first_knot_face = len(tb.faces)
bmesh.ops.create_uvsphere(tb, u_segments=10, v_segments=8, radius=0.012, matrix=Matrix.Translation((0, 0, 0)))
tb.faces.ensure_lookup_table()
for i, f in enumerate(tb.faces):
    f.smooth = True
    if i >= first_knot_face:
        f.material_index = 1        # the knot where the cords leave the collar is gold
tmesh = bpy.data.meshes.new('tassels')
tb.to_mesh(tmesh)
tb.free()
for m in (cord_mat, gold_mat, green_mat, green2_mat):
    tmesh.materials.append(m)
new_object('Tassels', tmesh, location=B(*PIVOT))

# ── export ───────────────────────────────────────────────────────────────────
os.makedirs(OUT_DIR, exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=os.path.join(OUT_DIR, 'flute.gltf'),
    export_format='GLTF_SEPARATE',
    export_image_format='WEBP',
    export_image_quality=90,
    export_yup=True,
    export_apply=True,
    export_cameras=False,
    export_lights=False,
)
print('exported', OUT_DIR)

# ── optional preview renders ─────────────────────────────────────────────────
if PREVIEW:
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 24
    world = bpy.data.worlds.new('w')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.06, 0.06, 0.1, 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 1.0
    scene.world = world
    sun = bpy.data.lights.new('sun', 'SUN')
    sun.energy = 3.5
    sun_o = new_object('sun', sun)
    sun_o.rotation_euler = (math.radians(55), 0, math.radians(-25))
    fill = bpy.data.lights.new('fill', 'AREA')
    fill.energy = 150
    fill.size = 3
    fill_o = new_object('fill', fill, (0, -3, 1))
    fill_o.rotation_euler = (math.radians(80), 0, 0)
    scene.view_settings.view_transform = 'Standard'
    cam_d = bpy.data.cameras.new('c')
    cam = new_object('cam', cam_d)
    scene.camera = cam

    def shot(name, loc, target, lens, w, h):
        cam.location = loc
        d = Vector(target) - Vector(loc)
        cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
        cam_d.lens = lens
        scene.render.resolution_x, scene.render.resolution_y = w, h
        scene.render.filepath = os.path.join(WORK, name)
        bpy.ops.render.render(write_still=True)

    shot('prev_full.png', B(0, 0.25, 4.6), B(0, 0, 0), 50, 1600, 420)
    shot('prev_holes.png', B(0.3, 0.35, 0.7), B(0.3, 0.0, 0.0), 50, 1400, 700)
    shot('prev_ferrule.png', B(1.85, 0.3, 0.9), B(1.85, 0.0, 0.0), 50, 1200, 700)
    shot('prev_bell.png', B(-2.55, 0.45, 0.8), B(-1.85, 0.0, 0.0), 45, 1200, 700)
    shot('prev_tassel.png', B(1.8, -0.2, 0.7), B(1.8, -0.2, 0.0), 40, 1000, 900)
