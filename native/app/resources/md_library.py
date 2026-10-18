# MD CAD AI STUDIO — 3D asset library helper for Blender (the user's own Blender, a separate background process).
#
#   blender -b --factory-startup --offline-mode -noaudio --python-exit-code 3 -P md_library.py -- job.json
# job.json (written by the app, native/app/src/library_store.cpp):
#   {"mode": "import", "src": <file the user picked>, "glb": <out .glb>, "thumb": <out .png>}
#       imports GLB / glTF / OBJ / FBX / STL / .blend, guesses the unit (m / cm / mm) from the size, puts the footprint
#       centre at the origin and the base at z = 0, exports one GLB (textures packed) and renders a 256 px thumbnail.
#   {"mode": "probe", "models": [{"id", "file"}]}
#       the real bounding box (mm) and triangle count of downloaded models.
# Output lines: MDLIB <json> (one per result), MDERROR <message>. Nothing here goes online.
import json
import math
import os
import sys
import traceback

import bpy
from mathutils import Vector


def say(*a):
    print(*a, flush=True)


IMPORTERS = {
    '.glb': lambda p: bpy.ops.import_scene.gltf(filepath=p),
    '.gltf': lambda p: bpy.ops.import_scene.gltf(filepath=p),
    '.obj': lambda p: bpy.ops.wm.obj_import(filepath=p),
    '.fbx': lambda p: bpy.ops.import_scene.fbx(filepath=p),
    '.stl': lambda p: bpy.ops.wm.stl_import(filepath=p),
}


def import_any(path):
    ext = os.path.splitext(path)[1].lower()
    if ext == '.blend':
        with bpy.data.libraries.load(path, link=False) as (src, dst):
            dst.objects = list(src.objects)
        for o in dst.objects:
            if o is not None and o.type in ('MESH', 'EMPTY', 'CURVE'):
                bpy.context.scene.collection.objects.link(o)
        return
    if ext == '.dae':
        try:
            bpy.ops.wm.collada_import.get_rna_type()
        except Exception:
            raise RuntimeError('DAE (Collada) is not supported by this Blender (removed in Blender 5) — convert it to GLB / FBX / OBJ first')
        bpy.ops.wm.collada_import(filepath=path)
        return
    fn = IMPORTERS.get(ext)
    if not fn:
        raise RuntimeError('unsupported file type ' + ext)
    fn(path)


def meshes():
    return [o for o in bpy.context.scene.objects if o.type == 'MESH']


def bounds(objs):
    lo, hi = Vector((1e18, 1e18, 1e18)), Vector((-1e18, -1e18, -1e18))
    deps = bpy.context.evaluated_depsgraph_get()
    for o in objs:
        ev = o.evaluated_get(deps)
        for c in ev.bound_box:
            w = o.matrix_world @ Vector(c)
            lo = Vector((min(lo.x, w.x), min(lo.y, w.y), min(lo.z, w.z)))
            hi = Vector((max(hi.x, w.x), max(hi.y, w.y), max(hi.z, w.z)))
    return lo, hi


def tris(objs):
    n = 0
    for o in objs:
        for p in o.data.polygons:
            n += max(1, len(p.vertices) - 2)
    return n


def guess_unit(size):
    """Unit of the file's numbers: the one that makes the largest side closest to ~1.2 m (furniture 0.1 … 6 m)."""
    if 0.1 <= size <= 6:
        return 'm', 1.0
    best = None
    # metric only: a file in inches is rare for furniture and would be confused with centimetres (45 in ≈ 45 cm × 2.5)
    for unit, k in (('m', 1.0), ('cm', 0.01), ('mm', 0.001)):
        s = size * k
        if s <= 0:
            continue
        d = abs(math.log(s / 1.2))
        if best is None or d < best[0]:
            best = (d, unit, k)
    return best[1], best[2]


def do_import(job):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    src = job['src']
    if not os.path.isfile(src):
        raise RuntimeError('file not found: ' + src)
    import_any(src)
    ms = meshes()
    if not ms:
        raise RuntimeError('the file has no mesh geometry')
    lo, hi = bounds(ms)
    raw = hi - lo
    unit, k = guess_unit(max(raw.x, raw.y, raw.z))
    # one root: scale to metres, footprint centre at the origin, base on the floor
    root = bpy.data.objects.new('md_root', None)
    bpy.context.scene.collection.objects.link(root)
    for o in bpy.context.scene.objects:
        if o is not root and o.parent is None:
            o.parent = root
    c = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
    root.scale = (k, k, k)
    root.location = -c * k
    bpy.context.view_layer.update()
    for o in bpy.context.scene.objects:
        o.select_set(True)
    bpy.context.view_layer.objects.active = root
    lo2, hi2 = bounds(ms)
    size = hi2 - lo2
    os.makedirs(os.path.dirname(job['glb']), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=job['glb'], export_format='GLB', use_selection=False, export_apply=True, export_yup=True)
    if not os.path.isfile(job['glb']):
        raise RuntimeError('Blender did not write the GLB')
    thumb_ok = False
    if job.get('thumb'):
        try:
            thumbnail(ms, lo2, hi2, job['thumb'])
            thumb_ok = os.path.isfile(job['thumb'])
        except Exception as e:
            say('MDINFO thumbnail failed:', repr(e))
    mats = len({m.name for o in ms for m in o.data.materials if m})
    say('MDLIB ' + json.dumps({'ok': True, 'mode': 'import', 'unit': unit, 'raw': [raw.x, raw.y, raw.z],
                               'dims': {'w': round(size.x * 1000), 'd': round(size.y * 1000), 'h': round(size.z * 1000)},
                               'tris': tris(ms), 'objects': len(ms), 'materials': mats, 'thumb': thumb_ok}))


def thumbnail(ms, lo, hi, out):
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 24
    scene.cycles.use_denoising = True
    scene.render.resolution_x = scene.render.resolution_y = 256
    scene.render.film_transparent = False
    world = bpy.data.worlds.new('w')
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get('Background')
    bg.inputs['Color'].default_value = (0.92, 0.93, 0.94, 1)
    bg.inputs['Strength'].default_value = 1.0
    sun = bpy.data.lights.new('sun', 'SUN')
    sun.energy = 3
    so = bpy.data.objects.new('sun', sun)
    so.rotation_euler = (math.radians(50), 0, math.radians(-35))
    scene.collection.objects.link(so)
    center = (lo + hi) / 2
    r = max((hi - lo).length / 2, 0.05)
    cam = bpy.data.cameras.new('cam')
    cam.lens = 50
    co = bpy.data.objects.new('cam', cam)
    scene.collection.objects.link(co)
    # 3/4 front view (the front of a piece faces −Y)
    d = Vector((0.55, -1.0, 0.55)).normalized()
    co.location = center + d * r * 3.1
    co.rotation_euler = (center - co.location).to_track_quat('-Z', 'Y').to_euler()
    scene.camera = co
    scene.view_settings.view_transform = 'AgX' if 'AgX' in [i.identifier for i in scene.view_settings.bl_rna.properties['view_transform'].enum_items] else 'Standard'
    scene.render.image_settings.file_format = 'PNG'
    scene.render.filepath = out
    bpy.ops.render.render(write_still=True)


def do_probe(job):
    for m in job.get('models', []):
        try:
            bpy.ops.wm.read_factory_settings(use_empty=True)
            import_any(m['file'])
            ms = meshes()
            if not ms:
                raise RuntimeError('no mesh')
            lo, hi = bounds(ms)
            s = hi - lo
            say('MDLIB ' + json.dumps({'ok': True, 'mode': 'probe', 'id': m['id'], 'dims': {'w': round(s.x * 1000), 'd': round(s.y * 1000), 'h': round(s.z * 1000)}, 'tris': tris(ms)}))
        except Exception as e:
            say('MDLIB ' + json.dumps({'ok': False, 'mode': 'probe', 'id': m.get('id'), 'error': str(e) or repr(e)}))


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    if not argv:
        raise RuntimeError('usage: blender -b -P md_library.py -- job.json')
    with open(argv[0], encoding='utf-8') as f:
        job = json.load(f)
    if job.get('mode') == 'import':
        do_import(job)
    elif job.get('mode') == 'probe':
        do_probe(job)
    else:
        raise RuntimeError('unknown mode')


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        say('MDERROR', str(e) or repr(e))
        traceback.print_exc()
        sys.stdout.flush()
        sys.exit(3)
