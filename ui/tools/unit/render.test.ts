// Unit tests of the v2.4 render pipeline logic (run: cd ui && UNIT=render node tools/test-cam.mjs run;
// a GLB file from the app: UNIT=render node tools/test-cam.mjs glbFile <file.glb>).
import {
  MATERIAL_OPTIONS, LIGHTING_PATCH, applyOverrides, bimGroup, canonicalJson, finalStatus, fnv1a64, fovFromLens, geometryKey, glbMaterialName, interiorGroup,
  lensFromFov, lightingOf, makeBookmark, memoryOk, parseGlb, provenanceOf, renderMemoryBytes, sameBookmarkState, sameCamera, sceneRevision, type JobSnapshot,
} from '../../src/renders/provenance'
import { DEFAULT_SETTINGS, VARIATIONS } from '../../src/renders/model'
import type { Scene } from '../../src/engine3d/scene'

const results: [string, boolean, string?][] = []
const t = (name: string, ok: boolean, extra?: unknown) => results.push([name, ok, extra === undefined ? undefined : JSON.stringify(extra)])

/** A tiny scene like interiorScene: floor, walls, a sofa (group set like snapshot.ts does). */
function sampleScene(width = 4200): Scene {
  const items: Scene['items'] = [
    { id: 'room:living', rgb: [0.85, 0.8, 0.73], mat: 'matte', parts: [{ k: 'prism', o: [0, 0, -40], pts: [[0, 0], [width, 0], [width, 3000], [0, 3000]], s: [40, 0, 0] } as never] },
    { id: 'walls:living', rgb: [0.95, 0.93, 0.9], parts: [{ k: 'box', o: [0, 0, 0], s: [width, 100, 2800] } as never] },
    { id: 'sofa', rgb: [0.48, 0.32, 0.22], mat: 'glossy', parts: [{ k: 'box', o: [500, 500, 0], s: [2200, 900, 800] } as never] },
  ]
  return { items: items.map((it) => ({ ...it, group: interiorGroup(it, it.id === 'sofa' ? 'furniture' : undefined) })) }
}

/** Minimal GLB with one triangle node (glTF metres, Y up) for the reader. */
function tinyGlb(): Uint8Array {
  const pos = new Float32Array([1, 0.5, -2, 4, 3, -2, 1, 0.5, -6])
  const idx = new Uint32Array([0, 1, 2])
  const bin = new Uint8Array(pos.byteLength + idx.byteLength)
  bin.set(new Uint8Array(pos.buffer), 0)
  bin.set(new Uint8Array(idx.buffer), pos.byteLength)
  const gltf = {
    asset: { version: '2.0', extras: { presentationOnly: true, units: 'm', upAxis: 'Y' } },
    scenes: [{ nodes: [0] }], nodes: [{ name: 'w1', mesh: 0 }], meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
    materials: [{ name: 'md:matte:e0ded6' }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [1, 0.5, -6], max: [4, 3, -2] }, { bufferView: 1, componentType: 5125, count: 3, type: 'SCALAR' }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: pos.byteLength }, { buffer: 0, byteOffset: pos.byteLength, byteLength: idx.byteLength }],
    buffers: [{ byteLength: bin.byteLength }],
  }
  let json = JSON.stringify(gltf)
  while (json.length % 4) json += ' '
  const jb = new TextEncoder().encode(json)
  const out = new Uint8Array(12 + 8 + jb.length + 8 + bin.length)
  const dv = new DataView(out.buffer)
  dv.setUint32(0, 0x46546c67, true), dv.setUint32(4, 2, true), dv.setUint32(8, out.length, true)
  dv.setUint32(12, jb.length, true), dv.setUint32(16, 0x4e4f534a, true)
  out.set(jb, 20)
  dv.setUint32(20 + jb.length, bin.length, true), dv.setUint32(24 + jb.length, 0x004e4942, true)
  out.set(bin, 28 + jb.length)
  return out
}

export function run() {
  // ── revisions ────────────────────────────────────────────────────────────────
  t('FNV-1a 64 reference vectors ("" and "a")', fnv1a64('') === 'cbf29ce484222325' && fnv1a64('a') === 'af63dc4c8601ec8c', [fnv1a64(''), fnv1a64('a')])
  t('canonical JSON ignores key order', canonicalJson({ b: 1, a: [{ y: 2, x: 1 }] }) === canonicalJson({ a: [{ x: 1, y: 2 }], b: 1 }))
  const r0 = sceneRevision(sampleScene()), r1 = sceneRevision(sampleScene(4500))
  t('scene revision: same model → same revision; a 4200 → 4500 mm wall → new revision', r0 === sceneRevision(sampleScene()) && r0 !== r1 && r0.length === 12, [r0, r1])

  // ── queue-time snapshot / provenance ───────────────────────────────────────────
  const snap: JobSnapshot = { sceneId: 'interior:villa-riverside', sceneRev: r0, geomHash: 'abc', glb: '/cache/scene.glb', glbSha256: 'f00', frame: '/cache/frame.png', camera: { eye: [7350, 3450, 1600], at: [2000, 900, 900], up: [0, 0, 1], fov: 68, lens: 8.9 }, capturedAt: 1_700_000_000_000 }
  const job = { id: 'j1', camera: 'Cam 03 - Living', cameraId: 'cam3', created: 1_700_000_000_000, variant: { key: 'timber', overrides: MATERIAL_OPTIONS[1].overrides } }
  const prov = provenanceOf(job, snap, { samples: 16 }, 'blender')
  t('provenance: presentation only, queue-time revision (not the live one), camera, option, enqueue time', prov.presentationOnly && /PRESENTATION ONLY/.test(prov.label) && prov.scene?.revision === r0 && prov.scene.revision !== r1 && prov.camera?.fov === 68 && prov.materialOption?.key === 'timber' && prov.enqueuedAt === '2023-11-14T22:13:20.000Z' && prov.frame3d === '/cache/frame.png')
  t('provenance: Blender fallback is recorded', provenanceOf(job, snap, {}, 'occt', 'blender-missing').fallback === 'blender-missing')

  // ── job status: cancel / failures are never "done" (V24-043) ───────────────────
  t('final status: cancelled', finalStatus({ ok: false, error: 'cancelled' }) === 'cancelled')
  t('final status: failed (error / no file)', finalStatus({ ok: false, error: 'Blender crashed' }) === 'failed' && finalStatus({ ok: true }) === 'failed')
  t('final status: done only with an image', finalStatus({ ok: true, path: '/r/a.png' }) === 'done' && finalStatus({ ok: true }, false) === 'done')

  // ── camera bookmarks (V24-015) ─────────────────────────────────────────────────
  t('lens ↔ fov on a 24 mm sensor height (50° → 25.73 mm)', Math.abs(lensFromFov(50) - 25.734) < 0.01 && Math.abs(fovFromLens(lensFromFov(37)) - 37) < 1e-9)
  const hidden = ['w3'], planes = [[0, 1, 0, -2500]]
  const bm = makeBookmark({ name: 'View 01', source: 'bim', eye: [1, 2, 3], at: [4, 5, 6], fov: 45, level: 'L2', visibility: { hidden, keep: [] }, section: { on: true, around: [], planes }, sceneId: 'bim:villa-riverside', sceneRev: r0, lighting: 'golden' })
  hidden.push('w4')
  planes[0][3] = 0
  t('bookmark keeps lens, up, level, visibility, section, revision and lighting (deep copies)', bm.lens === 28.97 && bm.up.join() === '0,0,1' && bm.level === 'L2' && bm.visibility.hidden.join() === 'w3' && bm.section.planes?.[0][3] === -2500 && bm.sceneRev === r0 && bm.lighting === 'golden')
  const restored = { eye: [1, 2, 3.004], at: [4, 5, 6], up: [0, 0, 2], fov: 45, level: 'L2', hidden: ['w3'], keep: [], section: { on: true, around: [], planes: [[0, 1, 0, -2500]] } }
  t('bookmark restore check: same camera (0.01 mm, up normalised) and state', sameCamera(bm, restored) && sameBookmarkState(bm, restored))
  t('bookmark restore check: a moved camera / other level / other section is detected', !sameCamera(bm, { ...restored, eye: [1, 2, 4] }) && !sameBookmarkState(bm, { ...restored, level: 'L1' }) && !sameBookmarkState(bm, { ...restored, section: { on: false, around: [] } }) && !sameCamera(bm, { ...restored, fov: 46 }))

  // ── Day / Golden / Night (lighting only) ────────────────────────────────────────
  const lv = VARIATIONS.map((v) => lightingOf({ ...DEFAULT_SETTINGS, ...v.patch }))
  t('variations map to Blender lighting: Original → day, Warm → golden, Overcast, Night', lv.join() === 'day,golden,overcast,night', lv)
  t('presets patch only sun / sky / lighting keys (never geometry)', Object.values(LIGHTING_PATCH).every((p) => Object.keys(p).every((k) => ['lighting', 'sunSky', 'sunIntensity', 'sunDirection', 'sunElevation', 'hdri'].includes(k))))
  t('derived lighting without an explicit preset', lightingOf({ sunSky: true, sunIntensity: 1, sunElevation: 8, hdri: 'Outdoor - Clear Sky' }) === 'golden' && lightingOf({ sunSky: false, sunIntensity: 0, hdri: 'Outdoor - Clear Sky' }) === 'night')

  // ── material options (SP46): geometry identical, materials differ ──────────────
  const base = sampleScene()
  const opts = MATERIAL_OPTIONS.map((o) => applyOverrides(base, o.overrides))
  t('material options keep the geometry identical', opts.every((s) => geometryKey(s) === geometryKey(base)))
  t('material options change materials (timber: floor + sofa wood; marble: floor)', opts[1].items[0].rgb.join() === '0.55,0.38,0.22' && opts[1].items[2].mat === 'glossy' && opts[3].items[0].rgb.join() === '0.93,0.92,0.89' && opts[0] === base)
  t('material groups: interior floor / wall / furniture / light / glass', base.items.map((i) => i.group).join() === 'floor,wall,furniture' && interiorGroup({ id: 'x', rgb: [1, 1, 1], parts: [], mat: 'emissive' }) === 'light' && interiorGroup({ id: 'g', rgb: [1, 1, 1], parts: [], mat: 'glass' }) === 'glass')
  const kinds = { columns: new Set(['c1']), slabs: new Set(['s1']), ceilings: new Set(['s2']), stairs: new Set(['st1']), railings: new Set(['r1']), roofs: new Set(['rf']), components: new Set(['k1']) }
  t('material groups: BIM extras', ['c1', 's1', 's2', 'st1', 'r1', 'rf', 'k1', 'w9:frame'].map((id) => bimGroup(id, kinds)).join() === 'structure,floor,ceiling,stair,metal,roof,furniture,metal')

  // ── memory guard (V24-046) ──────────────────────────────────────────────────────
  const gb = (b: number) => b / 1073741824
  t('memory estimate: 4K Blender ≈ 1.8 GB, 8K OCCT ≈ 3.7 GB', Math.abs(gb(renderMemoryBytes(3840, 2160, 'blender')) - 1.81) < 0.05 && Math.abs(gb(renderMemoryBytes(7680, 4320, 'occt')) - 3.69) < 0.05)
  t('memory guard: 4K refused on a 1.2 GB budget, allowed with 60 % of 32 GB', !memoryOk(3840, 2160, 'blender', 1200 * 1048576) && memoryOk(7680, 4320, 'blender', 32 * 1073741824 * 0.6))

  // ── GLB naming + reader ─────────────────────────────────────────────────────────
  t('GLB material names match the native writer', glbMaterialName('glass', [0.55, 0.7, 0.78], 0.6) === 'md:glass:8cb3c7:t60' && glbMaterialName(undefined, [0.88, 0.87, 0.84]) === 'md:matte:e0ded6')
  const g = parseGlb(tinyGlb())
  t('GLB reader: nodes, material per node, metres Y-up → mm Z-up bounds', g.nodes.length === 1 && g.nodeMaterial.w1 === 'md:matte:e0ded6' && g.boundsMm.join() === '1000,2000,500,4000,6000,3000' && g.triangles === 1, g.boundsMm)
  let bad = ''
  try { parseGlb(new Uint8Array(32)) } catch (e) { bad = String(e) }
  t('GLB reader rejects a non-GLB', /magic/.test(bad))

  const all = results.every((r) => r[1])
  return { all, passed: results.filter((r) => r[1]).length, total: results.length, failed: results.filter((r) => !r[1]) }
}

/** Checks a GLB written by the app (V24-036 round trip): structure, presentation flag, bounds in mm. */
export function glbFile(latin1: string) {
  const bytes = Uint8Array.from(latin1, (c) => c.charCodeAt(0))
  const g = parseGlb(bytes)
  const d = [g.boundsMm[3] - g.boundsMm[0], g.boundsMm[4] - g.boundsMm[1], g.boundsMm[5] - g.boundsMm[2]].map((x) => Math.round(x * 10) / 10)
  return { all: g.version === 2 && g.nodes.length > 0 && g.asset?.extras !== undefined && (g.asset.extras as { presentationOnly?: boolean }).presentationOnly === true, nodes: g.nodes.length, triangles: g.triangles, materials: g.materials, dimsMm: d, boundsMm: g.boundsMm.map((x) => Math.round(x * 10) / 10) }
}
