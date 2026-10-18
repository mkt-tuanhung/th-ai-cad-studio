/**
 * Prototype CAD document model (TypeScript, in the UI process).
 *
 * This is NOT the CAD engine. The production engine is native C++20 / OCCT behind the Qt host
 * (docs/ARCHITECTURE.md). This model exists so the UI, the command line and the command-bus
 * contract (validate → preview → commit → undo) can be built and tested before the bridge exists.
 * Units: millimetres, Y up (CAD convention).
 */
export interface Vec2 {
  x: number
  y: number
}

interface EntityBase {
  id: string
  layer: string
  /** 'ByLayer' or a hex colour. */
  color: string
  linetype: 'ByLayer' | 'Continuous' | 'Dashed' | 'DashDot'
  lineweight: 'ByLayer' | '0.13' | '0.25' | '0.35' | '0.50'
  /** 0–90 (%), AutoCAD semantics. */
  transparency: number
  /** Set on geometry inserted from the Components library as one block (selected together). */
  block?: { id: string; name: string }
  /** Imported from a DXF/DWG block instance (INSERT): instance id, block name, world rotation (radians).
   *  Informational only (plan recognition reads furniture / doors from it); selection is per entity. */
  insert?: { id: string; name: string; rot: number }
  /** Provenance (v2.4): which import / survey this entity came from (`CadDocument.provenance.sources[id]`), its
   *  own confidence (0–1, OCR words) and whether it still needs review. Absent = drawn in this app. */
  src?: import('./provenance').EntitySrc
}

export interface LineEntity extends EntityBase {
  kind: 'line'
  a: Vec2
  b: Vec2
}

export interface PolylineEntity extends EntityBase {
  kind: 'polyline'
  pts: Vec2[]
  closed: boolean
  /** Solid fill (used for north-arrow needle). */
  filled?: boolean
}

export interface CircleEntity extends EntityBase {
  kind: 'circle'
  c: Vec2
  r: number
}

export interface ArcEntity extends EntityBase {
  kind: 'arc'
  c: Vec2
  r: number
  /** Radians, counter-clockwise from +X, start → end. */
  start: number
  end: number
}

export interface TextEntity extends EntityBase {
  kind: 'text'
  p: Vec2
  height: number
  value: string
  /** Radians. */
  rotation: number
  align: 'left' | 'center'
}

/** Aligned linear dimension between a and b, dimension line offset by `offset` (signed, mm). */
export interface DimensionEntity extends EntityBase {
  kind: 'dimension'
  a: Vec2
  b: Vec2
  offset: number
  /** Text override (as typed by the drafter). null = measured value. */
  override: string | null
  textHeight: number
  /** Fixed text angle (radians); default keeps text readable along the dimension line. */
  textAngle?: number
}

export type Entity = LineEntity | PolylineEntity | CircleEntity | ArcEntity | TextEntity | DimensionEntity
export type EntityKind = Entity['kind']

export interface Layer {
  name: string
  color: string
  visible: boolean
  locked: boolean
  linetype: 'Continuous' | 'Dashed' | 'DashDot'
  lineweight: number
}

/** Raster reference (AutoCAD IMAGE/underlay). Not editable geometry. */
export interface ImageUnderlay {
  name: string
  src: string
  natW: number
  natH: number
  /** Region of the asset that is used (asset px). */
  crop: { x: number; y: number; w: number; h: number }
  /** World position of the crop's top-left corner and size of one asset px in mm. */
  origin: Vec2
  mmPerPx: number
  /** Entities with index < drawIndex are drawn behind the image (DRAWORDER). */
  drawIndex: number
}

export interface CadDocument {
  id: string
  name: string
  entities: Entity[]
  layers: Layer[]
  currentLayer: string
  underlay: ImageUnderlay | null
  blocks: string[]
  dirty: boolean
  createdAt: number
  savedAt: number | null
  /** Where the document came from — shown in References. */
  source: 'seed' | 'new' | 'dxf-import' | 'bim-drawing'
  /** Paper-space layouts (paper size and plot scale; scale null = the largest standard scale that fits). */
  layouts?: Layout[]
  /** Imported / surveyed sources, their calibration and the review list (v2.4, cad/provenance.ts). Absent =
   *  everything drawn here: nothing to review. `provenance.reviewRequired` is the doc property “REVIEW REQUIRED”. */
  provenance?: import('./provenance').DocProvenance
}

export interface Layout {
  id: string
  name: string
  paper: 'A4' | 'A3' | 'A2' | 'A1'
  scale: number | null
}

export const DEFAULT_LAYOUTS: Layout[] = [
  { id: 'layout1', name: 'Layout1', paper: 'A3', scale: null },
  { id: 'layout2', name: 'Layout2', paper: 'A1', scale: null },
]
