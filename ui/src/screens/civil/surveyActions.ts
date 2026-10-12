/** Store actions for surveys: import, alignment drawn on the plan, removal — each one undoable edit with feedback. */
import { fmt } from '../../i18n'
import { toast } from '../../state/toast'
import { useCivil } from '../../state/civil'
import type { Survey } from '../../civil/survey'
import { polyLength, type Polyline } from '../../civil/tin'
import { resample, tinOf, withPlan, withSurvey, withoutSurvey, type ApplyResult } from '../../civil/surveyModel'
import type { civilEn } from '../../i18n/ws/civil'

type T = (typeof civilEn)['survey']

function report(r: ApplyResult, t: T) {
  if (Math.abs(r.stretch - 1) > 1e-4) toast(fmt(t.stretched, { k: r.stretch.toFixed(4) }), 'warning')
  if (r.missing.length) toast(fmt(t.missing, { n: r.missing.length }), 'warning')
  if (!r.model.plan) toast(t.noAlignment, 'info')
}

export function applySurveyImport(survey: Survey, useAlignment: boolean, maxEdge: number | null, t: T): boolean {
  const st = useCivil.getState()
  let res: ApplyResult | null = null
  const err = st.edit(`Import survey ${survey.name}`, (m) => (res = withSurvey({ ...m, tinMaxEdge: maxEdge }, survey, useAlignment)).model)
  if (err || !res) {
    toast(fmt(t.error, { why: err ?? 'model rule' }), 'warning')
    return false
  }
  const r = res as ApplyResult
  const tin = tinOf(r.model)
  st.set({ view: 'plan', browserSel: 'sf-eg', station: Math.min(st.station, r.model.alignment.end) })
  toast(fmt(t.imported, { n: survey.x.length.toLocaleString('en-US'), t: ((tin?.tri.length ?? 0) / 3).toLocaleString('en-US') }), 'success')
  report(r, t)
  return true
}

export function applyPlan(plan: Polyline, t: T) {
  const st = useCivil.getState()
  let res: ApplyResult | null = null
  const err = st.edit('Draw alignment', (m) => (res = withPlan(m, plan)).model)
  if (err || !res) return toast(fmt(t.error, { why: err ?? 'alignment' }), 'warning')
  toast(fmt(t.drawn, { l: polyLength(plan).toFixed(1) }), 'success')
  report(res, t)
}

export function setMaxEdge(v: number | null) {
  useCivil.getState().edit('Surface edge limit', (m) => resample({ ...m, tinMaxEdge: v }).model)
}

export function removeSurvey(t: T) {
  useCivil.getState().edit('Remove survey', (m) => withoutSurvey(m))
  toast(t.removed)
}
