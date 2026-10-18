/**
 * The one-command result (auto/pipeline.ts AutoResult) of a plan picture: the recognised plan (bim/fromCad.ts
 * Recognition) goes through the same builders as a DWG plan — BIM model (bim/fromCadBuild.ts buildBimModel), model
 * checks, Interior data (buildInterior) — so the review, the approval, the package and the undo are those of the
 * DWG path (screens/auto/AutoDialog.tsx). A picture has no furniture blocks: the living rooms, bedrooms and kitchens
 * are furnished by the existing room-type layout rules (interior/options.ts generateLayouts, catalog items, the best
 * valid option), the room doors taken from the BIM model (interior/bimDoors.ts). Pure; nothing is applied here.
 */
import type { AutoResult } from '../auto/pipeline'
import { norm, type Recognition } from '../bim/fromCad'
import { buildBimModel, buildInterior, DEFAULT_BUILD, type BuildNames, type InteriorBuild } from '../bim/fromCadBuild'
import { runModelChecks, type BimModel } from '../bim/model'
import { doorsFromBim } from '../interior/bimDoors'
import type { InteriorDoc } from '../state/interior'
import { applyChangeSet, generateLayouts, type RoomType } from '../interior/options'

/** Room type for the layout rules from a room name — only the three the rules know; anything else stays empty. */
export function layoutType(name: string): RoomType | null {
  const n = norm(name)
  if (/\b(WC|VE SINH|TOILET|BATH|KHO|STORE|THANG|STAIR|LIFT|HOP KT|SANH|LOBBY|HALL|BAN CONG|BALCON|SAN THUONG|TERRACE|GIAT|LAUNDRY|THONG TANG|VOID|GARA|GARAGE|HANH LANG|CORRIDOR)\b/.test(n)) return null
  if (/\b(BEP|KITCHEN)\b/.test(n)) return 'kitchen'
  if (/\b(NGU|BED|MASTER|BEDROOM)\b/.test(n)) return 'bedroom'
  if (/\b(KHACH|SINH HOAT|LIVING|FAMILY|P\.? ?KHACH)\b/.test(n)) return 'living'
  return null
}

/**
 * Furnishes the rooms of an Interior build by the room-type rules (best valid option of each room); rooms without a
 * door in the BIM model, or where no layout is valid, stay empty (said in `notes`).
 */
export function furnish(b: InteriorBuild, model: BimModel): { build: InteriorBuild; furnished: string[]; skipped: string[] } {
  let doc: InteriorDoc = { rooms: b.rooms.map((r) => ({ ...r, doors: r.doors?.length ? r.doors : doorsFromBim(model, r) })), items: b.items, cabinets: b.cabinets, notes: [] }
  const furnished: string[] = [], skipped: string[] = []
  for (const r of doc.rooms) {
    const type = layoutType(r.name)
    if (!type) continue
    // a room that already has furniture (from the drawing) keeps it
    if (doc.items.some((i) => i.room === r.id)) continue
    try {
      const res = generateLayouts(doc, r.id, type)
      if (res.status === 'ok' && res.options.length) { doc = applyChangeSet(doc, res.options[0].changes); furnished.push(r.name) }
      else skipped.push(r.name)
    } catch { skipped.push(r.name) }
  }
  return { build: { ...b, rooms: doc.rooms, items: doc.items, cabinets: doc.cabinets }, furnished, skipped }
}

export interface PlanBuildOptions {
  names: BuildNames
  /** Default name of the level ("Tầng 1") when the title gives none. */
  levelName: string
  file: string
  /** furnish the rooms by the room-type rules (default true) */
  furnish?: boolean
}

export function autoFromPlan(rec: Recognition, opt: PlanBuildOptions): AutoResult & { furnished: string[] } {
  const t0 = Date.now()
  const levelName = rec.region.levelName ?? opt.levelName
  const built = buildBimModel([{ rec, levelName, elevation: rec.region.elevation ?? 0, roof: rec.region.kind === 'roof', order: rec.region.order }], { ...DEFAULT_BUILD }, opt.names)
  const lv = built.model.levels[0]
  let interior: InteriorBuild | null = lv && built.model.rooms.some((r) => r.level === lv.id && !r.void) ? buildInterior(built.model, lv.id, rec.furniture, built.align.origins[0], opt.names) : null
  let furnished: string[] = []
  if (interior && opt.furnish !== false) { const f = furnish(interior, built.model); interior = f.build; furnished = f.furnished }
  return {
    file: opt.file, kind: 'house', houseRoles: {}, civilRoles: {}, ai: null,
    house: {
      plans: [rec.region], recs: [rec], recLevels: [levelName], built, checks: runModelChecks(built.model),
      interior, interiorLevel: interior ? 0 : null, interiors: interior && interior.rooms.length ? [{ level: levelName, build: interior }] : [],
      structure: [], inferred: [], duplicates: [],
    },
    route: null, mep: [], mepModel: null,
    files: [{ name: opt.file, kind: 'arch', hint: null, plans: 1, structure: false, mep: false, usedForPlans: true }],
    ms: Date.now() - t0,
    furnished,
  }
}
