/**
 * North Canal Project — irrigation canal CANAL-01 (sample data). Lengths in metres, elevations in metres.
 *
 * Hydraulics: Manning, Q = (1/n)·A·R^(2/3)·S^(1/2), trapezoidal section (bottom width b, side slope m H:1V),
 * normal depth solved by bisection. Earthwork: average-end-area between 20 m sections. Cut is the channel
 * prism below existing ground; fill is the bank embankment needed to reach top of bank + 0.30 m
 * (maintenance road) with 3.0 m crests. These are standard hand methods, not AI.
 */

export interface DesignParams {
  bottomWidth: number // b, m
  sideSlope: number // m (H per 1 V)
  freeboard: number // m
  manningN: number
  discharge: number // Q, m³/s
  slopeMin: number
  slopeMax: number
  lining: string
  liningT: number // m
}

import { crossLine } from './tin'
import { tinOf } from './surveyModel'

/** Design invert profile: [station, elevation] vertices with grade breaks. */
export type Profile = [number, number][]

export interface Culvert {
  id: string
  name: string
  station: number
  invert: number
  size: string
  length: number
}

export interface Alignment {
  name: string
  type: string
  description: string
  start: number
  end: number
  site: string
}

export interface CivilModel {
  alignment: Alignment
  params: DesignParams
  invert: Profile
  culverts: Culvert[]
  /** Imported survey (points / TIN / alignment) — see civil/survey.ts. */
  survey?: import('./survey').Survey
  /** Alignment centre line in plan (m), station 0 at the first vertex. */
  plan?: [number, number][]
  /** Existing ground sampled from the survey surface along the plan alignment (every 20 m). */
  ground?: Profile
  /** TIN long-edge trimming limit (m); null/undefined = automatic. */
  tinMaxEdge?: number | null
  /** Notes and measured dimensions placed on the profile (x = station, z = elevation) or a cross section
   *  (x = offset from the centre line, z = elevation; `station` = which section). */
  notes?: CivilNote[]
}

export interface CivilNote {
  id: string
  kind: 'text' | 'dimension'
  view: 'profile' | 'section'
  station?: number
  a: [number, number]
  b?: [number, number]
  text?: string
}

/** Existing ground along CANAL-01 every 20 m (sample project; replaced by the imported survey surface). */
export const EXISTING_GROUND: Profile = [
  [0, 7.75], [20, 7.82], [40, 7.95], [60, 8.05], [80, 7.9], [100, 7.66], [120, 7.52], [140, 7.61], [160, 7.74], [180, 7.62],
  [200, 7.45], [220, 7.38], [240, 7.31], [260, 7.42], [280, 7.55], [300, 7.48], [320, 7.33], [340, 7.21], [360, 7.15], [380, 7.24],
  [400, 7.31], [420, 7.22], [440, 7.08], [460, 7.0], [480, 6.98], [500, 7.05], [520, 6.96], [540, 6.88], [560, 6.82], [580, 6.85],
  [600, 6.79], [620, 6.74],
]

export function createNorthCanal(): CivilModel {
  return {
    alignment: { name: 'CANAL-01', type: 'Centerline Alignment', description: 'Main Drainage Canal', start: 0, end: 620, site: 'North Canal Project' },
    params: { bottomWidth: 8, sideSlope: 2, freeboard: 0.5, manningN: 0.015, discharge: 6.7, slopeMin: 0.0005, slopeMax: 0.005, lining: 'Concrete (M250)', liningT: 0.12 },
    // two flat stretches (0+120–0+160, 0+480–0+500) come from the sample design and are flagged by the slope check
    invert: [[0, 6.55], [120, 6.37], [160, 6.354], [250, 6.2], [480, 5.855], [500, 5.847], [520, 5.8], [620, 5.65]],
    culverts: [
      { id: 'CL-01', name: 'Culvert CL-01', station: 250, invert: 6.2, size: 'Box 2 × 2.0 × 1.5 m', length: 12 },
      { id: 'CL-02', name: 'Culvert CL-02', station: 520, invert: 5.8, size: 'Box 2 × 2.0 × 1.5 m', length: 12 },
    ],
  }
}

/** Existing ground used by every calculation: the survey surface when imported, otherwise the sample profile. */
export const groundOf = (m: CivilModel): Profile => (m.ground && m.ground.length >= 2 ? m.ground : EXISTING_GROUND)

/* ---------------- geometry along the alignment ---------------- */

export function interp(p: Profile, s: number): number {
  if (s <= p[0][0]) return p[0][1]
  for (let i = 1; i < p.length; i++) {
    const [s0, z0] = p[i - 1], [s1, z1] = p[i]
    if (s <= s1) return z0 + ((z1 - z0) * (s - s0)) / (s1 - s0)
  }
  return p[p.length - 1][1]
}

export interface Segment {
  from: number
  to: number
  slope: number
}

export function segments(p: Profile): Segment[] {
  return p.slice(1).map(([s1, z1], i) => ({ from: p[i][0], to: s1, slope: (p[i][1] - z1) / (s1 - p[i][0]) }))
}

/* ---------------- hydraulics ---------------- */

export function section(b: number, m: number, y: number) {
  const A = (b + m * y) * y
  const P = b + 2 * y * Math.sqrt(1 + m * m)
  const T = b + 2 * m * y
  return { A, P, R: A / P, T }
}

export function manningQ(b: number, m: number, y: number, n: number, S: number) {
  const { A, R } = section(b, m, y)
  return (1 / n) * A * Math.pow(R, 2 / 3) * Math.sqrt(S)
}

/** Normal depth for discharge Q (bisection). */
export function normalDepth(p: DesignParams, S: number): number {
  let lo = 0.001, hi = 20
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2
    if (manningQ(p.bottomWidth, p.sideSlope, mid, p.manningN, S) > p.discharge) hi = mid
    else lo = mid
  }
  return (lo + hi) / 2
}

/** Governing (design) slope for the typical section: the mid-length grade. */
export const typicalSlope = (m: CivilModel) => (interp(m.invert, 250) - interp(m.invert, 480)) / 230

export function hydraulics(m: CivilModel, S = typicalSlope(m)) {
  const p = m.params
  const y = normalDepth(p, S)
  const sec = section(p.bottomWidth, p.sideSlope, y)
  const v = p.discharge / sec.A
  const fr = v / Math.sqrt(9.81 * (sec.A / sec.T))
  const H = Math.ceil((y + p.freeboard) * 20) / 20 // section depth rounded up to 0.05 m
  return { S, y, v, fr, A: sec.A, H, top: p.bottomWidth + 2 * p.sideSlope * H }
}

/* ---------------- earthwork ---------------- */

const CREST = 3.0
const ROAD = 0.3

/**
 * Cut / fill areas from the surveyed cross section (when a survey surface and plan alignment exist):
 * the design template (channel, 3 m crests at top of bank + 0.30 m, outer embankment slopes down to the
 * ground) is compared with the ground line across the section, integrated every 0.25 m.
 */
function surveyedAreas(m: CivilModel, s: number, H: number, gc: number, inv: number) {
  const tin = tinOf(m)
  if (!tin || !m.plan) return null
  const { bottomWidth: b, sideSlope: k } = m.params
  const top = b + 2 * k * H
  const crestZ = H + ROAD
  const half = top / 2 + CREST + k * (crestZ + 6) + 2
  const ground = crossLine(tin, m.plan, s, half, 0.25)
  if (ground.length < 8) return null
  const gAt = new Map(ground.map(([o, z]) => [Math.round(o * 4), z - inv]))
  let cut = 0, fill = 0
  for (let i = -Math.round(half * 4); i <= Math.round(half * 4); i++) {
    const x = Math.abs(i / 4)
    const g = gAt.get(i) ?? gc - inv // gaps (outside the TIN): centre-line ground
    let z: number, outer = false
    if (x <= b / 2) z = 0
    else if (x <= top / 2) z = (x - b / 2) / Math.max(k, 1e-9)
    else if (x <= top / 2 + CREST) z = crestZ
    else (z = crestZ - (x - top / 2 - CREST) / Math.max(k, 1e-9)), (outer = true)
    if (g > z && !outer) cut += (g - z) * 0.25
    if (z > g) fill += (z - g) * 0.25
  }
  return { cut, fill }
}

export function areasAt(m: CivilModel, s: number, H: number) {
  const g = interp(groundOf(m), s)
  const inv = interp(m.invert, s)
  const sv = surveyedAreas(m, s, H, g, inv)
  if (sv) return { g, inv, ...sv }
  const { bottomWidth: b, sideSlope: k } = m.params
  const d = Math.max(0, g - inv)
  const cut = (b + k * d) * d
  const e = Math.max(0, inv + H + ROAD - g)
  const fill = 2 * (CREST + k * e) * e
  return { g, inv, cut, fill }
}

export interface EarthRow {
  from: number
  to: number
  length: number
  cut: number
  fill: number
  net: number
}

/** Average-end-area volumes per 100 m, integrated on 20 m sections. */
export function earthwork(m: CivilModel, step = 100): EarthRow[] {
  const { H } = hydraulics(m)
  const rows: EarthRow[] = []
  for (let a = m.alignment.start; a < m.alignment.end; a += step) {
    const b = Math.min(a + step, m.alignment.end)
    let cut = 0, fill = 0
    for (let s = a; s < b; s += 20) {
      const s2 = Math.min(s + 20, b)
      const p = areasAt(m, s, H), q = areasAt(m, s2, H)
      cut += ((p.cut + q.cut) / 2) * (s2 - s)
      fill += ((p.fill + q.fill) / 2) * (s2 - s)
    }
    rows.push({ from: a, to: b, length: b - a, cut, fill, net: cut - fill })
  }
  return rows
}

export function liningQuantities(m: CivilModel) {
  const { H } = hydraulics(m)
  const { bottomWidth: b, sideSlope: k, liningT } = m.params
  const perim = b + 2 * H * Math.sqrt(1 + k * k)
  const len = m.alignment.end - m.alignment.start
  return { perim, area: perim * len, concrete: perim * len * liningT, len }
}

/* ---------------- checks ---------------- */

export interface CivilCheck {
  kind: 'slope' | 'velocity' | 'froude' | 'freeboard'
  ok: boolean
  detail: string[]
}

export function checks(m: CivilModel) {
  const p = m.params
  const h = hydraulics(m)
  const flat = segments(m.invert).filter((g) => g.slope < p.slopeMin - 1e-9)
  const steep = segments(m.invert).filter((g) => g.slope > p.slopeMax + 1e-9)
  return {
    flat,
    steep,
    // concrete-lined: non-silting ≥ 0.6 m/s, non-scouring ≤ 3.0 m/s; subcritical flow Fr < 0.8
    velocityOk: h.v >= 0.6 && h.v <= 3,
    froudeOk: h.fr < 0.8,
    freeboardOk: p.freeboard >= 0.5,
    h,
  }
}

/** Optimisation: earthwork if the bottom width were reduced by 1 m (same Q, S). */
export function narrowerOption(m: CivilModel) {
  const b = Math.max(2, m.params.bottomWidth - 1)
  const alt: CivilModel = { ...m, params: { ...m.params, bottomWidth: b } }
  const cut0 = earthwork(m).reduce((a, r) => a + r.cut + r.fill, 0)
  const cut1 = earthwork(alt).reduce((a, r) => a + r.cut + r.fill, 0)
  return { b, saving: (cut0 - cut1) / cut0, alt: hydraulics(alt) }
}

export const sta = (s: number) => `${Math.floor(s / 1000)}+${String(Math.round(s % 1000)).padStart(3, '0')}`
