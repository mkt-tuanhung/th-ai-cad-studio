/**
 * Camera bookmark (v2.4, SP17 / V24-015) — one saved viewpoint shared by the live 3D views (BIM, Interior) and the
 * render pipeline: where the camera is and looks, its field of view / lens, the level and what is shown, the section,
 * and the model revision it was saved from (a render queued from it records that revision). Units: mm, degrees.
 */
export type V3 = [number, number, number]

export interface ViewVisibility {
  /** native item ids hidden / isolated (empty = all) */
  hidden: string[]
  keep: string[]
  /** discipline filter ('architecture' | 'structure'), display mode ('shaded' | 'wireframe' | 'hidden' …) */
  discipline?: string
  display?: string
  /** BIM 3D view mode ('section' | 'exterior' | 'lowWalls' | 'xray' | 'walk') and its view-only settings */
  view3d?: string
  wallOpacity?: number
  lowWalls?: number | null
  doorsOpen?: boolean
}

export interface SectionState {
  on: boolean
  around: string[]
  top?: number
  planes?: number[][]
}

export interface CameraBookmark {
  id: string
  name: string
  /** the scene it belongs to ('bim', 'interior', …) */
  scene: string
  eye: V3
  at: V3
  up: V3
  /** vertical field of view (degrees) */
  fov: number
  /** 35 mm-equivalent focal length (mm) of that field of view (36 × 24 mm frame) */
  lens: number
  ortho?: boolean
  level?: string
  visibility: ViewVisibility
  section: SectionState | null
  /** model revision the view was saved from */
  revision: number
  createdAt: number
  /** render settings attached by the render pipeline (engine, preset, size…) — opaque here */
  render?: Record<string, unknown>
}

/** 35 mm-equivalent focal length of a vertical field of view (24 mm frame height). */
export const lensFromFov = (fovDeg: number) => Math.round((12 / Math.tan((fovDeg * Math.PI) / 360)) * 10) / 10
export const fovFromLens = (lensMm: number) => Math.round(((2 * Math.atan(12 / lensMm) * 180) / Math.PI) * 100) / 100

/** Same viewpoint (positions within `tol` mm, angles within 0.01°). */
export function sameView(a: Pick<CameraBookmark, 'eye' | 'at' | 'fov'>, b: Pick<CameraBookmark, 'eye' | 'at' | 'fov'>, tol = 1): boolean {
  const d = (p: V3, q: V3) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])
  return d(a.eye, b.eye) <= tol && d(a.at, b.at) <= tol && Math.abs(a.fov - b.fov) <= 0.01
}
