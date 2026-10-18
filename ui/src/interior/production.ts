/**
 * Production gate of the interior model (V24-024) and the room item schedule (SP36 / V24-037).
 *
 * Only real dimensions enter manufacturing: a cabinet whose size came from an AI concept, an image trace or
 * anything flagged "review required" is not manufacturable until its dimensions are measured / confirmed —
 * a render or AI picture is presentation only and never feeds the cut list, nesting or NC.
 *
 * API for the CNC side: `manufacturable(item, doc)`, `manufacturableCabinet(cabinet, doc)` and
 * `productionGate(doc)` → { ok: cabinets that may be cut, blocked: [{ cabinet, reason }] }.
 */
import type { InteriorDoc } from '../state/interior'
import type { Cabinet, DimSource, Item } from './model'
import { itemPlacements } from './scene'
import { itemBounds } from './layout'
import { partMaterial, PARTS } from './materials'

export type BlockReason = 'not-parametric' | 'unverified-dimensions' | 'ai-concept' | 'image-trace' | 'no-cabinet'

/** Real, confirmed dimensions? (undefined source = drawn / parametric in this app). */
export function realDims(src: DimSource | undefined): { ok: true } | { ok: false; reason: BlockReason } {
  if (!src) return { ok: true }
  if (src.reviewRequired) return { ok: false, reason: src.kind === 'ai' ? 'ai-concept' : src.kind === 'image' ? 'image-trace' : 'unverified-dimensions' }
  if (src.kind === 'ai') return { ok: false, reason: 'ai-concept' }
  if (src.kind === 'image') return { ok: false, reason: 'image-trace' }
  return { ok: true }
}

export function manufacturableCabinet(c: Cabinet, doc?: InteriorDoc): { ok: boolean; reason?: BlockReason } {
  const own = realDims(c.src)
  if (!own.ok) return { ok: false, reason: own.reason }
  // the furniture item that shows the cabinet must have real dimensions too
  for (const i of doc?.items.filter((x) => x.cabinet === c.id) ?? []) {
    const r = realDims(i.src)
    if (!r.ok) return { ok: false, reason: r.reason }
  }
  return { ok: true }
}

/** Can this item enter manufacturing (cut list → nesting → CAM)? */
export function manufacturable(i: Item, doc: InteriorDoc): { ok: boolean; reason?: BlockReason } {
  const r = realDims(i.src)
  if (!r.ok) return { ok: false, reason: r.reason }
  if (!i.cabinet) return { ok: false, reason: 'not-parametric' }
  const c = doc.cabinets.find((x) => x.id === i.cabinet)
  if (!c) return { ok: false, reason: 'no-cabinet' }
  return manufacturableCabinet(c, doc)
}

/** Cabinets that may enter manufacturing and the ones that are blocked (with why). */
export function productionGate(doc: InteriorDoc) {
  const ok: Cabinet[] = []
  const blocked: { cabinet: Cabinet; reason: BlockReason }[] = []
  for (const c of doc.cabinets) {
    const m = manufacturableCabinet(c, doc)
    if (m.ok) ok.push(c)
    else blocked.push({ cabinet: c, reason: m.reason! })
  }
  return { ok, blocked }
}

/** The user confirms measured dimensions (removes the review flag; the source becomes a survey). */
export function confirmDims(doc: InteriorDoc, itemId: string): InteriorDoc {
  const i = doc.items.find((x) => x.id === itemId)
  if (!i) return doc
  const src: DimSource = { kind: 'survey' }
  return {
    ...doc,
    items: doc.items.map((x) => (x.id === itemId ? { ...x, src } : x)),
    cabinets: doc.cabinets.map((c) => (c.id === i.cabinet ? { ...c, src } : c)),
  }
}

/* ---------------- room item schedule ---------------- */

export interface ScheduleRow {
  item: string
  name: string
  category: Item['category']
  room: string
  /** Instances placed in the scene. */
  count: number
  /** Catalog / model size W × D × H (mm; round items: Ø as W and D). */
  w: number
  d: number
  h: number
  elev: number
  /** Measured from the 3D primitives of the first instance (rotation removed: W along the item's width). */
  bounds: { w: number; d: number; h: number }
  finishes: string
  status: Item['status']
  manufacturable: boolean
}

/** One row per item in the room(s): counts are scene instances, sizes are measured from the scene geometry. */
export function roomSchedule(doc: InteriorDoc, room?: string): ScheduleRow[] {
  const rows: ScheduleRow[] = []
  for (const pl of itemPlacements(doc)) {
    const i = pl.item
    if (room && i.room !== room) continue
    const cab = i.cabinet ? doc.cabinets.find((c) => c.id === i.cabinet) : undefined
    // bounds of the first instance measured unrotated (an axis-aligned copy of it), so W / D read as the item's own
    const unrot = { ...doc, items: doc.items.map((x) => (x.id === i.id ? { ...x, qty: 1, at: [{ ...(pl.at[0] ?? { x: 0, y: 0, rot: 0 }), rot: 0 }] } : x)) }
    const b = itemBounds(unrot, i.id, 0)
    const w = i.w ?? i.dia ?? 0, d = i.d ?? i.dia ?? 0
    rows.push({
      item: i.id,
      name: i.name,
      category: i.category,
      room: i.room,
      count: pl.at.length,
      w,
      d,
      h: i.h,
      elev: i.elev ?? 0,
      bounds: b ? { w: Math.round(b.x1 - b.x0), d: Math.round(b.y1 - b.y0), h: Math.round(b.z1 - b.z0) } : { w: 0, d: 0, h: 0 },
      finishes: PARTS[i.category].map((p) => `${p}: ${partMaterial(i, p, cab).material}`).join('; '),
      status: i.status,
      manufacturable: manufacturable(i, doc).ok,
    })
  }
  return rows
}

export const scheduleCsvRows = (rows: ScheduleRow[], roomName: (id: string) => string): (string | number)[][] => [
  ['Room', 'Item', 'Category', 'Count', 'W (mm)', 'D (mm)', 'H (mm)', 'Elevation (mm)', '3D bounds W×D×H (mm)', 'Finishes', 'Status', 'Manufacturable'],
  ...rows.map((r) => [roomName(r.room), r.name, r.category, r.count, r.w, r.d, r.h, r.elev, `${r.bounds.w} × ${r.bounds.d} × ${r.bounds.h}`, r.finishes, r.status, r.manufacturable ? 'yes' : 'no']),
]


