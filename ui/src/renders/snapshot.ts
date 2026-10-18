/**
 * Render scene snapshots (v2.4, SP43): when a job is QUEUED, the scene it will render is captured — its
 * specification and revision, the kernel's geometry hash, a GLB for Blender and a live OCCT frame from the
 * job camera (before / after comparison). Later edits to the model never change a queued render.
 */
import type { HostApi } from '../services/host'
import type { Scene } from '../engine3d/scene'
import { useBim } from '../state/bim'
import { useInterior } from '../state/interior'
import { interiorScene } from '../interior/scene'
import { bimExtras, nativeBuildingModel } from '../bim/scene'
import type { BimModel } from '../bim/model'
import { bimGroup, interiorGroup, lensFromFov, sceneRevision, type JobSnapshot } from './provenance'
import type { CameraView } from './model'

/** Everything the renderer builds for a camera's scene. */
export interface SceneSpec {
  sceneId: string
  items: Scene['items']
  /** Exterior: the BIM model the native builder turns into walls with openings, glazing and floor slabs. */
  bimModel?: BimModel
  ground?: boolean
}

export function bimKinds(m: BimModel) {
  return {
    columns: new Set(m.columns.map((x) => x.id)),
    slabs: new Set(m.slabs.filter((x) => x.kind !== 'ceiling').map((x) => x.id)),
    ceilings: new Set(m.slabs.filter((x) => x.kind === 'ceiling').map((x) => x.id)),
    stairs: new Set(m.stairs.map((x) => x.id)),
    railings: new Set(m.railings.map((x) => x.id)),
    roofs: new Set((m.roofs ?? []).map((x) => x.id)),
    components: new Set(m.components.map((x) => x.id)),
  }
}

/** The BIM building scene (as the live BIM 3D view builds it) with material groups. */
export function bimSpec(model: BimModel, layers: Record<string, boolean>): SceneSpec {
  const k = bimKinds(model)
  const arch = layers.architecture !== false
  const items = arch ? bimExtras(model).items.map((it) => ({ ...it, group: it.group ?? bimGroup(it.id, k) })) : []
  return { sceneId: 'bim:villa-riverside', items, bimModel: arch ? nativeBuildingModel(model) : undefined, ground: layers.landscape !== false }
}

/** The interior scene (walls to the ceiling, furniture per layer) with material groups. */
export function interiorSpec(doc: ReturnType<typeof useInterior.getState>['doc'], layers: Record<string, boolean>): SceneSpec {
  const sc = interiorScene(doc, { fullWalls: true, furniture: layers.furniture !== false })
  const byId = new Map(doc.items.map((i) => [i.id, i]))
  return { sceneId: 'interior:villa-riverside', items: sc.items.map((it) => ({ ...it, group: interiorGroup(it, byId.get(it.id)?.category, !!byId.get(it.id)?.cabinet) })) }
}

/** Scene spec of a camera's view from the current models. */
export function specFor(view: CameraView, layers: Record<string, boolean>): SceneSpec {
  return view.scene === 'interior' ? interiorSpec(useInterior.getState().doc, layers) : bimSpec(useBim.getState().model, layers)
}

export const specRevision = (spec: SceneSpec) => sceneRevision(spec)

/** Builds a spec into a host scene key (same calls as the live 3D views). */
export async function loadSpec(host: HostApi, key: string, spec: SceneSpec) {
  return spec.bimModel ? host.scene3dLoadBim(key, JSON.stringify(spec.bimModel), JSON.stringify({ items: spec.items })) : host.scene3dLoad(key, JSON.stringify({ items: spec.items }))
}

const SNAP_KEY = 'render-snap'
let last: { rev: string; geomHash?: string; glb?: string; glbSha256?: string; nodes?: number } | null = null

/**
 * Captures a job's snapshot now: builds the spec in the host, hashes the geometry, exports the GLB when
 * `glb` (Blender jobs; reused while the revision is the same) and grabs the live frame from the camera.
 */
export async function captureSnapshot(host: HostApi, spec: SceneSpec, cam: { eye: number[]; at: number[]; up?: number[]; fov: number }, opts: { glb: boolean; frameW: number; frameH: number }): Promise<JobSnapshot> {
  const rev = specRevision(spec)
  const fresh = last?.rev !== rev
  if (fresh || (opts.glb && !last?.glb)) {
    const r = await loadSpec(host, SNAP_KEY, spec)
    if (!r.ok) throw new Error(r.error ?? 'scene build failed')
    const h = (await host.scene3dCommand(SNAP_KEY, JSON.stringify({ cmd: 'geomHash' }))) as { hash?: string }
    last = { rev, geomHash: h.hash }
    if (opts.glb) {
      const g = (await host.scene3dCommand(SNAP_KEY, JSON.stringify({ cmd: 'exportGlb', visibleOnly: true }))) as { ok: boolean; path?: string; sha256?: string; nodes?: number; error?: string }
      if (!g.ok || !g.path) throw new Error(g.error ?? 'GLB export failed')
      Object.assign(last, { glb: g.path, glbSha256: g.sha256, nodes: g.nodes })
    }
  }
  const up = cam.up ?? [0, 0, 1]
  await host.scene3dCommand(SNAP_KEY, JSON.stringify({ cmd: 'camera', eye: cam.eye, at: cam.at, fov: cam.fov, up }))
  const f = (await host.scene3dCommand(SNAP_KEY, JSON.stringify({ cmd: 'snapshot', w: opts.frameW, h: opts.frameH, save: true }))) as { ok: boolean; path?: string }
  return {
    sceneId: spec.sceneId,
    sceneRev: rev,
    geomHash: last!.geomHash,
    ...(opts.glb ? { glb: last!.glb, glbSha256: last!.glbSha256, nodes: last!.nodes } : {}),
    frame: f.ok ? f.path : undefined,
    camera: { eye: [...cam.eye], at: [...cam.at], up: [...up], fov: cam.fov, lens: Math.round(lensFromFov(cam.fov) * 100) / 100 },
    capturedAt: Date.now(),
  }
}

/** Export GLB (SP38): builds the spec in its own scene key and asks the host to write it (save dialog). */
export async function exportGlb(host: HostApi, spec: SceneSpec, name: string) {
  const r = await loadSpec(host, 'export-glb', spec)
  if (!r.ok) return { ok: false as const, error: r.error ?? 'scene build failed' }
  return host.scene3dExportGlb('export-glb', name)
}

/** Forget the cached GLB (tests; a new scene key). */
export const resetSnapshotCache = () => void (last = null)
