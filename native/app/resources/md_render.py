# MD CAD AI STUDIO — local photoreal render worker for Blender (Cycles).
#
# Run by the app as a separate background process (never bundled; the user's own Blender install):
#   blender -b --factory-startup --offline-mode -noaudio --python-exit-code 3 -P md_render.py -- job.json
# job.json (written by the app, see native/app/src/host_bridge.cpp renderStartBlender):
#   glb       scene snapshot exported when the job was queued (metres, glTF Y-up; Blender imports Z-up)
#   output    PNG path to write (the app moves it into the Renders folder and writes the provenance sidecar)
#   w, h, samples, bounces, denoise, exposure
#   camera    {eye, at, up, fov (vertical, deg), lens (mm, 24 mm sensor height), level?, shift?: [x, y]} in scene mm
#   lighting  day | golden | night | overcast | studio
#   sun       {on, azimuth (deg from +Y towards +X), elevation (deg), intensity}
#   overrides {group: {rgb, mat}} presentation material variations (geometry untouched)
#   ground    add a ground plane
#   depth16   16-bit PNG (else 8-bit)
#   device    auto | cpu
#   dressing  interior renders (ui/src/renders/interiorRender.ts): library models replacing the furniture placeholders,
#             the app finishes of every surface with their PBR library materials, rooms (ceilings, lights), HDRIs
#   library   the asset library folder (dressing paths are relative to it; nothing outside it is read)
# Output lines for the app: MDSTAGE <name>, MDDEVICE <device>, MDERROR <message>; Cycles prints "Sample n/N".
# The image is presentation only: it never feeds dimensions, BOM, quantities or CNC.
import json
import math
import os
import re
import sys
import time
import traceback

import bmesh
import bpy
from mathutils import Matrix, Vector


def say(*a):
    print(*a, flush=True)


def rgb3(v, d=(0.8, 0.8, 0.8)):
    try:
        return (float(v[0]), float(v[1]), float(v[2]))
    except Exception:
        return d


def set_first(obj, prop, values):
    """Sets the first enum value the running Blender accepts (APIs move between versions)."""
    for v in values:
        try:
            setattr(obj, prop, v)
            return v
        except Exception:
            continue
    return None


def setup_device(job):
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    want = job.get('device', 'auto')
    if want != 'cpu':
        try:
            prefs = bpy.context.preferences.addons['cycles'].preferences
            kinds = ['METAL'] if sys.platform == 'darwin' else ['OPTIX', 'CUDA', 'HIP', 'ONEAPI']
            for kind in kinds:
                try:
                    prefs.compute_device_type = kind
                except Exception:
                    continue
                prefs.get_devices()
                gpus = [d for d in prefs.devices if d.type == kind]
                if gpus:
                    for d in prefs.devices:
                        d.use = d.type == kind
                    scene.cycles.device = 'GPU'
                    say('MDDEVICE', kind + ' GPU: ' + ', '.join(d.name for d in gpus))
                    return
        except Exception as e:
            say('MDINFO gpu unavailable:', repr(e))
    scene.cycles.device = 'CPU'
    say('MDDEVICE', 'CPU')


def principled(mat):
    if mat.node_tree is None:
        mat.use_nodes = True
    for n in mat.node_tree.nodes:
        if n.type == 'BSDF_PRINCIPLED':
            return n
    return mat.node_tree.nodes.new('ShaderNodeBsdfPrincipled')


def set_input(node, names, value):
    for k in names:
        if k in node.inputs:
            node.inputs[k].default_value = value
            return True
    return False


def variation_material(group, o):
    """Material for a presentation variation of a group: colour + surface model like the app's path tracer."""
    name = 'md-variation:%s' % group
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    b = principled(mat)
    rgb = rgb3(o.get('rgb'))
    kind = o.get('mat', 'matte')
    b.inputs['Base Color'].default_value = (rgb[0], rgb[1], rgb[2], 1)
    b.inputs['Metallic'].default_value = 1.0 if kind == 'metal' else 0.0
    b.inputs['Roughness'].default_value = {'glossy': 0.3, 'metal': 0.28, 'glass': 0.04}.get(kind, 0.85)
    if kind == 'glass':
        set_input(b, ('Transmission Weight', 'Transmission'), 0.92)
    if kind == 'emissive':
        set_input(b, ('Emission Color', 'Emission'), (rgb[0], rgb[1], rgb[2], 1))
        set_input(b, ('Emission Strength',), 6)
    mat['mdMat'] = kind
    return mat


def to_m(v):
    return Vector((float(v[0]) / 1000.0, float(v[1]) / 1000.0, float(v[2]) / 1000.0))


def place_camera(job):
    c = job.get('camera') or {}
    eye, at = to_m(c.get('eye', [0, -10000, 1600])), to_m(c.get('at', [0, 0, 1600]))
    # architectural camera: level (vertical lines stay vertical); framing moves with the lens shift instead of a tilt
    if c.get('level'):
        at.z = eye.z
    up = Vector(rgb3(c.get('up'), (0, 0, 1)))
    f = (at - eye)
    if f.length < 1e-9:
        f = Vector((0, 1, 0))
    f.normalize()
    if up.length < 1e-9 or abs(f.dot(up.normalized())) > 0.9999:
        up = Vector((0, 1, 0)) if abs(f.z) > 0.999 else Vector((0, 0, 1))
    r = f.cross(up).normalized()
    u = r.cross(f).normalized()
    rot = Matrix(((r.x, u.x, -f.x), (r.y, u.y, -f.y), (r.z, u.z, -f.z)))
    cam_data = bpy.data.cameras.new('MD camera')
    cam_data.sensor_fit = 'VERTICAL'
    cam_data.sensor_height = 24.0
    fov = float(c.get('fov', 55))
    cam_data.lens = float(c.get('lens') or (12.0 / math.tan(math.radians(fov) / 2)))
    sh = c.get('shift') or [0, 0]
    try:
        cam_data.shift_x, cam_data.shift_y = float(sh[0]), float(sh[1])
    except Exception:
        pass
    cam_data.clip_start = 0.05
    cam_data.clip_end = 5000
    cam = bpy.data.objects.new('MD camera', cam_data)
    bpy.context.scene.collection.objects.link(cam)
    cam.matrix_world = Matrix.Translation(eye) @ rot.to_4x4()
    bpy.context.scene.camera = cam
    return cam


def world_nodes(world):
    if not world.node_tree:
        world.use_nodes = True
    nt = world.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputWorld')
    bg = nt.nodes.new('ShaderNodeBackground')
    nt.links.new(bg.outputs['Background'], out.inputs['Surface'])
    return nt, bg


def sky(nt, bg, elevation, azimuth, strength):
    try:
        s = nt.nodes.new('ShaderNodeTexSky')
        if not set_first(s, 'sky_type', ['MULTIPLE_SCATTERING', 'SINGLE_SCATTERING', 'NISHITA', 'HOSEK_WILKIE']):
            raise RuntimeError('no sky model')
        for k, v in (('sun_disc', False), ('sun_elevation', math.radians(max(1.0, elevation))), ('sun_rotation', math.radians(azimuth))):
            try:
                setattr(s, k, v)
            except Exception:
                pass
        nt.links.new(s.outputs['Color'], bg.inputs['Color'])
        bg.inputs['Strength'].default_value = strength
    except Exception as e:
        say('MDINFO sky texture unavailable, gradient instead:', repr(e))
        bg.inputs['Color'].default_value = (0.42, 0.6, 0.85, 1)
        bg.inputs['Strength'].default_value = 1.0


def add_sun(name, azimuth, elevation, strength, color, angle_deg=0.53):
    az, el = math.radians(azimuth), math.radians(max(1.0, elevation))
    to_sun = Vector((math.cos(el) * math.sin(az), math.cos(el) * math.cos(az), math.sin(el)))
    data = bpy.data.lights.new(name, 'SUN')
    data.energy = strength
    data.color = color
    data.angle = math.radians(angle_deg)
    obj = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(obj)
    obj.rotation_mode = 'QUATERNION'
    obj.rotation_quaternion = (-to_sun).to_track_quat('-Z', 'Y')
    return obj


def add_point(name, loc, watts, color=(1.0, 0.78, 0.5), radius=0.25):
    data = bpy.data.lights.new(name, 'POINT')
    data.energy = watts
    data.color = color
    data.shadow_soft_size = radius
    obj = bpy.data.objects.new(name, data)
    obj.location = loc
    bpy.context.scene.collection.objects.link(obj)


def world_bounds(objs):
    lo, hi = Vector((1e9, 1e9, 1e9)), Vector((-1e9, -1e9, -1e9))
    for o in objs:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            lo = Vector((min(lo.x, w.x), min(lo.y, w.y), min(lo.z, w.z)))
            hi = Vector((max(hi.x, w.x), max(hi.y, w.y), max(hi.z, w.z)))
    return lo, hi


def lighting(job, meshes):
    preset = job.get('lighting', 'day')
    sun = job.get('sun') or {}
    az = float(sun.get('azimuth', 320))
    el = float(sun.get('elevation', 40))
    k = float(sun.get('intensity', 1.2)) / 1.2
    world = bpy.data.worlds.new('MD world')
    bpy.context.scene.world = world
    nt, bg = world_nodes(world)
    if preset == 'golden':
        el = min(el, 9.0)
        add_sun('MD sun', az, el, 4.5 * k, (1.0, 0.58, 0.3), 1.0)
        sky(nt, bg, el, az, 0.3)
    elif preset == 'overcast':
        bg.inputs['Color'].default_value = (0.78, 0.8, 0.83, 1)
        bg.inputs['Strength'].default_value = 1.1
    elif preset == 'studio':
        bg.inputs['Color'].default_value = (0.9, 0.9, 0.9, 1)
        bg.inputs['Strength'].default_value = 1.2
    elif preset == 'night':
        bg.inputs['Color'].default_value = (0.006, 0.009, 0.025, 1)
        bg.inputs['Strength'].default_value = 1.0
        add_sun('MD moon', az, 35, 0.04, (0.62, 0.72, 1.0), 0.6)
        # interior lights: light fixtures (emissive materials) glow, and each room / storey gets a warm lamp
        for m in bpy.data.materials:
            if m.get('mdMat') == 'emissive' and m.node_tree:
                for n in m.node_tree.nodes:
                    if n.type == 'BSDF_PRINCIPLED' and 'Emission Strength' in n.inputs:
                        n.inputs['Emission Strength'].default_value = max(12.0, n.inputs['Emission Strength'].default_value * 3)
        rooms = [o for o in meshes if str(o.get('mdId', o.name)).startswith(('room:', 'slab:'))]
        for o in rooms[:48]:
            lo, hi = world_bounds([o])
            z = hi.z + (2.3 if str(o.get('mdId', o.name)).startswith('room:') else 1.5)
            add_point('MD lamp ' + o.name, Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, z)), 180)
        if not rooms and meshes:
            lo, hi = world_bounds(meshes)
            add_point('MD lamp', (lo + hi) / 2, 400)
    else:  # day
        if sun.get('on', True) and k > 0:
            add_sun('MD sun', az, el, 4.0 * k, (1.0, 0.97, 0.92), 0.53)
        sky(nt, bg, el, az, 0.45)
    return preset


# ====================================================================================== interior dressing (v2.4)

def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_rgb(h, d=(0.8, 0.8, 0.8)):
    try:
        h = h.lstrip('#')
        return tuple(srgb_to_linear(int(h[i:i + 2], 16) / 255.0) for i in (0, 2, 4))
    except Exception:
        return d


class Interior:
    """Builds the photoreal interior from the dressing: PBR materials, library models, ceilings, glazing, lights."""

    def __init__(self, job, meshes):
        self.job = job
        self.d = job.get('dressing') or {}
        lib = job.get('library') or ''
        self.lib = os.path.realpath(lib) if lib else ''
        self.meshes = meshes
        self.by_id = {}
        for o in meshes:
            self.by_id.setdefault(str(o.get('mdId', o.name)), []).append(o)
        self.mats = {}
        self.images = {}
        self.stats = {'models': 0, 'composed': 0, 'pbr': 0, 'missing': []}
        self.rooms = self.d.get('rooms') or []

    # ---------------------------------------------------------------- paths (confined to the library)
    def lib_path(self, rel):
        if not self.lib or not rel or rel.startswith('/') or '..' in rel.split('/') or '\\' in rel:
            return None
        p = os.path.realpath(os.path.join(self.lib, rel))
        if not p.startswith(self.lib + os.sep) or not os.path.isfile(p):
            return None
        return p

    def image(self, rel, non_color=False):
        p = self.lib_path(rel)
        if not p:
            return None
        key = (p, non_color)
        if key not in self.images:
            try:
                img = bpy.data.images.load(p, check_existing=True)
                if non_color:
                    img = img.copy() if img.colorspace_settings.name != 'Non-Color' and any(i is img for (pp, nc), i in self.images.items() if not nc) else img
                    img.colorspace_settings.name = 'Non-Color'
                self.images[key] = img
            except Exception as e:
                say('MDINFO texture failed:', rel, repr(e))
                self.images[key] = None
        return self.images[key]

    @staticmethod
    def mean_value(img):
        """Mean colour of an image (on a 32 px copy, fast)."""
        try:
            small = img.copy()
            small.scale(32, 32)
            px = list(small.pixels)
            bpy.data.images.remove(small)
            n = len(px) // 4
            return tuple(sum(px[i::4][:n]) / n for i in range(3))
        except Exception:
            return (0.5, 0.5, 0.5)

    # ---------------------------------------------------------------- materials
    def material(self, name, floor=False, shell_ext=False):
        """Cycles material of an app finish: its PBR library textures (box-projected in metres) or a plain PBR colour."""
        spec = (self.d.get('materials') or {}).get(name)
        key = (name, floor)
        if key in self.mats:
            return self.mats[key]
        mat = bpy.data.materials.new('md:%s%s' % (name, ':floor' if floor else ''))
        mat.use_nodes = True
        nt = mat.node_tree
        b = principled(mat)
        out = next(n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL')
        spec = spec or {}
        kind = spec.get('kind', 'paint')
        col = hex_rgb(spec.get('color', '#cccccc'))
        b.inputs['Base Color'].default_value = (col[0], col[1], col[2], 1)
        b.inputs['Roughness'].default_value = float(spec.get('roughness', 0.8))
        b.inputs['Metallic'].default_value = float(spec.get('metallic', 0))
        if kind == 'fabric':
            set_input(b, ('Sheen Weight', 'Sheen'), 0.35)
            set_input(b, ('Sheen Roughness',), 0.4)
            b.inputs['Roughness'].default_value = 0.85
        if kind in ('wood', 'board'):
            # furniture: a satin lacquer; floors: an oiled / matt-varnished finish (a strong coat reads as a mirror)
            set_input(b, ('Coat Weight', 'Clearcoat'), 0.05 if floor else 0.15)
            set_input(b, ('Coat Roughness', 'Clearcoat Roughness'), 0.45 if floor else 0.25)
        if kind == 'stone':
            set_input(b, ('Coat Weight', 'Clearcoat'), 0.35)
            set_input(b, ('Coat Roughness', 'Clearcoat Roughness'), 0.08)
        if kind == 'tile':
            set_input(b, ('Coat Weight', 'Clearcoat'), 0.25)
            set_input(b, ('Coat Roughness', 'Clearcoat Roughness'), 0.12)
        if kind == 'metal':
            b.inputs['Roughness'].default_value = 0.32 if col[0] > 0.1 else 0.45
        lib = (spec.get('floorLib') if floor else None) or spec.get('lib')
        if lib and lib.get('maps'):
            if self.textured(mat, nt, b, lib, col, kind):
                self.stats['pbr'] += 1
        elif kind in ('paint', 'gypsum'):
            # plain paint: a very fine noise bump so walls do not read as CG-flat
            tex = nt.nodes.new('ShaderNodeTexNoise')
            tex.inputs['Scale'].default_value = 900.0
            bump = nt.nodes.new('ShaderNodeBump')
            bump.inputs['Strength'].default_value = 0.03
            nt.links.new(tex.outputs['Fac'], bump.inputs['Height'])
            nt.links.new(bump.outputs['Normal'], b.inputs['Normal'])
        elif kind == 'tile' and name.startswith('Brick'):
            self.procedural_brick(nt, b, col, spec.get('tileMm') or [230, 76])
        elif kind == 'tile':
            self.procedural_tile(nt, b, col, spec.get('tileMm') or [600, 600])
        elif kind == 'stone':
            self.procedural_marble(nt, b, col)
        mat['mdFinish'] = name
        self.mats[key] = mat
        return mat

    @staticmethod
    def procedural_tile(nt, b, col, tile_mm):
        """Large-format porcelain: square tiles of the finish's size, 2 mm grout, a faint mottle per tile, glossy."""
        tc = nt.nodes.new('ShaderNodeTexCoord')
        mp = nt.nodes.new('ShaderNodeMapping')
        sx, sy = max(100.0, float(tile_mm[0])) / 1000.0, max(100.0, float(tile_mm[1] or tile_mm[0])) / 1000.0
        mp.inputs['Scale'].default_value = (1.0 / sx, 1.0 / sy, 1.0)
        nt.links.new(tc.outputs['Object'], mp.inputs['Vector'])
        br = nt.nodes.new('ShaderNodeTexBrick')
        br.offset = 0.0
        br.squash = 1.0
        br.inputs['Scale'].default_value = 1.0
        br.inputs['Brick Width'].default_value = 1.0
        br.inputs['Row Height'].default_value = 1.0
        br.inputs['Mortar Size'].default_value = 0.008
        br.inputs['Mortar Smooth'].default_value = 0.2
        br.inputs['Bias'].default_value = 0.0
        c1 = (col[0] * 1.03, col[1] * 1.03, col[2] * 1.03, 1)
        c2 = (col[0] * 0.93, col[1] * 0.93, col[2] * 0.92, 1)
        br.inputs['Color1'].default_value = c1
        br.inputs['Color2'].default_value = c2
        br.inputs['Mortar'].default_value = (col[0] * 0.5, col[1] * 0.48, col[2] * 0.46, 1)
        nt.links.new(mp.outputs['Vector'], br.inputs['Vector'])
        # stone-like mottle inside the tiles
        nz = nt.nodes.new('ShaderNodeTexNoise')
        nz.inputs['Scale'].default_value = 3.0
        nz.inputs['Detail'].default_value = 6.0
        nt.links.new(mp.outputs['Vector'], nz.inputs['Vector'])
        mix = nt.nodes.new('ShaderNodeMix')
        mix.data_type = 'RGBA'
        mix.blend_type = 'OVERLAY'
        mix.inputs['Factor'].default_value = 0.12
        nt.links.new(br.outputs['Color'], mix.inputs[6])
        nt.links.new(nz.outputs['Color'], mix.inputs[7])
        nt.links.new(mix.outputs[2], b.inputs['Base Color'])
        bump = nt.nodes.new('ShaderNodeBump')
        bump.inputs['Strength'].default_value = 0.35
        bump.inputs['Distance'].default_value = 0.002
        nt.links.new(br.outputs['Fac'], bump.inputs['Height'])
        nt.links.new(bump.outputs['Normal'], b.inputs['Normal'])
        b.inputs['Roughness'].default_value = 0.22
        set_input(b, ('Coat Weight', 'Clearcoat'), 0.3)
        set_input(b, ('Coat Roughness', 'Clearcoat Roughness'), 0.08)

    @staticmethod
    def procedural_brick(nt, b, col, tile_mm):
        """Exposed brick (reference-photo finish): running bond on walls along X or Y (u = x + y, v = z), light mortar."""
        tc = nt.nodes.new('ShaderNodeTexCoord')
        sep = nt.nodes.new('ShaderNodeSeparateXYZ')
        nt.links.new(tc.outputs['Object'], sep.inputs['Vector'])
        add = nt.nodes.new('ShaderNodeMath')
        add.operation = 'ADD'
        nt.links.new(sep.outputs['X'], add.inputs[0])
        nt.links.new(sep.outputs['Y'], add.inputs[1])
        comb = nt.nodes.new('ShaderNodeCombineXYZ')
        nt.links.new(add.outputs['Value'], comb.inputs['X'])
        nt.links.new(sep.outputs['Z'], comb.inputs['Y'])
        br = nt.nodes.new('ShaderNodeTexBrick')
        br.offset = 0.5
        br.squash = 1.0
        br.inputs['Scale'].default_value = 1.0
        br.inputs['Brick Width'].default_value = max(0.05, float(tile_mm[0]) / 1000.0)
        br.inputs['Row Height'].default_value = max(0.02, float(tile_mm[1] or 76) / 1000.0)
        br.inputs['Mortar Size'].default_value = 0.009
        br.inputs['Mortar Smooth'].default_value = 0.3
        br.inputs['Bias'].default_value = 0.0
        # reclaimed brick: each brick a random mix of a pale tan and a deep red-brown (Blender varies it per brick)
        br.inputs['Color1'].default_value = (min(1.0, col[0] * 1.55), min(1.0, col[1] * 1.6), min(1.0, col[2] * 1.5), 1)
        br.inputs['Color2'].default_value = (col[0] * 0.7, col[1] * 0.62, col[2] * 0.6, 1)
        br.inputs['Mortar'].default_value = (0.55, 0.52, 0.48, 1)
        nt.links.new(comb.outputs['Vector'], br.inputs['Vector'])
        nz = nt.nodes.new('ShaderNodeTexNoise')
        nz.inputs['Scale'].default_value = 40.0
        nz.inputs['Detail'].default_value = 8.0
        nt.links.new(comb.outputs['Vector'], nz.inputs['Vector'])
        mix = nt.nodes.new('ShaderNodeMix')
        mix.data_type = 'RGBA'
        mix.blend_type = 'OVERLAY'
        mix.inputs['Factor'].default_value = 0.35
        nt.links.new(br.outputs['Color'], mix.inputs[6])
        nt.links.new(nz.outputs['Color'], mix.inputs[7])
        nt.links.new(mix.outputs[2], b.inputs['Base Color'])
        bump = nt.nodes.new('ShaderNodeBump')
        bump.inputs['Strength'].default_value = 0.6
        bump.inputs['Distance'].default_value = 0.004
        nt.links.new(br.outputs['Fac'], bump.inputs['Height'])
        nt.links.new(bump.outputs['Normal'], b.inputs['Normal'])
        b.inputs['Roughness'].default_value = 0.88

    @staticmethod
    def procedural_marble(nt, b, col):
        """Polished marble: the finish's colour with thin grey veins (distorted bands), clear-coated."""
        tc = nt.nodes.new('ShaderNodeTexCoord')
        wv = nt.nodes.new('ShaderNodeTexWave')
        wv.bands_direction = 'DIAGONAL'
        wv.inputs['Scale'].default_value = 2.2
        wv.inputs['Distortion'].default_value = 16.0
        wv.inputs['Detail'].default_value = 8.0
        wv.inputs['Detail Scale'].default_value = 2.5
        nt.links.new(tc.outputs['Object'], wv.inputs['Vector'])
        ramp = nt.nodes.new('ShaderNodeValToRGB')
        ramp.color_ramp.elements[0].position = 0.0
        ramp.color_ramp.elements[0].color = (col[0] * 0.58, col[1] * 0.59, col[2] * 0.61, 1)
        ramp.color_ramp.elements[1].position = 0.06
        ramp.color_ramp.elements[1].color = (col[0], col[1], col[2], 1)
        nt.links.new(wv.outputs['Fac'], ramp.inputs['Fac'])
        nt.links.new(ramp.outputs['Color'], b.inputs['Base Color'])
        b.inputs['Roughness'].default_value = 0.12
        set_input(b, ('Coat Weight', 'Clearcoat'), 0.6)
        set_input(b, ('Coat Roughness', 'Clearcoat Roughness'), 0.04)

    def textured(self, mat, nt, b, lib, col, kind):
        maps = lib.get('maps') or {}
        d = lib.get('dir', '')
        diff = self.image('%s/%s' % (d, maps.get('diff'))) if maps.get('diff') else None
        if not diff:
            return False
        size = lib.get('sizeMm') or [1000, 1000]
        sx, sy = max(50.0, float(size[0])) / 1000.0, max(50.0, float(size[1] or size[0])) / 1000.0
        tc = nt.nodes.new('ShaderNodeTexCoord')
        mp = nt.nodes.new('ShaderNodeMapping')
        mp.inputs['Scale'].default_value = (1.0 / sx, 1.0 / sy, 1.0 / sx)
        nt.links.new(tc.outputs['Object'], mp.inputs['Vector'])

        def tex(img):
            t = nt.nodes.new('ShaderNodeTexImage')
            t.image = img
            t.projection = 'BOX'
            t.projection_blend = 0.25
            nt.links.new(mp.outputs['Vector'], t.inputs['Vector'])
            return t
        td = tex(diff)
        color_out = td.outputs['Color']
        if lib.get('tint'):
            # the finish's colour with the texture's detail: hue / saturation from the finish, value from the texture
            mean = self.mean_value(diff)
            mv = max(1e-3, max(mean))
            target = max(col)
            mix = nt.nodes.new('ShaderNodeMix')
            mix.data_type = 'RGBA'
            mix.blend_type = 'MULTIPLY'
            mix.inputs['Factor'].default_value = 1.0
            # texture normalised to its mean (detail around 1.0), times the finish colour
            gain = nt.nodes.new('ShaderNodeMix')
            gain.data_type = 'RGBA'
            gain.blend_type = 'MULTIPLY'
            gain.inputs['Factor'].default_value = 1.0
            bw = nt.nodes.new('ShaderNodeRGBToBW')
            nt.links.new(td.outputs['Color'], bw.inputs['Color'])
            norm = nt.nodes.new('ShaderNodeMath')
            norm.operation = 'MULTIPLY'
            norm.inputs[1].default_value = 1.0 / mv
            nt.links.new(bw.outputs['Val'], norm.inputs[0])
            # detail contrast softened (0.55 … 1.45 around the finish colour)
            soft = nt.nodes.new('ShaderNodeMapRange')
            soft.inputs['From Min'].default_value = 0.0
            soft.inputs['From Max'].default_value = 2.0
            k = 0.12 if kind in ('paint', 'gypsum') else 0.45
            soft.inputs['To Min'].default_value = 1.0 - k
            soft.inputs['To Max'].default_value = 1.0 + k
            nt.links.new(norm.outputs['Value'], soft.inputs['Value'])
            comb = nt.nodes.new('ShaderNodeCombineColor')
            for i in range(3):
                nt.links.new(soft.outputs['Result'], comb.inputs[i])
            nt.links.new(comb.outputs['Color'], mix.inputs[6])
            mix.inputs[7].default_value = (col[0], col[1], col[2], 1)
            color_out = mix.outputs[2]
            _ = target, gain
        nt.links.new(color_out, b.inputs['Base Color'])
        if maps.get('arm'):
            img = self.image('%s/%s' % (d, maps['arm']), non_color=True)
            if img:
                t = tex(img)
                sep = nt.nodes.new('ShaderNodeSeparateColor')
                nt.links.new(t.outputs['Color'], sep.inputs['Color'])
                nt.links.new(sep.outputs[1], b.inputs['Roughness'])
                if kind == 'metal':
                    nt.links.new(sep.outputs[2], b.inputs['Metallic'])
        elif maps.get('rough'):
            img = self.image('%s/%s' % (d, maps['rough']), non_color=True)
            if img:
                nt.links.new(tex(img).outputs['Color'], b.inputs['Roughness'])
        if maps.get('nor'):
            img = self.image('%s/%s' % (d, maps['nor']), non_color=True)
            if img:
                nm = nt.nodes.new('ShaderNodeNormalMap')
                nm.inputs['Strength'].default_value = 0.6
                nt.links.new(tex(img).outputs['Color'], nm.inputs['Color'])
                nt.links.new(nm.outputs['Normal'], b.inputs['Normal'])
        return True

    def shade_material(self):
        """Lamp shade: linen that glows warm from the bulb inside (translucent + a little emission)."""
        if 'shade' in self.mats:
            return self.mats['shade']
        mat = bpy.data.materials.new('md:lamp-shade')
        mat.use_nodes = True
        nt = mat.node_tree
        for n in list(nt.nodes):
            nt.nodes.remove(n)
        out = nt.nodes.new('ShaderNodeOutputMaterial')
        tr = nt.nodes.new('ShaderNodeBsdfTranslucent')
        tr.inputs['Color'].default_value = (1.0, 0.85, 0.65, 1)
        em = nt.nodes.new('ShaderNodeEmission')
        em.inputs['Color'].default_value = (1.0, 0.78, 0.5, 1)
        em.inputs['Strength'].default_value = 2.5
        add = nt.nodes.new('ShaderNodeAddShader')
        nt.links.new(tr.outputs['BSDF'], add.inputs[0])
        nt.links.new(em.outputs['Emission'], add.inputs[1])
        nt.links.new(add.outputs['Shader'], out.inputs['Surface'])
        self.mats['shade'] = mat
        return mat

    def glass_material(self):
        if 'glass' in self.mats:
            return self.mats['glass']
        mat = bpy.data.materials.new('md:window-glass')
        mat.use_nodes = True
        nt = mat.node_tree
        for n in list(nt.nodes):
            nt.nodes.remove(n)
        out = nt.nodes.new('ShaderNodeOutputMaterial')
        glass = nt.nodes.new('ShaderNodeBsdfGlass')
        glass.inputs['Roughness'].default_value = 0.0
        glass.inputs['IOR'].default_value = 1.45
        glass.inputs['Color'].default_value = (0.96, 0.98, 0.98, 1)
        transp = nt.nodes.new('ShaderNodeBsdfTransparent')
        lp = nt.nodes.new('ShaderNodeLightPath')
        mix = nt.nodes.new('ShaderNodeMixShader')
        # shadow and diffuse rays pass straight through (daylight enters the room); camera / glossy rays see the glass
        mx = nt.nodes.new('ShaderNodeMath')
        mx.operation = 'MAXIMUM'
        nt.links.new(lp.outputs['Is Shadow Ray'], mx.inputs[0])
        nt.links.new(lp.outputs['Is Diffuse Ray'], mx.inputs[1])
        nt.links.new(mx.outputs['Value'], mix.inputs['Fac'])
        nt.links.new(glass.outputs['BSDF'], mix.inputs[1])
        nt.links.new(transp.outputs['BSDF'], mix.inputs[2])
        nt.links.new(mix.outputs['Shader'], out.inputs['Surface'])
        self.mats['glass'] = mat
        return mat

    def emit_material(self, strength=12.0, color=(1.0, 0.85, 0.65)):
        key = ('emit', strength)
        if key in self.mats:
            return self.mats[key]
        mat = bpy.data.materials.new('md:downlight')
        mat.use_nodes = True
        nt = mat.node_tree
        for n in list(nt.nodes):
            nt.nodes.remove(n)
        out = nt.nodes.new('ShaderNodeOutputMaterial')
        em = nt.nodes.new('ShaderNodeEmission')
        em.inputs['Color'].default_value = (color[0], color[1], color[2], 1)
        em.inputs['Strength'].default_value = strength
        nt.links.new(em.outputs['Emission'], out.inputs['Surface'])
        self.mats[key] = mat
        return mat

    @staticmethod
    def assign(obj, mat):
        obj.data.materials.clear()
        obj.data.materials.append(mat)
        for p in obj.data.polygons:
            p.material_index = 0

    def assign_by_normal(self, obj, up, down, side):
        """Slabs: top faces get the floor finish, undersides the ceiling, edges the wall paint."""
        me = obj.data
        me.materials.clear()
        for m in (up, down, side):
            me.materials.append(m)
        mw = obj.matrix_world.to_3x3()
        for p in me.polygons:
            nz = (mw @ p.normal).normalized().z
            p.material_index = 0 if nz > 0.5 else 1 if nz < -0.5 else 2

    # ---------------------------------------------------------------- surfaces
    def room_faces(self, obj, rooms, key, side):
        """Shell faces looking into a room with its own finish take that finish (walls: vertical faces; ceilings: slab
        undersides), so a restyled room shows its walls / ceiling while the rest of the building keeps the shell's."""
        me = obj.data
        mw = obj.matrix_world
        mn = mw.to_3x3()
        slots = {}
        for p in me.polygons:
            n = (mn @ p.normal).normalized()
            if (side and abs(n.z) > 0.5) or (not side and n.z > -0.5):
                continue
            q = (mw @ p.center) + n * 0.08
            # the face's height range (a tall wall may be one triangle reaching above the room: its centre can be too)
            zs = [(mw @ me.vertices[v].co).z for v in p.vertices]
            for r in rooms:
                top = float(r.get('openTo') or r.get('ceiling') or 3000) / 1000.0
                if (side and (min(zs) > top - 0.05 or max(zs) < 0.05)) or (not side and not (-0.05 <= q.z <= top + 0.05)):
                    continue
                if not inside(r['outline'], q.x * 1000.0, q.y * 1000.0):
                    continue
                name = r[key]
                if name not in slots:
                    me.materials.append(self.material(name))
                    slots[name] = len(me.materials) - 1
                p.material_index = slots[name]
                self.stats['roomFaces'] = self.stats.get('roomFaces', 0) + 1
                break

    def surfaces(self):
        surf = self.d.get('surfaces') or {}
        shell = self.d.get('shellFinish') or {}
        own_wall = [r for r in self.rooms if r.get('wall') and r.get('wall') != shell.get('wall', 'Paint - Warm White')]
        own_ceil = [r for r in self.rooms if r.get('ceilingFinish') and r.get('ceilingFinish') != shell.get('ceiling', 'Gypsum - White')]
        wall = self.material(shell.get('wall', 'Paint - Warm White'))
        ceiling = self.material(shell.get('ceiling', 'Gypsum - White'))
        concrete = self.material('Gypsum - White')
        floor_any = self.material(shell.get('floor', 'Porcelain Tile - Beige'), floor=True)
        leaf = self.material('Wood - Walnut')
        frame = self.material('Metal - Black')
        hide = set()
        for it in self.d.get('items') or []:
            hide.update(it.get('hide') or [])
        for o in self.meshes:
            mid = str(o.get('mdId', o.name))
            grp = str(o.get('mdGroup', ''))
            if mid in hide:
                o.hide_render = True
                continue
            if mid in surf:
                floor = mid.startswith('room:')
                self.assign(o, self.material(surf[mid], floor=floor))
                if floor:
                    # the room floors sit on the slab tops: lifted 3 mm in this render scene only (no coplanar faces)
                    for v in o.data.vertices:
                        v.co.z += 0.003
                continue
            if mid.startswith('glass:') or grp == 'glass' or o.get('mdMat') == 'glass':
                self.assign(o, self.glass_material())
                self.window_frame(o, frame)
                continue
            if mid.startswith('leaf:'):
                self.assign(o, leaf)
                continue
            if grp in ('wall', 'wall-exterior', 'structure'):
                self.assign(o, wall)
                if own_wall:
                    self.room_faces(o, own_wall, 'wall', True)
            elif grp in ('floor', 'ceiling', 'stair'):
                self.assign_by_normal(o, floor_any, ceiling, concrete)
                if own_ceil:
                    self.room_faces(o, own_ceil, 'ceilingFinish', False)
            elif grp == 'metal':
                self.assign(o, frame)
            elif grp == 'roof':
                self.assign(o, concrete)

    def window_frame(self, pane, mat):
        """A slim dark aluminium frame round each pane (the BIM opening has none)."""
        vs = [pane.matrix_world @ v.co for v in pane.data.vertices]
        if len(vs) < 8:
            return
        zs = [v.z for v in vs]
        z0, z1 = min(zs), max(zs)
        # plan direction of the pane: its two farthest corners at the bottom
        bottom = [v for v in vs if abs(v.z - z0) < 1e-4]
        if len(bottom) < 4:
            return
        a, b, best = bottom[0], bottom[0], 0
        for p in bottom:
            for q in bottom:
                dd = (p - q).length
                if dd > best:
                    a, b, best = p, q, dd
        mid = (a + b) / 2
        u = (b - a)
        u.z = 0
        length = u.length
        if length < 0.2:
            return
        u.normalize()
        ang = math.atan2(u.y, u.x)
        t, w = 0.06, 0.05  # frame depth / face width (m)
        h = z1 - z0
        parts = [(0, z0, length, w), (0, z1 - w, length, w), (-length / 2 + w / 2, z0, w, h), (length / 2 - w / 2, z0, w, h)]
        if length > 1.7:
            parts.append((0, z0, w, h))
        for i, (off, z, lw, lh) in enumerate(parts):
            bpy.ops.mesh.primitive_cube_add(size=1)
            o = bpy.context.active_object
            o.name = 'MD frame %s %d' % (pane.name, i)
            o.scale = (lw, t, lh)
            o.rotation_euler = (0, 0, ang)
            o.location = (mid.x + u.x * off, mid.y + u.y * off, z + lh / 2)
            self.assign(o, mat)

    # ---------------------------------------------------------------- rooms: ceilings, downlights
    def poly_object(self, name, pts, z, mat, flip=False):
        me = bpy.data.meshes.new(name)
        bm = bmesh.new()
        vs = [bm.verts.new((p[0] / 1000.0, p[1] / 1000.0, z)) for p in pts]
        try:
            f = bm.faces.new(vs)
            if flip:
                f.normal_flip()
        except Exception:
            bm.free()
            return None
        bm.normal_update()
        bm.to_mesh(me)
        bm.free()
        o = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(o)
        self.assign(o, mat)
        return o

    def ceilings(self):
        if not self.d.get('ceilings'):
            return
        for r in self.rooms:
            h = float(r.get('openTo') or r.get('ceiling') or 3000) / 1000.0
            # a ceiling faces down (into the room); the outline is counter-clockwise (normal up), so flip it
            self.poly_object('MD ceiling ' + r['id'], r['outline'], h, self.material(r.get('ceilingFinish', 'Gypsum - White')), flip=True)

    def downlights(self, preset):
        """Warm (3000 K) recessed downlights on a ~1.6 m grid in each room, a small glowing disc under each."""
        warm = (1.0, 0.78, 0.56)
        watts = {'night': 55.0, 'golden': 26.0}.get(preset, 12.0)
        disc = self.emit_material(25.0 if preset == 'night' else 12.0, (1.0, 0.86, 0.68))
        n = 0
        for r in self.rooms:
            pts = r['outline']
            xs, ys = [p[0] for p in pts], [p[1] for p in pts]
            x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
            if (x1 - x0) < 900 or (y1 - y0) < 900:
                continue
            h = float(r.get('openTo') or r.get('ceiling') or 3000) / 1000.0
            nx = max(1, int(round((x1 - x0 - 1000) / 1600.0)) + 1)
            ny = max(1, int(round((y1 - y0 - 1000) / 1600.0)) + 1)
            for i in range(nx):
                for j in range(ny):
                    x = (x0 + 600 + (x1 - x0 - 1200) * (i + 0.5) / nx) / 1000.0 if nx > 1 else (x0 + x1) / 2000.0
                    y = (y0 + 600 + (y1 - y0 - 1200) * (j + 0.5) / ny) / 1000.0 if ny > 1 else (y0 + y1) / 2000.0
                    if not inside(pts, x * 1000, y * 1000):
                        continue
                    data = bpy.data.lights.new('MD downlight', 'SPOT')
                    data.energy = watts * (1.6 if h > 4.5 else 1.0)
                    data.color = warm
                    data.spot_size = math.radians(110)
                    data.spot_blend = 0.65
                    data.shadow_soft_size = 0.04
                    o = bpy.data.objects.new('MD downlight', data)
                    o.location = (x, y, h - 0.015)
                    bpy.context.scene.collection.objects.link(o)
                    bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=0.045, depth=0.004, location=(x, y, h - 0.003))
                    self.assign(bpy.context.active_object, disc)
                    n += 1
        return n

    def portals(self):
        """Light portals in the window openings: Cycles samples the sky through them (far less noise indoors)."""
        n = 0
        for o in self.meshes:
            mid = str(o.get('mdId', o.name))
            if not mid.startswith('glass:'):
                continue
            lo, hi = world_bounds([o])
            c = (lo + hi) / 2
            dx, dy = hi.x - lo.x, hi.y - lo.y
            along_x = dx >= dy
            normal = Vector((0, 1, 0)) if along_x else Vector((1, 0, 0))
            # the room side: the normal pointing into a room of the dressing
            side = None
            for s in (1, -1):
                p = c + normal * 0.35 * s
                if any(inside(r['outline'], p.x * 1000, p.y * 1000) for r in self.rooms):
                    side = s
                    break
            if side is None:
                continue
            data = bpy.data.lights.new('MD portal', 'AREA')
            data.shape = 'RECTANGLE'
            data.size = max(dx, dy)
            data.size_y = hi.z - lo.z
            try:
                data.cycles.is_portal = True
            except Exception:
                return n
            lo_obj = bpy.data.objects.new('MD portal', data)
            n_in = normal * side
            lo_obj.location = c + n_in * 0.06
            # an area light emits along its −Z: point it into the room
            lo_obj.rotation_mode = 'QUATERNION'
            lo_obj.rotation_quaternion = n_in.to_track_quat('-Z', 'Z')
            bpy.context.scene.collection.objects.link(lo_obj)
            n += 1
        return n

    # ---------------------------------------------------------------- furniture
    def import_model(self, rel):
        p = self.lib_path(rel)
        if not p:
            return None
        before = set(bpy.data.objects)
        try:
            bpy.ops.import_scene.gltf(filepath=p)
        except Exception as e:
            say('MDINFO model import failed:', rel, repr(e))
            return None
        new = [o for o in bpy.data.objects if o not in before]
        if not new:
            return None
        coll = bpy.data.collections.new('asset:' + rel)
        for o in new:
            for c in list(o.users_collection):
                c.objects.unlink(o)
            coll.objects.link(o)
        ms = [o for o in new if o.type == 'MESH']
        if not ms:
            return None
        lo, hi = world_bounds(ms)
        coll.instance_offset = ((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z)
        # materials of the model: keep them, but never let them glow or be see-through by accident
        return {'coll': coll, 'size': hi - lo, 'objects': new}

    def finish_copy(self, src, finish):
        """A copy of a model collection with every surface in the item's finish (assetFinish = item)."""
        coll = bpy.data.collections.new(src['coll'].name + ':' + finish)
        mat = self.material(finish)
        mapping = {}
        for o in src['objects']:
            c = o.copy()
            if o.data:
                c.data = o.data.copy()
            mapping[o] = c
            coll.objects.link(c)
        for o, c in mapping.items():
            if o.parent in mapping:
                c.parent = mapping[o.parent]
            if c.type == 'MESH':
                self.assign(c, mat)
        coll.instance_offset = src['coll'].instance_offset
        return {'coll': coll, 'size': src['size'], 'objects': list(mapping.values())}

    def composed(self, it, place, rot):
        """Composed parts (presets / "Tự vẽ" pieces) as bevelled primitives in the mapped PBR materials."""
        root = bpy.data.objects.new('MD item %s' % it['item'], None)
        bpy.context.scene.collection.objects.link(root)
        for p in it.get('parts') or []:
            w, d, h = p['w'] / 1000.0, p['d'] / 1000.0, p['h'] / 1000.0
            if p['shape'] == 'cyl':
                bpy.ops.mesh.primitive_cylinder_add(vertices=40, radius=0.5, depth=1.0)
                o = bpy.context.active_object
                o.scale = (max(w, d), max(w, d), h)
            else:
                bpy.ops.mesh.primitive_cube_add(size=1)
                o = bpy.context.active_object
                o.scale = (w, d, h)
            o.location = (p['x'] / 1000.0, p['y'] / 1000.0, p['z'] / 1000.0 + h / 2)
            bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
            r = float(p.get('r') or 0) / 1000.0
            bev = o.modifiers.new('bevel', 'BEVEL')
            bev.width = max(0.002, min(r if r > 0 else 0.003, min(w, d, h) / 2 - 1e-4))
            bev.segments = 6 if r > 0.01 else 2
            bev.limit_method = 'ANGLE'
            if r > 0.01 and p['shape'] != 'cyl':
                o.modifiers.new('subd', 'SUBSURF').levels = 1
            bpy.ops.object.shade_smooth() if r > 0.01 else None
            m = self.material(p.get('material', 'Wood - Oak'))
            if it.get('glow') and p.get('name') == 'shade':
                m = self.shade_material()
            self.assign(o, m)
            o.parent = root
        root.location = place
        root.rotation_euler = (0, 0, rot)
        return root

    def furniture(self):
        cache = {}
        for it in self.d.get('items') or []:
            box = it.get('box') or {}
            bw, bd, bh = (float(box.get(k, 500)) / 1000.0 for k in ('w', 'd', 'h'))
            for at in it.get('at') or []:
                place = Vector((at['x'] / 1000.0, at['y'] / 1000.0, float(at.get('z', 0)) / 1000.0))
                rot = math.radians(float(at.get('rot', 0)))
                if it.get('glow'):
                    # a warm lamp inside the shade (bedside lamps): the shade lights up, the room gets a pool of light
                    g = it['glow']
                    data = bpy.data.lights.new('MD lamp', 'POINT')
                    data.energy = float(g.get('watts', 15))
                    data.color = (1.0, 0.72, 0.45)
                    data.shadow_soft_size = 0.06
                    lo = bpy.data.objects.new('MD lamp', data)
                    lo.location = place + Vector((0, 0, float(g.get('z', 300)) / 1000.0))
                    bpy.context.scene.collection.objects.link(lo)
                if it.get('kind') == 'composed':
                    self.composed(it, place, rot)
                    self.stats['composed'] += 1
                    continue
                key = (it.get('file'), None if it.get('keepModel', True) else it.get('finish'))
                if key not in cache:
                    src = cache.get((it.get('file'), None)) or self.import_model(it.get('file'))
                    cache[(it.get('file'), None)] = src
                    cache[key] = src if src is None or key[1] is None else self.finish_copy(src, key[1])
                m = cache[key]
                if not m:
                    self.stats['missing'].append(it.get('asset'))
                    # the placeholder stays visible when the model cannot be read
                    for mid in it.get('hide') or []:
                        for o in self.by_id.get(mid, []):
                            o.hide_render = False
                    continue
                sz = m['size']
                yaw = math.radians(float(it.get('yaw') or 0))
                if abs(math.sin(yaw)) > 0.7:  # turned 90°: the model's x runs along the item's depth
                    sz = Vector((sz.y, sz.x, sz.z))
                if it.get('hang'):
                    # pendants: fit the shade's plan size, hang from the ceiling (drop at most 1.2 m)
                    s = min(bw / max(sz.x, 1e-4), bd / max(sz.y, 1e-4))
                    s = min(s, 1.2 / max(sz.z, 1e-4))
                    place.z = float(it['hang']) / 1000.0 - sz.z * s
                else:
                    s = min(bw / max(sz.x, 1e-4), bd / max(sz.y, 1e-4), bh / max(sz.z, 1e-4))
                inst = bpy.data.objects.new('MD item %s' % it['item'], None)
                inst.instance_type = 'COLLECTION'
                inst.instance_collection = m['coll']
                inst.location = place
                inst.rotation_euler = (0, 0, rot + yaw)
                inst.scale = (s, s, s)
                bpy.context.scene.collection.objects.link(inst)
                self.stats['models'] += 1

    def hdri(self, preset):
        rel = (self.d.get('hdri') or {}).get(preset) or (self.d.get('hdri') or {}).get('day')
        return self.lib_path(rel) if rel else None


def inside(pts, x, y):
    c = False
    j = len(pts) - 1
    for i in range(len(pts)):
        xi, yi, xj, yj = pts[i][0], pts[i][1], pts[j][0], pts[j][1]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-12) + xi:
            c = not c
        j = i
    return c


def hdri_sun(img):
    """Direction (azimuth from +Y towards +X, elevation; degrees) of the brightest spot of an equirectangular HDRI."""
    try:
        small = img.copy()
        small.scale(128, 64)
        px = small.pixels[:]
        bpy.data.images.remove(small)
        best, bi = -1.0, 0
        for i in range(0, len(px), 4):
            v = px[i] + px[i + 1] + px[i + 2]
            if v > best:
                best, bi = v, i // 4
        u, v = (bi % 128 + 0.5) / 128.0, (bi // 128 + 0.5) / 64.0
        # Blender's equirect: u = atan2(dir.y, -dir.x) / (2π) + 0.5, v = atan2(dir.z, hypot(x, y)) / π + 0.5
        phi = (u - 0.5) * 2 * math.pi
        el = (v - 0.5) * 180.0
        dx, dy = -math.cos(phi), math.sin(phi)
        return math.degrees(math.atan2(dx, dy)), el
    except Exception:
        return None


def interior_world(job, it, preset):
    """HDRI world (rotated so its sun matches the job's sun azimuth) + a matching sun lamp; procedural sky without one."""
    sun = job.get('sun') or {}
    az = float(sun.get('azimuth', 320))
    el = float(sun.get('elevation', 40))
    k = float(sun.get('intensity', 1.2)) / 1.2
    world = bpy.data.worlds.new('MD world')
    bpy.context.scene.world = world
    nt, bg = world_nodes(world)
    path = it.hdri(preset)
    strength = {'night': 0.7, 'golden': 1.6, 'overcast': 2.0, 'studio': 1.5}.get(preset, 2.2)
    if path:
        img = bpy.data.images.load(path, check_existing=True)
        env = nt.nodes.new('ShaderNodeTexEnvironment')
        env.image = img
        tc = nt.nodes.new('ShaderNodeTexCoord')
        mp = nt.nodes.new('ShaderNodeMapping')
        rot = 0.0
        hs = hdri_sun(img) if preset in ('day', 'golden') else None
        if hs:
            rot = math.radians(az - hs[0])
            el = max(5.0, min(70.0, hs[1])) if preset == 'golden' else el
        mp.inputs['Rotation'].default_value = (0, 0, -rot)
        nt.links.new(tc.outputs['Generated'], mp.inputs['Vector'])
        nt.links.new(mp.outputs['Vector'], env.inputs['Vector'])
        nt.links.new(env.outputs['Color'], bg.inputs['Color'])
        bg.inputs['Strength'].default_value = strength
        say('MDINFO hdri %s rot=%.0f sun=%s' % (os.path.basename(path), math.degrees(rot), hs))
    else:
        sky(nt, bg, el if preset != 'golden' else min(el, 9), az, 0.45 if preset != 'night' else 0.02)
    if preset in ('day', 'golden') and sun.get('on', True) and k > 0:
        add_sun('MD sun', az, min(el, 9.0) if preset == 'golden' else el, (3.2 if preset == 'day' else 3.5) * k, (1.0, 0.95, 0.88) if preset == 'day' else (1.0, 0.62, 0.34), 0.53)


def auto_exposure(scene, base):
    """Exposure from a quick low-resolution pass: the log-average luminance brought to ~0.18 (AgX mid grey)."""
    r = scene.render
    keep = (r.resolution_percentage, scene.cycles.samples, r.filepath, r.image_settings.file_format, r.image_settings.color_depth, scene.cycles.use_denoising)
    tmp = os.path.join(os.path.dirname(r.filepath) or '.', 'md_exposure.exr')
    try:
        r.resolution_percentage = 12
        scene.cycles.samples = 24
        scene.cycles.use_denoising = True
        r.image_settings.file_format = 'OPEN_EXR'
        r.image_settings.color_depth = '16'
        r.filepath = tmp
        bpy.ops.render.render(write_still=True)
        img = bpy.data.images.load(tmp)
        px = img.pixels[:]
        bpy.data.images.remove(img)
        n = len(px) // 4
        logs = []
        for i in range(n):
            L = 0.2126 * px[4 * i] + 0.7152 * px[4 * i + 1] + 0.0722 * px[4 * i + 2]
            logs.append(math.log(max(L, 1e-4)))
        logs.sort()
        # ignore the brightest 3 % (windows, lamps): the room's surfaces set the exposure
        cut = logs[: max(1, int(len(logs) * 0.97))]
        avg = math.exp(sum(cut) / len(cut))
        # bright, airy interiors (architectural photography exposes above mid grey)
        ev = max(-3.0, min(4.0, math.log2(0.24 / max(avg, 1e-4))))
        say('MDINFO auto exposure: log-avg %.4f → %+.2f EV' % (avg, ev))
        return ev + base
    except Exception as e:
        say('MDINFO auto exposure failed:', repr(e))
        return base
    finally:
        r.resolution_percentage, scene.cycles.samples, r.filepath, r.image_settings.file_format, r.image_settings.color_depth, scene.cycles.use_denoising = keep
        try:
            os.remove(tmp)
        except Exception:
            pass


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    if not argv:
        raise RuntimeError('usage: blender -b -P md_render.py -- job.json')
    with open(argv[0], encoding='utf-8') as f:
        job = json.load(f)
    t0 = time.time()
    say('MDSTAGE import')
    bpy.ops.wm.read_factory_settings(use_empty=True)
    glb = job['glb']
    if not os.path.isfile(glb):
        raise RuntimeError('scene snapshot missing: ' + glb)
    bpy.ops.import_scene.gltf(filepath=glb)
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    if not meshes:
        raise RuntimeError('the scene snapshot has no geometry')
    interior = bool(job.get('dressing'))
    # presentation variations: recolour whole material groups; the geometry stays the imported snapshot
    ov = job.get('overrides') or {}
    changed = 0
    for o in meshes:
        g = o.get('mdGroup')
        if g and g in ov:
            mat = variation_material(g, ov[g])
            o.data.materials.clear()
            o.data.materials.append(mat)
            changed += 1
    say('MDINFO objects=%d overridden=%d import=%.1fs' % (len(meshes), changed, time.time() - t0))
    # floor slabs end flush with the outer wall faces: coplanar faces give black shadow acne in a path tracer,
    # so in this render scene only (never in the model or the GLB) their edges are pulled in by 3 mm
    for o in meshes:
        if str(o.get('mdId', o.name)).startswith('slab:') and o.data.vertices:
            xs = [v.co.x for v in o.data.vertices]
            ys = [v.co.y for v in o.data.vertices]
            cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
            for v in o.data.vertices:
                if abs(v.co.x - cx) > 0.003:
                    v.co.x -= math.copysign(0.003, v.co.x - cx)
                if abs(v.co.y - cy) > 0.003:
                    v.co.y -= math.copysign(0.003, v.co.y - cy)
    if job.get('ground') and not interior:  # interiors: the HDRI's own ground shows through the windows
        lo, hi = world_bounds(meshes)
        bpy.ops.mesh.primitive_plane_add(size=400, location=((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z - 0.002 if not interior else min(lo.z, -0.2) - 0.002))
        g = bpy.context.active_object
        gm = bpy.data.materials.new('md-ground')
        gb = principled(gm)
        gb.inputs['Base Color'].default_value = (0.24, 0.3, 0.18, 1)
        gb.inputs['Roughness'].default_value = 0.95
        g.data.materials.append(gm)
    place_camera(job)
    scene = bpy.context.scene
    preset = job.get('lighting', 'day')
    it = None
    if interior:
        say('MDSTAGE dressing')
        it = Interior(job, meshes)
        it.surfaces()
        it.ceilings()
        it.furniture()
        lights = it.downlights(preset)
        portals = it.portals() if preset in ('day', 'golden', 'overcast') else 0
        interior_world(job, it, preset)
        say('MDINFO dressing: models=%d composed=%d pbr-materials=%d downlights=%d portals=%d missing=%s %.1fs'
            % (it.stats['models'], it.stats['composed'], it.stats['pbr'], lights, portals, ','.join(sorted(set(map(str, it.stats['missing'])))) or '-', time.time() - t0))
    else:
        preset = lighting(job, meshes)
    setup_device(job)
    scene.cycles.samples = max(1, int(job.get('samples', 64)))
    scene.cycles.use_adaptive_sampling = True
    scene.cycles.max_bounces = max(1, int(job.get('bounces', 8)))
    scene.cycles.use_denoising = bool(job.get('denoise', True))
    if scene.cycles.use_denoising:
        set_first(scene.cycles, 'denoiser', ['OPENIMAGEDENOISE', 'OPTIX'])
    if interior:
        # interiors: enough bounces for light coming in through the windows, no caustic fireflies
        scene.cycles.max_bounces = max(scene.cycles.max_bounces, 10)
        scene.cycles.diffuse_bounces = max(scene.cycles.diffuse_bounces, 6)
        scene.cycles.glossy_bounces = max(scene.cycles.glossy_bounces, 4)
        scene.cycles.transparent_max_bounces = max(scene.cycles.transparent_max_bounces, 12)
        scene.cycles.caustics_reflective = False
        scene.cycles.caustics_refractive = False
        scene.cycles.blur_glossy = 1.0
        scene.cycles.sample_clamp_indirect = 8.0
        scene.cycles.adaptive_threshold = 0.015
    scene.render.resolution_x = max(16, int(job.get('w', 1920)))
    scene.render.resolution_y = max(16, int(job.get('h', 1080)))
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    vt = set_first(scene.view_settings, 'view_transform', ['AgX', 'Filmic', 'Standard'])
    if interior:
        set_first(scene.view_settings, 'look', ['AgX - Medium High Contrast', 'AgX - Base Contrast', 'None'])
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGB'
    scene.render.image_settings.color_depth = '16' if job.get('depth16') else '8'
    scene.render.filepath = job['output']
    exposure = float(job.get('exposure', 0))
    if interior:
        say('MDSTAGE exposure')
        exposure = auto_exposure(scene, exposure)
    scene.view_settings.exposure = exposure
    say('MDINFO preset=%s view_transform=%s exposure=%.2f samples=%d %dx%d' % (preset, vt, exposure, scene.cycles.samples, scene.render.resolution_x, scene.render.resolution_y))
    say('MDSTAGE render')
    # progress for the app: Blender's render statistics carry "Sample n/N" while Cycles renders
    last = {'s': ''}

    def on_stats(stats, *_):
        m = re.search(r'Sample (\d+)/(\d+)', str(stats))
        if m and m.group(0) != last['s']:
            last['s'] = m.group(0)
            say('MDPROGRESS', m.group(0))
    bpy.app.handlers.render_stats.append(on_stats)
    bpy.ops.render.render(write_still=True)
    if not os.path.isfile(job['output']):
        raise RuntimeError('Blender did not write the image')
    say('MDSTAGE done %.1fs' % (time.time() - t0))


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        say('MDERROR', str(e) or repr(e))
        traceback.print_exc()
        sys.stdout.flush()
        sys.exit(3)
