/**
 * Import → reviewed CAD geometry (v2.4): applies a calibration to an import, tags every entity with its source and
 * builds the review list. Pure; used by Scan to CAD (on open) and by the Calibrate dialog of CAD 2D (afterwards).
 *
 *  - calibrated: entities scaled from the nominal placement to the fitted scale; dimension texts checked against the
 *    geometry (mismatch → review item with both values);
 *  - not calibrated: geometry kept as derived from the pixels at the nominal dpi × scale, every entity marked
 *    `unscaled`, one 'uncalibrated' review item, fabrication blocked — no dimension is invented;
 *  - OCR words below the confidence threshold are kept (on SCAN-TEXT-REVIEW) as review items with their confidence.
 */
import { dimensionTexts, scaleEntity, solveScale, DIM_TOLERANCE, type CalRef, type DimTolerance, type ScaleFit } from './calibration'
import { calibrationConfidence, calibrationOf, normalize, provId, type ReviewItem, type SourceMeta } from './provenance'
import type { CadDocument, Entity } from './types'
import { summaryOf, surveyEntities, surveyRoom, type SurveyInput } from './survey'

/** OCR words below this confidence (Tesseract, 0–100) are review items instead of accepted text. */
export const OCR_CONFIDENT = 65

export interface ImportInput {
  kind: 'image' | 'pdf'
  file: string
  page: number | null
  /** Entities as placed at the nominal scale (mm). */
  entities: Entity[]
  /** Nominal placement: picture px → mm (dpi × drawing scale the user selected). */
  nominal: { dpi: number; scale: number; mmPerPx: number }
  /** References in picture px (two-point picks, OCR dimension texts). Empty = not calibrated. */
  refs: CalRef[]
  tol?: DimTolerance
}

export interface ImportResult {
  entities: Entity[]
  source: SourceMeta
  review: ReviewItem[]
  /** Final mm per picture px (underlay). */
  mmPerPx: number
  fit: ScaleFit | null
}

/** Mismatch review items of a source's dimension texts (only meaningful on calibrated geometry). */
export function mismatchItems(entities: Entity[], sourceId: string, tol: DimTolerance = DIM_TOLERANCE): ReviewItem[] {
  return dimensionTexts(entities.filter((e) => e.src?.id === sourceId), tol)
    .filter((d) => !d.ok)
    .map((d) => ({ id: provId('rv'), kind: 'ocr-dimension-mismatch' as const, sourceId, entityId: d.textId, text: d.text, ocrValue: d.value, measuredMm: Math.round(d.measured * 10) / 10, status: 'open' as const }))
}

function lowConfidenceItems(entities: Entity[], sourceId: string): ReviewItem[] {
  return entities
    .filter((e) => e.kind === 'text' && e.src?.confidence !== undefined && e.src.confidence * 100 < OCR_CONFIDENT)
    .map((e) => ({ id: provId('rv'), kind: 'ocr-low-confidence' as const, sourceId, entityId: e.id, text: e.kind === 'text' ? e.value : '', conf: Math.round((e.src?.confidence ?? 0) * 100), status: 'open' as const }))
}

export function buildImport(inp: ImportInput): ImportResult {
  const id = provId('src')
  const fit = solveScale(inp.refs)
  const ratio = fit ? fit.k / inp.nominal.mmPerPx : 1
  const calibration = fit ? calibrationOf(inp.refs, fit) : null
  let entities = inp.entities.map((e) => {
    const s = ratio === 1 ? e : scaleEntity(e, ratio)
    const low = s.kind === 'text' && s.src?.confidence !== undefined && s.src.confidence * 100 < OCR_CONFIDENT
    return { ...s, src: { ...(s.src ?? {}), id, reviewRequired: low || undefined, unscaled: fit ? undefined : true } } as Entity
  })
  const review: ReviewItem[] = []
  if (!calibration) review.push({ id: provId('rv'), kind: 'uncalibrated', sourceId: id, text: inp.file, status: 'open' })
  review.push(...lowConfidenceItems(entities, id))
  if (calibration) review.push(...mismatchItems(entities, id, inp.tol))
  const flagged = new Set(review.filter((r) => r.entityId).map((r) => r.entityId!))
  entities = entities.map((e) => (flagged.has(e.id) && e.src ? { ...e, src: { ...e.src, reviewRequired: true } } : e))
  const source: SourceMeta = {
    id, kind: inp.kind, file: inp.file, page: inp.page, calibration, confidence: calibrationConfidence(calibration),
    reviewRequired: review.length > 0, status: calibration ? 'calibrated' : 'unscaled', nominal: calibration ? null : inp.nominal, createdAt: Date.now(),
  }
  return { entities, source, review, mmPerPx: fit ? fit.k : inp.nominal.mmPerPx, fit }
}

/**
 * Calibration after opening (CAD 2D → Calibrate): `refs` measured in the drawing as it is now (mm; or underlay
 * px converted by the caller). The whole drawing and its underlay are scaled by the fitted factor about the origin
 * (the import's coordinate system), the source gets its calibration, its 'uncalibrated' item is resolved and the
 * dimension texts are checked again. Returns null when the references give no scale.
 */
export function recalibrate(doc: CadDocument, sourceId: string, refs: CalRef[], tol: DimTolerance = DIM_TOLERANCE): { doc: CadDocument; fit: ScaleFit; ratio: number } | null {
  const fit = solveScale(refs)
  const src = doc.provenance?.sources[sourceId]
  if (!fit || !src || !doc.provenance) return null
  const ratio = fit.k
  const entities = doc.entities.map((e) => {
    const s = scaleEntity(e, ratio)
    return s.src?.id === sourceId ? ({ ...s, src: { ...s.src, unscaled: undefined } } as Entity) : s
  })
  const underlay = doc.underlay ? { ...doc.underlay, origin: { x: doc.underlay.origin.x * ratio, y: doc.underlay.origin.y * ratio }, mmPerPx: doc.underlay.mmPerPx * ratio } : null
  // the calibration is expressed per picture px when the source is a picture (underlay), else per drawing mm
  const perPx = doc.underlay ? doc.underlay.mmPerPx * ratio : ratio
  const calibration = { ...calibrationOf(refs, fit), mmPerUnit: perPx }
  const kept = doc.provenance.review.filter((r) => !(r.sourceId === sourceId && (r.kind === 'uncalibrated' || (r.kind === 'ocr-dimension-mismatch' && r.status === 'open'))))
  const decided = new Set(kept.filter((r) => r.kind === 'ocr-dimension-mismatch').map((r) => r.entityId))
  const fresh = mismatchItems(entities, sourceId, tol).filter((r) => !decided.has(r.entityId))
  const review = [...kept, ...fresh]
  const open = new Set(review.filter((r) => r.status === 'open' && r.entityId).map((r) => r.entityId!))
  const tagged = entities.map((e) => (e.src?.id === sourceId ? ({ ...e, src: { ...e.src, reviewRequired: open.has(e.id) || undefined } } as Entity) : e))
  const source: SourceMeta = { ...src, calibration, confidence: calibrationConfidence(calibration), status: 'calibrated', nominal: null, reviewRequired: review.some((r) => r.sourceId === sourceId && r.status === 'open') }
  return {
    doc: { ...doc, entities: tagged, underlay, provenance: normalize({ sources: { ...doc.provenance.sources, [sourceId]: source }, review }), dirty: true },
    fit,
    ratio,
  }
}

/**
 * A measured room as a provenance source + entities + review items: out of tolerance → 'survey-tolerance' (the user
 * may accept the deviation); each missing measurement (door width…) → 'missing-measurement' with its key, resolved
 * only by entering the value (`withMeasurement` + build again). `ok: false` when the sides do not make a room.
 */
export function buildSurvey(inp: SurveyInput, labels: { area: string; height: string; doorMissing: string }, sourceId = provId('srv')) {
  const r = surveyRoom(inp)
  if (!r.ok) return { ok: false as const, result: r }
  const entities = surveyEntities(inp, r, sourceId, labels)
  const review: ReviewItem[] = []
  const dev = Math.max(r.closure, ...r.diagonals.map((d) => Math.abs(d.dev)))
  if (!r.withinTolerance) review.push({ id: provId('rv'), kind: 'survey-tolerance', sourceId, text: inp.name, deviation: Math.round(dev * 10) / 10, tolerance: inp.tolerance, status: 'open' })
  for (const key of r.missing) review.push({ id: provId('rv'), kind: 'missing-measurement', sourceId, key, text: inp.name, status: 'open' })
  const source: SourceMeta = {
    id: sourceId, kind: 'survey', file: inp.name, page: null,
    calibration: { method: 'survey-tape', points: [], refDistance: inp.sides[0], residual: Math.round(dev * 10) / 10, mmPerUnit: 1, refs: [], at: Date.now() },
    confidence: null, reviewRequired: review.length > 0, status: 'measured', tolerance: inp.tolerance, survey: summaryOf(inp, r), createdAt: Date.now(),
  }
  return { ok: true as const, result: r, entities, source, review }
}

/** Sets a missing survey measurement (`door2.width`, `ceilingHeight`…) and returns the new input. */
export function withMeasurement(inp: SurveyInput, key: string, value: number): SurveyInput {
  const m = /^door(\d+)\.(offset|width|height)$/.exec(key)
  if (m) {
    const i = Number(m[1]) - 1
    return { ...inp, doors: (inp.doors ?? []).map((d, j) => (j === i ? { ...d, [m[2]]: value } : d)) }
  }
  if (key === 'ceilingHeight' || key === 'wallThickness') return { ...inp, [key]: value }
  return inp
}

/**
 * Enters a missing survey measurement in a document: the survey source is rebuilt with the value (same source id,
 * its entities replaced), so the item disappears and the geometry shows the door. Returns the ids to erase and the
 * entities to add (for the command bus) and the provenance after.
 */
export function resurvey(doc: CadDocument, sourceId: string, key: string, value: number, labels: { area: string; height: string; doorMissing: string }) {
  const src = doc.provenance?.sources[sourceId]
  if (!src?.survey || !doc.provenance) return null
  const inp = withMeasurement(src.survey.input, key, value)
  const b = buildSurvey(inp, labels, sourceId)
  if (!b.ok) return null
  const erase = doc.entities.filter((e) => e.src?.id === sourceId).map((e) => e.id)
  // a deviation the user already accepted stays accepted
  const accepted = doc.provenance.review.filter((r) => r.sourceId === sourceId && r.kind === 'survey-tolerance' && r.status !== 'open')
  const review = [...doc.provenance.review.filter((r) => r.sourceId !== sourceId), ...b.review.filter((r) => !(r.kind === 'survey-tolerance' && accepted.length)), ...accepted]
  return { erase, add: b.entities, provenance: normalize({ sources: { ...doc.provenance.sources, [sourceId]: { ...b.source, reviewRequired: review.some((r) => r.sourceId === sourceId && r.status === 'open') } }, review }) }
}
