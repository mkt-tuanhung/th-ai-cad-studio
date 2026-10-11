import { arc, circle, line, poly, rect, regular, roundRect, text, type Shape } from './shapes'

/**
 * Built-in component library: parametric 2D blocks / families / parts that really insert into a
 * CAD 2D drawing (plan geometry), plus materials. Counts on screen are computed from this list —
 * nothing is invented. Photos are DEMO crops from the approved mockup (MISSING_PRODUCTION_ASSETS.md);
 * every other thumbnail is drawn from the component's own geometry.
 */
export type Group = 'blocks' | 'families' | 'mechanical' | 'mep' | 'materials' | 'interior'
export type Category =
  | 'architecture' | 'interior' | 'site' | 'annotation'
  | 'doors' | 'windows' | 'furniture' | 'lighting' | 'fixtures'
  | 'hvac' | 'piping' | 'equipment'
  | 'ductwork' | 'electrical' | 'plumbing' | 'fire'
  | 'surface'
  | 'kitchen' | 'storage' | 'bath'
export type Discipline = 'Architecture' | 'Interior' | 'Mechanical' | 'MEP' | 'Civil' | 'Structural'

export const GROUP_CATEGORIES: Record<Group, Category[]> = {
  blocks: ['architecture', 'interior', 'site', 'annotation'],
  families: ['doors', 'windows', 'furniture', 'lighting', 'fixtures'],
  mechanical: ['hvac', 'piping', 'equipment'],
  mep: ['ductwork', 'electrical', 'plumbing', 'fire'],
  materials: ['surface'],
  interior: ['kitchen', 'storage', 'bath'],
}

export interface LibComponent {
  id: string
  name: string
  group: Group
  category: Category
  kind: 'Block' | 'Family' | 'Part' | 'Material' | 'Module'
  discipline: Discipline
  /** Two display tags (mockup cards). */
  tags: [string, string]
  /** Width × depth × height in mm (plan footprint w × d). */
  size?: { w: number; d: number; h?: number }
  sizeLabel?: string
  version: string
  versions: { v: string; date: string; note: 'initial' | 'update' | 'upload'; file?: string }[]
  addedAt: number
  popularity: number
  material?: { name: string; kind: string; color: string; image?: string }
  manufacturer: string
  /** DEMO product image (cropped from the mockup). */
  photo?: string
  /** Default layer (Layer Mapping). */
  layer: string
  shared?: boolean
  source: 'builtin' | 'upload'
  /** Software the component came from (filter). */
  software: 'TH AI CAD Studio' | 'AutoCAD'
  plan?: () => Shape[]
  front?: () => Shape[]
  side?: () => Shape[]
}

const DAY = 86_400_000
const T0 = Date.UTC(2026, 9, 11)
const P = '/assets/v2/components/'

// ------------------------------------------------------------------ geometry generators
const sofaPlan = (w: number, d: number, seats: number) => () => {
  const arm = 160, back = 200
  const s: Shape[] = [rect(0, 0, w, d), rect(0, 0, arm, d), rect(w - arm, 0, arm, d), rect(arm, d - back, w - 2 * arm, back)]
  const cw = (w - 2 * arm) / seats
  for (let i = 0; i < seats; i++) s.push(rect(arm + i * cw + 10, 20, cw - 20, d - back - 30))
  return s
}
const sofaFront = (w: number, h: number) => () => {
  const arm = 160, seat = 420, leg = 120
  return [
    rect(0, leg, arm, 600 - leg), rect(w - arm, leg, arm, 600 - leg), rect(arm, leg, w - 2 * arm, seat - leg),
    rect(arm + 40, seat, (w - 2 * arm) / 3 - 20, h - seat - 20), rect(arm + (w - 2 * arm) / 3 + 10, seat, (w - 2 * arm) / 3 - 20, h - seat - 20),
    rect(arm + (2 * (w - 2 * arm)) / 3 - 20, seat, (w - 2 * arm) / 3 - 20, h - seat - 20),
    line(arm, leg + 60, w - arm, leg + 60),
    poly([[40, 0], [70, 0], [80, leg], [30, leg]]), poly([[w - 70, 0], [w - 40, 0], [w - 30, leg], [w - 80, leg]]),
  ]
}
const sofaSide = (d: number, h: number) => () => [
  rect(0, 120, d, 480), poly([[0, 600], [180, 600], [180, h], [40, h], [0, h - 40]]), rect(150, 520, 120, 140),
  poly([[40, 0], [70, 0], [80, 120], [30, 120]]), poly([[d - 70, 0], [d - 40, 0], [d - 30, 120], [d - 80, 120]]),
]
const doorPlan = (w: number, t = 100) => () => [rect(0, 0, 50, t), rect(w + 50, 0, 50, t), rect(50, t, 40, w), arc(50, t, w, 0, 90), line(50, t, w + 50, t)]
const doubleDoorPlan = (w: number, t = 100) => () => {
  const leaf = w / 2
  return [rect(0, 0, 50, t), rect(w + 50, 0, 50, t), rect(50, t, 40, leaf), rect(w + 10, t, 40, leaf), arc(50, t, leaf, 0, 90), arc(w + 50, t, leaf, 90, 180)]
}
const slidingDoorPlan = (w: number, t = 100) => () => [rect(0, 0, 50, t), rect(w + 50, 0, 50, t), rect(50, 20, w / 2 + 50, 30), rect(w / 2, 55, w / 2 + 50, 30), line(60, 92, 260, 92), line(220, 82, 260, 92), line(220, 102, 260, 92)]
const windowPlan = (w: number, t = 200) => () => [rect(0, 0, w, t), line(0, t / 2 - 15, w, t / 2 - 15), line(0, t / 2 + 15, w, t / 2 + 15)]
const deskPlan = (w: number, d: number) => () => [rect(0, 0, w, d), rect(40, 40, 420, d - 80), line(40, d / 2, 460, d / 2)]
const chairPlan = (w: number) => () => [circle(w / 2, w / 2, w / 2 - 20), roundRect(w / 2 - 230, w - 160, 460, 120, 40), rect(w / 2 - 210, 80, 420, 400), ...[0, 72, 144, 216, 288].map((a) => line(w / 2, w / 2, w / 2 + (w / 2 - 20) * Math.cos((a * Math.PI) / 180), w / 2 + (w / 2 - 20) * Math.sin((a * Math.PI) / 180)))]
const tablePlan = (w: number, d: number, chairs: number) => () => {
  const s: Shape[] = [rect(0, 0, w, d)]
  const per = Math.max(1, Math.floor(chairs / 2))
  for (let i = 0; i < per; i++) {
    const x = (w / per) * (i + 0.5) - 225
    s.push(rect(x, -520, 450, 450), rect(x, d + 70, 450, 450))
  }
  return s
}
const bedPlan = (w: number, d: number) => () => {
  const s: Shape[] = [rect(0, 0, w, d), rect(0, d - 80, w, 80)]
  const pillows = w >= 1400 ? 2 : 1
  for (let i = 0; i < pillows; i++) s.push(...roundRect(80 + i * ((w - 160) / pillows), d - 480, (w - 160) / pillows - 40, 300, 60))
  s.push(line(0, d - 900, w, d - 1100))
  return s
}
const wardrobePlan = (w: number, d = 600) => () => {
  const s: Shape[] = [rect(0, 0, w, d), line(0, 60, w, 60)]
  for (let x = 450; x < w; x += 450) s.push(line(x, 0, x, d))
  s.push(line(20, d / 2, w - 20, d / 2))
  return s
}
const treePlan = (dia: number) => () => {
  const r = dia / 2
  const s: Shape[] = [circle(r, r, r), circle(r, r, r * 0.08)]
  for (let a = 0; a < 360; a += 30) s.push(arc(r + r * 0.6 * Math.cos((a * Math.PI) / 180), r + r * 0.6 * Math.sin((a * Math.PI) / 180), r * 0.35, a + 120, a + 240))
  return s
}
const plantPlan = (dia: number) => () => {
  const r = dia / 2
  const s: Shape[] = [circle(r, r, r * 0.55), circle(r, r, r * 0.45)]
  for (let a = 0; a < 360; a += 45) s.push(line(r, r, r + r * Math.cos((a * Math.PI) / 180), r + r * Math.sin((a * Math.PI) / 180)))
  return s
}
const columnPlan = (w: number) => () => [rect(0, 0, w, w), line(0, 0, w, w), line(0, w, w, 0)]
const roundColumnPlan = (dia: number) => () => [circle(dia / 2, dia / 2, dia / 2), line(0, dia / 2, dia, dia / 2), line(dia / 2, 0, dia / 2, dia)]
const stairPlan = (w: number, n = 12, tread = 280) => () => {
  const s: Shape[] = [rect(0, 0, w, n * tread)]
  for (let i = 1; i < n; i++) s.push(line(0, i * tread, w, i * tread))
  s.push(line(w / 2, 100, w / 2, n * tread - 300), line(w / 2 - 80, n * tread - 460, w / 2, n * tread - 300), line(w / 2 + 80, n * tread - 460, w / 2, n * tread - 300))
  return s
}
const northArrow = () => () => [circle(500, 500, 450), poly([[500, 950], [650, 250], [500, 380], [350, 250]], true, true), text(500, 1020, 180, 'N')]
const gridBubble = () => () => [circle(400, 400, 400), text(400, 330, 280, 'A'), line(400, 0, 400, -800)]
const levelMark = () => () => [poly([[0, 0], [300, 300], [-300, 300]]), line(-300, 300, 1800, 300), text(600, 380, 200, '+0.000', false)]
const sectionMark = () => () => [circle(400, 400, 400), line(0, 400, 800, 400), text(400, 470, 200, 'A'), text(400, 150, 160, 'A-01'), poly([[800, 400], [1200, 400], [1200, 560]], false)]
const toiletPlan = () => () => [rect(0, 480, 380, 200), roundRect(30, 0, 320, 480, 150), circle(190, 220, 110)]
const basinPlan = (w: number) => () => [rect(0, 0, w, 450), roundRect(50, 40, w - 100, 350, 120), circle(w / 2, 330, 25)]
const bathPlan = (w: number) => () => [rect(0, 0, w, 750), roundRect(60, 60, w - 120, 630, 200), circle(w - 200, 375, 30)]
const showerPlan = (w: number) => () => [rect(0, 0, w, w), line(0, 0, w, w), line(0, w, w, 0), circle(w / 2, w / 2, 40)]
const sinkPlan = (bowls: number) => () => {
  const w = bowls === 1 ? 800 : 1200
  const s: Shape[] = [rect(0, 0, w, 500)]
  const bw = bowls === 1 ? 450 : 450
  for (let i = 0; i < bowls; i++) s.push(...roundRect(40 + i * (bw + 40), 40, bw, 400, 60))
  s.push(rect(w - 260, 60, 220, 360))
  return s
}
const downlight = (dia: number) => () => [circle(dia / 2, dia / 2, dia / 2), circle(dia / 2, dia / 2, dia * 0.35), line(dia * 0.15, dia / 2, dia * 0.85, dia / 2), line(dia / 2, dia * 0.15, dia / 2, dia * 0.85)]
const pendant = (dia: number) => () => [circle(dia / 2, dia / 2, dia / 2), circle(dia / 2, dia / 2, dia / 2 - 60), circle(dia / 2, dia / 2, 30)]
const linearLight = (len: number) => () => [rect(0, 0, len, 80), line(0, 40, len, 40)]
const cassette = (w: number) => () => {
  const s: Shape[] = [rect(0, 0, w, w), rect(w * 0.3, w * 0.3, w * 0.4, w * 0.4)]
  for (const [x, y, ww, hh] of [[w * 0.1, w * 0.12, w * 0.8, w * 0.08], [w * 0.1, w * 0.8, w * 0.8, w * 0.08], [w * 0.12, w * 0.1, w * 0.08, w * 0.8], [w * 0.8, w * 0.1, w * 0.08, w * 0.8]]) s.push(rect(x, y, ww, hh))
  return s
}
const diffuser = (w: number) => () => [rect(0, 0, w, w), rect(w * 0.15, w * 0.15, w * 0.7, w * 0.7), rect(w * 0.3, w * 0.3, w * 0.4, w * 0.4), line(0, 0, w, w), line(0, w, w, 0)]
const grille = (w: number, h: number) => () => {
  const s: Shape[] = [rect(0, 0, w, h)]
  for (let x = 60; x < w; x += 60) s.push(line(x, 20, x, h - 20))
  return s
}
const boxUnit = (w: number, d: number, label: string) => () => [rect(0, 0, w, d), line(0, 0, w, d), line(0, d, w, 0), text(w / 2, d / 2 + 80, Math.min(w, d) / 6, label)]
const elbowPlan = (od: number) => () => {
  const r = od * 1.5
  return [arc(0, 0, r - od / 2, 0, 90), arc(0, 0, r + od / 2, 0, 90), line(r - od / 2, 0, r + od / 2, 0), line(0, r - od / 2, 0, r + od / 2), arc(0, 0, r, 0, 90)]
}
const teePlan = (od: number) => () => [rect(0, 0, od * 3, od), rect(od, od, od, od), line(od * 1.5, od * 2, od * 1.5, od * 0.5)]
const valvePlan = (od: number, check = false) => () => {
  const L = od * 2.5
  const s: Shape[] = [poly([[0, 0], [L / 2, od / 2], [0, od]]), poly([[L, 0], [L / 2, od / 2], [L, od]]), line(L / 2, od / 2, L / 2, od * 1.6), line(L / 2 - od / 3, od * 1.6, L / 2 + od / 3, od * 1.6)]
  if (check) s.splice(2, 2, line(0, 0, L, od))
  return s
}
const reducerPlan = (od1: number, od2: number) => () => [poly([[0, 0], [od1 * 1.5, (od1 - od2) / 2], [od1 * 1.5, (od1 + od2) / 2], [0, od1]])]
const pumpPlan = () => () => [rect(0, 0, 1400, 500), circle(1050, 250, 230), rect(150, 120, 650, 260), line(800, 250, 820, 250), rect(1240, 180, 160, 140), rect(980, 480, 140, 160)]
const boltPlan = (m: number) => () => {
  const s = m * 1.6
  return [regular(s / 2 + 2, s / 2 + 2, s / 2 / Math.cos(Math.PI / 6), 6), circle(s / 2 + 2, s / 2 + 2, m / 2)]
}
const nutPlan = (m: number) => () => {
  const s = m * 1.6
  return [regular(s / 2 + 2, s / 2 + 2, s / 2 / Math.cos(Math.PI / 6), 6), circle(s / 2 + 2, s / 2 + 2, m / 2), circle(s / 2 + 2, s / 2 + 2, s * 0.45)]
}
const washerPlan = (m: number) => () => [circle(m, m, m), circle(m, m, m * 0.55)]
const bearingPlan = (d: number, D: number) => () => {
  const c = D / 2
  const s: Shape[] = [circle(c, c, D / 2), circle(c, c, d / 2), circle(c, c, D / 2 - (D - d) / 8), circle(c, c, d / 2 + (D - d) / 8)]
  const rb = (D - d) / 8
  for (let a = 0; a < 360; a += 36) s.push(circle(c + ((D + d) / 4) * Math.cos((a * Math.PI) / 180), c + ((D + d) / 4) * Math.sin((a * Math.PI) / 180), rb * 0.9))
  return s
}
const flangePlan = (D: number, d: number, holes: number) => () => {
  const c = D / 2
  const s: Shape[] = [circle(c, c, D / 2), circle(c, c, d / 2)]
  for (let i = 0; i < holes; i++) {
    const a = (i * 2 * Math.PI) / holes + Math.PI / holes
    s.push(circle(c + D * 0.38 * Math.cos(a), c + D * 0.38 * Math.sin(a), D * 0.045))
  }
  return s
}
const ductPlan = (w: number, len = 1200) => () => [rect(0, 0, len, w), line(0, 0, len, w), line(0, w, len, 0)]
const roundDuct = (dia: number, len = 1200) => () => [rect(0, 0, len, dia), line(0, dia / 2, len, dia / 2)]
const trayPlan = (w: number, len = 1200) => () => {
  const s: Shape[] = [rect(0, 0, len, w)]
  for (let x = 150; x < len; x += 300) s.push(line(x, 0, x, w))
  return s
}
const symbolBox = (w: number, label: string) => () => [rect(0, 0, w, w * 0.6), text(w / 2, w * 0.18, w * 0.25, label)]
const socketPlan = () => () => [circle(150, 150, 150), line(0, 150, 300, 150), line(150, 300, 150, 420)]
const switchPlan = () => () => [circle(100, 100, 100), line(170, 170, 330, 330), line(330, 330, 380, 280)]
const sprinkler = () => () => [circle(100, 100, 100), line(30, 30, 170, 170), line(30, 170, 170, 30)]
const drainPlan = () => () => [rect(0, 0, 200, 200), circle(100, 100, 70), line(40, 100, 160, 100)]
const extinguisher = () => () => [circle(120, 120, 120), text(120, 80, 90, 'FE')]
const cabinetPlan = (w: number, d = 600) => () => [rect(0, 0, w, d), line(0, 40, w, 40), line(w / 2, 40, w / 2, d)]
const islandPlan = (w: number) => () => [rect(0, 0, w, 1000), line(0, 500, w, 500), rect(w / 2 - 400, 120, 800, 300)]
const tvUnitPlan = (w: number) => () => [rect(0, 0, w, 450), line(w / 3, 0, w / 3, 450), line((2 * w) / 3, 0, (2 * w) / 3, 450)]
const shelfPlan = (w: number) => () => [rect(0, 0, w, 350), line(0, 175, w, 175)]
const parkingBay = () => () => [poly([[0, 0], [0, 5000], [2500, 5000], [2500, 0]], false), text(1250, 2300, 600, 'P')]
const carPlan = () => () => [roundRect(0, 0, 1800, 4500, 400), rect(150, 1200, 1500, 1600), line(150, 2000, 1650, 2000)]
const benchPlan = () => () => [rect(0, 0, 1800, 450), line(0, 150, 1800, 150), line(0, 300, 1800, 300)]
const rampPlan = (w: number, len: number) => () => [rect(0, 0, w, len), line(w / 2, 200, w / 2, len - 200), line(w / 2 - 100, len - 400, w / 2, len - 200), line(w / 2 + 100, len - 400, w / 2, len - 200), text(w / 2, len / 2, 150, '1:12')]
const liftPlan = (w: number) => () => [rect(0, 0, w, w), rect(150, 150, w - 300, w - 500), line(150, 150, w - 150, w - 350), line(150, w - 350, w - 150, 150)]
const glassPartition = (panels: number, pw = 900) => () => {
  const s: Shape[] = [rect(0, 0, panels * pw, 50)]
  for (let i = 1; i < panels; i++) s.push(line(i * pw, 0, i * pw, 50))
  return s
}

// ------------------------------------------------------------------ catalogue
let seq = 0
const versions = (v: string, days: number) => {
  const n = Number(v.slice(1).replace('.', '')) // v1.2 → 12
  const major = Math.floor(n / 10), minor = n % 10
  const out: LibComponent['versions'] = []
  for (let i = 0; i <= minor; i++) out.push({ v: `v${major}.${i}`, date: new Date(T0 - (days + (minor - i) * 40) * DAY).toISOString().slice(0, 10), note: i === 0 ? 'initial' : 'update' })
  return out.reverse()
}
type Gen = () => (Shape | Shape[])[]
const flat = (g?: Gen) => (g ? () => g().flat() : undefined)
function c(p: Omit<LibComponent, 'id' | 'versions' | 'addedAt' | 'popularity' | 'manufacturer' | 'source' | 'software' | 'version' | 'plan' | 'front' | 'side'> & { version?: string; popularity?: number; days?: number; plan?: Gen; front?: Gen; side?: Gen }): LibComponent {
  const i = ++seq
  const version = p.version ?? 'v1.0'
  const days = p.days ?? 30 + ((i * 37) % 300)
  return {
    manufacturer: 'Generic', source: 'builtin', software: 'TH AI CAD Studio', ...p,
    plan: flat(p.plan), front: flat(p.front), side: flat(p.side),
    id: `lib-${i}`, version, versions: versions(version, days), addedAt: T0 - days * DAY, popularity: p.popularity ?? 100 - (i % 60),
  }
}
const dims = (w: number, d: number, h?: number) => ({ w, d, ...(h ? { h } : {}) })
const sz = (w: number, d: number, h?: number) => `${w} × ${d}${h ? ` × ${h}` : ''} mm`

const MAT = (name: string, color: string, image?: string) => ({ name, kind: 'Generic Material', color, ...(image ? { image } : {}) })

export const BUILTIN: LibComponent[] = [
  // ---- featured in mockup 07 (grid order) ----
  c({ name: 'Modern Sofa 3-Seater', group: 'families', category: 'furniture', kind: 'Family', discipline: 'Interior', tags: ['Interior', 'Furniture'], size: dims(2400, 950, 780), sizeLabel: sz(2400, 950, 780), version: 'v1.2', popularity: 980, days: 12, layer: 'A-FURN-FIXT', photo: P + 'sofa.png', material: MAT('Fabric - Light Gray', '#9a9ea3', P + 'fabric.png'), plan: sofaPlan(2400, 950, 3), front: sofaFront(2400, 780), side: sofaSide(950, 780) }),
  c({ name: 'Wooden Door - Single', group: 'families', category: 'doors', kind: 'Family', discipline: 'Architecture', tags: ['Architecture', 'Door'], size: dims(900, 100, 2100), sizeLabel: '900 × 2100 × 100 mm', version: 'v2.0', popularity: 960, days: 20, layer: 'A-DOOR', photo: P + 'door.png', material: MAT('Wood - Oak', '#a9805a'), plan: doorPlan(900) }),
  c({ name: 'Ceiling AC Unit', group: 'mechanical', category: 'hvac', kind: 'Family', discipline: 'Mechanical', tags: ['Mechanical', 'HVAC'], size: dims(840, 840, 298), sizeLabel: sz(840, 840, 298), version: 'v1.1', popularity: 940, days: 25, layer: 'M-HVAC-EQPM', photo: P + 'ac.png', material: MAT('Steel - Galvanized', '#b8bcc0'), plan: cassette(840) }),
  c({ name: 'LED Downlight', group: 'families', category: 'lighting', kind: 'Family', discipline: 'MEP', tags: ['MEP', 'Lighting'], size: dims(200, 200, 95), sizeLabel: 'Ø200 × 95 mm', version: 'v1.0', popularity: 930, days: 5, layer: 'E-LITE', photo: P + 'downlight.png', material: MAT('Aluminium - Brushed', '#c9cccf'), plan: downlight(200) }),
  c({ name: 'Office Desk', group: 'families', category: 'furniture', kind: 'Family', discipline: 'Interior', tags: ['Interior', 'Furniture'], size: dims(1600, 700, 750), sizeLabel: sz(1600, 700, 750), version: 'v1.3', popularity: 920, days: 40, layer: 'A-FURN', photo: P + 'desk.png', material: MAT('Laminate - Gray', '#a7aaad'), plan: deskPlan(1600, 700) }),
  c({ name: 'Ergonomic Office Chair', group: 'families', category: 'furniture', kind: 'Family', discipline: 'Interior', tags: ['Interior', 'Furniture'], size: dims(680, 680, 1200), sizeLabel: sz(680, 680, 1200), version: 'v1.1', popularity: 910, days: 33, layer: 'A-FURN', photo: P + 'chair.png', material: MAT('Mesh - Gray', '#8d9196'), plan: chairPlan(680) }),
  c({ name: 'Pipe Elbow 90°', group: 'mechanical', category: 'piping', kind: 'Part', discipline: 'Mechanical', tags: ['Mechanical', 'Piping'], size: dims(285, 285), sizeLabel: 'DN100 (Ø114 mm)', version: 'v2.1', popularity: 900, days: 18, layer: 'P-PIPE', photo: P + 'elbow.png', material: MAT('Stainless Steel - 316', '#c4c8cc'), plan: elbowPlan(114) }),
  c({ name: 'Rectangular Duct', group: 'mep', category: 'ductwork', kind: 'Family', discipline: 'MEP', tags: ['MEP', 'Ductwork'], size: dims(1200, 400, 300), sizeLabel: '400 × 300 × 1200 mm', version: 'v1.4', popularity: 890, days: 9, layer: 'M-DUCT', photo: P + 'duct.png', material: MAT('Steel - Galvanized', '#b8bcc0'), plan: ductPlan(400) }),
  // ---- recently used (mockup strip) ----
  c({ name: 'Office Chair', group: 'families', category: 'furniture', kind: 'Family', discipline: 'Interior', tags: ['Interior', 'Furniture'], size: dims(600, 600, 950), sizeLabel: sz(600, 600, 950), popularity: 870, layer: 'A-FURN', photo: P + 'office-chair.png', plan: chairPlan(600), shared: true }),
  c({ name: 'Meeting Table', group: 'blocks', category: 'interior', kind: 'Block', discipline: 'Interior', tags: ['Interior', 'Furniture'], size: dims(2400, 1200, 750), sizeLabel: sz(2400, 1200, 750), popularity: 860, layer: 'A-FURN', photo: P + 'meeting-table.png', material: MAT('Wood - Oak', '#a9805a'), plan: tablePlan(2400, 1200, 6), shared: true }),
  c({ name: 'Pendant Light', group: 'families', category: 'lighting', kind: 'Family', discipline: 'MEP', tags: ['MEP', 'Lighting'], size: dims(600, 600, 80), sizeLabel: 'Ø600 × 80 mm', popularity: 850, layer: 'E-LITE', photo: P + 'pendant.png', plan: pendant(600) }),
  c({ name: 'Glass Partition', group: 'families', category: 'windows', kind: 'Family', discipline: 'Architecture', tags: ['Architecture', 'Partition'], size: dims(2700, 50, 2700), sizeLabel: '2700 × 50 × 2700 mm', popularity: 840, layer: 'A-GLAZ', photo: P + 'partition.png', material: MAT('Glass - Clear', '#d6e8ef'), plan: glassPartition(3), shared: true }),
  c({ name: 'Potted Plant', group: 'blocks', category: 'site', kind: 'Block', discipline: 'Architecture', tags: ['Site', 'Landscape'], size: dims(500, 500, 1100), sizeLabel: 'Ø500 × 1100 mm', popularity: 830, layer: 'L-PLNT', photo: P + 'plant.png', plan: plantPlan(500) }),
  c({ name: 'Toilet WC', group: 'families', category: 'fixtures', kind: 'Family', discipline: 'MEP', tags: ['Plumbing', 'Fixture'], size: dims(380, 680, 780), sizeLabel: sz(380, 680, 780), popularity: 820, layer: 'P-FIXT', photo: P + 'toilet.png', material: MAT('Ceramic - White', '#f2f2f0'), plan: toiletPlan(), shared: true }),

  // ---- blocks / architecture ----
  ...[300, 400, 500].map((w) => c({ name: `Column ${w}×${w}`, group: 'blocks', category: 'architecture', kind: 'Block', discipline: 'Structural', tags: ['Structural', 'Column'], size: dims(w, w), sizeLabel: sz(w, w), layer: 'S-COLS', plan: columnPlan(w) })),
  ...[300, 400].map((d) => c({ name: `Round Column Ø${d}`, group: 'blocks', category: 'architecture', kind: 'Block', discipline: 'Structural', tags: ['Structural', 'Column'], size: dims(d, d), sizeLabel: `Ø${d} mm`, layer: 'S-COLS', plan: roundColumnPlan(d) })),
  ...[1000, 1200].map((w) => c({ name: `Straight Stair ${w}`, group: 'blocks', category: 'architecture', kind: 'Block', discipline: 'Architecture', tags: ['Architecture', 'Stair'], size: dims(w, 3360), sizeLabel: `${w} × 3360 mm, 12 risers`, layer: 'A-FLOR-STRS', plan: stairPlan(w) })),
  c({ name: 'Ramp 1:12', group: 'blocks', category: 'architecture', kind: 'Block', discipline: 'Architecture', tags: ['Architecture', 'Access'], size: dims(1200, 6000), sizeLabel: sz(1200, 6000), layer: 'A-FLOR', plan: rampPlan(1200, 6000) }),
  c({ name: 'Lift Shaft 2000×2000', group: 'blocks', category: 'architecture', kind: 'Block', discipline: 'Architecture', tags: ['Architecture', 'Lift'], size: dims(2000, 2000), sizeLabel: sz(2000, 2000), layer: 'A-FLOR-EVTR', plan: liftPlan(2000) }),
  // ---- blocks / interior ----
  ...([['Single Bed', 900, 2000], ['Double Bed', 1400, 2000], ['Queen Bed', 1600, 2000], ['King Bed', 1800, 2000]] as const).map(([n, w, d]) => c({ name: n, group: 'blocks', category: 'interior', kind: 'Block', discipline: 'Interior', tags: ['Interior', 'Bedroom'], size: dims(w, d, 450), sizeLabel: sz(w, d, 450), layer: 'A-FURN', plan: bedPlan(w, d) })),
  ...[1200, 1800, 2400].map((w) => c({ name: `Wardrobe ${w}`, group: 'blocks', category: 'interior', kind: 'Block', discipline: 'Interior', tags: ['Interior', 'Storage'], size: dims(w, 600, 2400), sizeLabel: sz(w, 600, 2400), layer: 'A-FURN', plan: wardrobePlan(w) })),
  c({ name: 'Sofa 2-Seater', group: 'blocks', category: 'interior', kind: 'Block', discipline: 'Interior', tags: ['Interior', 'Furniture'], size: dims(1700, 900, 780), sizeLabel: sz(1700, 900, 780), layer: 'A-FURN', plan: sofaPlan(1700, 900, 2) }),
  c({ name: 'Armchair', group: 'blocks', category: 'interior', kind: 'Block', discipline: 'Interior', tags: ['Interior', 'Furniture'], size: dims(850, 850, 780), sizeLabel: sz(850, 850, 780), layer: 'A-FURN', plan: sofaPlan(850, 850, 1) }),
  c({ name: 'Coffee Table', group: 'blocks', category: 'interior', kind: 'Block', discipline: 'Interior', tags: ['Interior', 'Furniture'], size: dims(1200, 600, 400), sizeLabel: sz(1200, 600, 400), layer: 'A-FURN', plan: () => [...roundRect(0, 0, 1200, 600, 80)] }),
  ...[1800, 2400].map((w) => c({ name: `TV Unit ${w}`, group: 'blocks', category: 'interior', kind: 'Block', discipline: 'Interior', tags: ['Interior', 'Living'], size: dims(w, 450, 500), sizeLabel: sz(w, 450, 500), layer: 'A-FURN', plan: tvUnitPlan(w) })),
  ...([[4, 1200, 800], [6, 1800, 900], [8, 2400, 1000]] as const).map(([n, w, d]) => c({ name: `Dining Table ${n} Seats`, group: 'blocks', category: 'interior', kind: 'Block', discipline: 'Interior', tags: ['Interior', 'Dining'], size: dims(w, d, 750), sizeLabel: sz(w, d, 750), layer: 'A-FURN', plan: tablePlan(w, d, n) })),
  c({ name: 'Meeting Table 3600', group: 'blocks', category: 'interior', kind: 'Block', discipline: 'Interior', tags: ['Interior', 'Office'], size: dims(3600, 1400, 750), sizeLabel: sz(3600, 1400, 750), layer: 'A-FURN', plan: tablePlan(3600, 1400, 10) }),
  // ---- blocks / site & landscape ----
  ...[3000, 5000, 8000].map((d) => c({ name: `Tree Ø${d / 1000} m`, group: 'blocks', category: 'site', kind: 'Block', discipline: 'Civil', tags: ['Site', 'Landscape'], size: dims(d, d), sizeLabel: `Ø${d} mm`, layer: 'L-PLNT', plan: treePlan(d) })),
  c({ name: 'Shrub', group: 'blocks', category: 'site', kind: 'Block', discipline: 'Civil', tags: ['Site', 'Landscape'], size: dims(1200, 1200), sizeLabel: 'Ø1200 mm', layer: 'L-PLNT', plan: plantPlan(1200) }),
  c({ name: 'Parking Bay 2500×5000', group: 'blocks', category: 'site', kind: 'Block', discipline: 'Civil', tags: ['Site', 'Parking'], size: dims(2500, 5000), sizeLabel: sz(2500, 5000), layer: 'C-PRKG', plan: parkingBay() }),
  c({ name: 'Car (Plan)', group: 'blocks', category: 'site', kind: 'Block', discipline: 'Civil', tags: ['Site', 'Vehicle'], size: dims(1800, 4500), sizeLabel: sz(1800, 4500), layer: 'C-PRKG', plan: carPlan() }),
  c({ name: 'Park Bench', group: 'blocks', category: 'site', kind: 'Block', discipline: 'Civil', tags: ['Site', 'Furniture'], size: dims(1800, 450), sizeLabel: sz(1800, 450), layer: 'L-SITE', plan: benchPlan() }),
  // ---- blocks / annotation ----
  c({ name: 'North Arrow', group: 'blocks', category: 'annotation', kind: 'Block', discipline: 'Architecture', tags: ['Annotation', 'Symbol'], size: dims(1000, 1000), sizeLabel: '1000 mm (1:100)', layer: 'A-ANNO-SYMB', plan: northArrow() }),
  c({ name: 'Grid Bubble', group: 'blocks', category: 'annotation', kind: 'Block', discipline: 'Architecture', tags: ['Annotation', 'Grid'], size: dims(800, 800), sizeLabel: 'Ø800 mm', layer: 'A-GRID', plan: gridBubble() }),
  c({ name: 'Level Marker', group: 'blocks', category: 'annotation', kind: 'Block', discipline: 'Architecture', tags: ['Annotation', 'Level'], size: dims(2100, 400), sizeLabel: '2100 mm', layer: 'A-ANNO-SYMB', plan: levelMark() }),
  c({ name: 'Section Marker', group: 'blocks', category: 'annotation', kind: 'Block', discipline: 'Architecture', tags: ['Annotation', 'Section'], size: dims(1200, 800), sizeLabel: 'Ø800 mm', layer: 'A-ANNO-SYMB', plan: sectionMark() }),
  // ---- families / doors ----
  ...[700, 800, 1000, 1100, 1200].map((w) => c({ name: `Single Door ${w}`, group: 'families', category: 'doors', kind: 'Family', discipline: 'Architecture', tags: ['Architecture', 'Door'], size: dims(w + 100, 100, 2100), sizeLabel: `${w} × 2100 × 100 mm`, layer: 'A-DOOR', plan: doorPlan(w) })),
  ...[1400, 1600, 1800].map((w) => c({ name: `Double Door ${w}`, group: 'families', category: 'doors', kind: 'Family', discipline: 'Architecture', tags: ['Architecture', 'Door'], size: dims(w + 100, 100, 2100), sizeLabel: `${w} × 2100 × 100 mm`, layer: 'A-DOOR', plan: doubleDoorPlan(w) })),
  ...[1600, 2000].map((w) => c({ name: `Sliding Door ${w}`, group: 'families', category: 'doors', kind: 'Family', discipline: 'Architecture', tags: ['Architecture', 'Door'], size: dims(w + 100, 100, 2100), sizeLabel: `${w} × 2100 × 100 mm`, layer: 'A-DOOR', plan: slidingDoorPlan(w) })),
  // ---- families / windows ----
  ...[600, 900, 1200, 1500, 1800, 2100, 2400].map((w) => c({ name: `Window ${w}`, group: 'families', category: 'windows', kind: 'Family', discipline: 'Architecture', tags: ['Architecture', 'Window'], size: dims(w, 200, 1500), sizeLabel: `${w} × 1500 mm`, layer: 'A-GLAZ', plan: windowPlan(w) })),
  c({ name: 'Glass Partition 4 Panels', group: 'families', category: 'windows', kind: 'Family', discipline: 'Architecture', tags: ['Architecture', 'Partition'], size: dims(3600, 50, 2700), sizeLabel: '3600 × 50 × 2700 mm', layer: 'A-GLAZ', plan: glassPartition(4) }),
  // ---- families / furniture ----
  ...[1200, 1400, 1800].map((w) => c({ name: `Office Desk ${w}`, group: 'families', category: 'furniture', kind: 'Family', discipline: 'Interior', tags: ['Interior', 'Furniture'], size: dims(w, 700, 750), sizeLabel: sz(w, 700, 750), layer: 'A-FURN', plan: deskPlan(w, 700) })),
  ...[800, 1000].map((w) => c({ name: `Bookshelf ${w}`, group: 'families', category: 'furniture', kind: 'Family', discipline: 'Interior', tags: ['Interior', 'Storage'], size: dims(w, 350, 2000), sizeLabel: sz(w, 350, 2000), layer: 'A-FURN', plan: shelfPlan(w) })),
  // ---- families / lighting ----
  ...[100, 150].map((d) => c({ name: `LED Downlight Ø${d}`, group: 'families', category: 'lighting', kind: 'Family', discipline: 'MEP', tags: ['MEP', 'Lighting'], size: dims(d, d, 80), sizeLabel: `Ø${d} × 80 mm`, layer: 'E-LITE', plan: downlight(d) })),
  c({ name: 'Pendant Light Ø800', group: 'families', category: 'lighting', kind: 'Family', discipline: 'MEP', tags: ['MEP', 'Lighting'], size: dims(800, 800, 80), sizeLabel: 'Ø800 × 80 mm', layer: 'E-LITE', plan: pendant(800) }),
  ...[1200, 1500].map((l) => c({ name: `Linear Light ${l}`, group: 'families', category: 'lighting', kind: 'Family', discipline: 'MEP', tags: ['MEP', 'Lighting'], size: dims(l, 80, 60), sizeLabel: `${l} × 80 mm`, layer: 'E-LITE', plan: linearLight(l) })),
  c({ name: 'Wall Sconce', group: 'families', category: 'lighting', kind: 'Family', discipline: 'MEP', tags: ['MEP', 'Lighting'], size: dims(300, 150), sizeLabel: '300 × 150 mm', layer: 'E-LITE', plan: () => [rect(0, 0, 300, 40), arc(150, 40, 110, 0, 180)] }),
  // ---- families / fixtures ----
  ...[500, 600].map((w) => c({ name: `Washbasin ${w}`, group: 'families', category: 'fixtures', kind: 'Family', discipline: 'MEP', tags: ['Plumbing', 'Fixture'], size: dims(w, 450, 850), sizeLabel: sz(w, 450, 850), layer: 'P-FIXT', plan: basinPlan(w) })),
  ...[1500, 1700].map((w) => c({ name: `Bathtub ${w}`, group: 'families', category: 'fixtures', kind: 'Family', discipline: 'MEP', tags: ['Plumbing', 'Fixture'], size: dims(w, 750, 550), sizeLabel: sz(w, 750, 550), layer: 'P-FIXT', plan: bathPlan(w) })),
  c({ name: 'Shower Tray 900', group: 'families', category: 'fixtures', kind: 'Family', discipline: 'MEP', tags: ['Plumbing', 'Fixture'], size: dims(900, 900), sizeLabel: sz(900, 900), layer: 'P-FIXT', plan: showerPlan(900) }),
  c({ name: 'Kitchen Sink - Single', group: 'families', category: 'fixtures', kind: 'Family', discipline: 'MEP', tags: ['Plumbing', 'Kitchen'], size: dims(800, 500), sizeLabel: sz(800, 500), layer: 'P-FIXT', plan: sinkPlan(1) }),
  c({ name: 'Kitchen Sink - Double', group: 'families', category: 'fixtures', kind: 'Family', discipline: 'MEP', tags: ['Plumbing', 'Kitchen'], size: dims(1200, 500), sizeLabel: sz(1200, 500), layer: 'P-FIXT', plan: sinkPlan(2) }),
  c({ name: 'Urinal', group: 'families', category: 'fixtures', kind: 'Family', discipline: 'MEP', tags: ['Plumbing', 'Fixture'], size: dims(400, 350), sizeLabel: sz(400, 350), layer: 'P-FIXT', plan: () => [rect(0, 250, 400, 100), ...roundRect(40, 0, 320, 250, 120)] }),
  // ---- mechanical / hvac ----
  c({ name: 'Ceiling AC Unit 600', group: 'mechanical', category: 'hvac', kind: 'Family', discipline: 'Mechanical', tags: ['Mechanical', 'HVAC'], size: dims(600, 600, 250), sizeLabel: sz(600, 600, 250), layer: 'M-HVAC-EQPM', plan: cassette(600) }),
  c({ name: 'Fan Coil Unit 1000', group: 'mechanical', category: 'hvac', kind: 'Family', discipline: 'Mechanical', tags: ['Mechanical', 'HVAC'], size: dims(1000, 500, 250), sizeLabel: sz(1000, 500, 250), layer: 'M-HVAC-EQPM', plan: boxUnit(1000, 500, 'FCU') }),
  ...[300, 450, 600].map((w) => c({ name: `Supply Diffuser ${w}`, group: 'mechanical', category: 'hvac', kind: 'Family', discipline: 'Mechanical', tags: ['Mechanical', 'HVAC'], size: dims(w, w), sizeLabel: sz(w, w), layer: 'M-HVAC-DIFF', plan: diffuser(w) })),
  c({ name: 'Return Grille 600×300', group: 'mechanical', category: 'hvac', kind: 'Family', discipline: 'Mechanical', tags: ['Mechanical', 'HVAC'], size: dims(600, 300), sizeLabel: sz(600, 300), layer: 'M-HVAC-DIFF', plan: grille(600, 300) }),
  c({ name: 'Air Handling Unit', group: 'mechanical', category: 'hvac', kind: 'Family', discipline: 'Mechanical', tags: ['Mechanical', 'HVAC'], size: dims(3000, 1200, 1800), sizeLabel: sz(3000, 1200, 1800), layer: 'M-HVAC-EQPM', plan: boxUnit(3000, 1200, 'AHU') }),
  // ---- mechanical / piping ----
  ...([[50, 60.3], [80, 88.9], [150, 168.3], [200, 219.1]] as const).map(([dn, od]) => c({ name: `Pipe Elbow 90° DN${dn}`, group: 'mechanical', category: 'piping', kind: 'Part', discipline: 'Mechanical', tags: ['Mechanical', 'Piping'], size: dims(Math.round(od * 2), Math.round(od * 2)), sizeLabel: `DN${dn} (Ø${od} mm)`, layer: 'P-PIPE', plan: elbowPlan(od) })),
  c({ name: 'Equal Tee DN100', group: 'mechanical', category: 'piping', kind: 'Part', discipline: 'Mechanical', tags: ['Mechanical', 'Piping'], size: dims(342, 228), sizeLabel: 'DN100 (Ø114 mm)', layer: 'P-PIPE', plan: teePlan(114) }),
  ...[100, 150].map((dn) => c({ name: `Gate Valve DN${dn}`, group: 'mechanical', category: 'piping', kind: 'Part', discipline: 'Mechanical', tags: ['Mechanical', 'Valve'], size: dims(dn * 2.5, dn * 1.6), sizeLabel: `DN${dn}`, layer: 'P-PIPE-VALV', plan: valvePlan(dn) })),
  c({ name: 'Check Valve DN100', group: 'mechanical', category: 'piping', kind: 'Part', discipline: 'Mechanical', tags: ['Mechanical', 'Valve'], size: dims(250, 100), sizeLabel: 'DN100', layer: 'P-PIPE-VALV', plan: valvePlan(100, true) }),
  c({ name: 'Concentric Reducer DN150×100', group: 'mechanical', category: 'piping', kind: 'Part', discipline: 'Mechanical', tags: ['Mechanical', 'Piping'], size: dims(252, 168), sizeLabel: 'DN150 × DN100', layer: 'P-PIPE', plan: reducerPlan(168.3, 114.3) }),
  // ---- mechanical / equipment ----
  c({ name: 'Centrifugal Pump', group: 'mechanical', category: 'equipment', kind: 'Part', discipline: 'Mechanical', tags: ['Mechanical', 'Pump'], size: dims(1400, 640, 700), sizeLabel: sz(1400, 640, 700), layer: 'M-EQPM', plan: pumpPlan() }),
  ...[8, 10, 12, 16, 20, 24].map((m) => c({ name: `Hex Bolt M${m}`, group: 'mechanical', category: 'equipment', kind: 'Part', discipline: 'Mechanical', tags: ['Mechanical', 'Fastener'], size: dims(Math.round(m * 1.6 + 4), Math.round(m * 1.6 + 4)), sizeLabel: `M${m} — ISO 4014`, layer: 'M-PART', plan: boltPlan(m) })),
  ...[8, 12, 16, 20].map((m) => c({ name: `Hex Nut M${m}`, group: 'mechanical', category: 'equipment', kind: 'Part', discipline: 'Mechanical', tags: ['Mechanical', 'Fastener'], size: dims(Math.round(m * 1.6 + 4), Math.round(m * 1.6 + 4)), sizeLabel: `M${m} — ISO 4032`, layer: 'M-PART', plan: nutPlan(m) })),
  c({ name: 'Plain Washer M16', group: 'mechanical', category: 'equipment', kind: 'Part', discipline: 'Mechanical', tags: ['Mechanical', 'Fastener'], size: dims(32, 32), sizeLabel: 'M16 — ISO 7089', layer: 'M-PART', plan: washerPlan(16) }),
  ...([['6205', 25, 52], ['6208', 40, 80], ['6210', 50, 90]] as const).map(([n, d, D]) => c({ name: `Ball Bearing ${n}`, group: 'mechanical', category: 'equipment', kind: 'Part', discipline: 'Mechanical', tags: ['Mechanical', 'Bearing'], size: dims(D, D), sizeLabel: `${d} × ${D} mm`, layer: 'M-PART', plan: bearingPlan(d, D) })),
  ...([[100, 220, 8], [150, 285, 8]] as const).map(([dn, D, h]) => c({ name: `Flange DN${dn} PN16`, group: 'mechanical', category: 'equipment', kind: 'Part', discipline: 'Mechanical', tags: ['Mechanical', 'Piping'], size: dims(D, D), sizeLabel: `DN${dn}, Ø${D} mm`, layer: 'P-PIPE', plan: flangePlan(D, dn + 15, h) })),
  // ---- MEP objects ----
  ...([[600, 400], [800, 500]] as const).map(([w, h]) => c({ name: `Rectangular Duct ${w}×${h}`, group: 'mep', category: 'ductwork', kind: 'Family', discipline: 'MEP', tags: ['MEP', 'Ductwork'], size: dims(1200, w, h), sizeLabel: `${w} × ${h} × 1200 mm`, layer: 'M-DUCT', plan: ductPlan(w) })),
  ...[200, 300].map((d) => c({ name: `Round Duct Ø${d}`, group: 'mep', category: 'ductwork', kind: 'Family', discipline: 'MEP', tags: ['MEP', 'Ductwork'], size: dims(1200, d), sizeLabel: `Ø${d} × 1200 mm`, layer: 'M-DUCT', plan: roundDuct(d) })),
  ...[300, 450, 600].map((w) => c({ name: `Cable Tray ${w}`, group: 'mep', category: 'electrical', kind: 'Family', discipline: 'MEP', tags: ['MEP', 'Cable Tray'], size: dims(1200, w), sizeLabel: `${w} × 100 × 1200 mm`, layer: 'E-CABL', plan: trayPlan(w) })),
  c({ name: 'Distribution Board', group: 'mep', category: 'electrical', kind: 'Family', discipline: 'MEP', tags: ['MEP', 'Electrical'], size: dims(600, 360), sizeLabel: '600 × 200 × 800 mm', layer: 'E-POWR', plan: symbolBox(600, 'DB') }),
  c({ name: 'Socket Outlet', group: 'mep', category: 'electrical', kind: 'Family', discipline: 'MEP', tags: ['MEP', 'Electrical'], size: dims(300, 420), sizeLabel: 'Symbol', layer: 'E-POWR', plan: socketPlan() }),
  c({ name: 'Light Switch', group: 'mep', category: 'electrical', kind: 'Family', discipline: 'MEP', tags: ['MEP', 'Electrical'], size: dims(380, 330), sizeLabel: 'Symbol', layer: 'E-LITE', plan: switchPlan() }),
  c({ name: 'Floor Drain', group: 'mep', category: 'plumbing', kind: 'Family', discipline: 'MEP', tags: ['MEP', 'Plumbing'], size: dims(200, 200), sizeLabel: sz(200, 200), layer: 'P-SANR', plan: drainPlan() }),
  c({ name: 'Sprinkler Head', group: 'mep', category: 'fire', kind: 'Family', discipline: 'MEP', tags: ['MEP', 'Fire'], size: dims(200, 200), sizeLabel: 'Ø200 mm', layer: 'F-SPRN', plan: sprinkler() }),
  c({ name: 'Fire Extinguisher', group: 'mep', category: 'fire', kind: 'Family', discipline: 'MEP', tags: ['MEP', 'Fire'], size: dims(240, 240), sizeLabel: 'Ø240 mm', layer: 'F-EQPM', plan: extinguisher() }),
  // ---- materials (not insertable in CAD 2D) ----
  ...([
    ['Fabric - Light Gray', '#9a9ea3', P + 'fabric.png'], ['Concrete', '#a3a39c'], ['Wood - Oak', '#a9805a'], ['Wood - Walnut', '#6b4a33'], ['Marble - White', '#ecebe7'],
    ['Glass - Clear', '#d6e8ef'], ['Steel - Galvanized', '#b8bcc0'], ['Stainless Steel - 316', '#c4c8cc'], ['Porcelain Tile - Beige', '#d9cbb4'], ['Gypsum - White', '#f1f1ee'],
    ['Paint - Warm White', '#f4efe6'], ['Brick - Red', '#9c4a36'],
  ] as const).map(([n, col, img]) => c({ name: n, group: 'materials', category: 'surface', kind: 'Material', discipline: 'Architecture', tags: ['Material', n.split(' - ')[0]], sizeLabel: 'Surface material', layer: '0', material: MAT(n, col, img) })),
  // ---- interior modules ----
  ...[300, 450, 600, 800, 900].map((w) => c({ name: `Base Cabinet ${w}`, group: 'interior', category: 'kitchen', kind: 'Module', discipline: 'Interior', tags: ['Interior', 'Kitchen'], size: dims(w, 600, 870), sizeLabel: sz(w, 600, 870), layer: 'A-FURN-CASE', plan: cabinetPlan(w) })),
  ...[600, 800].map((w) => c({ name: `Wall Cabinet ${w}`, group: 'interior', category: 'kitchen', kind: 'Module', discipline: 'Interior', tags: ['Interior', 'Kitchen'], size: dims(w, 350, 720), sizeLabel: sz(w, 350, 720), layer: 'A-FURN-CASE', plan: cabinetPlan(w, 350) })),
  c({ name: 'Tall Cabinet 600', group: 'interior', category: 'kitchen', kind: 'Module', discipline: 'Interior', tags: ['Interior', 'Kitchen'], size: dims(600, 600, 2200), sizeLabel: sz(600, 600, 2200), layer: 'A-FURN-CASE', plan: cabinetPlan(600) }),
  c({ name: 'Kitchen Island 2400', group: 'interior', category: 'kitchen', kind: 'Module', discipline: 'Interior', tags: ['Interior', 'Kitchen'], size: dims(2400, 1000, 900), sizeLabel: sz(2400, 1000, 900), layer: 'A-FURN-CASE', plan: islandPlan(2400) }),
  c({ name: 'Wardrobe Module 1000', group: 'interior', category: 'storage', kind: 'Module', discipline: 'Interior', tags: ['Interior', 'Storage'], size: dims(1000, 600, 2400), sizeLabel: sz(1000, 600, 2400), layer: 'A-FURN-CASE', plan: wardrobePlan(1000) }),
  c({ name: 'Vanity Unit 800', group: 'interior', category: 'bath', kind: 'Module', discipline: 'Interior', tags: ['Interior', 'Bathroom'], size: dims(800, 480, 850), sizeLabel: sz(800, 480, 850), layer: 'A-FURN-CASE', plan: () => [rect(0, 0, 800, 480), ...roundRect(150, 60, 500, 340, 100)] }),
]

/** Mockup "Recently Used" strip: seeded use times (hours ago) — DEMO history until you insert components. */
export const SEED_RECENT: [string, number][] = [
  ['Office Chair', 2], ['Meeting Table', 5], ['Pendant Light', 24], ['Glass Partition', 26], ['Potted Plant', 48], ['Toilet WC', 72],
]
