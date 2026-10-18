/**
 * Camera bookmarks (v2.4 SP41, V24-015): saved from the BIM / Interior 3D views (their view menus) and from
 * Renders; each one is also a Renders camera so it can be queued. Restoring puts back the exact camera (eye,
 * target, up, fov), the level, hidden / isolated items, the section state and the lighting preset.
 */
import type { SceneCtl } from '../components/workspace/NativeScene'
import { useRenders } from '../state/renders'
import { useBim } from '../state/bim'
import { useInterior } from '../state/interior'
import { makeBookmark, type BookmarkSource, type CameraBookmark, type LightingPreset, type V3 } from './provenance'
import { bimSpec, interiorSpec, specRevision } from './snapshot'

const ALL_LAYERS = { architecture: true, landscape: true, furniture: true }

/** Current revision of the model a bookmark source shows. */
export function sourceRevision(source: BookmarkSource): { sceneId: string; rev: string } {
  const spec = source === 'interior' ? interiorSpec(useInterior.getState().doc, ALL_LAYERS) : bimSpec(useBim.getState().model, ALL_LAYERS)
  return { sceneId: spec.sceneId, rev: specRevision(spec) }
}

export interface ViewState {
  level?: string
  hidden: string[]
  keep: string[]
  section: CameraBookmark['section']
  mode?: string
  lighting?: LightingPreset
}

/** Saves the live view as a bookmark (and a Renders camera); returns it, or null without a live view. */
export async function saveBookmark(ctl: SceneCtl | null, source: BookmarkSource, view: ViewState, name?: string): Promise<CameraBookmark | null> {
  const r = await ctl?.command({ cmd: 'getCamera' })
  if (!r?.ok || !r.eye || !r.at) return null
  const st = useRenders.getState()
  const n = (st.doc.bookmarks ?? []).length + 1
  const { sceneId, rev } = sourceRevision(source)
  const bm = makeBookmark({
    name: name ?? `View ${String(n).padStart(2, '0')}`,
    source,
    eye: r.eye as V3,
    at: r.at as V3,
    up: (r.up as V3 | undefined) ?? [0, 0, 1],
    fov: r.fov ?? 45,
    level: view.level,
    visibility: { hidden: view.hidden, keep: view.keep },
    section: view.section,
    mode: view.mode,
    lighting: (view.lighting ?? (r.lighting as LightingPreset | undefined)) || 'standard',
    sceneId,
    sceneRev: rev,
    render: { settings: st.doc.settings, fx: st.doc.fx },
  })
  const scene = source === 'interior' ? 'interior' : 'exterior'
  st.edit(`Bookmark ${bm.name}`, (d) => ({
    ...d,
    bookmarks: [...(d.bookmarks ?? []), bm],
    cameras: [...d.cameras, { id: `cam-${bm.id}`, name: bm.name, kind: scene === 'interior' ? 'Interior - Bookmark' : 'Exterior - Bookmark', aspect: '16:9', w: 3840, h: 2160, thumb: scene === 'interior' ? '/assets/v2/renders/cam3.png' : '/assets/v2/renders/cam1.png', view: { scene, eye: bm.eye, at: bm.at, fov: bm.fov, up: bm.up }, bookmarkId: bm.id }],
  }))
  return bm
}

export const bookmarksOf = (source: BookmarkSource) => (useRenders.getState().doc.bookmarks ?? []).filter((b) => b.source === source)

/** Puts a bookmark back: view state through `apply` (level first, then visibility / section), then the exact camera. */
export async function restoreBookmark(ctl: SceneCtl | null, bm: CameraBookmark, apply: (v: ViewState) => void): Promise<boolean> {
  if (!ctl) return false
  apply({ level: bm.level, hidden: bm.visibility.hidden, keep: bm.visibility.keep, section: bm.section, mode: bm.mode, lighting: bm.lighting })
  // after the view state has re-applied (a level change re-cuts the section), set the camera last
  await new Promise((r) => setTimeout(r, 120))
  await ctl.command({ cmd: 'lighting', preset: bm.lighting ?? 'standard' })
  const r = await ctl.command({ cmd: 'camera', eye: bm.eye, at: bm.at, fov: bm.fov, up: bm.up })
  return r.ok
}
