/**
 * CNC router CAM for nested panel sheets: drilling (shelf-pin rows, hinge cups) and outside profiles
 * with depth passes, onion-skin tabs and exact square corners (G2 arcs around each corner). Output:
 * G-code for GRBL (one program per tool — GRBL has no tool changer) or ISO / Fanuc style (T… M6).
 * Machine zero: sheet lower-left corner, Z0 = top of the board. `simulate()` re-reads the program
 * independently to verify bounds / depths / rapids and to estimate the machining time.
 */
import type { Placement, Sheet } from './nesting'

export interface CamSettings {
  dialect: 'grbl' | 'iso'
  cutterD: number // profile end mill Ø (mm)
  feed: number // mm/min
  plunge: number // mm/min
  rpm: number
  stepdown: number // mm per pass
  /** Cut this far into the spoilboard (mm). */
  breakthrough: number
  safeZ: number // mm above the board
  tabs: boolean
  tabW: number // mm
  tabH: number // mm of material left in a tab
  /** Drill 5 mm shelf-pin rows (32 mm system) in sides / dividers of cabinets with shelves. */
  shelfPins: boolean
  /** Hinge cups Ø35 × 12.5 in doors. */
  hingeCups: boolean
  /** Rapid traverse speed used for the time estimate (mm/min). */
  rapid: number
}

export const DEFAULT_CAM: CamSettings = {
  dialect: 'grbl', cutterD: 8, feed: 8000, plunge: 2000, rpm: 18000, stepdown: 9.5, breakthrough: 0.3, safeZ: 15,
  tabs: true, tabW: 10, tabH: 2, shelfPins: true, hingeCups: true, rapid: 15000,
}

export interface Tool {
  n: number
  name: string
  d: number
  rpm: number
  feed: number
  plunge: number
}

/** Holes in sheet coordinates. */
export interface Hole {
  x: number
  y: number
  d: number
  depth: number
  part: string
}

/** Drilling features of a placed part (part-local x along its length, y across its width). */
export function holesOf(p: Placement, s: CamSettings, hasShelves: (cabinet: string) => boolean): Hole[] {
  const local: { x: number; y: number; d: number; depth: number }[] = []
  if (s.hingeCups && p.part === 'Door') {
    const n = p.l <= 900 ? 2 : p.l <= 1600 ? 3 : p.l <= 2000 ? 4 : 5
    for (let k = 0; k < n; k++) local.push({ x: 100 + (k * (p.l - 200)) / (n - 1), y: 22.5, d: 35, depth: 12.5 })
  }
  if (s.shelfPins && (p.part === 'Side panel' || p.part === 'Divider') && hasShelves(p.cabinet)) {
    // two rows 37 mm from the front and back edges, 32 mm pitch over the middle half of the height
    const x0 = Math.ceil((p.l * 0.25) / 32) * 32, x1 = Math.floor((p.l * 0.75) / 32) * 32
    for (let x = x0; x <= x1; x += 32) for (const y of [37, p.w - 37]) local.push({ x, y, d: 5, depth: 12 })
  }
  // local → sheet (rotated parts: local x runs along sheet y)
  return local.map((h) => ({ x: p.rotated ? p.x + h.y : p.x + h.x, y: p.rotated ? p.y + h.x : p.y + h.y, d: h.d, depth: Math.min(h.depth, p.t - 1), part: p.label }))
}

export interface Program {
  name: string
  text: string
  tools: number[]
}

export interface CamResult {
  programs: Program[]
  /** For the preview: profile paths (sheet coordinates) and holes. */
  profiles: { part: string; pts: [number, number][]; tabs: [number, number][] }[]
  holes: Hole[]
  tools: Tool[]
}

const f3 = (v: number) => (Math.round(v * 1000) / 1000).toFixed(3).replace(/\.?0+$/, '') || '0'

/** Nearest-neighbour ordering from the sheet origin. */
function order<T extends { x: number; y: number }>(items: T[]): T[] {
  const left = [...items], out: T[] = []
  let cx = 0, cy = 0
  while (left.length) {
    let bi = 0, bd = Infinity
    left.forEach((h, i) => { const d = Math.hypot(h.x - cx, h.y - cy); if (d < bd) (bd = d), (bi = i) })
    const h = left.splice(bi, 1)[0]
    out.push(h)
    cx = h.x
    cy = h.y
  }
  return out
}

export function camSheet(sheet: Sheet, s: CamSettings, hasShelves: (cabinet: string) => boolean, jobName: string): CamResult {
  const r = s.cutterD / 2
  const tools: Tool[] = [
    { n: 1, name: `End mill Ø${s.cutterD} (profile)`, d: s.cutterD, rpm: s.rpm, feed: s.feed, plunge: s.plunge },
    { n: 2, name: 'Drill Ø5 (shelf pins)', d: 5, rpm: 6000, feed: 2000, plunge: 2000 },
    { n: 3, name: 'Forstner Ø35 (hinge cups)', d: 35, rpm: 4000, feed: 1000, plunge: 1000 },
  ]
  const holes = sheet.parts.flatMap((p) => holesOf(p, s, hasShelves))
  const depth = sheet.t + s.breakthrough
  const passes = Math.max(1, Math.ceil(depth / s.stepdown))
  const zs = Array.from({ length: passes }, (_, i) => -(depth * (i + 1)) / passes)

  // profiles: smallest parts first (they lose vacuum hold-down first), each one clockwise (climb, M3)
  const parts = [...sheet.parts].sort((a, b) => a.sx * a.sy - b.sx * b.sy)
  const profiles: CamResult['profiles'] = []
  const blocks = new Map<number, string[]>()
  const add = (t: number, ...lines: string[]) => blocks.set(t, [...(blocks.get(t) ?? []), ...lines])

  // drilling
  for (const [tn, d] of [[2, 5], [3, 35]] as const) {
    const list = order(holes.filter((h) => h.d === d))
    if (!list.length) continue
    const t = tools[tn - 1]
    add(tn, `(${t.name}: ${list.length} holes)`)
    for (const h of list) add(tn, `G0 X${f3(h.x)} Y${f3(h.y)}`, `G0 Z2`, `G1 Z${f3(-h.depth)} F${t.plunge}`, `G0 Z2`)
    add(tn, `G0 Z${s.safeZ}`)
  }
  // profiles
  const t1 = tools[0]
  for (const p of parts) {
    const x0 = p.x, y0 = p.y, x1 = p.x + p.sx, y1 = p.y + p.sy
    const tabsX = s.tabs && p.sx >= 200 ? [x0 + p.sx / 3, x0 + (2 * p.sx) / 3] : []
    profiles.push({ part: p.label, pts: [[x0 - r, y1 + r], [x1 + r, y1 + r], [x1 + r, y0 - r], [x0 - r, y0 - r]], tabs: tabsX.flatMap((x) => [[x, y1 + r], [x, y0 - r]] as [number, number][]) })
    add(1, `(${p.label} — ${p.sx} × ${p.sy})`, `G0 X${f3(x0)} Y${f3(y1 + r)}`, `G0 Z2`)
    zs.forEach((z, k) => {
      const last = k === zs.length - 1
      const zTab = Math.max(z, -(p.t - s.tabH))
      add(1, `G1 Z${f3(z)} F${t1.plunge}`)
      // top edge (left → right) with tabs on the final pass
      const edge = (xa: number, xb: number, y: number) => {
        const tabs = last ? tabsX.slice().sort((a, b) => (xb > xa ? a - b : b - a)) : []
        for (const tx of tabs) {
          const ta = tx - (Math.sign(xb - xa) * (s.tabW / 2 + r)), tb = tx + Math.sign(xb - xa) * (s.tabW / 2 + r)
          add(1, `G1 X${f3(ta)} Y${f3(y)} F${t1.feed}`, `G1 Z${f3(zTab)} F${t1.plunge}`, `G1 X${f3(tb)} F${t1.feed}`, `G1 Z${f3(z)} F${t1.plunge}`)
        }
        add(1, `G1 X${f3(xb)} Y${f3(y)} F${t1.feed}`)
      }
      edge(x0, x1, y1 + r)
      add(1, `G2 X${f3(x1 + r)} Y${f3(y1)} I0 J${f3(-r)}`, `G1 X${f3(x1 + r)} Y${f3(y0)}`, `G2 X${f3(x1)} Y${f3(y0 - r)} I${f3(-r)} J0`)
      edge(x1, x0, y0 - r)
      add(1, `G2 X${f3(x0 - r)} Y${f3(y0)} I0 J${f3(r)}`, `G1 X${f3(x0 - r)} Y${f3(y1)}`, `G2 X${f3(x0)} Y${f3(y1 + r)} I${f3(r)} J0`)
    })
    add(1, `G0 Z${s.safeZ}`)
  }

  const head = (t: Tool, title: string) => [
    `(${title})`,
    `(MD CAD AI STUDIO CAM · sheet ${sheet.material} ${sheet.l} × ${sheet.w} × ${sheet.t} mm #${sheet.index})`,
    `(Zero: sheet lower-left corner, Z0 = top of the board; depth ${f3(depth)} mm in ${passes} pass(es))`,
    'G21 G90 G17 G94',
    s.dialect === 'iso' ? 'G54' : '',
    s.dialect === 'iso' ? `T${t.n} M6 (${t.name})` : `(Tool T${t.n}: ${t.name} — load it before running)`,
    `S${t.rpm} M3`,
    `G0 Z${s.safeZ}`,
  ].filter(Boolean)
  const used = tools.filter((t) => blocks.has(t.n)).sort((a, b) => (a.n === 1 ? 1 : b.n === 1 ? -1 : a.n - b.n)) // drills before the profile cut
  const programs: Program[] = []
  const tail = ['M5', `G0 Z${s.safeZ}`, 'G0 X0 Y0', 'M30']
  const base = `${jobName} - ${sheet.material.replace(/\W+/g, '_')} #${sheet.index}`
  if (s.dialect === 'iso') {
    const lines: string[] = []
    used.forEach((t, i) => {
      lines.push(...(i === 0 ? head(t, base) : ['M5', `G0 Z${s.safeZ}`, `T${t.n} M6 (${t.name})`, `S${t.rpm} M3`, `G0 Z${s.safeZ}`]), ...blocks.get(t.n)!)
    })
    programs.push({ name: `${base}.nc`, text: [...lines, ...tail].join('\n') + '\n', tools: used.map((t) => t.n) })
  } else {
    for (const t of used) programs.push({ name: `${base} T${t.n}.nc`, text: [...head(t, `${base} — T${t.n}`), ...blocks.get(t.n)!, ...tail].join('\n') + '\n', tools: [t.n] })
  }
  return { programs, profiles, holes, tools }
}

/* ------------------------------------------------------------------ independent verification */

export interface SimResult {
  lines: number
  cutLength: number // mm at feed
  rapidLength: number
  minZ: number
  bounds: { x0: number; y0: number; x1: number; y1: number }
  /** Seconds: cutting + plunging at their feeds, rapids at `rapid`, 20 s per tool change. */
  seconds: number
  errors: string[]
}

/**
 * Re-reads a program (G0/G1/G2/G3 X Y Z I J F, M3/M5/M6/M30) without using any CAM data: checks that
 * every cutting move has a feed, no rapid move runs below Z0, the depth never exceeds `maxDepth`, and
 * all moves stay inside the sheet ± `margin`.
 */
export function simulate(text: string, sheet: { l: number; w: number }, maxDepth: number, margin: number, rapid = 15000): SimResult {
  let x = 0, y = 0, z = 0, f = 0, mode = 0, spindle = false, toolChanges = 0
  let cut = 0, fast = 0, secs = 0, minZ = Infinity
  const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }
  const errors: string[] = []
  const lines = text.split('\n')
  const grow = (px: number, py: number) => {
    b.x0 = Math.min(b.x0, px), b.x1 = Math.max(b.x1, px), b.y0 = Math.min(b.y0, py), b.y1 = Math.max(b.y1, py)
  }
  lines.forEach((raw, i) => {
    const line = raw.replace(/\(.*?\)/g, '').trim().toUpperCase()
    if (!line) return
    const w = Object.fromEntries([...line.matchAll(/([A-Z])(-?\d+(?:\.\d+)?)/g)].map((m) => [m[1], Number(m[2])])) as Record<string, number>
    for (const m of line.matchAll(/M(\d+)/g)) {
      if (m[1] === '3') spindle = true
      if (m[1] === '5') spindle = false
      if (m[1] === '6') toolChanges++
    }
    const gs = [...line.matchAll(/G(\d+)/g)].map((m) => Number(m[1]))
    for (const g of gs) if (g <= 3) mode = g
    if ('F' in w) f = w.F
    if (!('X' in w || 'Y' in w || 'Z' in w)) return
    const nx = w.X ?? x, ny = w.Y ?? y, nz = w.Z ?? z
    let len = Math.hypot(nx - x, ny - y, nz - z)
    if (mode === 2 || mode === 3) {
      const cx = x + (w.I ?? 0), cy = y + (w.J ?? 0), rad = Math.hypot(x - cx, y - cy)
      let a0 = Math.atan2(y - cy, x - cx), a1 = Math.atan2(ny - cy, nx - cx)
      if (mode === 2 && a1 >= a0) a1 -= 2 * Math.PI
      if (mode === 3 && a1 <= a0) a1 += 2 * Math.PI
      if (Math.abs(Math.hypot(nx - cx, ny - cy) - rad) > 0.01) errors.push(`line ${i + 1}: arc end not on its circle`)
      len = Math.abs(a1 - a0) * rad
      for (let k = 0; k <= 16; k++) grow(cx + rad * Math.cos(a0 + ((a1 - a0) * k) / 16), cy + rad * Math.sin(a0 + ((a1 - a0) * k) / 16))
    }
    if (mode === 0) {
      fast += len
      secs += (len / rapid) * 60
      if (Math.min(z, nz) < -1e-9 && (nx !== x || ny !== y)) errors.push(`line ${i + 1}: rapid move below Z0`)
    } else {
      if (!f) errors.push(`line ${i + 1}: cutting move without a feed`)
      if (!spindle) errors.push(`line ${i + 1}: cutting with the spindle stopped`)
      cut += len
      secs += (len / Math.max(f, 1)) * 60
    }
    grow(nx, ny)
    x = nx
    y = ny
    z = nz
    minZ = Math.min(minZ, z)
  })
  if (minZ < -maxDepth - 1e-6) errors.push(`depth ${minZ.toFixed(3)} below the allowed −${maxDepth}`)
  if (b.x0 < -margin || b.y0 < -margin || b.x1 > sheet.l + margin || b.y1 > sheet.w + margin) errors.push(`moves leave the sheet: X ${b.x0.toFixed(1)}…${b.x1.toFixed(1)}, Y ${b.y0.toFixed(1)}…${b.y1.toFixed(1)}`)
  return { lines: lines.length, cutLength: cut, rapidLength: fast, minZ, bounds: b, seconds: secs + toolChanges * 20, errors }
}
