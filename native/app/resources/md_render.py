# MD CAD AI STUDIO — local photoreal render worker for Blender (Cycles).
#
# Run by the app as a separate background process (never bundled; the user's own Blender install):
#   blender -b --factory-startup --offline-mode -noaudio --python-exit-code 3 -P md_render.py -- job.json
# job.json (written by the app, see native/app/src/host_bridge.cpp renderStartBlender):
#   glb       scene snapshot exported when the job was queued (metres, glTF Y-up; Blender imports Z-up)
#   output    PNG path to write (the app moves it into the Renders folder and writes the provenance sidecar)
#   w, h, samples, bounces, denoise, exposure
#   camera    {eye, at, up, fov (vertical, deg), lens (mm, 24 mm sensor height)} in scene mm
#   lighting  day | golden | night | overcast | studio
#   sun       {on, azimuth (deg from +Y towards +X), elevation (deg), intensity}
#   overrides {group: {rgb, mat}} presentation material variations (geometry untouched)
#   ground    add a ground plane
#   depth16   16-bit PNG (else 8-bit)
#   device    auto | cpu
# Output lines for the app: MDSTAGE <name>, MDDEVICE <device>, MDERROR <message>; Cycles prints "Sample n/N".
# The image is presentation only: it never feeds dimensions, BOM, quantities or CNC.
import json
import math
import os
import re
import sys
import time
import traceback

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
        for k in ('Transmission Weight', 'Transmission'):
            if k in b.inputs:
                b.inputs[k].default_value = 0.92
                break
    if kind == 'emissive':
        for k in ('Emission Color', 'Emission'):
            if k in b.inputs:
                b.inputs[k].default_value = (rgb[0], rgb[1], rgb[2], 1)
                break
        if 'Emission Strength' in b.inputs:
            b.inputs['Emission Strength'].default_value = 6
    mat['mdMat'] = kind
    return mat


def to_m(v):
    return Vector((float(v[0]) / 1000.0, float(v[1]) / 1000.0, float(v[2]) / 1000.0))


def place_camera(job):
    c = job.get('camera') or {}
    eye, at = to_m(c.get('eye', [0, -10000, 1600])), to_m(c.get('at', [0, 0, 1600]))
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
    if job.get('ground'):
        lo, hi = world_bounds(meshes)
        bpy.ops.mesh.primitive_plane_add(size=400, location=((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z - 0.002))
        g = bpy.context.active_object
        gm = bpy.data.materials.new('md-ground')
        gb = principled(gm)
        gb.inputs['Base Color'].default_value = (0.24, 0.3, 0.18, 1)
        gb.inputs['Roughness'].default_value = 0.95
        g.data.materials.append(gm)
    place_camera(job)
    preset = lighting(job, meshes)
    scene = bpy.context.scene
    setup_device(job)
    scene.cycles.samples = max(1, int(job.get('samples', 64)))
    scene.cycles.use_adaptive_sampling = True
    scene.cycles.max_bounces = max(1, int(job.get('bounces', 8)))
    scene.cycles.use_denoising = bool(job.get('denoise', True))
    if scene.cycles.use_denoising:
        set_first(scene.cycles, 'denoiser', ['OPENIMAGEDENOISE', 'OPTIX'])
    scene.render.resolution_x = max(16, int(job.get('w', 1920)))
    scene.render.resolution_y = max(16, int(job.get('h', 1080)))
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    vt = set_first(scene.view_settings, 'view_transform', ['AgX', 'Filmic', 'Standard'])
    scene.view_settings.exposure = float(job.get('exposure', 0))
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGB'
    scene.render.image_settings.color_depth = '16' if job.get('depth16') else '8'
    scene.render.filepath = job['output']
    say('MDINFO preset=%s view_transform=%s samples=%d %dx%d' % (preset, vt, scene.cycles.samples, scene.render.resolution_x, scene.render.resolution_y))
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
