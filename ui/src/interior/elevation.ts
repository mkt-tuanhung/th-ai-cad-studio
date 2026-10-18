/**
 * Cabinet wall elevation (SP33): the install view of one wall of a room — the wall seen from inside the room,
 * every cabinet backed on it drawn at its real width, height and elevation, door divisions, and dimension
 * chains (cabinet widths and gaps along the floor, overall length, height marks floor → cabinet bottoms / tops →
 * ceiling). The result is a CAD document (layers I-ELEV, I-ELEV-CASE, A-ANNO-DIMS, A-ANNO-TEXT) with one A3
 * layout at the largest standard scale that fits, so it opens in CAD 2D and plots / exports to PDF, DXF, DWG
 * through the existing paths. Deterministic: the same model gives the same drawing.
 */
import type { InteriorDoc } from '../state/interior'
import type { CadDocument, Entity, Layer } from '../cad/types'
import { createBlankDocument } from '../cad/seed'
import { itemPlacements } from './scene'
import { faceAlong, faceDist, norm180, toPlan, wallFaces } from './geom'
import { footD, footW } from './layout'

export interface ElevationCabinet {
  item: string
  name: string
  /** Along the wall as seen from the room (0 = left end), mm. */
  u0: number
  u1: number
  z0: number
  z1: number
  doors: number
}

const LAYERS: Layer[] = [
  { name: 'I-ELEV', color: '#111827', visible: true, locked: false, linetype: 'Continuous', lineweight: 0.35 },
  { name: 'I-ELEV-CASE', color: '#1f2937', visible: true, locked: false, linetype: 'Continuous', lineweight: 0.25 },
  { name: 'A-ANNO-DIMS', color: '#111827', visible: true, locked: false, linetype: 'Continuous', lineweight: 0.18 },
  { name: 'A-ANNO-TEXT', color: '#111827', visible: true, locked: false, linetype: 'Continuous', lineweight: 0.25 },
]

/** Cabinets (and other storage) whose back stands on the wall, with their extents in the elevation. */
export function wallCabinets(doc: InteriorDoc, roomId: string, wall: number): { len: number; height: number; cabinets: ElevationCabinet[] } | null {
  const r = doc.rooms.find((x) => x.id === roomId)
  const f = r && wallFaces(r).find((x) => x.index === wall)
  if (!r || !f) return null
  const out: ElevationCabinet[] = []
  for (const pl of itemPlacements(doc)) {
    if (pl.room.id !== roomId || pl.item.category !== 'cabinet') continue
    const cab = pl.item.cabinet ? doc.cabinets.find((c) => c.id === pl.item.cabinet) : undefined
    pl.at.forEach((at) => {
      if (Math.abs(norm180(at.rot - f.rot)) > 0.5) return
      const back = toPlan(at.x, at.y, at.rot, 0, footD(pl.item) / 2)
      if (Math.abs(faceDist(f, back[0], back[1])) > 30) return
      const c = faceAlong(f, at.x, at.y), w = footW(pl.item)
      const z0 = pl.item.elev ?? 0
      // seen from inside the room the wall runs from its end b (left) to its start a (right)
      out.push({ item: pl.item.id, name: pl.item.name, u0: Math.round(f.len - (c + w / 2)), u1: Math.round(f.len - (c - w / 2)), z0, z1: z0 + pl.item.h, doors: cab?.doors ?? 0 })
    })
  }
  out.sort((a, b) => a.u0 - b.u0 || a.z0 - b.z0)
  return { len: Math.round(f.len), height: r.ceilingHeight, cabinets: out }
}

const SCALES = [10, 20, 25, 50, 100]

export function wallElevation(doc: InteriorDoc, roomId: string, wall: number, title?: string): { doc: CadDocument; cabinets: ElevationCabinet[]; scale: number; len: number; height: number } {
  const w = wallCabinets(doc, roomId, wall) ?? { len: 0, height: 0, cabinets: [] }
  const { len: L, height: H, cabinets } = w
  // A3 landscape drawable ~380 × 250 mm with room for the dimension chains
  const scale = SCALES.find((s) => (L + 3000) / s <= 380 && (H + 2500) / s <= 250) ?? 100
  const T = 2.5 * scale
  let n = 0
  const id = () => `el-${++n}`
  const base = { color: 'ByLayer', linetype: 'ByLayer', lineweight: 'ByLayer', transparency: 0 } as const
  const ents: Entity[] = []
  const line = (layer: string, a: [number, number], b: [number, number]) => ents.push({ ...base, id: id(), layer, kind: 'line', a: { x: a[0], y: a[1] }, b: { x: b[0], y: b[1] } })
  const rect = (layer: string, x0: number, y0: number, x1: number, y1: number) => ents.push({ ...base, id: id(), layer, kind: 'polyline', pts: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }], closed: true })
  const text = (x: number, y: number, h: number, value: string, align: 'left' | 'center' = 'left') => ents.push({ ...base, id: id(), layer: 'A-ANNO-TEXT', kind: 'text', p: { x, y }, height: h, value, rotation: 0, align })
  const dim = (a: [number, number], b: [number, number], offset: number) => ents.push({ ...base, id: id(), layer: 'A-ANNO-DIMS', kind: 'dimension', a: { x: a[0], y: a[1] }, b: { x: b[0], y: b[1] }, offset, override: null, textHeight: T })

  // wall: floor, ceiling and the two corners
  line('I-ELEV', [0, 0], [L, 0])
  line('I-ELEV', [0, H], [L, H])
  line('I-ELEV', [0, 0], [0, H])
  line('I-ELEV', [L, 0], [L, H])
  for (const c of cabinets) {
    rect('I-ELEV-CASE', c.u0, c.z0, c.u1, c.z1)
    // door leaves: 3 mm gaps as in the cut list
    for (let k = 1; k < c.doors; k++) {
      const x = c.u0 + ((c.u1 - c.u0) * k) / c.doors
      line('I-ELEV-CASE', [x, c.z0 + 3], [x, c.z1 - 3])
    }
    const label = `${c.name} ${c.u1 - c.u0}×${c.z1 - c.z0}`
    text((c.u0 + c.u1) / 2, (c.z0 + c.z1) / 2 - T * 0.4, Math.min(T, (0.9 * (c.u1 - c.u0)) / (0.6 * label.length)), label, 'center')
  }
  // floor chain: every cabinet edge (cabinets on the floor and wall-hung ones), then the overall length
  const marks = [...new Set([0, L, ...cabinets.flatMap((c) => [c.u0, c.u1])].map((v) => Math.max(0, Math.min(L, v))))].sort((a, b) => a - b)
  for (let i = 0; i + 1 < marks.length; i++) if (marks[i + 1] - marks[i] >= 1) dim([marks[i], 0], [marks[i + 1], 0], -T * 4)
  dim([0, 0], [L, 0], -T * 8)
  // height chain on the right: floor → bottoms / tops → ceiling
  const zs = [...new Set([0, H, ...cabinets.flatMap((c) => [c.z0, c.z1])].filter((z) => z >= 0 && z <= H))].sort((a, b) => a - b)
  for (let i = 0; i + 1 < zs.length; i++) if (zs[i + 1] - zs[i] >= 1) dim([L, zs[i]], [L, zs[i + 1]], -T * 4)
  dim([L, 0], [L, H], -T * 8)
  const r = doc.rooms.find((x) => x.id === roomId)
  const name = title ?? `${r?.name ?? roomId} — wall ${wall + 1}`
  text(0, -T * 13, T * 1.6, `ELEVATION — ${name.toUpperCase()}`)
  text(0, -T * 15.2, T, `1:${scale} · mm · ${cabinets.length} cabinet(s)`)

  const out = createBlankDocument(`Villa Riverside - Elevation ${name}.dwg`)
  out.layers = [...out.layers.filter((l) => !LAYERS.some((x) => x.name === l.name)), ...LAYERS]
  out.currentLayer = 'I-ELEV'
  out.entities = ents
  out.layouts = [{ id: 'sheet', name: `Elevation ${wall + 1}`, paper: 'A3', scale }]
  out.source = 'bim-drawing'
  return { doc: out, cabinets, scale, len: L, height: H }
}
