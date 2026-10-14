/**
 * Quantities from MEP drawings (mặt bằng điện, cấp thoát nước, điều hoà), read by code:
 *  - layers by name (AIA "E-LIGHT", "P-CW", "M-AC" and Vietnamese ones "ĐÈN", "Ổ CẮM", "CẤP NƯỚC"…);
 *  - each plan: the MEP entities grouped by place, its title under it ("MẶT BẰNG ĐIỆN … TẦNG 1",
 *    "MẶT BẰNG CẤP THOÁT NƯỚC TẦNG 2") — the level by its name; schematics ("SƠ ĐỒ …") are left out;
 *  - devices (lights, switches, sockets, panels, air conditioners, fans, plumbing fixtures and drains): one symbol
 *    = one group of touching entities on the layer, at most 1.5 m across; an air conditioner takes the capacity
 *    written next to it ("ĐH 24k");
 *  - runs (wiring, pipes): the length of the lines drawn on the plan; a pipe takes the diameter written along it
 *    ("D110", "OĐ1 D110"), else "—". Vertical runs (risers, drops to switches and sockets) are not on a plan and
 *    are not counted: said on the lines.
 */
import type { CadDocument, Entity } from '../cad/types'
import { boxOf, norm, segsOf, type Box } from '../bim/fromCad'

export type MepRole = 'light' | 'switch' | 'socket' | 'panel' | 'wire' | 'ac' | 'fan' | 'lps' | 'cold' | 'hot' | 'waste' | 'sewer' | 'storm' | 'vent' | 'fixture' | 'text' | 'ignore'
const DEVICES: MepRole[] = ['light', 'switch', 'socket', 'panel', 'ac', 'fan', 'lps', 'fixture']
const RUNS: MepRole[] = ['wire', 'cold', 'hot', 'waste', 'sewer', 'storm', 'vent']
const PIPES: MepRole[] = ['cold', 'hot', 'waste', 'sewer', 'storm', 'vent']

export function mepRole(layer: string): MepRole {
  const n = norm(layer)
  if (/(DIM|KICH THUOC|ARCH|KIEN TRUC|SCHEM|SO DO|GRID|TRUC)/.test(n)) return 'ignore'
  if (/(TEXT|TXT|CHU|TAG)/.test(n)) return 'text'
  const e = /^(E|EL|ELEC|DIEN)\b/.test(n) || /\b(DIEN|ELECTRIC)\b/.test(n)
  const p = /^(P|PL|PLUMB|NUOC|CTN)\b/.test(n) || /\b(NUOC|PLUMBING)\b/.test(n)
  const mm = /^(M|MECH|HVAC)\b/.test(n) || /\b(DIEU HOA|HVAC)\b/.test(n)
  if (e || /\b(DEN|CONG TAC|O CAM)\b/.test(n)) {
    if (/(LPS|CHONG SET|LIGHTNING)/.test(n)) return 'lps'
    if (/(LIGHT|\bDEN\b|CHIEU SANG|LAMP)/.test(n)) return 'light'
    if (/(SWITCH|CONG TAC)/.test(n)) return 'switch'
    if (/(POWER|SOCKET|O CAM|OUTLET)/.test(n)) return 'socket'
    if (/(PANEL|TU DIEN|\bDB\b|\bMDB\b)/.test(n)) return 'panel'
    if (/(CIRCUIT|WIRE|CABLE|\bDAY\b|\bCAP DIEN\b)/.test(n)) return 'wire'
    return 'ignore'
  }
  if (mm) {
    if (/(\bAC\b|DIEU HOA|SPLIT|FCU)/.test(n)) return 'ac'
    if (/(EXH|HUT|\bFAN\b|QUAT)/.test(n)) return 'fan'
    return 'ignore'
  }
  if (p) {
    if (/(EQUIP|THIET BI|TBVS|FIXT|PHEU)/.test(n)) return 'fixture'
    if (/(\bHW\b|NONG|\bHOT\b)/.test(n)) return 'hot'
    if (/(STORM|\bMUA\b|RAIN)/.test(n)) return 'storm'
    if (/(VENT|THONG HOI)/.test(n)) return 'vent'
    if (/(\bSAN\b|SEWER|SOIL|\bPHAN\b)/.test(n)) return 'sewer'
    if (/(WASTE|THAI|\bXAM\b|DRAIN)/.test(n)) return 'waste'
    if (/(\bCW\b|COLD|LANH|\bCAP\b|SUPPLY)/.test(n)) return 'cold'
  }
  return 'ignore'
}

export interface MepPlan { title: string; level: string | null; kind: 'electrical' | 'plumbing' | 'mixed' }
export interface MepRow {
  key: string
  role: MepRole
  /** diameter of a pipe (mm), capacity of an air conditioner ("24k") */
  size: string | null
  byLevel: Record<string, number>
  total: number
  unit: 'pcs' | 'm'
}
export interface MepResult { file: string; plans: MepPlan[]; rows: MepRow[] }

type Txt = Extract<Entity, { kind: 'text' }>
const near = (a: Box, b: Box, pad: number) => a.x0 - pad <= b.x1 && b.x0 - pad <= a.x1 && a.y0 - pad <= b.y1 && b.y0 - pad <= a.y1
const grow = (b: Box, o: Box) => ({ x0: Math.min(b.x0, o.x0), y0: Math.min(b.y0, o.y0), x1: Math.max(b.x1, o.x1), y1: Math.max(b.y1, o.y1) })
const inBox = (p: { x: number; y: number }, b: Box, pad = 0) => p.x >= b.x0 - pad && p.x <= b.x1 + pad && p.y >= b.y0 - pad && p.y <= b.y1 + pad

export const hasMep = (doc: CadDocument) => doc.entities.some((e) => { const r = mepRole(e.layer); return DEVICES.includes(r) || RUNS.includes(r) })

/** Groups of entities close to each other (boxes within `pad`), merged as they meet. */
function cluster(ents: Entity[], pad: number): { box: Box; ents: Entity[] }[] {
  const out: { box: Box; ents: Entity[] }[] = []
  for (const e of ents) {
    const b = boxOf(e)
    const hit = out.filter((g) => near(g.box, b, pad))
    if (!hit.length) { out.push({ box: b, ents: [e] }); continue }
    const g0 = hit[0]
    g0.box = grow(g0.box, b)
    g0.ents.push(e)
    for (const g of hit.slice(1)) { g0.box = grow(g0.box, g.box); g0.ents.push(...g.ents); out.splice(out.indexOf(g), 1) }
  }
  return out
}

/** Level names: "TẦNG 2" → the given level of that number, "MÁI" → the roof name, else as written. */
export function readMep(doc: CadDocument, levelNames: string[], roofName: string): MepResult {
  const role = new Map<string, MepRole>()
  const R = (l: string) => { let r = role.get(l); if (!r) { r = mepRole(l); role.set(l, r) } return r }
  const texts = doc.entities.filter((e): e is Txt => e.kind === 'text')
  const geo = doc.entities.filter((e) => e.kind !== 'text' && (DEVICES.includes(R(e.layer)) || RUNS.includes(R(e.layer))))
  // small groups first, each given to the plan title nearest under it; a group under no title (a schematic) is left
  const titles = texts.filter((t) => { const n = norm(t.value); return /MAT BANG/.test(n) && !/SO DO/.test(n) })
  const byTitle = new Map<Txt, { box: Box; ents: Entity[] }>()
  for (const c of cluster(geo, 1000)) {
    let best: Txt | null = null, bd = Infinity
    for (const t of titles) {
      if (t.p.y > c.box.y0 + 200 || t.p.y < c.box.y0 - 25000 || t.p.x < c.box.x0 - 12000 || t.p.x > c.box.x1 + 12000) continue
      const d = (c.box.y0 - t.p.y) + Math.max(0, Math.abs(t.p.x - (c.box.x0 + c.box.x1) / 2) - 6000)
      if (d < bd) { bd = d; best = t }
    }
    if (!best) continue
    const g = byTitle.get(best)
    if (g) { g.box = grow(g.box, c.box); g.ents.push(...c.ents) } else byTitle.set(best, { box: c.box, ents: [...c.ents] })
  }
  const plans: MepPlan[] = []
  const rows = new Map<string, MepRow>()
  const add = (r: MepRole, size: string | null, level: string, q: number, unit: 'pcs' | 'm') => {
    if (!(q > 0)) return
    const key = `mep:${r}${size ? `:${size}` : ''}`
    const row = rows.get(key) ?? { key, role: r, size, byLevel: {}, total: 0, unit }
    row.byLevel[level] = (row.byLevel[level] ?? 0) + q
    row.total += q
    rows.set(key, row)
  }
  for (const [title, g] of byTitle) {
    const tn = norm(title.value)
    const num = /TANG\s*(\d+)/.exec(tn)
    const level = num ? (levelNames.find((l) => new RegExp(`\\b${num[1]}\\b`).test(norm(l))) ?? `Tầng ${num[1]}`) : /\bMAI\b|ROOF/.test(tn) ? roofName : null
    const roles = new Set(g.ents.map((e) => R(e.layer)))
    plans.push({ title: title.value, level, kind: [...roles].some((r) => PIPES.includes(r) || r === 'fixture') ? ([...roles].some((r) => ['light', 'switch', 'socket', 'wire'].includes(r)) ? 'mixed' : 'plumbing') : 'electrical' })
    const lv = level ?? title.value
    // devices: symbols on their layers
    for (const r of DEVICES) {
      const sym = cluster(g.ents.filter((e) => R(e.layer) === r), 60).filter((c) => c.box.x1 - c.box.x0 <= 1500 && c.box.y1 - c.box.y0 <= 1500)
      if (r !== 'ac') { add(r, null, lv, sym.length, 'pcs'); continue }
      // air conditioners by the capacity written next to them
      for (const c of sym) {
        const cx = (c.box.x0 + c.box.x1) / 2, cy = (c.box.y0 + c.box.y1) / 2
        let cap: string | null = null, bd = 1500
        for (const t of texts) { const m = /(\d{1,2})\s*K\b/i.exec(t.value); if (!m) continue; const d = Math.hypot(t.p.x - cx, t.p.y - cy); if (d < bd) { bd = d; cap = `${m[1]}k` } }
        add('ac', cap, lv, 1, 'pcs')
      }
    }
    // runs: their drawn length. A diameter written on the plan belongs to the pipe nearest to it (within 400 mm);
    // a pipe with no label of its own is "—"
    const labels = texts.filter((t) => inBox(t.p, g.box, 500)).flatMap((t) => { const m = /\bD\s?(\d{2,3})\b/.exec(t.value); return m ? [{ p: t.p, d: m[1] }] : [] })
    const pipes = g.ents.filter((e) => PIPES.includes(R(e.layer)) && (e.kind === 'line' || e.kind === 'polyline'))
    const sizeOf = new Map<Entity, string>()
    for (const l of labels) {
      let best: Entity | null = null, bd = 400
      for (const e of pipes) for (const [p, q] of segsOf(e)) {
        const dx = q.x - p.x, dy = q.y - p.y, L2 = dx * dx + dy * dy || 1
        const t = Math.max(0, Math.min(1, ((l.p.x - p.x) * dx + (l.p.y - p.y) * dy) / L2))
        const d = Math.hypot(l.p.x - (p.x + dx * t), l.p.y - (p.y + dy * t))
        if (d < bd) { bd = d; best = e }
      }
      if (best && !sizeOf.has(best)) sizeOf.set(best, l.d)
    }
    for (const e of g.ents) {
      const r = R(e.layer)
      if (!RUNS.includes(r) || (e.kind !== 'line' && e.kind !== 'polyline')) continue
      const L = segsOf(e).reduce((a, [p, q]) => a + Math.hypot(q.x - p.x, q.y - p.y), 0) / 1000
      add(r, PIPES.includes(r) ? (sizeOf.get(e) ?? null) : null, lv, L, 'm')
    }
  }
  const order: MepRole[] = ['panel', 'light', 'switch', 'socket', 'wire', 'lps', 'ac', 'fan', 'cold', 'hot', 'waste', 'sewer', 'storm', 'vent', 'fixture']
  return { file: doc.name, plans, rows: [...rows.values()].sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role) || Number(a.size?.replace(/\D/g, '') ?? 0) - Number(b.size?.replace(/\D/g, '') ?? 0)) }
}
