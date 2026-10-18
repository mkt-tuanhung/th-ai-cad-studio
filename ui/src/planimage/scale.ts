/**
 * Scale suggestions for a plan picture (the user confirms — nothing here calibrates by itself, see
 * cad/calibration.ts): dimension texts read by OCR next to a dimension line, room areas written in the rooms
 * ("13.53 m²" against the room's measured pixels), and — as an assumption the user must check — standard door
 * widths. Every suggestion is a CalRef in picture px, the units of the calibration picker.
 */
import { ocrReferences, solveScale, type CalRef } from '../cad/calibration'
import type { Entity } from '../cad/types'
import { axisOf, type PlanGraph } from './recognize'

export interface ScaleSuggestion {
  refs: CalRef[]
  /** mm per px of the consensus (median of the agreeing references), null when there is none */
  k: number | null
  /** references within 3 % of the consensus */
  agreeing: CalRef[]
}

const base = { color: 'ByLayer', linetype: 'ByLayer', lineweight: 'ByLayer', transparency: 0 } as const

/** Dimension texts (OCR) on the thin lines of the plan: "3200" over a line of 189 px → 16.9 mm/px. */
export function dimensionRefs(g: PlanGraph): CalRef[] {
  const ents: Entity[] = []
  let n = 0
  // y up for the entity helpers (texts' boxes, segments) — distances do not care
  const Y = (y: number) => g.h - y
  for (const s of g.segs) ents.push({ ...base, id: `s${++n}`, kind: 'line', layer: 'L', a: { x: s.a[0], y: Y(s.a[1]) }, b: { x: s.b[0], y: Y(s.b[1]) } } as Entity)
  for (const w of g.words) {
    if (w.conf < 50) continue
    ents.push({ ...base, id: `t${++n}`, kind: 'text', layer: 'T', p: { x: w.x0, y: Y(w.y1) }, height: (w.y1 - w.y0) * 0.72, value: w.text, rotation: 0, align: 'left', src: { id: '', confidence: w.conf / 100, bbox: { x0: w.x0, y0: Y(w.y1), x1: w.x1, y1: Y(w.y0) } } } as Entity)
  }
  return ocrReferences(ents, 1).filter((r) => r.refDistance >= 300 && r.measured >= 15).map((r) => ({ ...r, a: { x: r.a.x, y: g.h - r.a.y }, b: { x: r.b.x, y: g.h - r.b.y } }))
}

/** Room areas written in the rooms: the side of a square of the same area (√px against √m²). */
export function areaRefs(g: PlanGraph): CalRef[] {
  return g.rooms.filter((r) => r.areaLabel && r.areaPx > 50).map((r) => ({
    id: `area-${r.id}`, method: 'ocr-dimension' as const, a: { x: r.seed[0], y: r.seed[1] }, b: { x: r.seed[0], y: r.seed[1] },
    measured: Math.sqrt(r.areaPx), refDistance: Math.round(Math.sqrt(r.areaLabel! * 1e6)), text: `${r.areaLabel} m²${r.name ? ` — ${r.name}` : ''}`,
  }))
}

/** Standard door width (an assumption): the median door gap against `width` mm, across a real door of the plan. */
export function doorRef(g: PlanGraph, width = 900): CalRef | null {
  const doors = g.openings.filter((o) => o.kind === 'door' && o.conf >= 0.7).map((o) => ({ o, w: o.s1 - o.s0 })).sort((a, b) => a.w - b.w)
  if (doors.length < 2) return null
  const m = doors[Math.floor(doors.length / 2)]
  const wall = g.walls.find((w) => w.id === m.o.wall)
  if (!wall) return null
  const L = Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]) || 1
  const ux = (wall.b[0] - wall.a[0]) / L, uy = (wall.b[1] - wall.a[1]) / L
  const a = { x: wall.a[0] + ux * m.o.s0, y: wall.a[1] + uy * m.o.s0 }, b = { x: wall.a[0] + ux * m.o.s1, y: wall.a[1] + uy * m.o.s1 }
  void axisOf
  return { id: `door-${m.o.id}`, method: 'two-point', a, b, measured: m.w, refDistance: width, text: `door ${width}` }
}

/** The references and their consensus: the median scale, the references within 3 % of it. */
export function suggestScale(g: PlanGraph): ScaleSuggestion {
  const refs = [...dimensionRefs(g), ...areaRefs(g)]
  if (!refs.length) return { refs, k: null, agreeing: [] }
  const ks = refs.map((r) => r.refDistance / r.measured).sort((a, b) => a - b)
  const med = ks[Math.floor(ks.length / 2)]
  const agreeing = refs.filter((r) => Math.abs(r.refDistance / r.measured / med - 1) <= 0.03)
  // a consensus needs two references that agree (one OCR reading can be wrong)
  const fit = agreeing.length >= 2 ? solveScale(agreeing) : null
  return { refs, k: fit ? fit.k : null, agreeing: fit ? agreeing : [] }
}
