/**
 * Centrifugal pump assembly (sample project, Industrial Equipment). Driving parameters, components with
 * materials, bill of materials, mates and engineering hand checks. Mass = volume × material density.
 * Volume / surface area / centre of mass are the sample geometry's values until the 3D mechanical
 * kernel is connected; checks use standard formulas (no FEA, no AI):
 *  - interference/clearance: impeller vs casing bore (radial), shaft vs bearing bore;
 *  - shaft torsion τ = 16·T / (π·d³), T = P / ω, allowable with keyway factor 0.75;
 *  - casing wall: thin-wall hoop stress σ = p·D / (2·t) against the material's allowable;
 *  - nozzles: DN series (EN 1092-1) with discharge ≤ suction (ISO 5199 layout);
 *  - manufacturability: minimum sand-cast wall 6 mm.
 */

export interface Param {
  name: string
  value: number
  unit: string
  description: string
  min: number
  max: number
}

export interface Material {
  name: string
  density: number // kg/m³
  allowable: number // MPa (design shear for shafts / tensile for casings)
}

export const MATERIALS: Material[] = [
  { name: 'Stainless Steel - 316', density: 8000, allowable: 138 },
  { name: 'Stainless Steel - 304', density: 7930, allowable: 138 },
  { name: 'Cast Iron - GG25', density: 7200, allowable: 60 },
  { name: 'Duplex 2205', density: 7800, allowable: 207 },
  { name: 'AISI 1045', density: 7850, allowable: 40 },
  { name: 'Steel', density: 7850, allowable: 120 },
  { name: 'SiC/Carbon', density: 2600, allowable: 0 },
  { name: 'Bronze', density: 8800, allowable: 70 },
]

export interface Component {
  id: string
  file: string
  kind: 'Assembly' | 'Part'
  dir: string
  description: string
  material: string
  /** Sample geometry (from the model file) */
  volume: number // m³
  area: number // m²
  com: [number, number, number] // m
  color: string
  opacity: number
  children?: string[]
}

export interface BomLine {
  n: number
  name: string
  partNo: string
  material: string
  qty: number
  component?: string
}

export type MateKind = 'Concentric' | 'Coincident' | 'Distance' | 'Angle' | 'Parallel'
export interface Mate {
  id: string
  kind: MateKind
  a: string
  b: string
  value?: string
}

export interface MechModel {
  params: Param[]
  components: Component[]
  bom: BomLine[]
  mates: Mate[]
  configs: { name: string; motorKw: number; active: boolean }[]
}

export function createPump(): MechModel {
  return {
    params: [
      { name: 'D_inlet', value: 80, unit: 'mm', description: 'Inlet flange diameter', min: 25, max: 300 },
      { name: 'D_outlet', value: 65, unit: 'mm', description: 'Outlet flange diameter', min: 25, max: 300 },
      { name: 'Impeller_Dia', value: 220, unit: 'mm', description: 'Impeller outer diameter', min: 100, max: 400 },
      { name: 'Shaft_Dia', value: 40, unit: 'mm', description: 'Shaft diameter', min: 20, max: 80 },
      { name: 'Bearing_Center', value: 280, unit: 'mm', description: 'Distance between bearings', min: 150, max: 600 },
      { name: 'Casing_Thickness', value: 12, unit: 'mm', description: 'Casing wall thickness', min: 3, max: 40 },
      { name: 'Motor_Power', value: 11, unit: 'kW', description: 'Motor rated power', min: 0.5, max: 200 },
      { name: 'Speed', value: 2900, unit: 'rpm', description: 'Rated speed', min: 500, max: 3600 },
    ],
    components: [
      { id: 'casing', file: 'Pump_Casing.asm', kind: 'Assembly', dir: '/Pump/Assemblies/', description: 'Centrifugal pump casing with inlet and outlet flanges', material: 'Stainless Steel - 316', volume: 0.00158, area: 1.246, com: [-0.012, 0.034, 0.128], color: '#a3a7ad', opacity: 100 },
      { id: 'impeller', file: 'Impeller.asm', kind: 'Assembly', dir: '/Pump/Assemblies/', description: 'Closed impeller, 6 vanes', material: 'Stainless Steel - 316', volume: 0.00041, area: 0.214, com: [0, 0, 0.142], color: '#a3a7ad', opacity: 100 },
      { id: 'shaft', file: 'Shaft.asm', kind: 'Assembly', dir: '/Pump/Assemblies/', description: 'Pump shaft with keyways', material: 'AISI 1045', volume: 0.00062, area: 0.089, com: [0, 0, -0.05], color: '#8c9198', opacity: 100 },
      { id: 'bearing', file: 'Bearing_Housing.asm', kind: 'Assembly', dir: '/Pump/Assemblies/', description: 'Bearing housing, 2 × 6208', material: 'Cast Iron - GG25', volume: 0.0021, area: 0.61, com: [0, 0, -0.16], color: '#8c9198', opacity: 100 },
      { id: 'seal', file: 'Mechanical_Seal.asm', kind: 'Assembly', dir: '/Pump/Assemblies/', description: 'Single mechanical seal', material: 'SiC/Carbon', volume: 0.00008, area: 0.02, com: [0, 0, 0.07], color: '#5f646b', opacity: 100 },
      { id: 'coupling', file: 'Coupling.asm', kind: 'Assembly', dir: '/Pump/Assemblies/', description: 'Flexible jaw coupling with spacer', material: 'Steel', volume: 0.00035, area: 0.11, com: [0, 0, -0.34], color: '#5f646b', opacity: 100 },
      { id: 'motormount', file: 'Motor_Mount.asm', kind: 'Assembly', dir: '/Pump/Assemblies/', description: 'Motor mount and shims', material: 'Steel', volume: 0.0009, area: 0.3, com: [0, -0.12, -0.6], color: '#8c9198', opacity: 100 },
      { id: 'baseplate', file: 'Base_Plate.prt', kind: 'Part', dir: '/Pump/Parts/', description: 'Fabricated base plate', material: 'Steel', volume: 0.0062, area: 2.1, com: [0, -0.25, -0.3], color: '#8c9198', opacity: 100 },
      { id: 'fasteners', file: 'Fasteners', kind: 'Part', dir: '/Pump/Standard/', description: 'ISO 4014 bolts M12–M16, washers, nuts', material: 'Steel', volume: 0.0007, area: 0.4, com: [0, -0.05, -0.2], color: '#5f646b', opacity: 100 },
    ],
    bom: [
      ['Pump Casing', 'PC-001', 'SS316', 1, 'casing'], ['Impeller', 'IM-001', 'SS316', 1, 'impeller'], ['Shaft', 'SH-001', 'AISI 1045', 1, 'shaft'], ['Bearing 6208', 'BRG-6208', 'Steel', 2, 'bearing'],
      ['Mechanical Seal', 'MS-001', 'SiC/Carbon', 1, 'seal'], ['Coupling', 'CP-001', 'Steel', 1, 'coupling'], ['Bearing Housing', 'BH-001', 'GG25', 1, 'bearing'], ['Casing Cover', 'CC-001', 'SS316', 1, 'casing'],
      ['Wear Ring', 'WR-001', 'Bronze', 2, 'casing'], ['Shaft Sleeve', 'SS-001', 'SS316', 1, 'shaft'], ['Impeller Nut', 'IN-001', 'SS316', 1, 'impeller'], ['Key 10×8×45', 'KY-1045', 'Steel', 2, 'shaft'],
      ['Oil Seal', 'OS-001', 'NBR', 2, 'bearing'], ['Bearing Cover', 'BC-001', 'GG25', 2, 'bearing'], ['Casing Gasket', 'GK-001', 'PTFE', 1, 'casing'], ['Drain Plug', 'DP-001', 'SS316', 1, 'casing'],
      ['Coupling Guard', 'CG-001', 'Steel', 1, 'coupling'], ['Motor 11 kW 2P', 'MT-011', 'Cast Iron', 1, 'motormount'], ['Motor Mount', 'MM-001', 'Steel', 1, 'motormount'], ['Base Plate', 'BP-001', 'Steel', 1, 'baseplate'],
      ['Hex Bolt M16×60', 'ISO4014-M16', 'Steel', 8, 'fasteners'], ['Hex Bolt M12×40', 'ISO4014-M12', 'Steel', 12, 'fasteners'], ['Washer M16', 'ISO7089-16', 'Steel', 8, 'fasteners'], ['Hex Nut M12', 'ISO4032-M12', 'Steel', 8, 'fasteners'],
    ].map(([name, partNo, material, qty, component], i) => ({ n: i + 1, name: name as string, partNo: partNo as string, material: material as string, qty: qty as number, component: component as string })),
    mates: [
      { id: 'm1', kind: 'Concentric', a: 'Shaft', b: 'Bearing_Housing' },
      { id: 'm2', kind: 'Coincident', a: 'Impeller', b: 'Shaft (shoulder)' },
      { id: 'm3', kind: 'Coincident', a: 'Pump_Casing', b: 'Bearing_Housing (flange)' },
      { id: 'm4', kind: 'Distance', a: 'Coupling', b: 'Motor_Mount', value: '4 mm' },
      { id: 'm5', kind: 'Distance', a: 'Motor_Mount', b: 'Base_Plate', value: '0 mm' },
      { id: 'm6', kind: 'Distance', a: 'Pump_Casing', b: 'Base_Plate', value: '0 mm' },
      { id: 'm7', kind: 'Angle', a: 'Pump_Casing (outlet)', b: 'Base_Plate (top)', value: '90°' },
      { id: 'm8', kind: 'Parallel', a: 'Shaft', b: 'Base_Plate (top)' },
    ],
    configs: [
      { name: 'Default - 11 kW', motorKw: 11, active: true },
      { name: 'High head - 15 kW', motorKw: 15, active: false },
      { name: 'Low flow - 7.5 kW', motorKw: 7.5, active: false },
    ],
  }
}

export const param = (m: MechModel, n: string) => m.params.find((p) => p.name === n)!.value
export const matOf = (name: string) => MATERIALS.find((x) => x.name === name)

/* ---------------- checks ---------------- */

const DN = [25, 32, 40, 50, 65, 80, 100, 125, 150, 200, 250, 300]
const CASING_BORE = 236 // mm, volute cut-water circle of the casing pattern
const BEARING_6208_BORE = 40 // mm
const DESIGN_PRESSURE = 1.6 // MPa (PN16)

export type Tone = 'ok' | 'warn' | 'err'
export interface DesignCheck {
  key: 'interference' | 'clearance' | 'strength' | 'standard' | 'dfm'
  tone: Tone
  detail: string
  /** Numeric facts for the UI text */
  facts: Record<string, string>
}

export function designChecks(m: MechModel): DesignCheck[] {
  const imp = param(m, 'Impeller_Dia'), shaft = param(m, 'Shaft_Dia'), t = param(m, 'Casing_Thickness')
  const P = param(m, 'Motor_Power') * 1000, n = param(m, 'Speed'), din = param(m, 'D_inlet'), dout = param(m, 'D_outlet')
  const radial = (CASING_BORE - imp) / 2
  const fitBearing = shaft - BEARING_6208_BORE
  const interference = radial <= 0 || fitBearing > 0
  const T = P / ((2 * Math.PI * n) / 60) // N·m
  const tau = (16 * T * 1000) / (Math.PI * Math.pow(shaft, 3)) // MPa (T in N·mm)
  const shaftMat = matOf(m.components.find((c) => c.id === 'shaft')!.material)!
  const tauAllow = shaftMat.allowable * 0.75
  const casingMat = matOf(m.components.find((c) => c.id === 'casing')!.material)!
  const hoop = (DESIGN_PRESSURE * (imp + 2 * t)) / (2 * t)
  const strengthWarns = [tau > tauAllow, hoop > casingMat.allowable].filter(Boolean).length
  const stdOk = DN.includes(din) && DN.includes(dout) && dout <= din
  const dfmOk = t >= 6
  return [
    { key: 'interference', tone: interference ? 'err' : 'ok', detail: interference ? 'interference' : 'none', facts: { radial: radial.toFixed(1), fit: fitBearing > 0 ? `+${fitBearing}` : '0' } },
    { key: 'clearance', tone: radial < 2 ? 'warn' : 'ok', detail: radial < 2 ? 'small' : 'ok', facts: { radial: radial.toFixed(1) } },
    { key: 'strength', tone: strengthWarns ? 'warn' : 'ok', detail: String(strengthWarns), facts: { tau: tau.toFixed(1), tauAllow: tauAllow.toFixed(0), hoop: hoop.toFixed(1), allow: String(casingMat.allowable), T: T.toFixed(1) } },
    { key: 'standard', tone: stdOk ? 'ok' : 'warn', detail: stdOk ? 'ok' : 'bad', facts: { din: String(din), dout: String(dout) } },
    { key: 'dfm', tone: dfmOk ? 'ok' : 'warn', detail: dfmOk ? 'ok' : 'thin', facts: { t: String(t) } },
  ]
}

export function massOf(c: Component): number | null {
  const mat = matOf(c.material)
  return mat ? c.volume * mat.density : null
}
