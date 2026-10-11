/**
 * MEP engineering checks (SI units). These are standard hand-calculation formulas, not AI:
 *  - rectangular duct equivalent diameter (Huebscher), Darcy–Weisbach friction with the Haaland
 *    friction factor, galvanised steel ε = 0.15 mm, air ρ = 1.2 kg/m³, ν = 1.5e-5 m²/s;
 *  - water pipes: steel ε = 0.045 mm, ρ = 998 kg/m³, ν = 1.0e-6 m²/s;
 *  - cable voltage drop: ΔU = k · I · L · (R·cosφ + X·sinφ), k = 2 (single-phase) or √3 (three-phase).
 */

export const AIR = { rho: 1.2, nu: 1.5e-5, eps: 0.00015 }
export const WATER = { rho: 998, nu: 1.0e-6, eps: 0.000045 }

/** Huebscher equivalent diameter of a rectangular duct (same friction), metres. */
export function ductDe(wMm: number, hMm: number): number {
  const a = wMm / 1000, b = hMm / 1000
  return (1.3 * Math.pow(a * b, 0.625)) / Math.pow(a + b, 0.25)
}

/** Mean air velocity in a rectangular duct, m/s. */
export function ductVelocity(wMm: number, hMm: number, flowLps: number): number {
  return flowLps / 1000 / ((wMm / 1000) * (hMm / 1000))
}

/** Haaland explicit friction factor. */
export function frictionFactor(re: number, relRough: number): number {
  if (re < 2300) return 64 / re
  const x = -1.8 * Math.log10(Math.pow(relRough / 3.7, 1.11) + 6.9 / re)
  return 1 / (x * x)
}

/** Friction pressure loss per metre, Pa/m. */
export function frictionLoss(v: number, d: number, fluid: { rho: number; nu: number; eps: number }): number {
  if (!(v > 0 && d > 0)) return 0
  const re = (v * d) / fluid.nu
  const f = frictionFactor(re, fluid.eps / d)
  return (f / d) * ((fluid.rho * v * v) / 2)
}

export function ductLoss(wMm: number, hMm: number, flowLps: number) {
  const v = ductVelocity(wMm, hMm, flowLps)
  // friction is computed at the equivalent-diameter velocity (same flow through a round duct of De)
  const de = ductDe(wMm, hMm)
  const vRound = flowLps / 1000 / ((Math.PI * de * de) / 4)
  return { v, de, paPerM: frictionLoss(vRound, de, AIR) }
}

/** Internal diameter (mm) for nominal steel pipe sizes (Sch 40, approximate). */
export const PIPE_ID: Record<number, number> = { 15: 15.8, 20: 20.9, 25: 26.6, 32: 35.1, 40: 40.9, 50: 52.5, 65: 62.7, 80: 77.9, 100: 102.3, 125: 128.2, 150: 154.1, 200: 202.7 }

export function pipeCheck(dn: number, flowLps: number) {
  const d = (PIPE_ID[dn] ?? dn) / 1000
  const v = flowLps / 1000 / ((Math.PI * d * d) / 4)
  return { v, paPerM: frictionLoss(v, d, WATER) }
}

/** Copper conductor resistance at 70 °C (Ω/km) and reactance (Ω/km) by cross-section mm². */
export const CABLE: Record<number, { r: number; x: number; iz: number }> = {
  1.5: { r: 14.5, x: 0.115, iz: 17.5 },
  2.5: { r: 8.71, x: 0.11, iz: 24 },
  4: { r: 5.45, x: 0.107, iz: 32 },
  6: { r: 3.62, x: 0.1, iz: 41 },
  10: { r: 2.16, x: 0.094, iz: 57 },
  16: { r: 1.36, x: 0.09, iz: 76 },
  25: { r: 0.863, x: 0.086, iz: 101 },
  35: { r: 0.627, x: 0.083, iz: 125 },
  50: { r: 0.463, x: 0.083, iz: 151 },
}

export function cableCheck(kw: number, phases: 1 | 3, mm2: number, lengthM: number, pf = 0.9) {
  const u = phases === 3 ? 400 : 230
  const i = phases === 3 ? (kw * 1000) / (Math.sqrt(3) * u * pf) : (kw * 1000) / (u * pf)
  const c = CABLE[mm2]
  const k = phases === 3 ? Math.sqrt(3) : 2
  const sin = Math.sqrt(1 - pf * pf)
  const du = c ? (k * i * (lengthM / 1000) * (c.r * pf + c.x * sin)) : NaN
  return { i, vdPct: (du / u) * 100, iz: c?.iz ?? 0 }
}

/** Design limits used by the rule checks (low-velocity comfort systems). */
export const LIMITS = { ductVelMain: 8, ductLoss: 1.5, pipeVel: 2.5, pipeLoss: 400, vdPct: 3 }
