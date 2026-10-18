/**
 * 3-axis 2.5D CAM for a feature part (one top setup): face the stock, rough the material around each
 * XY "add" extrude level by zig-zag rows clipped against the part outline (tool-radius offset) and finish
 * the outline, pocket XY "cut" extrudes, drill holes (explicit peck moves — no canned cycles, so any
 * controller and the independent simulator read them), helical-mill holes larger than the biggest drill
 * and counterbores. Machine zero: stock lower-left corner, Z0 = stock top. Speeds from the material.
 * Tool changes: ISO with an ATC writes `T n M6` + `G0 G43 H n Z…` after every change; ISO without an ATC stops
 * with M0 and an operator message, then `G43 H n`; GRBL (no M6 / G43) writes one program per tool, each starting
 * with M0 + "load the tool, zero Z on the stock top". Operations the selected machine cannot do are listed as
 * not machined instead of being written. The output is an UNVERIFIED engineering preview (cam/release.ts).
 */
import { simulate, type SimResult } from '../cam/gcode'
import type { OperationKind } from '../cam/machine'
import { holeInstances, shapeBounds, stockOf, type Part, type SketchShape } from './part'

export interface PartCamSettings {
  dialect: 'iso' | 'grbl'
  millD: number
  stepover: number // fraction of the mill Ø
  stepdown: number // mm
  safeZ: number
  /** Leave on walls and floors for the finishing pass (mm). */
  finishAllowance: number
  /** The machine has a verified tool changer (ISO only; default true = the old behaviour). */
  atc?: boolean
  /** Machine capability: why an operation cannot be done (null = it can). */
  allow?: (op: OperationKind) => string | null
}
export const DEFAULT_PART_CAM: PartCamSettings = { dialect: 'iso', millD: 10, stepover: 0.45, stepdown: 2, safeZ: 5, finishAllowance: 0.2 }

const DRILLS = [3, 3.3, 4, 4.2, 5, 5.5, 6, 6.8, 8, 8.5, 9, 10, 10.2, 11, 12, 13]

/** Cutting speed (m/min) and feed per tooth (mm, for a Ø10 carbide 3-flute) by material. */
function cutData(material: string): { vc: number; fz: number; drillVc: number } {
  if (/stainless|duplex/i.test(material)) return { vc: 90, fz: 0.04, drillVc: 15 }
  if (/cast iron/i.test(material)) return { vc: 120, fz: 0.06, drillVc: 25 }
  if (/bronze/i.test(material)) return { vc: 180, fz: 0.06, drillVc: 35 }
  if (/alumin/i.test(material)) return { vc: 400, fz: 0.08, drillVc: 80 }
  return { vc: 140, fz: 0.05, drillVc: 25 } // carbon steel
}

type P2 = [number, number]

/** Closed outline of a sketch shape grown by d (arcs as 48-segment polylines; rect corners rounded by cornerR + d). */
export function outline(s: SketchShape, d: number, cornerR = 0): P2[] {
  const arc = (cx: number, cy: number, r: number, a0: number, a1: number, n = 12): P2[] => Array.from({ length: n + 1 }, (_, i) => [cx + r * Math.cos(a0 + ((a1 - a0) * i) / n), cy + r * Math.sin(a0 + ((a1 - a0) * i) / n)] as P2)
  if (s.t === 'circle') return arc(s.x, s.y, s.r + d, 0, 2 * Math.PI, 48).slice(0, -1)
  if (s.t === 'rect') {
    const r = Math.max(0, Math.min(cornerR, s.w / 2, s.h / 2)) + d
    const x0 = s.x + r - d, x1 = s.x + s.w - r + d, y0 = s.y + r - d, y1 = s.y + s.h - r + d
    if (r <= 1e-9) return [[s.x - d, s.y - d], [s.x + s.w + d, s.y - d], [s.x + s.w + d, s.y + s.h + d], [s.x - d, s.y + s.h + d]]
    return [...arc(x1, y0, r, -Math.PI / 2, 0), ...arc(x1, y1, r, 0, Math.PI / 2), ...arc(x0, y1, r, Math.PI / 2, Math.PI), ...arc(x0, y0, r, Math.PI, 1.5 * Math.PI)]
  }
  if (s.t === 'slot') {
    const a = (s.angle * Math.PI) / 180, L = s.w / 2
    const c1: P2 = [s.x + Math.cos(a) * L, s.y + Math.sin(a) * L], c2: P2 = [s.x - Math.cos(a) * L, s.y - Math.sin(a) * L]
    return [...arc(c1[0], c1[1], s.r + d, a - Math.PI / 2, a + Math.PI / 2, 24), ...arc(c2[0], c2[1], s.r + d, a + Math.PI / 2, a + 1.5 * Math.PI, 24)]
  }
  // polygon: offset each vertex along its bisector (counter-clockwise outline grows outwards)
  const pts = s.pts, n = pts.length
  const area = pts.reduce((acc, p, i) => acc + p[0] * pts[(i + 1) % n][1] - pts[(i + 1) % n][0] * p[1], 0)
  const sgn = area >= 0 ? 1 : -1
  return pts.map((p, i) => {
    const a = pts[(i + n - 1) % n], b = pts[(i + 1) % n]
    const n1 = norm([(p[1] - a[1]) * sgn, -(p[0] - a[0]) * sgn]), n2 = norm([(b[1] - p[1]) * sgn, -(b[0] - p[0]) * sgn])
    const m = norm([n1[0] + n2[0], n1[1] + n2[1]])
    const k = d / Math.max(0.2, m[0] * n1[0] + m[1] * n1[1])
    return [p[0] + m[0] * k, p[1] + m[1] * k] as P2
  })
}
const norm = (v: P2): P2 => {
  const l = Math.hypot(v[0], v[1]) || 1
  return [v[0] / l, v[1] / l]
}

/** x-intervals of a horizontal line inside a polygon. */
function crossings(poly: P2[], y: number): number[] {
  const xs: number[] = []
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [x1, y1] = poly[j], [x2, y2] = poly[i]
    if ((y1 > y) !== (y2 > y)) xs.push(x1 + ((y - y1) * (x2 - x1)) / (y2 - y1))
  }
  return xs.sort((a, b) => a - b)
}
function inside(poly: P2[], y: number): [number, number][] {
  const xs = crossings(poly, y)
  const out: [number, number][] = []
  for (let i = 0; i + 1 < xs.length; i += 2) out.push([xs[i], xs[i + 1]])
  return out
}
/** [a, b] minus the union of intervals. */
function subtract(a: number, b: number, cuts: [number, number][]): [number, number][] {
  let segs: [number, number][] = [[a, b]]
  for (const [c0, c1] of cuts) {
    const next: [number, number][] = []
    for (const [s0, s1] of segs) {
      if (c1 <= s0 || c0 >= s1) next.push([s0, s1])
      else {
        if (c0 > s0) next.push([s0, c0])
        if (c1 < s1) next.push([c1, s1])
      }
    }
    segs = next
  }
  return segs.filter(([s0, s1]) => s1 - s0 > 0.05)
}

export interface CamOp {
  name: string
  tool: string
  zTop: number
  zBottom: number
  lengthMm: number
}

export interface PartCamResult {
  /** All programs, in order (one per tool on GRBL). */
  gcode: string
  programs: { name: string; text: string; tool: number }[]
  /** Operations left out because the machine cannot do them. */
  skipped: { op: OperationKind; name: string; reason: string }[]
  ops: CamOp[]
  tools: { n: number; name: string; d: number; rpm: number; feed: number }[]
  stock: { x: number; y: number; z: number }
  sim: SimResult
  /** Tool-centre paths for the preview (stock coordinates, mm). */
  paths: { tool: number; pts: P2[]; z: number }[]
}

export function partCam(p: Part, s: PartCamSettings = DEFAULT_PART_CAM): PartCamResult | { error: string } {
  const st = stockOf(p)
  if (!st) return { error: 'no XY extrude to machine' }
  const allow = s.allow ?? (() => null)
  const millWhy = allow('PROFILE') ?? allow('POCKET')
  if (millWhy) return { error: `machine cannot mill: ${millWhy}` }
  const skipped: PartCamResult['skipped'] = []
  const [sx0, sy0, , sx1, sy1, sz1] = st
  const sz0 = st[2]
  const X = (x: number) => x - sx0, Y = (y: number) => y - sy0, Z = (z: number) => z - sz1
  const cd = cutData(p.material)
  const R = s.millD / 2
  const rpmMill = Math.min(18000, Math.round((cd.vc * 1000) / (Math.PI * s.millD)))
  const feedMill = Math.round(cd.fz * (s.millD / 10) * 3 * rpmMill)
  const tools: PartCamResult['tools'] = [{ n: 1, name: `Flat end mill Ø${s.millD} carbide 3F`, d: s.millD, rpm: rpmMill, feed: feedMill }]
  const ops: CamOp[] = []
  const paths: PartCamResult['paths'] = []
  const progs: { tool: number; lines: string[] }[] = []
  let out: string[] = []
  const f3 = (n: number) => (Math.round(n * 1000) / 1000).toFixed(3).replace(/\.?0+$/, '') || '0'
  const header = () => ['%', `(MD CAD AI STUDIO — ${p.name} — ${p.material})`, `(stock ${f3(sx1 - sx0)} x ${f3(sy1 - sy0)} x ${f3(sz1 - sz0)} mm, zero = stock lower-left, Z0 = stock top)`, 'G21 G90 G17 G94']
  const atc = s.dialect === 'iso' && s.atc !== false
  let len = 0, cur: [number, number, number] = [0, 0, s.safeZ]
  const g0 = (x?: number, y?: number, z?: number) => {
    out.push(`G0${x !== undefined ? ` X${f3(x)}` : ''}${y !== undefined ? ` Y${f3(y)}` : ''}${z !== undefined ? ` Z${f3(z)}` : ''}`)
    cur = [x ?? cur[0], y ?? cur[1], z ?? cur[2]]
  }
  const g1 = (x: number | undefined, y: number | undefined, z: number | undefined, f: number) => {
    const nx = x ?? cur[0], ny = y ?? cur[1], nz = z ?? cur[2]
    len += Math.hypot(nx - cur[0], ny - cur[1], nz - cur[2])
    out.push(`G1${x !== undefined ? ` X${f3(x)}` : ''}${y !== undefined ? ` Y${f3(y)}` : ''}${z !== undefined ? ` Z${f3(z)}` : ''} F${Math.round(f)}`)
    cur = [nx, ny, nz]
  }
  const toolChange = (n: number, name: string, rpm: number) => {
    if (s.dialect === 'grbl') {
      // GRBL: a new program per tool (Z cannot be re-zeroed while a program is held)
      if (progs.length) out.push('M5', `G0 Z${f3(s.safeZ)}`, 'M30', '%')
      out = [...header(), `(T${n} ${name})`, `M0 (LOAD T${n} ${name}, ZERO Z ON THE STOCK TOP, THEN CYCLE START)`]
      progs.push({ tool: n, lines: out })
    } else {
      if (!progs.length) {
        out = header()
        progs.push({ tool: n, lines: out })
      } else out.push('M5', `G0 Z${f3(s.safeZ)}`)
      out.push(`(T${n} ${name})`)
      if (atc) out.push(`T${n} M6`)
      else out.push(`M0 (LOAD T${n} ${name}, SET TOOL LENGTH H${n}, THEN CYCLE START)`)
    }
    out.push(`S${rpm} M3`)
    if (s.dialect === 'iso') {
      out.push(`G0 G43 H${n} Z${f3(s.safeZ)}`)
      cur = [cur[0], cur[1], s.safeZ]
    } else g0(undefined, undefined, s.safeZ)
  }
  const passes = (top: number, bottom: number) => {
    const n = Math.max(1, Math.ceil((top - bottom) / s.stepdown - 1e-9))
    return Array.from({ length: n }, (_, i) => top - ((top - bottom) * (i + 1)) / n)
  }
  /** Follow a closed outline at depth z; rapid only down to 1 mm above `from` (the uncut surface there), then feed. */
  const contour = (pts: P2[], z: number, f: number, tool: number, from = z) => {
    g0(undefined, undefined, s.safeZ)
    g0(X(pts[0][0]), Y(pts[0][1]))
    g0(undefined, undefined, Math.min(s.safeZ, from + 1))
    g1(undefined, undefined, z, f * 0.4)
    for (const q of [...pts.slice(1), pts[0]]) g1(X(q[0]), Y(q[1]), undefined, f)
    paths.push({ tool, pts: [...pts, pts[0]].map((q) => [X(q[0]), Y(q[1])]), z })
  }

  toolChange(1, tools[0].name, rpmMill)

  // ---- 1. face the stock top down to the highest part surface
  const levels = p.features
    .filter((f): f is Extract<typeof f, { kind: 'extrude' }> => !f.suppressed && f.kind === 'extrude' && f.op === 'add')
    .map((f) => {
      const sk = p.sketches.find((k) => k.id === f.sketch)!
      const z0 = sk.offset + (f.reverse ? -f.depth : 0) - (f.symmetric ? f.depth / 2 : 0)
      return { f, sk, z0, z1: z0 + f.depth }
    })
    .filter((l) => l.sk && l.sk.plane === 'XY')
  const partTop = Math.max(...levels.map((l) => l.z1))
  const vertR = Math.max(0, ...p.features.filter((f) => !f.suppressed && f.kind === 'fillet' && (f.edges === 'vertical' || f.edges === 'all')).map((f) => (f.kind === 'fillet' ? f.r : 0)))
  if (sz1 - partTop > 0.01) {
    const l0 = len
    const zf = Z(partTop)
    const step = s.millD * 0.7
    let dir = 1
    for (let y = sy0 + R * 0.5; y <= sy1 + R * 0.5; y += step) {
      const xa = dir > 0 ? sx0 - R - 1 : sx1 + R + 1, xb = dir > 0 ? sx1 + R + 1 : sx0 - R - 1
      if (y === sy0 + R * 0.5) (g0(X(xa), Y(y)), g0(undefined, undefined, zf + 1), g1(undefined, undefined, zf, feedMill * 0.4))
      else g1(X(xa), Y(y), undefined, feedMill)
      g1(X(xb), undefined, undefined, feedMill)
      paths.push({ tool: 1, pts: [[X(xa), Y(y)], [X(xb), Y(y)]], z: zf })
      dir = -dir
    }
    g0(undefined, undefined, s.safeZ)
    ops.push({ name: 'Face', tool: 'T1', zTop: 0, zBottom: zf, lengthMm: len - l0 })
  }

  // ---- 2. levels from the top: rough around the outline (zig-zag rows clipped to the outline + R), finish the outline
  for (const lv of [...levels].sort((a, b) => b.z1 - a.z1)) {
    const l0 = len
    const below = levels.filter((o) => o !== lv && o.z1 <= lv.z0 + 1e-6)
    // a level's material ends where the next lower level starts (its floor), else at the stock bottom
    const floor = below.length ? Math.max(...below.map((o) => o.z1)) : lv.z0
    if (floor >= Math.min(lv.z1, partTop) - 1e-6 && below.length) continue
    const corner = lv === levels[0] ? vertR : 0
    const keep = lv.sk.shapes.map((sh) => outline(sh, R + s.finishAllowance, corner))
    const fin = lv.sk.shapes.map((sh) => outline(sh, R, corner))
    // rapids go down only to 1 mm above the previous pass (the material there is still uncut below it)
    let zPrev = Z(Math.min(lv.z1, partTop))
    for (const z of passes(Math.min(lv.z1, partTop), floor)) {
      const zz = Z(z)
      const step = s.millD * s.stepover
      for (let y = sy0 - R * 0.5; y <= sy1 + R * 0.5 + 1e-6; y += step) {
        const cuts = keep.flatMap((k) => inside(k, y))
        for (const [a, b] of subtract(sx0 - R - 1, sx1 + R + 1, cuts)) {
          g0(undefined, undefined, s.safeZ)
          g0(X(a), Y(y))
          g0(undefined, undefined, zPrev + 1)
          g1(undefined, undefined, zz, feedMill * 0.4)
          g1(X(b), undefined, undefined, feedMill)
          paths.push({ tool: 1, pts: [[X(a), Y(y)], [X(b), Y(y)]], z: zz })
        }
      }
      zPrev = zz
    }
    // finish the outline at full depth in one pass per stepdown
    for (const z of passes(Math.min(lv.z1, partTop), floor)) for (const f of fin) contour(f, Z(z), feedMill * 0.8, 1, Z(Math.min(lv.z1, partTop)))
    g0(undefined, undefined, s.safeZ)
    ops.push({ name: `Profile ${lv.f.name}`, tool: 'T1', zTop: Z(Math.min(lv.z1, partTop)), zBottom: Z(floor), lengthMm: len - l0 })
  }

  const topAt = (x: number, y: number) => Math.max(...levels.filter((l) => l.sk.shapes.some((sh) => inside(outline(sh, 0, 0), y).some(([a, b]) => x >= a && x <= b))).map((l) => l.z1), sz0)

  // ---- 3. pockets from XY cut extrudes (zig-zag inside the outline − R, then the outline − R)
  for (const f of p.features) {
    if (f.suppressed || f.kind !== 'extrude' || f.op !== 'cut') continue
    const sk = p.sketches.find((k) => k.id === f.sketch)
    if (!sk || sk.plane !== 'XY') continue
    const l0 = len
    const zTop = f.through ? partTop : Math.min(partTop, sk.offset + (f.reverse ? 0 : f.depth))
    const zBot = f.through ? sz0 - 0.3 : sk.offset - (f.reverse ? f.depth : 0)
    // a pocket must open on the top surface over it, else it needs a second (flipped) setup
    const open = sk.shapes.every((sh) => {
      const [x0, y0, x1, y1] = shapeBounds(sh)
      return Math.abs(topAt((x0 + x1) / 2, (y0 + y1) / 2) - zTop) < 0.01
    })
    if (!open) {
      ops.push({ name: `Pocket ${f.name} — not open to the top: second setup`, tool: '—', zTop: Z(zTop), zBottom: Z(zBot), lengthMm: 0 })
      continue
    }
    for (const sh of sk.shapes) {
      const area = outline(sh, -(R + s.finishAllowance), vertR)
      const fin = outline(sh, -R)
      let zPrev = Z(zTop)
      for (const z of passes(zTop, zBot)) {
        const step = s.millD * s.stepover
        const ys = area.map((q) => q[1])
        for (let y = Math.min(...ys) + 0.01; y <= Math.max(...ys) - 0.01; y += step)
          for (const [a, b] of inside(area, y)) {
            g0(undefined, undefined, s.safeZ)
            g0(X(a), Y(y))
            g0(undefined, undefined, zPrev + 1)
            g1(undefined, undefined, Z(z), feedMill * 0.3)
            g1(X(b), undefined, undefined, feedMill)
            paths.push({ tool: 1, pts: [[X(a), Y(y)], [X(b), Y(y)]], z: Z(z) })
          }
        contour(fin, Z(z), feedMill * 0.8, 1, Z(zTop))
        zPrev = Z(z)
      }
    }
    g0(undefined, undefined, s.safeZ)
    ops.push({ name: `Pocket ${f.name}`, tool: 'T1', zTop: Z(zTop), zBottom: Z(zBot), lengthMm: len - l0 })
  }

  // ---- 4. holes: helical milling of bores ≥ the mill and counterbores with T1; drilling with the drills after
  const holes = holeInstances(p)
  const helix = (x: number, y: number, r: number, zTop: number, zBot: number) => {
    // tool centre on a circle of radius r − R, 1 mm descent per turn segment, full circle at the bottom
    const rc = r - R
    if (rc <= 0.05) return
    g0(undefined, undefined, s.safeZ)
    g0(X(x + rc), Y(y))
    g0(undefined, undefined, Z(zTop) + 1)
    const turns = Math.max(1, Math.ceil((zTop - zBot) / 1))
    const pts: P2[] = []
    for (let k = 1; k <= turns * 24; k++) {
      const a = (k / 24) * 2 * Math.PI
      g1(X(x + rc * Math.cos(a)), Y(y + rc * Math.sin(a)), Z(zTop - ((zTop - zBot) * k) / (turns * 24)), feedMill * 0.5)
      pts.push([X(x + rc * Math.cos(a)), Y(y + rc * Math.sin(a))])
    }
    for (let k = 1; k <= 24; k++) g1(X(x + rc * Math.cos((k / 24) * 2 * Math.PI)), Y(y + rc * Math.sin((k / 24) * 2 * Math.PI)), undefined, feedMill * 0.6)
    paths.push({ tool: 1, pts, z: Z(zBot) })
    g0(undefined, undefined, s.safeZ)
  }
  const maxDrill = DRILLS[DRILLS.length - 1]
  {
    const l0 = len
    let any = false
    for (const h of holes) {
      const top = topAt(h.x, h.y)
      const bot = h.f.through ? sz0 - 0.3 : top - h.f.depth
      if (h.f.dia > maxDrill && h.f.dia > s.millD + 0.5) (helix(h.x, h.y, h.f.dia / 2, top, bot), (any = true))
      if (h.f.cbDia && h.f.cbDepth && h.f.cbDia > s.millD + 0.5) (helix(h.x, h.y, h.f.cbDia / 2, top, top - h.f.cbDepth), (any = true))
    }
    if (any) ops.push({ name: 'Bores and counterbores (helical)', tool: 'T1', zTop: 0, zBottom: Z(sz0 - 0.3), lengthMm: len - l0 })
  }
  const drillHoles = holes.filter((h) => h.f.dia <= maxDrill)
  const sizes = [...new Set(drillHoles.map((h) => DRILLS.find((d) => d >= h.f.dia - 1e-6) ?? h.f.dia))].sort((a, b) => a - b)
  const drillWhy = allow('DRILL_VERTICAL')
  if (drillWhy)
    for (const d of sizes) {
      const name = `Drill Ø${d} (${drillHoles.filter((x) => (DRILLS.find((q) => q >= x.f.dia - 1e-6) ?? x.f.dia) === d).length})`
      skipped.push({ op: 'DRILL_VERTICAL', name, reason: drillWhy })
      ops.push({ name: `${name} — not machined: ${drillWhy}`, tool: '—', zTop: 0, zBottom: 0, lengthMm: 0 })
    }
  for (const d of drillWhy ? [] : sizes) {
    const n = tools.length + 1
    const rpm = Math.min(12000, Math.round((cd.drillVc * 1000) / (Math.PI * d)))
    const feed = Math.round(rpm * d * 0.02)
    tools.push({ n, name: `HSS-Co twist drill Ø${d}`, d, rpm, feed })
    toolChange(n, tools[n - 1].name, rpm)
    const l0 = len
    for (const h of drillHoles.filter((x) => (DRILLS.find((q) => q >= x.f.dia - 1e-6) ?? x.f.dia) === d)) {
      const top = topAt(h.x, h.y) - (h.f.cbDia && h.f.cbDepth ? h.f.cbDepth : 0)
      const bot = h.f.through ? sz0 - 0.3 - d * 0.3 : top - h.f.depth // through: tip clears the bottom
      g0(undefined, undefined, s.safeZ)
      g0(X(h.x), Y(h.y))
      // peck: 1 × Ø per peck, full retract to 1 mm above the start; the first approach stops 1 mm above the
      // part surface (a counterbore is cut by another tool / program: feed down through it, never rapid)
      const surf = topAt(h.x, h.y)
      let z = top, first = true
      while (z > bot + 1e-6) {
        z = Math.max(bot, z - d)
        g0(undefined, undefined, Z(first ? surf : top) + 1)
        first = false
        g1(undefined, undefined, Z(z), feed)
      }
      g0(undefined, undefined, s.safeZ)
      paths.push({ tool: n, pts: [[X(h.x), Y(h.y)]], z: Z(bot) })
    }
    ops.push({ name: `Drill Ø${d} (${drillHoles.filter((x) => (DRILLS.find((q) => q >= x.f.dia - 1e-6) ?? x.f.dia) === d).length})`, tool: `T${n}`, zTop: 0, zBottom: Z(sz0 - 0.3 - d * 0.3), lengthMm: len - l0 })
  }

  out.push('M5', 'G0 Z' + f3(s.safeZ), ...(s.dialect === 'iso' ? ['G49'] : []), 'M30', '%')
  const base = p.file.replace(/\.prt$/, '')
  const programs = progs.map((q) => ({ name: progs.length > 1 ? `${base} T${q.tool}.nc` : `${base}.nc`, text: q.lines.join('\n') + '\n', tool: q.tool }))
  const gcode = programs.map((q) => q.text).join('\n')
  const sim = simulate(gcode, { l: sx1 - sx0, w: sy1 - sy0 }, sz1 - sz0 + 0.3 + maxDrill * 0.3, R + 2, 6000)
  return { gcode, programs, skipped, ops, tools, stock: { x: sx1 - sx0, y: sy1 - sy0, z: sz1 - sz0 }, sim, paths }
}
