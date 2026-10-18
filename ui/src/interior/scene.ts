/**
 * Interior 3D scene for the native OCCT engine. Rooms come from their outlines (floor slab + walls cut at
 * a section height so the plan reads like a dollhouse), furniture is parametric from each item's
 * W × D × H (or Ø × H), and cabinets are built panel by panel from the production cut list, so the 3D
 * board volume equals the cut list exactly. Plan coordinates: mm, Z up, floor at z = 0.
 */
import { boxAt, cylBetween, hex, prism, vcyl, type Prim, type Scene, type SceneItem } from '../engine3d/scene'
import { MATERIALS, cutList, type Cabinet, type Item, type Room } from './model'
import type { InteriorDoc } from '../state/interior'
import { PARTS, partMaterial, sceneMaterial, type SceneMaterial } from './materials'

/** A primitive tagged with the named part of the item it belongs to (per-part finishes). */
export interface PartPrim {
  part: string
  prim: Prim
}

/**
 * Scene item of the interior: the engine fields plus appearance metadata for the render paths (GLB /
 * Blender): `material` {id, colour, roughness, metallic, tileMm, grainDeg}. Parts whose finish differs from
 * the item's first part are separate scene items `<item id>::<part>` so the live 3D and the path tracer show
 * them; the geometry is identical either way (a finish never changes geometry).
 */
export type InteriorSceneItem = SceneItem & { material?: SceneMaterial; finishPart?: string; item?: string }

/** Walls are cut at this height (plan-section convention) so the rooms stay visible from above. */
export const WALL_CUT = 1100
const WALL_T = 50 // each room draws its half of a 100 mm partition, inside its own outline

/** Default furniture placement (plan centre + rotation; front faces −Y before rotation). */
export interface Place {
  x: number
  y: number
  rot: number
}
const LAYOUT: Record<string, { room: string; at: Place[] }> = {
  i1: { room: 'living', at: [{ x: 3600, y: 2780, rot: 0 }] },
  i2: { room: 'living', at: [{ x: 3600, y: 1500, rot: 0 }] },
  i3: { room: 'living', at: [{ x: 3600, y: 280, rot: 180 }] },
  i4: { room: 'dining', at: [{ x: 10000, y: 2050, rot: 0 }] },
  i5: { room: 'dining', at: [-800, 0, 800].flatMap((dx) => [{ x: 10000 + dx, y: 2050 - 640, rot: 180 }, { x: 10000 + dx, y: 2050 + 640, rot: 0 }]) },
  i6: { room: 'dining', at: [-800, 0, 800].map((dx) => ({ x: 10000 + dx, y: 2050, rot: 0 })) },
  i7: { room: 'living', at: [{ x: 1150, y: 1500, rot: 90 }] },
  i8: { room: 'living', at: [{ x: 3600, y: 1750, rot: 0 }] },
  i9: { room: 'dining', at: [{ x: 12520, y: 2050, rot: -90 }] },
  i10: { room: 'living', at: [{ x: 3600, y: 1500, rot: 0 }] },
  i11: { room: 'master', at: [{ x: 359, y: 4950, rot: 90 }] },
  i12: { room: 'master', at: [{ x: 2250, y: 6680, rot: 0 }] },
}

const color = (material: string) => hex(MATERIALS.find((m) => m.name === material)?.color ?? '#c8c8c8')
/** Path-tracer surface per finish: varnished wood / stone / tile get a clear coat, metal is metallic. */
function matOf(material: string): SceneItem['mat'] {
  const kind = MATERIALS.find((m) => m.name === material)?.kind
  return kind === 'metal' ? 'metal' : kind === 'wood' || kind === 'board' || kind === 'stone' || kind === 'tile' ? 'glossy' : 'matte'
}

/** Primitives in a furniture-local frame (origin = footprint centre, −Y = front), placed in plan. */
function local(p: Place) {
  const a = (p.rot * Math.PI) / 180
  const c = Math.cos(a), s = Math.sin(a)
  const pt = (lx: number, ly: number): [number, number] => [p.x + lx * c - ly * s, p.y + lx * s + ly * c]
  return {
    /** Box from its local min corner. */
    box: (x: number, y: number, z: number, w: number, d: number, h: number): Prim => {
      const [cx, cy] = pt(x + w / 2, y + d / 2)
      return boxAt(cx, cy, z, w, d, h, p.rot)
    },
    cyl: (x: number, y: number, z: number, r: number, h: number): Prim => {
      const [cx, cy] = pt(x, y)
      return vcyl(cx, cy, z, r, h)
    },
    pt,
  }
}

function bbox(r: Room) {
  const xs = r.outline.map((p) => p.x), ys = r.outline.map((p) => p.y)
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }
}

/** Cabinet panels exactly as in the cut list (sides full height, top/bottom between, grooved back, dividers, set-back shelves, overlay doors). */
export function cabinetParts(c: Cabinet, at: Place): Prim[] {
  return cabinetPartsTagged(c, at).map((p) => p.prim)
}

/** cabinetParts with each panel tagged body (carcass, back, dividers, shelves) or front (doors). */
export function cabinetPartsTagged(c: Cabinet, at: Place): PartPrim[] {
  const L = local(at)
  const parts = cutList(c)
  const get = (name: string) => parts.find((p) => p.part === name)
  const { w, d, h, t } = c
  const out: Prim[] = []
  const front: Prim[] = []
  // carcass occupies y ∈ [−d/2, d/2]; doors sit in front of it
  const y0 = -d / 2
  out.push(L.box(-w / 2, y0, 0, t, d, h), L.box(w / 2 - t, y0, 0, t, d, h))
  const tb = get('Top / bottom')!
  out.push(L.box(-tb.l / 2, y0, 0, tb.l, tb.wd, t), L.box(-tb.l / 2, y0, h - t, tb.l, tb.wd, t))
  const back = get('Back panel')!
  out.push(L.box(-back.l / 2, d / 2 - 14, t - 8, back.l, back.t, back.wd))
  const div = get('Divider')
  const bays = (div?.qty ?? 0) + 1
  const bayW = (w - 2 * t - (div?.qty ?? 0) * t) / bays
  for (let k = 1; div && k <= div.qty; k++) out.push(L.box(-w / 2 + t + k * bayW + (k - 1) * t, y0, t, t, div.wd, div.l))
  const sh = get('Shelf')
  if (sh) {
    const per = sh.qty / bays
    for (let b = 0; b < bays; b++)
      for (let k = 1; k <= per; k++) out.push(L.box(-w / 2 + t + b * (bayW + t) + 1, y0 + 20, t + (k * (h - 2 * t)) / (per + 1) - t / 2, sh.l, sh.wd, sh.t))
  }
  const door = get('Door')
  for (let k = 0; door && k < door.qty; k++) front.push(L.box(-w / 2 + k * (w / door.qty) + 1.5, y0 - door.t, 1.5, door.wd, door.t, door.l))
  return [...out.map((prim) => ({ part: 'body', prim })), ...front.map((prim) => ({ part: 'front', prim }))]
}

/** Board volume of a cabinet from its cut list (m³) — the 3D panels must match this. */
export const cutListVolume = (c: Cabinet) => cutList(c).reduce((a, p) => a + (p.l * p.wd * p.t * p.qty) / 1e9, 0)

/** Parametric furniture from W × D × H (origin: footprint centre at the bottom, front −Y), each primitive tagged with its part. */
export function furnitureParts(i: Item, at: Place, ceiling: number): PartPrim[] {
  const L = local(at)
  const w = i.w ?? i.dia ?? 500, d = i.d ?? i.dia ?? 500, h = i.h
  const tag = (part: string, ps: Prim[]) => ps.map((prim) => ({ part, prim }))
  switch (i.category) {
    case 'sofas': {
      if (d <= 1100) {
        // straight sofa: seat, back and two arms
        const arm = Math.min(180, w / 6)
        return [
          ...tag('body', [L.box(-w / 2, -d / 2, 0, w, d, 420)]),
          ...tag('back', [L.box(-w / 2, d / 2 - 200, 420, w, 200, h - 420), L.box(-w / 2, -d / 2, 420, arm, d - 200, 200), L.box(w / 2 - arm, -d / 2, 420, arm, d - 200, 200)]),
        ]
      }
      // L-shape: main seat along the back, chaise on the right, arms at both ends
      const seat = Math.min(950, d)
      return [
        ...tag('body', [L.box(-w / 2, d / 2 - seat, 0, w, seat, 420), L.box(w / 2 - seat, -d / 2, 0, seat, d - seat, 420)]),
        ...tag('back', [L.box(-w / 2, d / 2 - 200, 420, w, 200, h - 420), L.box(-w / 2, d / 2 - seat, 420, 180, seat - 200, 200), L.box(w / 2 - 180, -d / 2, 420, 180, d - 200, 200)]),
      ]
    }
    case 'tables':
      if (i.dia) return [...tag('top', [L.cyl(0, 0, h - 30, i.dia / 2, 30)]), ...tag('legs', [L.cyl(0, 0, 20, i.dia * 0.1, h - 50), L.cyl(0, 0, 0, i.dia * 0.3, 20)])]
      return [...tag('top', [L.box(-w / 2, -d / 2, h - 40, w, d, 40)]), ...tag('legs', [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sy]) => L.box(sx * (w / 2 - 90) - 30, sy * (d / 2 - 90) - 30, 0, 60, 60, h - 40)))]
    case 'chairs':
      if (w > 700)
        return [...tag('seat', [L.box(-w / 2, -d / 2, 0, w, d, 420)]), ...tag('back', [L.box(-w / 2, d / 2 - 180, 420, w, 180, h - 420), L.box(-w / 2, -d / 2, 420, 150, d - 180, 200), L.box(w / 2 - 150, -d / 2, 420, 150, d - 180, 200)])]
      return [
        ...tag('legs', [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sy]) => L.box(sx * (w / 2 - 30) - 17, sy * (d / 2 - 30) - 17, 0, 34, 34, 430))),
        ...tag('seat', [L.box(-w / 2, -d / 2, 430, w, d, 50)]),
        ...tag('back', [L.box(-w / 2, d / 2 - 40, 480, w, 40, h - 480)]),
      ]
    case 'beds': {
      // base, headboard to H; the mattress (and pillows when they fit) stay below H so the bounds are W × D × H
      const base = Math.min(300, h * 0.5), mat = Math.min(230, h - base - 10)
      return [
        ...tag('frame', [L.box(-w / 2, -d / 2, 0, w, d, base), L.box(-w / 2, d / 2 - 80, 0, w, 80, h)]),
        ...tag('mattress', [
          L.box(-w / 2 + 30, -d / 2 + 30, base, w - 60, d - 130, mat),
          ...(base + mat + 120 <= h ? [L.box(-w / 2 + 120, d / 2 - 600, base + mat, w / 2 - 180, 420, 120), L.box(60, d / 2 - 600, base + mat, w / 2 - 180, 420, 120)] : []),
        ]),
      ]
    }
    case 'rugs':
      return tag('body', [L.box(-w / 2, -d / 2, 0, w, d, Math.max(4, h))])
    case 'lighting': {
      // hung 900 mm below the ceiling on a cord
      const z = ceiling - 900
      const [cx, cy] = L.pt(0, 0)
      if (i.dia) return tag('shade', [{ k: 'cone', o: [cx, cy, z], s: [i.dia / 2, i.dia * 0.08, h] }, cylBetween([cx, cy, z + h], [cx, cy, ceiling], 4)])
      const [ax, ay] = L.pt(-w / 2 + 60, 0), [bx, by] = L.pt(w / 2 - 60, 0)
      return tag('shade', [L.box(-w / 2, -d / 2, z, w, d, h), cylBetween([ax, ay, z + h], [ax, ay, ceiling], 3), cylBetween([bx, by, z + h], [bx, by, ceiling], 3)])
    }
    default:
      return tag(PARTS[i.category]?.[0] ?? 'body', [L.box(-w / 2, -d / 2, 0, w, d, h)])
  }
}

/** Raise primitives by `dz` (the item's elevation). */
const lift = (ps: PartPrim[], dz: number): PartPrim[] => (dz ? ps.map(({ part, prim }) => ({ part, prim: { ...prim, o: [prim.o[0], prim.o[1], prim.o[2] + dz] as Prim['o'] } })) : ps)

/** Tagged primitives of every instance of an item (cabinet panels or parametric furniture) at its elevation. */
export function itemPartPrims(doc: InteriorDoc, i: Item, room: Room, at: Place[]): PartPrim[] {
  const cab = i.cabinet ? doc.cabinets.find((c) => c.id === i.cabinet) : undefined
  // a composed library piece ("Tự vẽ" / parametric preset) chosen for the item: its parts in the live 3D too
  const composed = !cab && i.asset ? composedPrimsOf(i.asset, i, at) : null
  if (composed) return composed
  return at.flatMap((p) => lift(cab ? cabinetPartsTagged(cab, p) : furnitureParts(i, p, room.ceilingHeight), i.category === 'lighting' ? 0 : i.elev ?? 0))
}

/**
 * Live-3D primitives of composed library pieces (set by the asset library once its manifest is loaded; mesh models
 * from files keep the parametric box shape in the live view — they are drawn in renders only). Returns null when the
 * asset is not a composed piece.
 */
let composedResolver: ((assetId: string, i: Item, at: Place[]) => PartPrim[] | null) | null = null
export const setComposedResolver = (fn: typeof composedResolver) => void (composedResolver = fn)
const composedPrimsOf = (assetId: string, i: Item, at: Place[]) => composedResolver?.(assetId, i, at) ?? null

/** Where each item instance stands in plan: its own placement (moved in Space Planning, or built from a CAD plan),
 *  else the sample layout, else a 1.2 m grid around its room centre. */
export function itemPlacements(doc: InteriorDoc): { item: Item; room: Room; at: Place[] }[] {
  const auto: Record<string, number> = {}
  const out: { item: Item; room: Room; at: Place[] }[] = []
  for (const i of doc.items) {
    const room = doc.rooms.find((r) => r.id === i.room)
    if (!room) continue
    const lay = LAYOUT[i.id]
    const at: Place[] = []
    for (let k = 0; k < i.qty; k++) {
      if (i.at?.[k]) at.push(i.at[k])
      else if (lay && lay.room === i.room && lay.at[k]) at.push(lay.at[k])
      else {
        // items without a layout yet: a 1.2 m grid around the room centre (shown where they will be placed)
        const b = bbox(room)
        const n = (auto[room.id] = (auto[room.id] ?? 0) + 1) - 1
        at.push({ x: (b.x0 + b.x1) / 2 + ((n % 3) - 1) * 1200, y: (b.y0 + b.y1) / 2 + (Math.floor(n / 3) - 0.5) * 1200, rot: 0 })
      }
    }
    out.push({ item: i, room, at })
  }
  return out
}

/** fullWalls: walls to ceiling height (renders) instead of the plan-section cut; furniture: include items. */
export function interiorScene(doc: InteriorDoc, opts: { fullWalls?: boolean; furniture?: boolean } = {}): Scene {
  const items: InteriorSceneItem[] = []
  for (const r of doc.rooms) {
    items.push({ id: `room:${r.id}`, rgb: color(r.floorFinish), mat: matOf(r.floorFinish), material: sceneMaterial(r.floorFinish), parts: [prism([0, 0, -40], r.outline.map((p) => [p.x, p.y]), 40)] })
    const walls: Prim[] = []
    const n = r.outline.length
    for (let k = 0; k < n; k++) {
      const p = r.outline[k], q = r.outline[(k + 1) % n]
      const len = Math.hypot(q.x - p.x, q.y - p.y)
      // inward normal of a counter-clockwise outline = left of the edge
      const nx = -(q.y - p.y) / len, ny = (q.x - p.x) / len
      const rot = (Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI
      walls.push(boxAt((p.x + q.x) / 2 + (nx * WALL_T) / 2, (p.y + q.y) / 2 + (ny * WALL_T) / 2, 0, len, WALL_T, opts.fullWalls ? r.ceilingHeight : Math.min(WALL_CUT, r.ceilingHeight), rot))
    }
    items.push({ id: `walls:${r.id}`, rgb: color(r.wallFinish), material: sceneMaterial(r.wallFinish), parts: walls })
  }

  for (const { item: i, room, at } of opts.furniture === false ? [] : itemPlacements(doc)) {
    const cab = i.cabinet ? doc.cabinets.find((c) => c.id === i.cabinet) : undefined
    const tagged = itemPartPrims(doc, i, room, at)
    const finish = (part: string) => partMaterial(i, part, cab)
    // one scene item per distinct finish; the first one keeps the item id (selection, volumes, renders).
    // Cabinets lead with the front (their colour before per-part finishes existed).
    const order = cab ? ['front', 'body'] : PARTS[i.category] ?? ['body']
    const groups: { part: string; key: string; prims: Prim[] }[] = []
    for (const part of order) {
      const prims = tagged.filter((t) => t.part === part).map((t) => t.prim)
      if (!prims.length) continue
      const f = finish(part)
      const key = `${f.material}|${f.grainDeg ?? ''}`
      const g = groups.find((x) => x.key === key)
      if (g) g.prims.push(...prims)
      else groups.push({ part, key, prims })
    }
    groups.forEach((g, n) => {
      const f = finish(g.part)
      items.push({
        id: n === 0 ? i.id : `${i.id}::${g.part}`,
        ...(n === 0 ? {} : { item: i.id, finishPart: g.part }),
        rgb: color(f.material),
        mat: matOf(f.material),
        material: sceneMaterial(f.material, f.grainDeg),
        transparency: i.status === 'planned' ? 0.35 : 0,
        parts: g.prims,
      })
    })
  }
  return { items, volumes: true }
}

/** Scene item id → interior item id (`<id>::<part>` items belong to their item). */
export const sceneItemOwner = (id: string) => id.split('::')[0]

/** Scene id for the current selection (room → its floor, cabinet → the item that uses it). */
export function interiorSceneId(doc: InteriorDoc, sel: { kind: 'item' | 'room' | 'cabinet'; id: string } | null): string {
  if (!sel) return ''
  if (sel.kind === 'room') return `room:${sel.id}`
  if (sel.kind === 'cabinet') return doc.items.find((i) => i.cabinet === sel.id)?.id ?? ''
  return sel.id
}
