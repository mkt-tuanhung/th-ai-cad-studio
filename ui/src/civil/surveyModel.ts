/**
 * Applying a survey to the canal model: the surface (TIN) gives the existing ground along the plan
 * alignment; a new alignment length stretches the design profile and structures proportionally (the
 * grade checks then show what to adjust). Pure functions over CivilModel — undoable through the store.
 */
import { buildTin, groundProfile, polyLength, type Polyline, type Tin } from './tin'
import type { Survey } from './survey'
import type { CivilModel } from './model'

const cache = new WeakMap<Survey, Map<string, Tin>>()

/** TIN of the model's survey (memoised per survey object and edge limit). */
export function tinOf(m: CivilModel): Tin | null {
  if (!m.survey) return null
  const key = String(m.tinMaxEdge ?? 'auto')
  let per = cache.get(m.survey)
  if (!per) cache.set(m.survey, (per = new Map()))
  let t = per.get(key)
  if (!t) per.set(key, (t = buildTin(m.survey, m.tinMaxEdge ?? null)))
  return t
}

export interface ApplyResult {
  model: CivilModel
  /** Stations (m) where the alignment leaves the surface. */
  missing: number[]
  /** New / old alignment length. */
  stretch: number
}

/** Re-samples the ground and fits the design to `plan` (and survey) of the model. */
export function resample(m: CivilModel): ApplyResult {
  const tin = tinOf(m)
  if (!m.plan || m.plan.length < 2) return { model: { ...m, ground: undefined }, missing: [], stretch: 1 }
  const L = Math.round(polyLength(m.plan) * 1000) / 1000
  const old = m.alignment.end - m.alignment.start
  const k = old > 0 ? L / old : 1
  const scaled: CivilModel = Math.abs(k - 1) < 1e-9 ? m : {
    ...m,
    alignment: { ...m.alignment, start: 0, end: L },
    invert: m.invert.map(([s, z]) => [Math.round(s * k * 1000) / 1000, z] as [number, number]),
    culverts: m.culverts.map((c) => ({ ...c, station: Math.round(c.station * k * 1000) / 1000 })),
  }
  if (!tin) return { model: { ...scaled, ground: undefined }, missing: [], stretch: k }
  const g = groundProfile(tin, m.plan, 20)
  return { model: { ...scaled, ground: g.profile.length >= 2 ? g.profile : undefined }, missing: g.missing, stretch: k }
}

export function withSurvey(m: CivilModel, survey: Survey, useAlignment: boolean): ApplyResult {
  return resample({ ...m, survey, plan: useAlignment && survey.alignment ? survey.alignment : m.plan })
}

export function withPlan(m: CivilModel, plan: Polyline): ApplyResult {
  return resample({ ...m, plan })
}

export function withoutSurvey(m: CivilModel): CivilModel {
  const { survey: _s, ground: _g, ...rest } = m
  return rest
}
