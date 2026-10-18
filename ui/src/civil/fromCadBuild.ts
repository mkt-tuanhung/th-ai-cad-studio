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

/**
 * Bottom width and inner side slope (H per 1 V) of a drawn design line: the flat stretch at its lowest level, and
 * from each bottom edge to the next vertex outwards ALONG THE LINE — a vertical wall (two points at one offset)
 * gives 0, not the slope to the far bank.
 */
export function typicalOf(design: [number, number][]): { b: number; m: number } | null {
  if (design.length < 4) return null
  const zMin = Math.min(...design.map(([, z]) => z))
  const flat = (i: number) => design[i][1] - zMin < 0.02
  // the bottom: the run of consecutive low vertices with the largest width
  let best: [number, number] | null = null
  for (let i = 0; i < design.length; i++) {
    if (!flat(i)) continue
    let j = i
    while (j + 1 < design.length && flat(j + 1)) j++
    if (j > i && (!best || design[j][0] - design[i][0] > design[best[1]][0] - design[best[0]][0])) best = [i, j]
    i = j
  }
  if (!best) return null
  const [i0, i1] = best
  const o0 = design[i0][0], o1 = design[i1][0]
  const slope = (top: [number, number] | undefined, dx: number) => (top && top[1] > zMin && dx >= -1e-6 ? Math.max(0, dx) / (top[1] - zMin) : NaN)
  const left = design[i0 - 1], right = design[i1 + 1]
  const ms = [slope(left, left ? o0 - left[0] : 0), slope(right, right ? right[0] - o1 : 0)].filter((x) => Number.isFinite(x))
  return { b: o1 - o0, m: ms.length ? ms.reduce((a, x) => a + x, 0) / ms.length : NaN }
}

const profile = (pts: [number, number | undefined][]): Profile => {
  const out: Profile = []
  for (const [s, z] of pts.sort((a, b) => a[0] - b[0])) if (z !== undefined && Number.isFinite(z) && (!out.length || s > out[out.length - 1][0])) out.push([s, z])
  return out
}

/**
 * The Civil model of a route. Without a design line (no design invert in the long profile and no drawn design
 * line) the invert stays empty: validateCivil refuses such a model and the dialog does not offer it (it asks for
 * the layer of the design line) — nothing is invented.
 */
export function buildCivilModel(base: CivilModel, route: Route, file: string): CivilModel {
  const secs: DrawnSection[] = route.sections
    .filter((s) => s.station !== null)
    .map((s) => ({
      name: s.name,
      station: s.station!,
      ground: s.ground,
      design: s.design,
      ...(s.channel ? { channel: s.channel } : {}),
      cut: Math.round(s.cut * 1000) / 1000,
      fill: Math.round(s.fill * 1000) / 1000,
      // the designer's areas: the totals, and the split by machine / by hand when written (for the estimate)
      ...(s.drawn ? { drawn: Object.fromEntries(Object.entries(s.drawn).filter(([, v]) => v !== undefined)) as NonNullable<DrawnSection['drawn']> } : {}),
    }))
  const zAt0 = (pts: [number, number][]) => {
    for (let i = 1; i < pts.length; i++) if (pts[i - 1][0] <= 0 && pts[i][0] >= 0) return pts[i - 1][1] + ((pts[i][1] - pts[i - 1][1]) * -pts[i - 1][0]) / Math.max(1e-9, pts[i][0] - pts[i - 1][0])
    return undefined
  }
  let invert = profile(route.stakes.map((k) => [k.station, k.invert]))
  if (invert.length < 2) invert = profile(secs.map((s) => [s.station, s.design.length ? Math.min(...s.design.map(([, z]) => z)) : undefined]))
  let ground = profile(route.stakes.map((k) => [k.station, k.ground]))
  if (ground.length < 2) ground = profile(secs.map((s) => [s.station, zAt0(s.ground)]))
  // measured on the water face of a lined canal, else on the design line
  const typ = secs.map((s) => typicalOf(s.channel ?? s.design)).filter((t): t is { b: number; m: number } => !!t)
  const b = median(typ.map((t) => t.b)), m = median(typ.map((t) => t.m).filter(Number.isFinite))
  const stations = [...invert.map(([s]) => s), ...secs.map((s) => s.station), ...route.stakes.map((k) => k.station)]
  const start = stations.length ? Math.min(...stations) : 0, end = stations.length ? Math.max(...stations) : 0
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
