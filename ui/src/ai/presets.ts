/**
 * AI Intelligence Studio task presets (v2.4, docs/03 "AI Intelligence Studio"). Each one drives an EXISTING feature;
 * the status is what this build really has — a preset whose engine is still being built says so and only links
 * to the screen (nothing is faked). Words: i18n importCal.presets.items[id].
 */
import type { Route } from '../state/router'

export type PresetId = 'scan' | 'cad3d' | 'layout' | 'options3' | 'render4k' | 'views' | 'cnc'

export interface PresetDef {
  id: PresetId
  /** available: runs as a job here; partial: part of it exists (linked, with its limits); dev: in development. */
  status: 'available' | 'partial' | 'dev'
  /** Screen of the existing feature. */
  route: Route
  /** Runs as a tracked job with checkpoints (otherwise: opens the feature). */
  job: boolean
}

export const PRESETS: PresetDef[] = [
  { id: 'scan', status: 'available', route: 'cad2d', job: true },
  { id: 'cad3d', status: 'available', route: 'bim', job: true },
  // Space Planning layout generator (Interior → Space Planning → Layouts, v2.4 M2): rule-based, checked, scored;
  // the input check (measured rooms, door widths) runs here too
  { id: 'layout', status: 'available', route: 'interior', job: false },
  { id: 'options3', status: 'available', route: 'interior', job: false },
  // OCCT path tracer exists (desktop); the Blender worker is v2.4 M3
  { id: 'render4k', status: 'partial', route: 'renders', job: false },
  { id: 'views', status: 'available', route: 'bim', job: false },
  // cut list + nesting exist; production NC is gated (machine profile / release gate, v2.4 P0)
  { id: 'cnc', status: 'partial', route: 'interior', job: false },
]

/** Job steps of the presets that run as jobs (the one-command steps are those of the Auto dialog). */
export const SCAN_STEPS = [
  { id: 'intake', kind: 'compute' as const },
  { id: 'page', kind: 'compute' as const },
  { id: 'calibrate', kind: 'user' as const },
  { id: 'vectorise', kind: 'compute' as const },
  { id: 'open', kind: 'apply' as const },
]
