import { shortcutLabel, useSettings, type KeyProfileId } from '../state/settings'
import { fmt, type useT } from '../i18n'
import { useWorkspace } from '../state/workspace'
import { activeBindings, activeProfile, collisions, profileBindings, type Collision } from './keymap'

/** The interaction profile in force now (current project's choice, else the default) and its key maps. */
export function currentKeys(prefs = useSettings.getState(), projectId = useWorkspace.getState().currentId): {
  profile: KeyProfileId
  bindings: Record<string, string>
  active: Map<string, string>
  collisions: ReturnType<typeof collisions>
} {
  const profile = activeProfile(prefs, projectId)
  const bindings = profileBindings(profile, prefs.keyMaps)
  return { profile, bindings, active: activeBindings(bindings, prefs.shortcuts), collisions: collisions(bindings, prefs.shortcuts) }
}

/** React: the same, re-rendering when the profile, the user's keys or the current project change. */
export function useCurrentKeys() {
  const keyProfile = useSettings((s) => s.keyProfile)
  const keyMaps = useSettings((s) => s.keyMaps)
  const projectKeyProfiles = useSettings((s) => s.projectKeyProfiles)
  const shortcuts = useSettings((s) => s.shortcuts)
  const pid = useWorkspace((s) => s.currentId)
  return currentKeys({ ...useSettings.getState(), keyProfile, keyMaps, projectKeyProfiles, shortcuts }, pid)
}

type Msgs = ReturnType<typeof useT>

/** One collision in words ("L in CAD 2D: typing L starts LINE, LA… — the key stays with the command line"). */
export function collisionText(c: Collision, t: Msgs): string {
  const C = t.platform.collisions
  const key = shortcutLabel(c.combo)
  if (c.kind === 'alias') return fmt(C.alias, { key, aliases: c.aliases.slice(0, 5).join(', ') + (c.aliases.length > 5 ? '…' : '') })
  if (c.kind === 'commandLine') return fmt(C.commandLine, { key })
  if (c.kind === 'app') return fmt(C.app, { key, name: t.settings.shortcuts.names[c.shortcut] })
  if (c.kind === 'duplicate') return fmt(C.duplicate, { key, other: t.platform.actions[c.other] ?? c.other })
  return fmt(C.reserved, { key })
}

