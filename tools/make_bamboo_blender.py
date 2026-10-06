"""Bakes the bamboo grain texture in Blender.

The grain is procedural 3D noise evaluated on a cylinder the size of the flute body, then baked to a UV
image (u = around the flute, v = along it), so it wraps around with no seam.

Run:  D:/Blender/app/blender.exe -b -P tools/make_bamboo_blender.py
Writes tools/bamboo_blender.png (512x2048). Convert with tools/finish_bamboo.py.
"""
import bpy, bmesh, math, os, sys

# optional:  blender -b -P make_bamboo_blender.py -- <width> <height> <out.png>
_args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
W, H = (int(_args[0]), int(_args[1])) if len(_args) >= 2 else (512, 2048)
OUT = _args[2] if len(_args) >= 3 else os.path.join(os.path.dirname(os.path.abspath(__file__)), 'bamboo_blender.png')
LENGTH, RADIUS = 3.8, 0.082
RINGS, AROUND = 96, 96


def lin(c):
    return tuple((v / 255.0) ** 2.2 for v in c) + (1.0,)


bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = 8
scene.cycles.use_denoising = False

# ── cylinder with explicit UVs (u around, v along); the seam vertices are duplicated ──
bm = bmesh.new()
uv = bm.loops.layers.uv.new('UVMap')
grid = []
for i in range(RINGS + 1):
    x = -LENGTH / 2 + LENGTH * i / RINGS
    row = []
    for j in range(AROUND + 1):
        a = j / AROUND * math.tau
        row.append(bm.verts.new((x, RADIUS * math.cos(a), RADIUS * math.sin(a))))
    grid.append(row)
for i in range(RINGS):
    for j in range(AROUND):
        f = bm.faces.new((grid[i][j], grid[i][j + 1], grid[i + 1][j + 1], grid[i + 1][j]))
        for loop, (ii, jj) in zip(f.loops, ((i, j), (i, j + 1), (i + 1, j + 1), (i + 1, j))):
            loop[uv].uv = (jj / AROUND, ii / RINGS)
mesh = bpy.data.meshes.new('body')
bm.to_mesh(mesh)
bm.free()
obj = bpy.data.objects.new('body', mesh)
scene.collection.objects.link(obj)
bpy.context.view_layer.objects.active = obj
obj.select_set(True)

# ── material: stretched noise = long fibres, coarse noise = mottling, voronoi = pores ──
mat = bpy.data.materials.new('bamboo')
mat.use_nodes = True
nt = mat.node_tree
nt.nodes.clear()
N = nt.nodes
L = nt.links


def node(kind, **kw):
    n = N.new(kind)
    for k, v in kw.items():
        setattr(n, k, v)
    return n


coord = node('ShaderNodeTexCoord')


def mapped(scale):
    m = node('ShaderNodeMapping')
    m.inputs['Scale'].default_value = scale
    L.new(coord.outputs['Object'], m.inputs['Vector'])
    return m


fiber = node('ShaderNodeTexNoise', noise_dimensions='3D')
fiber.inputs['Scale'].default_value = 1.0
fiber.inputs['Detail'].default_value = 5.0
fiber.inputs['Roughness'].default_value = 0.65
L.new(mapped((4.0, 95.0, 95.0)).outputs['Vector'], fiber.inputs['Vector'])

streak = node('ShaderNodeTexNoise', noise_dimensions='3D')
streak.inputs['Scale'].default_value = 1.0
streak.inputs['Detail'].default_value = 3.0
streak.inputs['Roughness'].default_value = 0.5
L.new(mapped((1.2, 22.0, 22.0)).outputs['Vector'], streak.inputs['Vector'])

blotch = node('ShaderNodeTexNoise', noise_dimensions='3D')
blotch.inputs['Scale'].default_value = 1.0
blotch.inputs['Detail'].default_value = 2.0
L.new(mapped((0.5, 6.0, 6.0)).outputs['Vector'], blotch.inputs['Vector'])

pores = node('ShaderNodeTexVoronoi', voronoi_dimensions='3D', feature='F1')
pores.inputs['Scale'].default_value = 1.0
L.new(mapped((12.0, 420.0, 420.0)).outputs['Vector'], pores.inputs['Vector'])
pore_ramp = node('ShaderNodeValToRGB')
pore_ramp.color_ramp.elements[0].position = 0.05
pore_ramp.color_ramp.elements[0].color = lin((140, 140, 140))
pore_ramp.color_ramp.elements[1].position = 0.16
pore_ramp.color_ramp.elements[1].color = (1, 1, 1, 1)
L.new(pores.outputs['Distance'], pore_ramp.inputs['Fac'])


def math_node(op, a, b=None, clamp=False, value=None):
    m = node('ShaderNodeMath', operation=op, use_clamp=clamp)
    L.new(a, m.inputs[0])
    if b is not None:
        L.new(b, m.inputs[1])
    if value is not None:
        m.inputs[1].default_value = value
    return m


# tone = mostly fibre, some streak, a little blotch
f1 = math_node('MULTIPLY', fiber.outputs['Fac'], value=0.55)
f2 = math_node('MULTIPLY', streak.outputs['Fac'], value=0.30)
f3 = math_node('MULTIPLY', blotch.outputs['Fac'], value=0.15)
s1 = math_node('ADD', f1.outputs[0], f2.outputs[0])
s2 = math_node('ADD', s1.outputs[0], f3.outputs[0])
contrast = node('ShaderNodeMath', operation='MULTIPLY_ADD')
L.new(s2.outputs[0], contrast.inputs[0])
contrast.inputs[1].default_value = 2.6
contrast.inputs[2].default_value = -0.85
contrast.use_clamp = True

ramp = node('ShaderNodeValToRGB')
ramp.color_ramp.elements[0].position = 0.0
ramp.color_ramp.elements[0].color = lin((74, 41, 14))
mid = ramp.color_ramp.elements.new(0.5)
mid.color = lin((126, 78, 30))
ramp.color_ramp.elements[2].position = 1.0
ramp.color_ramp.elements[2].color = lin((172, 112, 46))
L.new(contrast.outputs[0], ramp.inputs['Fac'])

mul = node('ShaderNodeMix', data_type='RGBA', blend_type='MULTIPLY')
mul.inputs['Factor'].default_value = 1.0
L.new(ramp.outputs['Color'], mul.inputs['A'])
L.new(pore_ramp.outputs['Color'], mul.inputs['B'])

emit = node('ShaderNodeEmission')
L.new(mul.outputs['Result'], emit.inputs['Color'])
out = node('ShaderNodeOutputMaterial')
L.new(emit.outputs['Emission'], out.inputs['Surface'])

# the bake target
img = bpy.data.images.new('bamboo', W, H, alpha=False)
img.colorspace_settings.name = 'sRGB'
tex = node('ShaderNodeTexImage')
tex.image = img
N.active = tex
obj.data.materials.append(mat)

bpy.ops.object.bake(type='EMIT', margin=6)
img.filepath_raw = OUT
img.file_format = 'PNG'
img.save()
print('baked', OUT)
