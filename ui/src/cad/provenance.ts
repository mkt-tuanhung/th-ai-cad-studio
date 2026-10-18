/**
 * Provenance and REVIEW REQUIRED of CAD 2D documents (v2.4 SP13 / SP14, V24-018 / 020 / 031).
 *
 * Every imported, vectorised or surveyed entity points (`entity.src.id`) at a source of the document
 * (`doc.provenance.sources`): what it came from (image, PDF page, measured survey), how it was scaled (calibration
 * with its references and residual, or none) and the review items it raised (uncalibrated scale, uncertain OCR
 * words, dimension texts that disagree with the geometry, survey out of tolerance, missing measurements).
 *
 * `fabricationAllowed(doc)` is the gate for manufacturing (CNC / cut lists / nesting): false, with the reasons,
 * while any source is unscaled or any review item is unresolved. Drawings without provenance (drawn here, DXF/DWG
 * opened) carry no review and are not blocked by this gate (other gates — machine profile, release — still apply).
 */
import type { CadDocument, Entity, Vec2 } from './types'
import type { CalRef } from './calibration'

export type SourceKind = 'image' | 'pdf' | 'survey' | 'drawn'
export type CalibrationMethod = 'two-point' | 'ocr-dimension' | 'entity-reference' | 'mixed' | 'survey-tape'

export interface Calibration {
  method: CalibrationMethod
  /** Reference point pairs, in source units (picture px; drawing mm for entity references). */
  points: { a: Vec2; b: Vec2 }[]
  /** True distance of the first reference (mm); every reference is in `refs`. */
  refDistance: number
  /** RMS misfit of the references (mm); null with one reference. */
  residual: number | null
  /** Resulting scale: mm per source unit (picture px). */
  mmPerUnit: number
  refs: CalRef[]
  at: number
}

export interface SourceMeta {
  id: string
  kind: SourceKind
  file: string
  /** PDF page (1-based); null for images and surveys. */
  page: number | null
  calibration: Calibration | null
  /** Fit quality 0–1 where it can be measured (1 − relative residual of ≥ 2 references; closure for surveys);
   *  null when it cannot (one reference); 0 when unscaled. Not a guess about the drawing's correctness. */
  confidence: number | null
  reviewRequired: boolean
  /** calibrated = true scale; unscaled = pixel-derived at the nominal dpi × scale typed, NOT verified;
   *  measured = surveyed on site (within / outside its tolerance). */
  status: 'calibrated' | 'unscaled' | 'measured'
  /** The nominal scale an unscaled import was placed at (what the user selected — not verified). */
  nominal?: { dpi: number; scale: number; mmPerPx: number } | null
  /** Survey tolerance (mm). */
  tolerance?: number
  survey?: import('./survey').SurveySummary
  createdAt: number
}

export type ReviewKind = 'uncalibrated' | 'ocr-low-confidence' | 'ocr-dimension-mismatch' | 'survey-tolerance' | 'missing-measurement'

export interface ReviewItem {
  id: string
  kind: ReviewKind
  sourceId: string
  entityId?: string
  /** OCR text / what the item is about. */
  text?: string
  /** OCR confidence (0–100). */
  conf?: number
  /** Dimension mismatch: value written vs length measured (mm). */
  ocrValue?: number
  measuredMm?: number
  /** Survey: deviation found (mm) and the tolerance (mm). */
  deviation?: number
  tolerance?: number
  /** Missing measurement: what to ask the user (key of the measurement). */
  key?: string
  status: 'open' | 'confirmed' | 'rejected'
}

export interface DocProvenance {
  sources: Record<string, SourceMeta>
  review: ReviewItem[]
  /** Doc property shown as the REVIEW REQUIRED banner (kept in step by `normalize`). */
  reviewRequired: boolean
}

/** Per-entity provenance: source id, own confidence (0–1), review flag, OCR box (world mm). */
export interface EntitySrc {
  id: string
  confidence?: number
  reviewRequired?: boolean
  bbox?: { x0: number; y0: number; x1: number; y1: number }
  /** “unscaled”: geometry derived from pixels at a nominal scale, not verified. */
  unscaled?: boolean
}

/** Kinds that can only be resolved by doing something (calibrating, entering the value), not by a click. */
const NOT_CONFIRMABLE: ReviewKind[] = ['uncalibrated', 'missing-measurement']
export const confirmable = (k: ReviewKind) => !NOT_CONFIRMABLE.includes(k)

export function normalize(p: Omit<DocProvenance, 'reviewRequired'> & { reviewRequired?: boolean }): DocProvenance {
  const reviewRequired = Object.values(p.sources).some((s) => s.calibration === null && s.kind !== 'survey' && s.kind !== 'drawn') || p.review.some((r) => r.status === 'open')
  return { sources: p.sources, review: p.review, reviewRequired }
}

export const openReview = (doc: CadDocument): ReviewItem[] => doc.provenance?.review.filter((r) => r.status === 'open') ?? []

/** The REVIEW REQUIRED doc property (recomputed — never trusts a stale flag). */
export const reviewRequired = (doc: CadDocument): boolean => (doc.provenance ? normalize(doc.provenance).reviewRequired : false)

export interface GateReason {
  code: 'uncalibrated' | 'open-review'
  /** Human-readable (English) — the UI shows its own translated text from the code / counts. */
  detail: string
  sourceId?: string
  items?: string[]
}

/**
 * Manufacturing gate of a CAD 2D document. ok = false while an imported source has no calibration (its
 * dimensions are pixel-derived, unscaled) or any review item is open. Exposed for the CNC / nesting side:
 * `import { fabricationAllowed } from 'src/cad/provenance'`.
 */
export function fabricationAllowed(doc: CadDocument | null | undefined): { ok: boolean; reasons: GateReason[] } {
  if (!doc) return { ok: false, reasons: [{ code: 'open-review', detail: 'no drawing' }] }
  const reasons: GateReason[] = []
  for (const s of Object.values(doc.provenance?.sources ?? {}))
    if (s.calibration === null && (s.kind === 'image' || s.kind === 'pdf'))
      reasons.push({ code: 'uncalibrated', sourceId: s.id, detail: `${s.file}${s.page ? ` p.${s.page}` : ''}: no scale calibration — geometry is unscaled (pixel-derived)` })
  const open = openReview(doc).filter((r) => r.kind !== 'uncalibrated')
  if (open.length) reasons.push({ code: 'open-review', detail: `${open.length} review item(s) unresolved`, items: open.map((r) => r.id) })
  return { ok: reasons.length === 0, reasons }
}

/** Full provenance of one entity (null = drawn in this app). */
export function entitySource(doc: CadDocument, e: Entity): (SourceMeta & { entity: EntitySrc }) | null {
  if (!e.src) return null
  const s = doc.provenance?.sources[e.src.id]
  return s ? { ...s, entity: e.src } : null
}

/** Adds a source with its entities' review items to the document's provenance (pure). */
export function addSource(doc: CadDocument, source: SourceMeta, review: ReviewItem[]): CadDocument {
  const prev = doc.provenance ?? { sources: {}, review: [], reviewRequired: false }
  return { ...doc, provenance: normalize({ sources: { ...prev.sources, [source.id]: source }, review: [...prev.review.filter((r) => r.sourceId !== source.id), ...review] }) }
}

/** Confirms / rejects / re-opens a review item; a confirmed OCR word or dimension loses its entity review flag. */
export function setReviewStatus(doc: CadDocument, itemId: string, status: ReviewItem['status']): CadDocument {
  if (!doc.provenance) return doc
  const item = doc.provenance.review.find((r) => r.id === itemId)
  if (!item) return doc
  if (status === 'confirmed' && !confirmable(item.kind)) return doc
  const review = doc.provenance.review.map((r) => (r.id === itemId ? { ...r, status } : r))
  const stillOpen = (eid: string) => review.some((r) => r.entityId === eid && r.status === 'open')
  const entities = item.entityId
    ? doc.entities.map((e) => (e.id === item.entityId && e.src ? { ...e, src: { ...e.src, reviewRequired: stillOpen(e.id) } } : e))
    : doc.entities
  return { ...doc, entities, provenance: normalize({ ...doc.provenance, review }), dirty: true }
}

/** Unique ids for sources and review items. */
let seq = 0
export const provId = (p: string) => `${p}-${Date.now().toString(36)}-${(++seq).toString(36)}`

/** Calibration record from a fit (method from the references used). */
export function calibrationOf(refs: CalRef[], fit: { k: number; residual: number | null }): Calibration {
  const methods = new Set(refs.map((r) => r.method))
  return {
    method: methods.size > 1 ? 'mixed' : (refs[0]?.method ?? 'two-point'),
    points: refs.map((r) => ({ a: r.a, b: r.b })),
    refDistance: refs[0]?.refDistance ?? 0,
    residual: fit.residual,
    mmPerUnit: fit.k,
    refs,
    at: Date.now(),
  }
}

/** Fit quality as confidence: 1 − residual / mean reference length (≥ 2 refs), null with one reference. */
export function calibrationConfidence(c: Calibration | null): number | null {
  if (!c) return 0
  if (c.residual === null) return null
  const mean = c.refs.reduce((a, r) => a + r.refDistance, 0) / Math.max(1, c.refs.length)
  return Math.max(0, Math.min(1, 1 - c.residual / Math.max(1e-9, mean)))
}
