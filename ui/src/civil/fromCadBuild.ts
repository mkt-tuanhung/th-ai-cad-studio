/**
 * Civil model of one route read from a drawing (src/civil/fromCad.ts): alignment by chainage, existing ground and
 * design invert from the long profile, design banks, the drawn cross sections with their computed areas, and the
 * typical section (bottom width, side slope) measured on the drawn design lines. The plan geometry of the route is
 * not in a long profile / cross-section set, so the alignment is straight by chainage until a survey alignment is
 * imported. Committed by the caller as ONE undoable edit.
 */
import type { CivilModel, DrawnSection, Profile } from './model'
import type { Route } from './fromCad'

const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN }

/** Bottom width and inner side slope of a drawn design line (the flat stretch at its lowest level). */
export function typicalOf(design: [number, number][]): { b: number; m: number } | null {
  if (design.length < 4) return null
  const zMin = Math.min(...design.map(([, z]) => z))
  const flat = design.filter(([, z]) => z - zMin < 0.02)
  if (flat.length < 2) return null
  const o0 = Math.min(...flat.map(([o]) => o)), o1 = Math.max(...flat.map(([o]) => o))
  // the inner slopes: from the bottom edges up to the next vertex outwards
  const left = design.filter(([o]) => o < o0 - 1e-6).sort((a, b) => b[0] - a[0])[0]
  const right = design.filter(([o]) => o > o1 + 1e-6).sort((a, b) => a[0] - b[0])[0]
  const ms = [left && left[1] > zMin ? (o0 - left[0]) / (left[1] - zMin) : NaN, right && right[1] > zMin ? (right[0] - o1) / (right[1] - zMin) : NaN].filter((x) => Number.isFinite(x))
  return { b: o1 - o0, m: ms.length ? ms.reduce((a, x) => a + x, 0) / ms.length : NaN }
}

const profile = (pts: [number, number | undefined][]): Profile => {
  const out: Profile = []
  for (const [s, z] of pts.sort((a, b) => a[0] - b[0])) if (z !== undefined && Number.isFinite(z) && (!out.length || s > out[out.length - 1][0])) out.push([s, z])
  return out
}

export function buildCivilModel(base: CivilModel, route: Route, file: string): CivilModel {
  const secs: DrawnSection[] = route.sections
    .filter((s) => s.station !== null)
    .map((s) => ({
      name: s.name,
      station: s.station!,
      ground: s.ground,
      design: s.design,
      cut: Math.round(s.cut * 1000) / 1000,
      fill: Math.round(s.fill * 1000) / 1000,
      ...(s.drawn ? { drawn: { cut: s.drawn.cut, fill: (s.drawn.fill ?? 0) + (s.drawn.fillMachine ?? 0) + (s.drawn.fillManual ?? 0) } } : {}),
    }))
  const zAt0 = (pts: [number, number][]) => {
    for (let i = 1; i < pts.length; i++) if (pts[i - 1][0] <= 0 && pts[i][0] >= 0) return pts[i - 1][1] + ((pts[i][1] - pts[i - 1][1]) * -pts[i - 1][0]) / Math.max(1e-9, pts[i][0] - pts[i - 1][0])
    return undefined
  }
  let invert = profile(route.stakes.map((k) => [k.station, k.invert]))
  if (invert.length < 2) invert = profile(secs.map((s) => [s.station, s.design.length ? Math.min(...s.design.map(([, z]) => z)) : undefined]))
  let ground = profile(route.stakes.map((k) => [k.station, k.ground]))
  if (ground.length < 2) ground = profile(secs.map((s) => [s.station, zAt0(s.ground)]))
  const typ = secs.map((s) => typicalOf(s.design)).filter((t): t is { b: number; m: number } => !!t)
  const b = median(typ.map((t) => t.b)), m = median(typ.map((t) => t.m).filter(Number.isFinite))
  const stations = [...invert.map(([s]) => s), ...secs.map((s) => s.station)]
  const start = Math.min(...stations), end = Math.max(...stations)
  const name = route.name.replace(/[,;]?\s*l\s*=.*$/i, '').trim() || route.name
  return {
    alignment: { name, type: 'Centerline Alignment', description: route.name, start, end, site: file },
    params: {
      ...base.params,
      bottomWidth: Number.isFinite(b) ? Math.min(50, Math.max(0.5, Math.round(b * 100) / 100)) : base.params.bottomWidth,
      sideSlope: Number.isFinite(m) ? Math.min(5, Math.max(0, Math.round(m * 100) / 100)) : base.params.sideSlope,
    },
    invert,
    ground,
    culverts: [],
    sections: secs,
    banks: { left: profile(route.stakes.map((k) => [k.station, k.leftDes])), right: profile(route.stakes.map((k) => [k.station, k.rightDes])) },
    source: { file, route: route.name },
  }
}
