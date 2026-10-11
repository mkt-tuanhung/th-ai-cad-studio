/**
 * MEP model of Villa Riverside (sample project). Every schedule, check and clash on the MEP workspace
 * is computed from this data. Geometry: mm, axis-aligned runs (enough for coordination checks until
 * the native MEP engine is connected).
 */
import { cableCheck, ductLoss, pipeCheck, LIMITS } from './calc'

export type SystemKey = 'hvac' | 'plumbing' | 'electrical'
export type LevelId = 'L1' | 'L2' | 'L3'
export const LEVELS: { id: LevelId; name: string; elev: number }[] = [
  { id: 'L1', name: 'Level 1', elev: 0 },
  { id: 'L2', name: 'Level 2', elev: 3600 },
  { id: 'L3', name: 'Level 3', elev: 7200 },
]
const LV = Object.fromEntries(LEVELS.map((l) => [l.id, l.elev])) as Record<LevelId, number>

interface Run {
  /** Start point in plan (mm). */
  x: number
  y: number
  axis: 'x' | 'y'
  length: number
  /** Centre-line elevation above its level (mm). */
  elevation: number
  level: LevelId
}

export type DuctType = 'Supply Air Duct' | 'Return Air Duct' | 'Exhaust Air Duct' | 'Outdoor Air Duct'
export interface Duct extends Run {
  id: string
  mark: string
  type: DuctType
  w: number
  h: number
  flow: number // L/s
  material: string
  insulation: number
  wall: number
}

export type PipeService = 'Chilled Water Supply' | 'Chilled Water Return' | 'Domestic Cold Water' | 'Domestic Hot Water' | 'Sanitary Drain' | 'Fire Sprinkler'
export interface Pipe extends Run {
  id: string
  mark: string
  service: PipeService
  dn: number
  flow: number // L/s
  material: string
}

export interface Circuit {
  id: string
  mark: string
  panel: string
  load: string
  kw: number
  phases: 1 | 3
  cable: number // mm²
  breaker: number // A
  length: number // m
  level: LevelId
}

export type EquipKind = 'AHU' | 'FCU' | 'Pump' | 'Chiller' | 'Electrical Panel'
export interface Equipment {
  id: string
  mark: string
  kind: EquipKind
  system: SystemKey
  level: LevelId
  capacity: string
}

export interface Beam extends Run {
  id: string
  w: number
  h: number
}

export interface MepModel {
  ducts: Duct[]
  pipes: Pipe[]
  circuits: Circuit[]
  equipment: Equipment[]
  beams: Beam[]
}

/* ---------------- sample data ---------------- */

let seed = 7
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
const pick = <T,>(a: readonly T[]) => a[Math.floor(rnd() * a.length)]

function makeDucts(): Duct[] {
  const base = (p: Partial<Duct> & Pick<Duct, 'mark' | 'type' | 'w' | 'h' | 'length' | 'flow' | 'x' | 'y' | 'axis' | 'level'>): Duct => ({
    id: p.mark + '-' + p.level, elevation: 3200, material: 'Galvanized Steel', insulation: 25, wall: 1.0, ...p,
  })
  // the five ducts shown in the mockup (Level 2)
  const out: Duct[] = [
    base({ mark: 'SA-01', type: 'Supply Air Duct', w: 600, h: 400, length: 3000, flow: 1200, x: 2000, y: 4000, axis: 'x', level: 'L2' }),
    base({ mark: 'SA-02', type: 'Supply Air Duct', w: 500, h: 300, length: 2800, flow: 900, x: 3500, y: 5000, axis: 'x', level: 'L2' }),
    base({ mark: 'RA-01', type: 'Return Air Duct', w: 800, h: 500, length: 4200, flow: 1500, x: 2500, y: 9000, axis: 'x', level: 'L2' }),
    base({ mark: 'EA-01', type: 'Exhaust Air Duct', w: 400, h: 300, length: 2500, flow: 800, x: 11500, y: 2000, axis: 'y', level: 'L2' }),
    base({ mark: 'OA-01', type: 'Outdoor Air Duct', w: 500, h: 400, length: 3100, flow: 1100, x: 13000, y: 7000, axis: 'y', level: 'L2' }),
  ]
  const types: [DuctType, string][] = [['Supply Air Duct', 'SA'], ['Return Air Duct', 'RA'], ['Exhaust Air Duct', 'EA'], ['Outdoor Air Duct', 'OA']]
  const sizes = [[300, 200], [400, 250], [400, 300], [500, 300], [600, 400], [700, 400], [800, 500]]
  const count: Record<string, number> = { SA: 2, RA: 1, EA: 1, OA: 1 }
  for (const level of ['L1', 'L2', 'L3'] as LevelId[]) {
    const n = level === 'L2' ? 11 : 16
    for (let i = 0; i < n; i++) {
      const [type, pre] = pick(types)
      const [w, h] = pick(sizes)
      const area = (w / 1000) * (h / 1000)
      const flow = Math.round((area * (3 + rnd() * 3.5)) * 1000 / 50) * 50 // 3–6.5 m/s
      count[pre] = (count[pre] ?? 0) + 1
      const axis = rnd() > 0.5 ? 'x' : 'y'
      // routed below the 600 mm beams (soffit at +3000); a few runs were drawn too high on purpose by the sample
      const elevation = rnd() > 0.9 ? 3100 : 2650
      out.push(base({ mark: `${pre}-${String(count[pre]).padStart(2, '0')}`, type, w, h, flow, length: Math.round((1500 + rnd() * 4500) / 100) * 100, x: Math.round(rnd() * 14000 / 100) * 100, y: Math.round(rnd() * 11000 / 100) * 100, axis, level, elevation }))
    }
  }
  return out
}

function makePipes(): Pipe[] {
  const services: [PipeService, string, number[]][] = [
    ['Chilled Water Supply', 'CHWS', [50, 65, 80, 100]],
    ['Chilled Water Return', 'CHWR', [50, 65, 80, 100]],
    ['Domestic Cold Water', 'DCW', [20, 25, 32, 40]],
    ['Domestic Hot Water', 'DHW', [20, 25, 32]],
    ['Sanitary Drain', 'SAN', [50, 80, 100]],
    ['Fire Sprinkler', 'FS', [25, 32, 50, 65]],
  ]
  const out: Pipe[] = []
  const count: Record<string, number> = {}
  for (let i = 0; i < 32; i++) {
    const [service, pre, dns] = services[i % services.length]
    const dn = pick(dns)
    const d = dn / 1000
    const v = service === 'Sanitary Drain' ? 0.9 : 0.6 + rnd() * 1.6
    count[pre] = (count[pre] ?? 0) + 1
    out.push({
      id: `${pre}-${count[pre]}`, mark: `${pre}-${String(count[pre]).padStart(2, '0')}`, service, dn,
      flow: Math.round(((Math.PI * d * d) / 4) * v * 1000 * 100) / 100,
      material: service === 'Sanitary Drain' ? 'PVC' : service.startsWith('Domestic') ? 'PPR' : 'Steel Sch 40',
      x: Math.round(rnd() * 14000 / 100) * 100, y: Math.round(rnd() * 11000 / 100) * 100, axis: rnd() > 0.5 ? 'x' : 'y',
      length: Math.round((2000 + rnd() * 6000) / 100) * 100, elevation: 2150 + Math.round(rnd() * 2) * 50, level: (['L1', 'L2', 'L3'] as LevelId[])[i % 3],
    })
  }
  return out
}

function makeCircuits(): Circuit[] {
  const loads: [string, number, 1 | 3][] = [['Lighting', 0.6, 1], ['Socket outlets', 2.2, 1], ['FCU', 1.1, 1], ['AHU', 5.5, 3], ['Water heater', 3.0, 1], ['Pump', 4.0, 3], ['Kitchen', 4.5, 1], ['EV charger', 7.4, 1]]
  const sizes = [1.5, 2.5, 4, 6, 10]
  const out: Circuit[] = []
  for (let i = 0; i < 56; i++) {
    const [load, kwBase, phases] = loads[i % loads.length]
    const level = (['L1', 'L2', 'L3'] as LevelId[])[Math.floor(i / 19)]
    const kw = Math.round(kwBase * (0.7 + rnd() * 0.6) * 10) / 10
    const length = Math.round(8 + rnd() * 52)
    // smallest cable whose ampacity exceeds the design current (one size up for long runs)
    const i_ = phases === 3 ? (kw * 1000) / (Math.sqrt(3) * 400 * 0.9) : (kw * 1000) / (230 * 0.9)
    // sized for ampacity and 3 % voltage drop — except every 9th circuit, sized for ampacity only (the check flags it)
    let cable = sizes.find((s) => [17.5, 24, 32, 41, 57][sizes.indexOf(s)] > i_ * 1.25) ?? 10
    if (i % 9 !== 4) cable = [...sizes, 16, 25].find((s) => s >= cable && cableCheck(kw, phases, s, length).vdPct <= 3) ?? cable
    out.push({ id: `C${i + 1}`, mark: `DB-${level}-${String((i % 19) + 1).padStart(2, '0')}`, panel: `DB-${level}`, load, kw, phases, cable, breaker: [10, 16, 20, 25, 32, 40][Math.min(5, Math.ceil(i_ / 8))], length, level })
  }
  return out
}

function makeEquipment(): Equipment[] {
  const out: Equipment[] = []
  const add = (kind: EquipKind, n: number, system: SystemKey, cap: (i: number) => string, pre: string) => {
    for (let i = 1; i <= n; i++) out.push({ id: `${pre}-${i}`, mark: `${pre}-${String(i).padStart(2, '0')}`, kind, system, level: (['L1', 'L2', 'L3'] as LevelId[])[(i - 1) % 3], capacity: cap(i) })
  }
  add('AHU', 4, 'hvac', (i) => `${[3.0, 3.5, 2.5, 4.0][i - 1]} m³/s`, 'AHU')
  add('FCU', 12, 'hvac', (i) => `${[0.15, 0.2, 0.25][i % 3]} m³/s`, 'FCU')
  add('Pump', 6, 'plumbing', (i) => `${[2.5, 3.0, 4.0][i % 3]} kW`, 'P')
  add('Chiller', 2, 'hvac', () => '350 kW', 'CH')
  add('Electrical Panel', 8, 'electrical', (i) => `${[63, 100, 125, 160][i % 4]} A`, 'DB')
  return out
}

function makeBeams(): Beam[] {
  // primary beams under each slab: 300 × 600, along both grids
  const out: Beam[] = []
  for (const level of ['L1', 'L2', 'L3'] as LevelId[]) {
    for (const x of [0, 7500, 15000]) out.push({ id: `B-${level}-x${x}`, x, y: 0, axis: 'y', length: 12000, elevation: 3300, level, w: 300, h: 600 })
    for (const y of [0, 6500, 12000]) out.push({ id: `B-${level}-y${y}`, x: 0, y, axis: 'x', length: 15000, elevation: 3300, level, w: 300, h: 600 })
  }
  return out
}

export function createVillaMep(): MepModel {
  seed = 7
  return { ducts: makeDucts(), pipes: makePipes(), circuits: makeCircuits(), equipment: makeEquipment(), beams: makeBeams() }
}

/* ---------------- checks ---------------- */

type Box = { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number }
function box(r: Run, w: number, h: number): Box {
  const z = LV[r.level] + r.elevation
  return r.axis === 'x'
    ? { x0: r.x, x1: r.x + r.length, y0: r.y - w / 2, y1: r.y + w / 2, z0: z - h / 2, z1: z + h / 2 }
    : { x0: r.x - w / 2, x1: r.x + w / 2, y0: r.y, y1: r.y + r.length, z0: z - h / 2, z1: z + h / 2 }
}
const hit = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1 && a.z0 < b.z1 && b.z0 < a.z1

export interface Clash {
  id: string
  a: string
  b: string
  kind: 'duct-beam' | 'pipe-beam' | 'duct-pipe'
  level: LevelId
  depth: number // vertical overlap, mm
}

export function findClashes(m: MepModel): Clash[] {
  const out: Clash[] = []
  const beams = m.beams.map((b) => ({ b, box: box(b, b.w, b.h) }))
  const ducts = m.ducts.map((d) => ({ d, box: box(d, d.w + 2 * d.insulation, d.h + 2 * d.insulation) }))
  const pipes = m.pipes.map((p) => ({ p, box: box(p, p.dn + 40, p.dn + 40) }))
  const ov = (a: Box, b: Box) => Math.round(Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0))
  for (const { d, box: db } of ducts) {
    for (const { b, box: bb } of beams) if (b.level === d.level && hit(db, bb)) out.push({ id: `${d.id}×${b.id}`, a: d.mark, b: b.id.replace(/^B-L\d-/, 'Beam '), kind: 'duct-beam', level: d.level, depth: ov(db, bb) })
    for (const { p, box: pb } of pipes) if (p.level === d.level && hit(db, pb)) out.push({ id: `${d.id}×${p.id}`, a: d.mark, b: p.mark, kind: 'duct-pipe', level: d.level, depth: ov(db, pb) })
  }
  for (const { p, box: pb } of pipes) for (const { b, box: bb } of beams) if (b.level === p.level && hit(pb, bb)) out.push({ id: `${p.id}×${b.id}`, a: p.mark, b: b.id.replace(/^B-L\d-/, 'Beam '), kind: 'pipe-beam', level: p.level, depth: ov(pb, bb) })
  return out
}

export interface Finding {
  id: string
  severity: 'warn' | 'err'
  target: { kind: 'duct' | 'pipe' | 'circuit'; id: string }
  rule: 'ductVel' | 'ductLoss' | 'pipeVel' | 'vd' | 'ampacity'
  value: number
  limit: number
  /** Automatic fix available (resize). */
  fix?: { label: string; patch: Record<string, number> }
}

const DUCT_W = [200, 250, 300, 350, 400, 450, 500, 600, 700, 800, 900, 1000, 1200]
const CABLES = [1.5, 2.5, 4, 6, 10, 16, 25, 35, 50]

export function designChecks(m: MepModel): Finding[] {
  const out: Finding[] = []
  for (const d of m.ducts) {
    const { v, paPerM } = ductLoss(d.w, d.h, d.flow)
    if (v > LIMITS.ductVelMain) {
      const w = DUCT_W.find((x) => x > d.w && (d.flow / 1000) / ((x / 1000) * (d.h / 1000)) <= LIMITS.ductVelMain)
      out.push({ id: `dv-${d.id}`, severity: 'warn', target: { kind: 'duct', id: d.id }, rule: 'ductVel', value: v, limit: LIMITS.ductVelMain, fix: w ? { label: `${w} × ${d.h}`, patch: { w } } : undefined })
    } else if (paPerM > LIMITS.ductLoss) out.push({ id: `dl-${d.id}`, severity: 'warn', target: { kind: 'duct', id: d.id }, rule: 'ductLoss', value: paPerM, limit: LIMITS.ductLoss })
  }
  for (const p of m.pipes) {
    const { v } = pipeCheck(p.dn, p.flow)
    if (v > LIMITS.pipeVel) out.push({ id: `pv-${p.id}`, severity: 'warn', target: { kind: 'pipe', id: p.id }, rule: 'pipeVel', value: v, limit: LIMITS.pipeVel })
  }
  for (const c of m.circuits) {
    const r = cableCheck(c.kw, c.phases, c.cable, c.length)
    if (r.i > r.iz) out.push({ id: `ia-${c.id}`, severity: 'err', target: { kind: 'circuit', id: c.id }, rule: 'ampacity', value: r.i, limit: r.iz })
    else if (r.vdPct > LIMITS.vdPct) {
      const up = CABLES.find((s) => s > c.cable && cableCheck(c.kw, c.phases, s, c.length).vdPct <= LIMITS.vdPct)
      out.push({ id: `vd-${c.id}`, severity: 'warn', target: { kind: 'circuit', id: c.id }, rule: 'vd', value: r.vdPct, limit: LIMITS.vdPct, fix: up ? { label: `${up} mm²`, patch: { cable: up } } : undefined })
    }
  }
  return out
}

export const systemOf = (d: Duct | Pipe) => ('service' in d ? 'Plumbing' : 'HVAC')
