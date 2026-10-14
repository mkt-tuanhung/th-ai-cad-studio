/**
 * Committing an approved "Build from CAD plans" preview: the BIM model as ONE undoable edit (replace or add), and
 * optionally the Interior design data of one level as one undoable Interior edit. Both stores validate the result
 * with their model rules; a rejected result changes nothing.
 */
import { fmt } from '../../i18n'
import type { Messages } from '../../i18n/en'
import { useBim } from '../../state/bim'
import { useInterior } from '../../state/interior'
import type { BimModel } from '../../bim/model'
import { mergeModels, type BuildNames, type InteriorBuild } from '../../bim/fromCadBuild'
import type { FurnKind } from '../../bim/fromCad'

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

/** BIM: replace or add. Returns null or the model rule that rejected it. */
export function applyBim(model: BimModel, mode: 'replace' | 'merge', label: string): string | null {
  const st = useBim.getState()
  const next = mode === 'merge' ? mergeModels(st.model, model) : model
  const err = st.edit(label, () => next)
  if (err) return err
  st.set({ level: next.levels[0]?.id ?? 'L1', selection: null, view: '3d', tool: 'select', drawing: null })
  st.runChecks()
  return null
}

/** Interior: rooms, furniture and cabinets of one level replace the design data. */
export function applyInterior(b: InteriorBuild, label: string): string | null {
  const st = useInterior.getState()
  const err = st.edit(label, (d) => ({ ...d, rooms: b.rooms, items: b.items, cabinets: b.cabinets, notes: [] }))
  if (err) return err
  const first = b.rooms[0]?.id
  if (first) st.set({ room: first, browserSel: `room-${first}`, sel: null, appliedPreset: null })
  return null
}
