import type { AngleUnits, UnitSystem } from '../state/settings'

/**
 * Display formatting for measurements (Settings → Units & Precision). Drawing geometry is always
 * stored in millimetres; this only changes how results are shown (DIST / AREA, previews).
 */
const PER_MM: Record<UnitSystem, number> = { mm: 1, cm: 0.1, m: 0.001, in: 1 / 25.4 }

export interface UnitPrefs {
  units: UnitSystem
  precision: number
  angleUnits: AngleUnits
}

export function formatLength(mm: number, p: UnitPrefs): string {
  return `${(mm * PER_MM[p.units]).toFixed(p.precision)} ${p.units}`
}

/** Areas: m² for metric unit systems, ft² for inches (as the preview in mockup 06). */
export function formatArea(mm2: number, p: UnitPrefs): string {
  return p.units === 'in' ? `${(mm2 / (304.8 * 304.8)).toFixed(p.precision)} ft²` : `${(mm2 / 1e6).toFixed(p.precision)} m²`
}

export function formatAngle(rad: number, p: UnitPrefs): string {
  if (p.angleUnits === 'rad') return `${rad.toFixed(p.precision)} rad`
  if (p.angleUnits === 'grad') return `${((rad * 200) / Math.PI).toFixed(p.precision)} gon`
  return `${((rad * 180) / Math.PI).toFixed(p.precision)}°`
}

/** Shoelace area (mm²) and perimeter (mm) of a closed polygon. */
export function polygonMetrics(pts: { x: number; y: number }[]): { area: number; perimeter: number } {
  let a = 0
  let per = 0
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]
    const q = pts[(i + 1) % pts.length]
    a += p.x * q.y - q.x * p.y
    per += Math.hypot(q.x - p.x, q.y - p.y)
  }
  return { area: Math.abs(a) / 2, perimeter: per }
}
