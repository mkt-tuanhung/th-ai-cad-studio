/** Shared helpers of the Space Planning UI (bottom panel, inspector, plan). */
import { fmt, getMessages } from '../../i18n'
import { useSettings } from '../../state/settings'
import { toast } from '../../state/toast'
import { useInterior, type InteriorDoc } from '../../state/interior'
import type { EditResult } from '../../interior/layout'
import { DEFAULT_RULES, type ClearanceRules, type Fix, type Issue } from '../../interior/clearance'

const msgs = () => getMessages(useSettings.getState().language).interior

/** The project's clearance table (guidance values) with defaults for missing keys. */
export const rulesOf = (d: InteriorDoc): ClearanceRules => ({ ...DEFAULT_RULES, ...(d.clearance ?? {}) })

export const errText = (e: string) => msgs().space.insp.errors[e] ?? e

/** Commit a Space Planning edit as one undo step; reports why when it is refused. */
export function commit(label: string, r: EditResult): boolean {
  const t = msgs()
  if (r.error !== undefined) {
    toast(fmt(t.space.plan.blocked, { why: errText(r.error) }), 'warning')
    return false
  }
  const err = useInterior.getState().edit(label, () => r.doc!)
  if (err) {
    toast(fmt(t.toast.invalid, { why: err }), 'warning')
    return false
  }
  return true
}

/** Name of an item instance for messages ("Dining Chair #3" when there are several). */
export function instName(d: InteriorDoc, [id, k]: [string, number]) {
  const i = d.items.find((x) => x.id === id)
  if (!i) return id
  return i.qty > 1 ? `${i.name} #${k + 1}` : i.name
}

export function issueText(d: InteriorDoc, is: Issue): string {
  const t = msgs().space.checks.kinds
  const room = d.rooms.find((r) => r.id === is.room)
  const rn = room ? msgs().roomNames[room.name] ?? room.name : is.room
  const a = is.items[0] ? instName(d, is.items[0]) : ''
  const b = is.items[1] ? instName(d, is.items[1]) : ''
  const p = { a, b, m: is.measured ?? '—', r: is.required ?? '—', room: rn }
  if (is.kind === 'needsInput') return fmt(is.missing === 'door.width' ? t.needsWidth : t.needsDoor, p)
  return fmt(t[is.kind], p)
}

export function fixText(d: InteriorDoc, f: Fix): string {
  const t = msgs().space.checks.fix
  const a = instName(d, [f.item, f.k])
  const main = f.kind === 'move' ? fmt(t.move, { a, d: f.dist ?? 0, dir: f.dir ?? '' }) : f.kind === 'rotate' ? fmt(t.rotate, { a, deg: f.deg ?? 0 }) : fmt(t.align, { a, d: f.dist ?? 0 })
  return f.after !== undefined ? `${main} ${fmt(t.after, { v: f.after })}` : main
}
