/**
 * Committing an approved build (Build from CAD plans, one command): the BIM model as ONE undoable edit (replace or
 * add), the Interior design data of one level, the Civil route, the MEP model — each one undoable edit in its
 * workspace. Every store validates the result with its model rules; a rejected result changes nothing. The same
 * rules are run BEFORE the approval (check*) so the review shows what would be rejected.
 * Before a model is replaced, the current one is backed up (src/auto/backup.ts: survives closing the app; restored
 * through the same undoable edit).
 */
import { fmt } from '../../i18n'
import type { Messages } from '../../i18n/en'
import { useBim } from '../../state/bim'
import { useInterior, validateInterior } from '../../state/interior'
import { useCivil, validateCivil } from '../../state/civil'
import { useMep, validateMep } from '../../state/mep'
import type { BimModel } from '../../bim/model'
import type { CivilModel } from '../../civil/model'
import type { MepModel } from '../../mep/model'
import { mergeModels, type BuildNames, type InteriorBuild } from '../../bim/fromCadBuild'
import type { FurnKind } from '../../bim/fromCad'
import { backupModel } from '../../auto/backup'

/** Model names in the UI language. */
export function buildNames(t: Messages['bim']['fromCad']): BuildNames {
  return {
    roofLevel: t.names.roofLevel,
    voidRoom: t.names.voidRoom,
    balconyRoom: t.names.balconyRoom,
    room: (n) => fmt(t.names.room, { n }),
    wallExt: (v) => fmt(t.names.wallExt, { t: v }),
    wallInt: (v) => fmt(t.names.wallInt, { t: v }),
    curtain: (v) => fmt(t.names.curtain, { t: v }),
    door: t.names.door,
    doubleDoor: t.names.doubleDoor,
    opening: t.names.opening,
    window: t.names.window,
    furniture: t.furniture as Record<FurnKind, string>,
  }
}

/** Outcome of applying one part: null error = applied; `backedUp` false when the previous model could not be saved. */
export interface Applied { error: string | null; backedUp: boolean }

/**
 * The BIM store's model rule, run before the approval: a wall's top above its base, a positive length (the same test
 * as useBim().edit — src/state/bim.ts). Null, or the mark of the first wall that breaks it.
 */
export function checkBim(model: BimModel, mode: 'replace' | 'merge' = 'replace'): string | null {
  const m = mode === 'merge' ? mergeModels(useBim.getState().model, model) : model
  const bad = m.walls.find((w) => {
    const base = (m.levels.find((l) => l.id === w.baseLevel)?.elevation ?? 0) + w.baseOffset
    const top = (m.levels.find((l) => l.id === w.topLevel)?.elevation ?? 0) + w.topOffset
    return top - base <= 0 || w.length <= 0
  })
  return bad ? bad.mark : null
}
/** The Interior model rules on the data an Interior build would give. */
export const checkInterior = (b: InteriorBuild): string | null => validateInterior({ ...useInterior.getState().doc, rooms: b.rooms, items: b.items, cabinets: b.cabinets, notes: [] })
export const checkCivil = (m: CivilModel): string | null => validateCivil(m)
export const checkMep = (m: MepModel): string | null => validateMep(m)

/** BIM: replace or add (the current model backed up first). */
export async function applyBim(model: BimModel, mode: 'replace' | 'merge', label: string): Promise<Applied> {
  const pre = checkBim(model, mode)
  if (pre) return { error: pre, backedUp: false }
  const backedUp = await backupModel('bim', label)
  const st = useBim.getState()
  const next = mode === 'merge' ? mergeModels(st.model, model) : model
  const err = st.edit(label, () => next)
  if (err) return { error: err, backedUp }
  st.set({ level: next.levels[0]?.id ?? 'L1', selection: null, view: '3d', tool: 'select', drawing: null })
  st.runChecks()
  return { error: null, backedUp }
}

/** Interior: rooms, furniture and cabinets of one level replace the design data (backed up first). */
export async function applyInterior(b: InteriorBuild, label: string): Promise<Applied> {
  const pre = checkInterior(b)
  if (pre) return { error: pre, backedUp: false }
  const backedUp = await backupModel('interior', label)
  const st = useInterior.getState()
  const err = st.edit(label, (d) => ({ ...d, rooms: b.rooms, items: b.items, cabinets: b.cabinets, notes: [] }))
  if (err) return { error: err, backedUp }
  const first = b.rooms[0]?.id
  if (first) st.set({ room: first, browserSel: `room-${first}`, sel: null, appliedPreset: null })
  return { error: null, backedUp }
}

/** Civil: the route replaces the current one (backed up first), shown on its long profile. */
export async function applyCivil(m: CivilModel, label: string): Promise<Applied> {
  const pre = checkCivil(m)
  if (pre) return { error: pre, backedUp: false }
  const backedUp = await backupModel('civil', label)
  const st = useCivil.getState()
  const err = st.edit(label, () => m)
  if (err) return { error: err, backedUp }
  st.set({ station: m.sections?.[0]?.station ?? m.alignment.start, profileRange: null, view: 'profile', bottom: 'earthwork' })
  return { error: null, backedUp }
}

/** MEP: the coordination model replaces the current one (backed up first); its first pipe selected. */
export async function applyMep(mm: MepModel, label: string): Promise<Applied> {
  const pre = checkMep(mm)
  if (pre) return { error: pre, backedUp: false }
  const backedUp = await backupModel('mep', label)
  const st = useMep.getState()
  const err = st.edit(label, () => mm)
  if (err) return { error: err, backedUp }
  // the old selection is not in the new model: select its first pipe
  st.set({ sel: mm.pipes[0] ? { kind: 'pipe', id: mm.pipes[0].id } : null })
  return { error: null, backedUp }
}
