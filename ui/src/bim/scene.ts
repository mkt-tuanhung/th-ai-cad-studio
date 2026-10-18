/**
 * BIM elements the native building builder does not know (columns, slabs, roofs, ceilings, stairs,
 * railings, components, curtain walls) as OCCT primitives. Walls with their openings, glazing and the
 * level slabs come from the native builder (SceneView::addBuilding); curtain walls are left out of it and
 * built here as glass + mullions. Item ids are the element ids, so a click in 3D selects the element.
 */
import { boxAt, cylBetween, hex, prism, vcyl, type Prim, type Scene, type SceneItem, type V3 } from '../engine3d/scene'
import { levelOf, typeOf, type BimModel, type Opening, type Wall } from './model'
import { wallEnds } from './geometry'
import { roofFrame } from './roof'
import { arcOf, heightsOf, pointAt, wallRun } from './walls'

const elev = (m: BimModel, id: string) => levelOf(m, id)?.elevation ?? 0
const CONCRETE = hex('#c9c6c0'), STEEL = hex('#5b6370'), GLASS = hex('#9cc3d5'), TIMBER = hex('#b98d5f')

/** Storey height a stair climbs, its riser count and riser height (≤ 180 mm). */
export function stairRisers(m: BimModel, base: string, top: string) {
  const H = Math.max(0, elev(m, top) - elev(m, base))
  const n = Math.max(1, Math.ceil(H / 180))
  return { H, n, riser: H / n }
}

/** The flight a stair element is: where it starts (z), the height it climbs, its risers. */
export function stairFlight(m: BimModel, st: BimModel['stairs'][number]) {
  const z = elev(m, st.baseLevel) + (st.baseOffset ?? 0)
  if (st.rise !== undefined && st.rise > 0) {
    const n = st.risers ?? Math.max(1, Math.ceil(st.rise / 180))
    return { z, H: st.rise, n, riser: st.rise / n }
  }
  return { z, ...stairRisers(m, st.baseLevel, st.topLevel) }
}

/** Waist slab of a concrete flight (mm), measured square to its pitch. */
export const STAIR_WAIST = 150

/** The side profile of a flight (local x along the run, y up): the steps on top of a sloping waist slab `waist` thick
 *  measured square to the pitch line through the step roots (the inner corners, where a tread meets the riser above
 *  it); the soffit meets the floor in front of the first riser and is cut square to the floor under the top
 *  (where the flight joins the landing / floor slab). A flight too short for the slab to rise off the floor is solid
 *  down to it. Its area × the width is the flight's concrete. */
export function stairProfile(st: BimModel['stairs'][number], n: number, riser: number, waist = STAIR_WAIST): [number, number][] {
  const going = st.length / n, H = n * riser
  // the soffit: the root line y = (riser / going) x lowered by the waist measured square to it
  const k = riser / going, drop = waist * Math.hypot(1, k)
  const prof: [number, number][] = [[0, 0]]
  for (let i = 0; i < n; i++) prof.push([i * going, (i + 1) * riser], [(i + 1) * going, (i + 1) * riser])
  const xs = drop / k
  if (xs < st.length - 1) {
    prof.push([st.length, H - drop])
    if (xs > 1) prof.push([xs, 0])
  } else prof.push([st.length, 0])
  return prof.filter((q, i, a) => i === 0 || q[0] !== a[i - 1][0] || q[1] !== a[i - 1][1])
}

/** One straight flight of a stair (plan start, direction, run, width), its base height, risers and riser height. */
export interface FlightGeom {
  x: number
  y: number
  angle: number
  length: number
  width: number
  z: number
  n: number
  riser: number
}

/**
 * The flights and landings of a stair element. A straight stair is one flight; an L / U stair from the authoring
 * tool (`run`) is flight 1, a landing (150 mm slab, top at flight 1's top) and flight 2 — the risers split between
 * them and follow the storey height, so a level elevation change re-shapes the stair (V24-010).
 */
export function stairGeometry(m: BimModel, st: BimModel['stairs'][number]): { flights: FlightGeom[]; landings: { pts: [number, number][]; z: number }[] } {
  const { z, n, riser } = stairFlight(m, st)
  if (!st.run) return { flights: [{ x: st.x, y: st.y, angle: st.angle, length: st.length, width: st.width, z, n, riser }], landings: [] }
  const r = st.run, W = st.width
  const n1 = Math.min(n - 1, Math.max(1, r.split ?? Math.floor(n / 2))), n2 = n - n1
  const t = (st.angle * Math.PI) / 180
  const u: [number, number] = [Math.cos(t), Math.sin(t)]
  const side = r.turn === 'left' ? 1 : -1
  const v: [number, number] = [-u[1] * side, u[0] * side] // towards the turn
  const P = (a: number, b: number): [number, number] => [st.x + u[0] * a + v[0] * b, st.y + u[1] * a + v[1] * b]
  const z1 = z + n1 * riser
  const L1 = st.length, D = r.landing
  const f1: FlightGeom = { x: st.x, y: st.y, angle: st.angle, length: L1, width: W, z, n: n1, riser }
  if (r.kind === 'L') {
    // landing D deep past flight 1 (as wide as the flights), flight 2 leaving it towards the turn
    const land = [P(L1, -W / 2), P(L1 + D, -W / 2), P(L1 + D, W / 2), P(L1, W / 2)]
    const s2 = P(L1 + D / 2, W / 2)
    const a2 = (Math.atan2(v[1], v[0]) * 180) / Math.PI
    return { flights: [f1, { x: s2[0], y: s2[1], angle: a2, length: r.length2, width: Math.min(W, D), z: z1, n: n2, riser }], landings: [{ pts: ccw(land), z: z1 }] }
  }
  // U: the landing across both flights; flight 2 back alongside flight 1, `gap` between them
  const g = r.gap ?? 100
  const land = [P(L1, -W / 2), P(L1 + D, -W / 2), P(L1 + D, W / 2 + g + W), P(L1, W / 2 + g + W)]
  const s2 = P(L1, W + g)
  return { flights: [f1, { x: s2[0], y: s2[1], angle: st.angle + 180, length: r.length2, width: W, z: z1, n: n2, riser }], landings: [{ pts: ccw(land), z: z1 }] }
}

function ccw(p: [number, number][]): [number, number][] {
  const a = p.reduce((s, q, i) => s + q[0] * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * q[1], 0)
  return a < 0 ? [...p].reverse() : p
}

/** One flight as its side profile extruded across the width (towards the right of the run). */
function flightPrim(f: FlightGeom): Prim {
  const t = (f.angle * Math.PI) / 180
  const ux = Math.cos(t), uy = Math.sin(t)
  const nx = -uy * (f.width / 2), ny = ux * (f.width / 2)
  return { ...prism([f.x + nx, f.y + ny, f.z], stairProfile({ length: f.length } as BimModel['stairs'][number], f.n, f.riser), f.width), z: [uy, -ux, 0], x: [ux, uy, 0] }
}

/** A tread of a spiral stair: the ring sector between two radii and two angles (rad), as a polygon. */
export function wedge(cx: number, cy: number, r0: number, r1: number, a: number, b: number): [number, number][] {
  const k = Math.max(2, Math.ceil(Math.abs(b - a) / (Math.PI / 24)))
  const arc = (r: number, rev: boolean) => Array.from({ length: k + 1 }, (_, i) => { const t = rev ? b + ((a - b) * i) / k : a + ((b - a) * i) / k; return [cx + Math.cos(t) * r, cy + Math.sin(t) * r] as [number, number] })
  const p = [...arc(r1, false), ...arc(r0, true)]
  // counter-clockwise for the extrusion
  const area = p.reduce((s, q, i) => s + q[0] * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * q[1], 0)
  return area < 0 ? p.reverse() : p
}

/** View-only options of the 3D scene (never part of the model): doors drawn open (90°, to their swing side) or closed. */
export interface SceneView {
  doorsOpen?: boolean
}

/** Arc walls and walls with a sloped top are built here (the native builder makes straight, flat-topped walls). */
export const isSpecialWall = (w: Wall) => !!arcOf(w) || (w.heightEnd !== undefined && w.heightEnd > 0)

const WALL_EXT: V3 = [0.88, 0.87, 0.84], WALL_INT: V3 = [0.93, 0.93, 0.92], PANE: V3 = [0.55, 0.7, 0.78], LEAF = hex('#a9764b')
const degOf = (r: number) => (r * 180) / Math.PI

/**
 * An arc wall (exact: the wall section revolved about the arc centre) or a straight wall with a sloped top (its side
 * profile extruded across the thickness), with its openings cut and a pane in each window.
 */
function specialWall(m: BimModel, w: Wall): SceneItem[] {
  const t = typeOf(m, w)?.thickness ?? 200
  const z0 = elev(m, w.baseLevel) + w.baseOffset
  const { h0, h1 } = heightsOf(m, w)
  if (h0 <= 0 || h1 <= 0) return []
  const rgb = t >= 200 ? WALL_EXT : WALL_INT
  const openings = [...m.doors, ...m.windows].filter((o) => o.hostWall === w.id)
  const out: SceneItem[] = []
  const arc = arcOf(w)
  if (arc) {
    const ri = arc.r - t / 2, ro = arc.r + t / 2
    // counter-clockwise from the start of the sweep
    const start = arc.sweep >= 0 ? arc.a0 : arc.a0 + arc.sweep
    const sweep = Math.abs(arc.sweep)
    const sector = (a: number, da: number, z: number, h: number, r0 = ri, r1 = ro): Prim => ({ k: 'revolve', o: [arc.c[0], arc.c[1], z], z: [0, 0, 1], x: [Math.cos(a), Math.sin(a), 0], s: [degOf(da), 0, 0], pts: [[r0, 0], [r1, 0], [r1, h], [r0, h]] })
    const parts: Prim[] = []
    if (Math.abs(h1 - h0) < 0.5) parts.push(sector(start, sweep, z0, h0))
    else {
      // a sloped top on an arc: 5° sectors, each at its mean height
      const k = Math.max(2, Math.ceil(sweep / ((5 * Math.PI) / 180)))
      for (let i = 0; i < k; i++) {
        const sMid = ((i + 0.5) / k) * arc.len
        const hMid = h0 + ((h1 - h0) * (arc.sweep >= 0 ? sMid : arc.len - sMid)) / arc.len
        parts.push(sector(start + (sweep * i) / k, sweep / k, z0, hMid))
      }
    }
    const ang = (sAlong: number) => arc.a0 + (arc.sweep >= 0 ? 1 : -1) * (sAlong / arc.r)
    const cuts = openings.map((o) => {
      const a = Math.min(ang(o.offset), ang(o.offset + o.width))
      return sector(a, o.width / arc.r, z0 + o.sill, o.height, ri - 20, ro + 20)
    })
    out.push({ id: w.id, rgb, parts, ...(cuts.length ? { cuts } : {}) })
    for (const o of openings.filter((x) => x.category === 'window')) {
      const a = Math.min(ang(o.offset), ang(o.offset + o.width))
      out.push({ id: `glass:${o.id}`, rgb: PANE, transparency: 0.6, mat: 'glass', parts: [sector(a, o.width / arc.r, z0 + o.sill, o.height, arc.r - 10, arc.r + 10)] })
    }
    return out
  }
  const { a, dir } = wallEnds(w)
  const n = [-dir[1], dir[0]]
  // frame: x along the wall, local z = the wall's right normal, so local y is up; the profile from the left face
  const part: Prim = { ...prism([a[0] + (n[0] * t) / 2, a[1] + (n[1] * t) / 2, z0], [[0, 0], [w.length, 0], [w.length, h1], [0, h0]], t), z: [dir[1], -dir[0], 0], x: [dir[0], dir[1], 0] }
  const at = (o: Opening) => pointAt(w, o.offset + o.width / 2).p
  const cuts = openings.map((o) => { const c = at(o); return boxAt(c[0], c[1], z0 + o.sill, o.width, t + 40, o.height, w.angle ?? 0) })
  out.push({ id: w.id, rgb, parts: [part], ...(cuts.length ? { cuts } : {}) })
  for (const o of openings.filter((x) => x.category === 'window')) {
    const c = at(o)
    out.push({ id: `glass:${o.id}`, rgb: PANE, transparency: 0.6, mat: 'glass', parts: [boxAt(c[0], c[1], z0 + o.sill, o.width, 20, o.height, w.angle ?? 0)] })
  }
  return out
}

/** A door leaf (40 mm), hinged on its hinge side at the face it opens to: closed in the opening, or open at 90°. */
export function doorLeaf(m: BimModel, o: Opening, open: boolean): SceneItem | null {
  const w = m.walls.find((x) => x.id === o.hostWall)
  if (!w || typeOf(m, w)?.family === 'Curtain Wall' || o.width <= 60 || o.height <= 30) return null
  const t = typeOf(m, w)?.thickness ?? 200
  const z = elev(m, w.baseLevel) + w.baseOffset + o.sill
  const hingeAt = o.hinge === 'right' ? o.offset + o.width : o.offset
  const { p: hp, t: tan } = pointAt(w, Math.min(wallRun(w), Math.max(0, hingeAt)))
  const toward = o.hinge === 'right' ? -1 : 1 // from the hinge along the wall to the other jamb
  const side = o.swing === 'out' ? -1 : 1 // the face the leaf opens to: left (+) / right (−) of the wall
  const nx = -tan[1] * side, ny = tan[0] * side
  const L = o.width - 20, T = 40, H = o.height - 10
  const H0: [number, number] = [hp[0] + (nx * t) / 2, hp[1] + (ny * t) / 2]
  const ang = degOf(Math.atan2(tan[1], tan[0]))
  const part = open
    ? boxAt(H0[0] + nx * (L / 2) + tan[0] * toward * (T / 2 + 10), H0[1] + ny * (L / 2) + tan[1] * toward * (T / 2 + 10), z, L, T, H, ang + 90)
    : boxAt(H0[0] + tan[0] * toward * (L / 2 + 10) - nx * (T / 2), H0[1] + tan[1] * toward * (L / 2 + 10) - ny * (T / 2), z, L, T, H, ang)
  return { id: `leaf:${o.id}`, rgb: LEAF, parts: [part] }
}

export function bimExtras(m: BimModel, view: SceneView = {}): Scene {
  const items: SceneItem[] = []
  // arc walls and sloped walls with their openings (straight walls come from the native builder)
  for (const w of m.walls) if (isSpecialWall(w) && typeOf(m, w)?.family !== 'Curtain Wall') items.push(...specialWall(m, w))
  // door leaves: open or closed (a view state)
  for (const o of m.doors) {
    const leaf = doorLeaf(m, o, !!view.doorsOpen)
    if (leaf) items.push(leaf)
  }
  for (const c of m.columns) {
    const z = elev(m, c.level), h = elev(m, c.topLevel) - z
    if (h <= 0) continue
    items.push({ id: c.id, rgb: CONCRETE, parts: [c.round ? vcyl(c.x, c.y, z, c.w / 2, h) : boxAt(c.x, c.y, z, c.w, c.d, h)] })
  }
  for (const s of m.slabs) {
    if (s.outline.length < 3) continue
    const z = elev(m, s.level) + s.offset
    // floor: top at the level; roof: sits on the level; ceiling: hangs at the offset
    const z0 = s.kind === 'floor' ? z - s.thickness : z
    // holes (a stair well) cut a little past both faces
    const cuts = (s.openings ?? []).filter((o) => o.length >= 3).map((o) => prism([0, 0, z0 - 10], o, s.thickness + 20))
    items.push({ id: s.id, rgb: s.kind === 'ceiling' ? hex('#f2f1ee') : s.kind === 'roof' ? hex('#8d8a85') : CONCRETE, parts: [prism([0, 0, z0], s.outline, s.thickness)], ...(cuts.length ? { cuts } : {}) })
  }
  for (const st of m.stairs) {
    const { n, riser, z } = stairFlight(m, st)
    if (st.spiral) {
      // treads 60 mm thick fanning round a newel post
      const s = st.spiral, a0 = (s.a0 * Math.PI) / 180, da = (s.sweep * Math.PI) / 180 / n
      const parts: Prim[] = [vcyl(st.x, st.y, z, Math.max(60, s.r0), n * riser)]
      for (let i = 0; i < n; i++) parts.push(prism([0, 0, z + (i + 1) * riser - 60], wedge(st.x, st.y, s.r0, s.r1, a0 + i * da, a0 + (i + 1) * da), 60))
      items.push({ id: st.id, rgb: CONCRETE, parts })
      continue
    }
    // each flight = its side profile extruded across the width; an L / U stair adds its landing (150 mm)
    const g = stairGeometry(m, st)
    const parts: Prim[] = [...g.flights.map(flightPrim), ...g.landings.map((l) => prism([0, 0, l.z - 150], l.pts, 150))]
    items.push({ id: st.id, rgb: CONCRETE, parts })
  }
  for (const r of m.railings) {
    if (r.pts.length < 2) continue
    const z = elev(m, r.level)
    const parts: Prim[] = []
    for (let i = 0; i + 1 < r.pts.length; i++) {
      const [a, b] = [r.pts[i], r.pts[i + 1]]
      // base heights at both ends: a stair rail runs parallel to the nosings
      const za = z + (r.z?.[i] ?? 0), zb = z + (r.z?.[i + 1] ?? 0)
      const L = Math.hypot(b[0] - a[0], b[1] - a[1])
      if (L < 1) continue
      const k = Math.max(1, Math.ceil(L / 1200))
      for (let j = i === 0 ? 0 : 1; j <= k; j++) parts.push(vcyl(a[0] + ((b[0] - a[0]) * j) / k, a[1] + ((b[1] - a[1]) * j) / k, za + ((zb - za) * j) / k, 20, r.height))
      parts.push(cylBetween([a[0], a[1], za + r.height], [b[0], b[1], zb + r.height], 25))
      parts.push(cylBetween([a[0], a[1], za + r.height * 0.45], [b[0], b[1], zb + r.height * 0.45], 12))
    }
    items.push({ id: r.id, rgb: STEEL, mat: 'metal', parts })
  }
  for (const c of m.components) items.push({ id: c.id, rgb: TIMBER, parts: [boxAt(c.x, c.y, elev(m, c.level), c.w, c.d, c.h, c.rot)] })
  // structure from the structural drawings: beams (under the slab, its depth included), tie beams, pile caps and
  // the head of their piles (drawn 1 m: the pile length is not on the plans)
  for (const b of m.beams ?? []) {
    const t = (b.angle * Math.PI) / 180, top = elev(m, b.level) + b.topOffset
    items.push({ id: b.id, rgb: CONCRETE, parts: [boxAt(b.x + Math.cos(t) * b.length / 2, b.y + Math.sin(t) * b.length / 2, top - b.h, b.length, b.b, b.h, b.angle)] })
  }
  // pitched roofs: the gable mass (a triangle across the width along the length); a hip roof has both ends cut
  // by the slope rising from the end eaves
  for (const r of m.roofs ?? []) {
    const f = roofFrame(r), z = elev(m, r.level)
    const u: V3 = [f.u[0], f.u[1], 0], v: V3 = [f.v[0], f.v[1], 0]
    const part: Prim = { ...prism([f.o[0], f.o[1], z], [[0, 0], [f.W, 0], [f.W / 2, f.h]], f.L), x: v, z: u }
    const cuts: Prim[] = []
    if (r.kind === 'hip') {
      const m2 = 50, end = (along: number, dir: 1 | -1): Prim => {
        // in the plane (along u, up), extruded across the width (−v): the region over the slope from the end eave
        const run = f.W / 2 + m2, top = f.h + m2 * f.tan + 10
        const pts: [number, number][] = dir > 0 ? [[-m2, -1], [0, -1], [run, run * f.tan - 1], [run, top], [-m2, top]] : [[m2, -1], [0, -1], [-run, run * f.tan - 1], [-run, top], [m2, top]]
        const o: V3 = [f.o[0] + f.u[0] * along + f.v[0] * (f.W + m2), f.o[1] + f.u[1] * along + f.v[1] * (f.W + m2), z]
        return { ...prism(o, dir > 0 ? pts : [...pts].reverse(), f.W + 2 * m2), x: u, z: [-v[0], -v[1], 0] }
      }
      cuts.push(end(0, 1), end(f.L, -1))
    }
    items.push({ id: r.id, rgb: hex('#a0522d'), parts: [part], ...(cuts.length ? { cuts } : {}) })
  }
  for (const f of m.footings ?? []) {
    const z = elev(m, f.level)
    items.push({ id: f.id, rgb: CONCRETE, parts: [boxAt(f.x, f.y, z + f.bottom, f.w, f.d, f.top - f.bottom)] })
  }
  // curtain walls: a glass plane and mullions every 1.5 m, transoms at the head of each storey
  for (const w of m.walls) {
    if (typeOf(m, w)?.family !== 'Curtain Wall') continue
    const z0 = elev(m, w.baseLevel) + w.baseOffset, z1 = elev(m, w.topLevel) + w.topOffset
    if (z1 <= z0) continue
    const { a, dir } = wallEnds(w)
    const mid = (s: number): [number, number] => [a[0] + dir[0] * s, a[1] + dir[1] * s]
    const [cx, cy] = mid(w.length / 2)
    items.push({ id: w.id, rgb: GLASS, transparency: 0.6, mat: 'glass', parts: [boxAt(cx, cy, z0, w.length, 24, z1 - z0, w.angle ?? 0)] })
    const frame: Prim[] = []
    const k = Math.max(1, Math.round(w.length / 1500))
    for (let i = 0; i <= k; i++) {
      const [x, y] = mid(Math.min(w.length - 30, Math.max(30, (w.length * i) / k)))
      frame.push(boxAt(x, y, z0, 60, 120, z1 - z0, w.angle ?? 0))
    }
    for (const z of [z0, z1 - 60]) frame.push(boxAt(cx, cy, z, w.length, 120, 60, w.angle ?? 0))
    items.push({ id: `${w.id}:frame`, rgb: STEEL, mat: 'metal', parts: frame })
  }
  return { items }
}

/** The model the native builder gets: curtain walls, arc walls and sloped walls (built above) and their openings left out. */
export function nativeBuildingModel(m: BimModel): BimModel {
  const cw = new Set(m.walls.filter((w) => typeOf(m, w)?.family === 'Curtain Wall' || isSpecialWall(w)).map((w) => w.id))
  if (!cw.size) return m
  return { ...m, walls: m.walls.filter((w) => !cw.has(w.id)), doors: m.doors.filter((o) => !cw.has(o.hostWall)), windows: m.windows.filter((o) => !cw.has(o.hostWall)) }
}

/** Load-bearing walls: a concrete structure layer (partitions are masonry, curtain walls glazing). */
export const isStructuralWall = (m: BimModel, w: BimModel['walls'][number]) => /concrete/i.test(typeOf(m, w)?.structure ?? '') && typeOf(m, w)?.family !== 'Curtain Wall'

/** 3D items the Structure discipline hides (architectural only). */
export function nonStructuralIds(m: BimModel): string[] {
  const ids: string[] = []
  for (const w of m.walls) if (!isStructuralWall(m, w)) ids.push(w.id, `${w.id}:frame`)
  for (const o of [...m.doors, ...m.windows]) ids.push(`glass:${o.id}`, `leaf:${o.id}`)
  for (const s of m.slabs) if (s.kind === 'ceiling') ids.push(s.id)
  for (const x of [...m.railings, ...m.components]) ids.push(x.id)
  return ids
}
