/**
 * Quantities (and a coordination model) from MEP drawings — electrical, plumbing, air conditioning, fire
 * protection, low-current — read by code:
 *  - layers by name (AIA "E-LIGHT", "P-CW", "M-AC", "F-DETECT", "L-CCTV" and Vietnamese ones "ĐÈN", "Ổ CẮM",
 *    "CẤP NƯỚC", "BÁO CHÁY", "CAMERA"…);
 *  - each plan: the MEP entities grouped by place, given to the plan title nearest under them ("MẶT BẰNG ĐIỆN …
 *    TẦNG 1", "MẶT BẰNG PCCC TẦNG 2") — the level by its name; schematics ("SƠ ĐỒ …") are left out;
 *  - devices: one symbol = one group of touching entities on the layer, at most 1.5 m across; an air conditioner
 *    takes the capacity written next to it ("ĐH 24k");
 *  - runs (wiring, pipes, low-current cables): the length drawn on the plan; a pipe takes the diameter written next
 *    to it ("D110") — each label belongs to the pipe nearest to it;
 *  - vertical runs, not drawn on a plan: a riser labelled "OĐ1 D110" climbs the storey of each plan it is on; the
 *    drops from the ceiling to the switches and sockets are estimated (mounting heights SWITCH_H / SOCKET_H);
 *  - with the model's grid (1 / A) the devices and runs are also placed on the building (`items`) for the MEP
 *    coordination model (src/auto/mepModel.ts).
 */
import type { CadDocument, Entity } from '../cad/types'
import type { P2 } from '../bim/model'
import { boxOf, norm, segsOf, type Box } from '../bim/fromCad'
import { cross, gridsIn } from '../bim/structure'

export type MepRole =
  | 'light' | 'switch' | 'socket' | 'panel' | 'wire' | 'ac' | 'fan' | 'lps'
  | 'cold' | 'hot' | 'waste' | 'sewer' | 'storm' | 'vent' | 'fixture'
  | 'detector' | 'alarm' | 'extinguisher' | 'exitSign' | 'sprinkler' | 'hydrant' | 'seal'
  | 'data' | 'tv' | 'ap' | 'camera' | 'intercom' | 'rack' | 'elvCable'
  | 'riser' | 'wireDrop' | 'text' | 'ignore'
const DEVICES: MepRole[] = ['light', 'switch', 'socket', 'panel', 'ac', 'fan', 'lps', 'fixture', 'detector', 'alarm', 'extinguisher', 'exitSign', 'sprinkler', 'hydrant', 'seal', 'data', 'tv', 'ap', 'camera', 'intercom', 'rack']
const RUNS: MepRole[] = ['wire', 'cold', 'hot', 'waste', 'sewer', 'storm', 'vent', 'elvCable']
export const PIPES: MepRole[] = ['cold', 'hot', 'waste', 'sewer', 'storm', 'vent']
/** mounting heights above the floor (mm) for the drops from the ceiling */
export const SWITCH_H = 1250, SOCKET_H = 400

export function mepRole(layer: string): MepRole {
  const n = norm(layer)
  if (/(DIM|KICH THUOC|ARCH|KIEN TRUC|SCHEM|SO DO|GRID|TRUC|FOV|ROUTE|THOAT NAN|\bR$|RANGE)/.test(n)) return 'ignore'
  if (/(TEXT|TXT|CHU|TAG)/.test(n)) return 'text'
  const f = /^(F|FA|FP|FIRE|PCCC)\b/.test(n) || /\b(PCCC|BAO CHAY|CHUA CHAY|FIRE)\b/.test(n)
  const l = /^(L|LV|ELV|IT|TEL)\b/.test(n) || /\b(DIEN NHE|ELV|CCTV|CAMERA)\b/.test(n)
  const e = /^(E|EL|ELEC|DIEN)\b/.test(n) || /\b(DIEN|ELECTRIC)\b/.test(n)
  const p = /^(P|PL|PLUMB|NUOC|CTN)\b/.test(n) || /\b(NUOC|PLUMBING)\b/.test(n)
  const mm = /^(M|MECH|HVAC)\b/.test(n) || /\b(DIEU HOA|HVAC)\b/.test(n)
  if (f) {
    if (/(SPRINK|DAU PHUN)/.test(n)) return 'sprinkler'
    if (/(DETECT|DAU BAO|SMOKE|HEAT|KHOI|NHIET)/.test(n)) return 'detector'
    if (/(ALARM|CHUONG|BELL|NUT|MCP|CALL)/.test(n)) return 'alarm'
    if (/(\bEXT\b|BINH|EXTING)/.test(n)) return 'extinguisher'
    if (/(SIGN|EXIT|CHI DAN|SU CO|EMERG)/.test(n)) return 'exitSign'
    if (/(HYDRANT|HOP VOI|\bVOI\b|HOSE)/.test(n)) return 'hydrant'
    if (/(SEAL|CHEN)/.test(n)) return 'seal'
    return 'ignore'
  }
  if (l) {
    if (/(CCTV|CAMERA|\bCAM\b)/.test(n)) return 'camera'
    if (/(WIFI|\bAP\b|ACCESS POINT)/.test(n)) return 'ap'
    if (/(INTERCOM|CHUONG HINH|VDP|DOOR PHONE)/.test(n)) return 'intercom'
    if (/(RACK|TU MANG|CABINET)/.test(n)) return 'rack'
    if (/\bTV\b|TRUYEN HINH|CATV/.test(n)) return 'tv'
    if (/(DATA|\bLAN\b|MANG|TEL)/.test(n)) return 'data'
    if (/(CABLE|\bCAP\b|WIRE|\bDAY\b)/.test(n)) return 'elvCable'
    return 'ignore'
  }
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

export interface MepPlan { title: string; level: string | null; kind: 'electrical' | 'plumbing' | 'fire' | 'elv' | 'mixed'; placed: boolean }
export interface MepRow {
  key: string
  role: MepRole
  /** diameter of a pipe (mm), capacity of an air conditioner ("24k") */
  size: string | null
  byLevel: Record<string, number>
  total: number
  unit: 'pcs' | 'm'
}
/** A device or a run placed on the model (model coordinates), for the coordination model. */
export interface MepItem { level: string; role: MepRole; size: string | null; at?: P2; pts?: P2[]; cap?: string | null }
export interface MepResult { file: string; plans: MepPlan[]; rows: MepRow[]; items: MepItem[] }

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

export interface MepLevel { name: string; elevation: number }
/** Where to put the plans on the model: the grid intersection it was aligned on, and that point in the model. */
export interface MepPlace { grid: [string, string]; at: P2 }

/**
 * Levels (sorted, with elevations: a storey's height for its risers and drops) by name: "TẦNG 2" → the level of that
 * number, "MÁI" → `roofName`, else as written.
 */
export function readMep(doc: CadDocument, levels: MepLevel[], roofName: string, place?: MepPlace): MepResult {
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
  const items: MepItem[] = []
  const rows = new Map<string, MepRow>()
  const add = (r: MepRole, size: string | null, level: string, q: number, unit: 'pcs' | 'm') => {
    if (!(q > 0)) return
    const key = `mep:${r}${size ? `:${size}` : ''}`
    const row = rows.get(key) ?? { key, role: r, size, byLevel: {}, total: 0, unit }
    row.byLevel[level] = (row.byLevel[level] ?? 0) + q
    row.total += q
    rows.set(key, row)
  }
  const storey = (name: string) => {
    const i = levels.findIndex((l) => l.name === name)
    return i >= 0 && i + 1 < levels.length ? levels[i + 1].elevation - levels[i].elevation : 3300
  }
  const gridEnts = doc.entities.filter((e) => /(GRID|AXIS|TRUC|ARCH)/.test(norm(e.layer)) && e.kind !== 'text')
  for (const [title, g] of byTitle) {
    const tn = norm(title.value)
    const num = /TANG\s*(\d+)/.exec(tn)
    const level = num ? (levels.find((l) => new RegExp(`\\b${num[1]}\\b`).test(norm(l.name)))?.name ?? `Tầng ${num[1]}`) : /\bMAI\b|ROOF/.test(tn) ? roofName : null
    const roles = new Set(g.ents.map((e) => R(e.layer)))
    const has = (rs: MepRole[]) => [...roles].some((r) => rs.includes(r))
    const kinds = [has(['light', 'switch', 'socket', 'wire', 'panel']) && 'electrical', has([...PIPES, 'fixture']) && 'plumbing', has(['detector', 'alarm', 'extinguisher', 'exitSign', 'sprinkler', 'hydrant', 'seal']) && 'fire', has(['data', 'tv', 'ap', 'camera', 'intercom', 'rack', 'elvCable']) && 'elv'].filter(Boolean) as MepPlan['kind'][]
    const lv = level ?? title.value
    // placed on the model by the grid intersection the model was aligned on
    let T: ((x: number, y: number) => P2) | null = null
    if (place) {
      // a plan's MEP may cover part of the building only: look for its grids 6 m round it
      const gs = gridsIn(gridEnts, texts, { x0: g.box.x0 - 6000, y0: g.box.y0 - 6000, x1: g.box.x1 + 6000, y1: g.box.y1 + 6000 })
      const gv = gs.find((x) => x.label === place.grid[0]), gh = gs.find((x) => x.label === place.grid[1])
      const o = gv && gh ? cross(gv, gh) : null
      if (o) T = (x, y) => [Math.round(x - o[0] + place.at[0]), Math.round(y - o[1] + place.at[1])]
    }
    plans.push({ title: title.value, level, kind: kinds.length === 1 ? kinds[0] : 'mixed', placed: !!T })
    // devices: symbols on their layers
    let switches = 0, sockets = 0
    for (const r of DEVICES) {
      const sym = cluster(g.ents.filter((e) => R(e.layer) === r), 60).filter((c) => c.box.x1 - c.box.x0 <= 1500 && c.box.y1 - c.box.y0 <= 1500)
      if (r === 'switch') switches += sym.length
      if (r === 'socket') sockets += sym.length
      for (const c of sym) {
        const cx = (c.box.x0 + c.box.x1) / 2, cy = (c.box.y0 + c.box.y1) / 2
        let cap: string | null = null
        if (r === 'ac') {
          // air conditioners by the capacity written next to them
          let bd = 1500
          for (const t of texts) { const m = /(\d{1,2})\s*K\b/i.exec(t.value); if (!m) continue; const d = Math.hypot(t.p.x - cx, t.p.y - cy); if (d < bd) { bd = d; cap = `${m[1]}k` } }
        }
        add(r, r === 'ac' ? cap : null, lv, 1, 'pcs')
        if (T) items.push({ level: lv, role: r, size: null, at: T(cx, cy), cap })
      }
    }
    // the drops from the ceiling to the switches and sockets (estimate: storey − slab − mounting height)
    if (switches || sockets) add('wireDrop', null, lv, (switches * Math.max(0, storey(lv) - 120 - SWITCH_H) + sockets * Math.max(0, storey(lv) - 120 - SOCKET_H)) / 1000, 'm')
    // runs: their drawn length. A diameter written on the plan belongs to the pipe nearest to it (within 400 mm)
    const labels = texts.filter((t) => inBox(t.p, g.box, 500)).flatMap((t) => { const m = /\bD\s?(\d{2,3})\b/.exec(t.value); return m ? [{ p: t.p, d: m[1], v: norm(t.value) }] : [] })
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
    // risers: "OĐ1 D110" (ống đứng) climb this plan's storey
    const risers = new Set<string>()
    for (const l of labels) {
      const m = /\b(OD|ONG DUNG|RISER)\s*(\d+)/.exec(l.v)
      if (!m || risers.has(m[2])) continue
      risers.add(m[2])
      add('riser', l.d, lv, storey(lv) / 1000, 'm')
    }
    for (const e of g.ents) {
      const r = R(e.layer)
      if (!RUNS.includes(r) || (e.kind !== 'line' && e.kind !== 'polyline')) continue
      const segs = segsOf(e)
      const L = segs.reduce((a, [p, q]) => a + Math.hypot(q.x - p.x, q.y - p.y), 0) / 1000
      const size = PIPES.includes(r) ? (sizeOf.get(e) ?? null) : null
      add(r, size, lv, L, 'm')
      if (T && PIPES.includes(r) && segs.length) items.push({ level: lv, role: r, size, pts: [T(segs[0][0].x, segs[0][0].y), ...segs.map(([, q]) => T!(q.x, q.y))] })
    }
  }
  const order: MepRole[] = ['panel', 'light', 'switch', 'socket', 'wire', 'wireDrop', 'lps', 'ac', 'fan', 'cold', 'hot', 'waste', 'sewer', 'storm', 'vent', 'riser', 'fixture', 'detector', 'alarm', 'sprinkler', 'hydrant', 'extinguisher', 'exitSign', 'seal', 'rack', 'data', 'tv', 'ap', 'camera', 'intercom', 'elvCable']
  return { file: doc.name, plans, items, rows: [...rows.values()].sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role) || Number(a.size?.replace(/\D/g, '') ?? 0) - Number(b.size?.replace(/\D/g, '') ?? 0)) }
}
