/**
 * Finite-element analysis of the pump shaft (rotor) — 1-D Timoshenko beam elements in the plane of the
 * radial load (2 DOF per node: deflection v, rotation θ), bearings as springs.
 *
 * - Static: impeller weight + hydraulic radial force at the impeller, coupling weight, shaft self-weight
 *   → deflection (seal faces: API 610 limit 50 µm), bending moment, combined stress with the torque.
 * - Modal: K φ = ω² M φ (consistent shaft mass + lumped impeller / coupling masses), Cholesky reduction
 *   and Jacobi eigen-solution → natural frequencies; the first is compared with the running speed
 *   (non-rotating, no gyroscopic stiffening — conservative for an overhung impeller).
 *
 * Geometry follows the 3D assembly (mech/scene.ts): impeller centre at x = 0, seal, two bearings at the
 * Bearing_Center distance, coupling. Plain FE, validated against closed-form beam solutions (tools/test-cam).
 */
import { CASING_BORE, matOf, param, type MechModel } from './model'

/* ------------------------------------------------------------------ generic beam solver */

export interface BeamSection {
  /** Element from x0 to x1 (m) with diameter d (m). */
  x0: number
  x1: number
  d: number
}

export interface BeamModel {
  sections: BeamSection[]
  E: number // Pa
  G: number // Pa
  rho: number // kg/m³
  /** Element length limit (m). */
  hMax: number
  supports: { x: number; kv: number; kt?: number }[]
  /** Point forces (N, + = along the load direction) and lumped masses (kg). */
  forces: { x: number; F: number; label?: string }[]
  masses: { x: number; m: number; label?: string }[]
  /** Distributed load per unit length due to gravity (true = self-weight along +v). */
  selfWeight: boolean
}

export interface BeamResult {
  x: number[] // node positions (m)
  v: number[] // deflection (m)
  theta: number[]
  /** Bending moment at nodes (N·m), from element end forces. */
  M: number[]
  shear: number[]
  d: number[] // diameter at nodes (m)
  freqs: number[] // Hz, ascending
  modes: number[][] // deflection shapes (normalised to max |v| = 1)
  reactions: { x: number; R: number }[]
}

const KAPPA = 0.9 // shear coefficient of a solid circular section

function nodesOf(b: BeamModel): number[] {
  const keys = new Set<number>()
  for (const s of b.sections) keys.add(+s.x0.toFixed(9)), keys.add(+s.x1.toFixed(9))
  for (const p of [...b.supports, ...b.forces, ...b.masses]) keys.add(+p.x.toFixed(9))
  const xs = [...keys].sort((a, c) => a - c)
  const out: number[] = [xs[0]]
  for (let i = 1; i < xs.length; i++) {
    const n = Math.max(1, Math.ceil((xs[i] - xs[i - 1]) / b.hMax - 1e-9))
    for (let k = 1; k <= n; k++) out.push(xs[i - 1] + ((xs[i] - xs[i - 1]) * k) / n)
  }
  return out
}

const diaAt = (b: BeamModel, xm: number) => b.sections.find((s) => xm >= Math.min(s.x0, s.x1) - 1e-12 && xm <= Math.max(s.x0, s.x1) + 1e-12)?.d ?? 0

function elementK(E: number, G: number, d: number, L: number): number[][] {
  const I = (Math.PI * d ** 4) / 64, A = (Math.PI * d * d) / 4
  const phi = (12 * E * I) / (KAPPA * G * A * L * L)
  const c = (E * I) / ((1 + phi) * L ** 3)
  return [
    [12 * c, 6 * L * c, -12 * c, 6 * L * c],
    [6 * L * c, (4 + phi) * L * L * c, -6 * L * c, (2 - phi) * L * L * c],
    [-12 * c, -6 * L * c, 12 * c, -6 * L * c],
    [6 * L * c, (2 - phi) * L * L * c, -6 * L * c, (4 + phi) * L * L * c],
  ]
}

function elementM(rho: number, d: number, L: number): number[][] {
  const m = (rho * Math.PI * d * d * L) / 4 / 420
  return [
    [156 * m, 22 * L * m, 54 * m, -13 * L * m],
    [22 * L * m, 4 * L * L * m, 13 * L * m, -3 * L * L * m],
    [54 * m, 13 * L * m, 156 * m, -22 * L * m],
    [-13 * L * m, -3 * L * L * m, -22 * L * m, 4 * L * L * m],
  ]
}

/** Dense Gaussian elimination with partial pivoting. */
export function solve(A: number[][], b: number[]): number[] {
  const n = b.length
  const M = A.map((r, i) => [...r, b[i]])
  for (let c = 0; c < n; c++) {
    let p = c
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r
    if (Math.abs(M[p][c]) < 1e-300) throw new Error('singular stiffness (unsupported rigid-body motion)')
    ;[M[c], M[p]] = [M[p], M[c]]
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c]
      if (f) for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]
    }
  }
  const x = new Array<number>(n).fill(0)
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n]
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k]
    x[r] = s / M[r][r]
  }
  return x
}

/** Symmetric eigen-decomposition by cyclic Jacobi rotations. */
export function jacobiEigen(S: number[][]): { values: number[]; vectors: number[][] } {
  const n = S.length
  const A = S.map((r) => [...r])
  const V: number[][] = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)))
  for (let sweep = 0; sweep < 100; sweep++) {
    // converged when every off-diagonal term is negligible relative to its two diagonal terms (a global
    // threshold would stop early when stiff supports make a few diagonal terms enormous)
    let done = true
    for (let i = 0; i < n && done; i++) for (let j = i + 1; j < n; j++) if (Math.abs(A[i][j]) > 1e-13 * Math.sqrt(Math.abs(A[i][i] * A[j][j])) + 1e-300) { done = false; break }
    if (done) break
    for (let p = 0; p < n; p++)
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(A[p][q]) <= 1e-15 * Math.sqrt(Math.abs(A[p][p] * A[q][q]))) continue
        const th = (A[q][q] - A[p][p]) / (2 * A[p][q])
        const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1))
        const c = 1 / Math.sqrt(t * t + 1), s = t * c
        for (let k = 0; k < n; k++) {
          const akp = A[k][p], akq = A[k][q]
          A[k][p] = c * akp - s * akq
          A[k][q] = s * akp + c * akq
        }
        for (let k = 0; k < n; k++) {
          const apk = A[p][k], aqk = A[q][k]
          A[p][k] = c * apk - s * aqk
          A[q][k] = s * apk + c * aqk
        }
        for (let k = 0; k < n; k++) {
          const vkp = V[k][p], vkq = V[k][q]
          V[k][p] = c * vkp - s * vkq
          V[k][q] = s * vkp + c * vkq
        }
      }
  }
  return { values: A.map((r, i) => r[i]), vectors: V }
}

export function solveBeam(b: BeamModel, nModes = 3): BeamResult {
  const x = nodesOf(b)
  const nn = x.length, ndof = 2 * nn
  const K = Array.from({ length: ndof }, () => new Array<number>(ndof).fill(0))
  const Mm = Array.from({ length: ndof }, () => new Array<number>(ndof).fill(0))
  const F = new Array<number>(ndof).fill(0)
  const elems: { i: number; L: number; d: number; ke: number[][]; fe: number[] }[] = []
  for (let i = 0; i < nn - 1; i++) {
    const L = x[i + 1] - x[i]
    const d = diaAt(b, (x[i] + x[i + 1]) / 2)
    const ke = elementK(b.E, b.G, d, L), me = elementM(b.rho, d, L)
    const q = b.selfWeight ? (b.rho * Math.PI * d * d * 9.81) / 4 : 0
    const fe = [(q * L) / 2, (q * L * L) / 12, (q * L) / 2, (-q * L * L) / 12]
    for (let r = 0; r < 4; r++) {
      F[2 * i + r] += fe[r]
      for (let c = 0; c < 4; c++) {
        K[2 * i + r][2 * i + c] += ke[r][c]
        Mm[2 * i + r][2 * i + c] += me[r][c]
      }
    }
    elems.push({ i, L, d, ke, fe })
  }
  const nodeAt = (px: number) => x.reduce((bi, xi, i) => (Math.abs(xi - px) < Math.abs(x[bi] - px) ? i : bi), 0)
  for (const s of b.supports) {
    const n = nodeAt(s.x)
    K[2 * n][2 * n] += s.kv
    if (s.kt) K[2 * n + 1][2 * n + 1] += s.kt
  }
  for (const f of b.forces) F[2 * nodeAt(f.x)] += f.F
  for (const m of b.masses) Mm[2 * nodeAt(m.x)][2 * nodeAt(m.x)] += m.m
  const u = solve(K, F)
  const v = x.map((_, i) => u[2 * i]), theta = x.map((_, i) => u[2 * i + 1])
  // internal forces from element end forces (sign convention: sagging moment positive)
  const M = new Array<number>(nn).fill(0), V = new Array<number>(nn).fill(0)
  for (const e of elems) {
    const ue = [u[2 * e.i], u[2 * e.i + 1], u[2 * e.i + 2], u[2 * e.i + 3]]
    const fend = e.ke.map((r, k) => r.reduce((a, kk, c) => a + kk * ue[c], 0) - e.fe[k])
    if (e.i === 0) (M[0] = -fend[1]), (V[0] = fend[0])
    M[e.i + 1] = fend[3]
    V[e.i + 1] = -fend[2]
  }
  const reactions = b.supports.map((s) => ({ x: s.x, R: -s.kv * v[nodeAt(s.x)] }))
  // modal: Cholesky of M, standard symmetric problem L⁻¹ K L⁻ᵀ
  const Lc = Array.from({ length: ndof }, () => new Array<number>(ndof).fill(0))
  for (let i = 0; i < ndof; i++)
    for (let j = 0; j <= i; j++) {
      let s = Mm[i][j]
      for (let k = 0; k < j; k++) s -= Lc[i][k] * Lc[j][k]
      Lc[i][j] = i === j ? Math.sqrt(Math.max(s, 1e-30)) : s / Lc[j][j]
    }
  const inv = (vec: number[]) => {
    // forward substitution L y = vec
    const y = new Array<number>(ndof).fill(0)
    for (let i = 0; i < ndof; i++) {
      let s = vec[i]
      for (let k = 0; k < i; k++) s -= Lc[i][k] * y[k]
      y[i] = s / Lc[i][i]
    }
    return y
  }
  // A = L⁻¹ K L⁻ᵀ: columns of L⁻¹ K, then the same on the transpose
  const LiK = K[0].map((_, c) => inv(K.map((r) => r[c]))) // columns of L⁻¹K (as rows)
  const LiKt = Array.from({ length: ndof }, (_, r) => LiK.map((col) => col[r])) // L⁻¹K as a matrix
  const Acol = LiKt.map((row) => inv(row)) // rows of (L⁻¹ (L⁻¹K)ᵀ) = rows of L⁻¹ K L⁻ᵀ (symmetric)
  const { values, vectors } = jacobiEigen(Acol)
  const idx = values.map((_, i) => i).sort((a, c) => values[a] - values[c]).filter((i) => values[i] > 0).slice(0, nModes)
  // back-transform φ = L⁻ᵀ y
  const back = (y: number[]) => {
    const z = new Array<number>(ndof).fill(0)
    for (let i = ndof - 1; i >= 0; i--) {
      let s = y[i]
      for (let k = i + 1; k < ndof; k++) s -= Lc[k][i] * z[k]
      z[i] = s / Lc[i][i]
    }
    return z
  }
  const modes = idx.map((i) => {
    const phi = back(vectors.map((r) => r[i]))
    const vv = x.map((_, n) => phi[2 * n])
    const mx = vv.reduce((a, c) => (Math.abs(c) > Math.abs(a) ? c : a), 0) || 1
    return vv.map((c) => c / mx)
  })
  return { x, v, theta, M, shear: V, d: x.map((xi) => diaAt(b, xi)), freqs: idx.map((i) => Math.sqrt(values[i]) / (2 * Math.PI)), modes, reactions }
}

/* ------------------------------------------------------------------ pump rotor */

export interface ShaftInputs {
  /** Hydraulic radial force on the impeller (N); null = Stepanoff estimate below. */
  radialForce: number | null
  /** Radial thrust factor K (volute pump, ~0.36 at shut-off, ~0.1 near BEP). */
  K: number
  /** Head coefficient ψ for the head estimate H = ψ u² / (2g). */
  psi: number
  /** Bearing radial stiffness (N/m). */
  bearingK: number
  /** Fluid density (kg/m³). */
  rhoFluid: number
}

export const DEFAULT_SHAFT: ShaftInputs = { radialForce: null, K: 0.36, psi: 1.0, bearingK: 2e8, rhoFluid: 998 }

export interface ShaftReport {
  inputs: ShaftInputs
  stations: { impeller: number; seal: number; bearing1: number; bearing2: number; coupling: number; end0: number; end1: number }
  loads: { impellerMass: number; couplingMass: number; head: number; tipSpeed: number; b2: number; Fr: number; torque: number }
  material: { name: string; E: number; yieldMPa: number }
  res: BeamResult
  sealDeflection: number // m
  maxDeflection: number // m (at the impeller)
  maxMoment: number // N·m
  sigmaB: number // MPa at the max moment
  tau: number // MPa
  sigmaVM: number // MPa
  safety: number | null
  critical1: number // rpm
  margin: number // (critical − running) / running
  speed: number // rpm
  pass: { deflection: boolean; stress: boolean; critical: boolean }
}

export function shaftFea(m: MechModel, inp: ShaftInputs = DEFAULT_SHAFT): ShaftReport {
  const imp = param(m, 'Impeller_Dia'), shaftD = param(m, 'Shaft_Dia'), t = param(m, 'Casing_Thickness'), bc = param(m, 'Bearing_Center')
  const kw = param(m, 'Motor_Power'), n = param(m, 'Speed')
  // same layout as the 3D assembly (mech/scene.ts), mm → m
  const B = Math.max(60, imp * 0.32), w = Math.min(B - 2 * t - 8, imp * 0.12)
  const xbh0 = -B / 2 - t - 90, xbh1 = xbh0 - bc - 80, xc = xbh1 - 70
  const mm = (v: number) => v / 1000
  const st = { end0: mm(w / 2 + 12), impeller: 0, seal: mm(-B / 2 - t - 45), bearing1: mm(xbh0 - 40), bearing2: mm(xbh0 - 40 - bc), coupling: mm(xc - 30), end1: mm(xc - 58) }
  const shaftMat = matOf(m.components.find((c) => c.id === 'shaft')!.material)!
  const dens = (id: string) => matOf(m.components.find((c) => c.id === id)!.material)?.density ?? 7850
  const vol = (id: string) => m.components.find((c) => c.id === id)!.volume
  const impMass = vol('impeller') * dens('impeller')
  const coupMass = (vol('coupling') * dens('coupling')) / 2 // pump-side hub; the other half sits on the motor shaft
  // Stepanoff radial thrust: Fr = K ρ g H D2 b2, head from the tip speed
  const u = (Math.PI * mm(imp) * n) / 60
  const H = (inp.psi * u * u) / (2 * 9.81)
  const b2 = mm(Math.max(4, w - 12))
  const Fr = inp.radialForce ?? inp.K * inp.rhoFluid * 9.81 * H * mm(imp) * b2
  const T = (kw * 1000) / ((2 * Math.PI * n) / 60)
  const E = shaftMat.E * 1e9
  const model: BeamModel = {
    sections: [{ x0: st.end1, x1: st.end0, d: mm(shaftD) }],
    E,
    G: E / (2 * (1 + 0.3)),
    rho: shaftMat.density,
    hMax: 0.015,
    supports: [{ x: st.bearing1, kv: inp.bearingK }, { x: st.bearing2, kv: inp.bearingK }],
    // worst case: hydraulic radial force aligned with the weight
    forces: [{ x: st.impeller, F: Fr + impMass * 9.81, label: 'impeller' }, { x: st.coupling, F: coupMass * 9.81, label: 'coupling' }],
    masses: [{ x: st.impeller, m: impMass }, { x: st.coupling, m: coupMass }],
    selfWeight: true,
  }
  const res = solveBeam(model)
  const at = (px: number) => res.x.reduce((bi, xi, i) => (Math.abs(xi - px) < Math.abs(res.x[bi] - px) ? i : bi), 0)
  const maxM = res.M.reduce((a, c) => (Math.abs(c) > Math.abs(a) ? c : a), 0)
  const d = mm(shaftD)
  const sigmaB = (32 * Math.abs(maxM)) / (Math.PI * d ** 3) / 1e6
  const tau = (16 * T) / (Math.PI * d ** 3) / 1e6
  const sigmaVM = Math.sqrt(sigmaB ** 2 + 3 * tau ** 2)
  const crit = res.freqs[0] * 60
  const sealDefl = Math.abs(res.v[at(st.seal)])
  const report: ShaftReport = {
    inputs: inp,
    stations: st,
    loads: { impellerMass: impMass, couplingMass: coupMass, head: H, tipSpeed: u, b2, Fr, torque: T },
    material: { name: shaftMat.name, E: shaftMat.E, yieldMPa: shaftMat.yieldMPa },
    res,
    sealDeflection: sealDefl,
    maxDeflection: Math.max(...res.v.map(Math.abs)),
    maxMoment: maxM,
    sigmaB,
    tau,
    sigmaVM,
    safety: shaftMat.yieldMPa ? shaftMat.yieldMPa / sigmaVM : null,
    critical1: crit,
    margin: (crit - n) / n,
    speed: n,
    pass: { deflection: sealDefl <= 50e-6, stress: !!shaftMat.yieldMPa && shaftMat.yieldMPa / sigmaVM >= 2, critical: (crit - n) / n >= 0.2 },
  }
  return report
}

/** Radial clearance check kept for the summary (mm). */
export const impellerClearance = (m: MechModel) => (CASING_BORE - param(m, 'Impeller_Dia')) / 2
