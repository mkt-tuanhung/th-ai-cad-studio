/**
 * Scene description shipped to the native OCCT engine (native/libs/geom_occt/scene.hpp).
 * The UI turns each discipline model into primitives; OCCT builds exact solids, renders, picks,
 * measures volumes and exports STEP. Units: mm. World Z is up.
 */
export type V3 = [number, number, number]

export interface Prim {
  k: 'box' | 'cyl' | 'cone' | 'sphere' | 'torus' | 'prism' | 'revolve' | 'mesh'
  /** Frame: origin, local Z, local X. */
  o: V3
  z?: V3
  x?: V3
  /** box: dx dy dz · cyl: r h · cone: r1 r2 h · sphere: r · torus: R r angle · prism: h · revolve: angle */
  s: V3
  pts?: [number, number][]
  /** mesh: triangles, x y z × 3 per triangle (surfaces without volume). */
  tri?: number[]
}

export interface SceneItem {
  id: string
  rgb: V3
  transparency?: number
  fuse?: boolean
  /** Surface model for the path tracer (default matte). */
  mat?: 'matte' | 'glossy' | 'metal' | 'glass' | 'emissive'
  parts: Prim[]
  cuts?: Prim[]
  /** Feature-based part evaluated natively instead of parts / cuts (mech/part.ts). */
  part?: object
  /** Presentation material group (render material options, renders/provenance.ts); never geometry. */
  group?: string
}

export interface Scene {
  items: SceneItem[]
  /** Ask the engine for exact per-item volumes (costly on large scenes). */
  volumes?: boolean
}

export const hex = (h: string): V3 => {
  const n = parseInt(h.replace('#', ''), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const len = (a: V3) => Math.hypot(a[0], a[1], a[2])
const norm = (a: V3): V3 => {
  const l = len(a) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]

/** Axis-aligned box from its min corner. */
export const box = (x: number, y: number, z: number, dx: number, dy: number, dz: number): Prim => ({ k: 'box', o: [x, y, z], s: [dx, dy, dz] })

/** Box of footprint w × d centred on (cx, cy), base at z, rotated by `rotDeg` about Z. */
export function boxAt(cx: number, cy: number, z: number, w: number, d: number, h: number, rotDeg = 0): Prim {
  const a = (rotDeg * Math.PI) / 180
  const x: V3 = [Math.cos(a), Math.sin(a), 0]
  const y: V3 = [-Math.sin(a), Math.cos(a), 0]
  return { k: 'box', o: [cx - x[0] * w / 2 - y[0] * d / 2, cy - x[1] * w / 2 - y[1] * d / 2, z], x, z: [0, 0, 1], s: [w, d, h] }
}

/** Vertical cylinder of radius r, base centre (cx, cy, z). */
export const vcyl = (cx: number, cy: number, z: number, r: number, h: number): Prim => ({ k: 'cyl', o: [cx, cy, z], s: [r, h, 0] })

/** Cylinder from a to b with radius r (pipes, shafts). */
export function cylBetween(a: V3, b: V3, r: number): Prim {
  return { k: 'cyl', o: a, z: norm(sub(b, a)), s: [r, len(sub(b, a)), 0] }
}

/** Rectangular section w (horizontal) × h (vertical) swept straight from a to b, centred on the line (ducts, beams). */
export function rectBetween(a: V3, b: V3, w: number, h: number): Prim {
  const dir = norm(sub(b, a))
  // local X along the run, local Z up (or across for vertical runs)
  const up: V3 = Math.abs(dir[2]) > 0.99 ? [1, 0, 0] : [0, 0, 1]
  const side = norm(cross(up, dir))
  const z = norm(cross(dir, side))
  const o: V3 = [a[0] - side[0] * w / 2 - z[0] * h / 2, a[1] - side[1] * w / 2 - z[1] * h / 2, a[2] - side[2] * w / 2 - z[2] * h / 2]
  // frame: X = run direction, Y = side, Z = up
  return { k: 'box', o, x: dir, z, s: [len(sub(b, a)), w, h] }
}

/** Revolved profile [[radius, height], …] around an axis through o along z. */
export const revolve = (o: V3, z: V3, profile: [number, number][], x?: V3): Prim => ({ k: 'revolve', o, z, x, s: [360, 0, 0], pts: profile })

/** Extruded polygon (local XY) of height h. */
export const prism = (o: V3, pts: [number, number][], h: number): Prim => ({ k: 'prism', o, s: [h, 0, 0], pts })

/**
 * Exploded view: every part of the matching items moves away from its item's centre by `factor` × its
 * offset (cabinets open up panel by panel) and the items lift by `lift` mm. Other items stay put.
 */
export function explodeScene(scene: Scene, match: (item: SceneItem) => boolean, factor = 0.6, lift = 600): Scene {
  return {
    ...scene,
    volumes: false,
    items: scene.items.map((it) => {
      if (!match(it) || !it.parts.length) return it
      const c = it.parts.reduce<V3>((a, p) => [a[0] + p.o[0] / it.parts.length, a[1] + p.o[1] / it.parts.length, a[2] + p.o[2] / it.parts.length], [0, 0, 0])
      const move = (p: Prim): Prim => ({ ...p, o: [p.o[0] + (p.o[0] - c[0]) * factor, p.o[1] + (p.o[1] - c[1]) * factor, p.o[2] + (p.o[2] - c[2]) * factor + lift] })
      return { ...it, parts: it.parts.map(move), cuts: it.cuts?.map(move) }
    }),
  }
}
