import { useSettings, type KeyProfileId } from '../state/settings'
import { useWorkspace } from '../state/workspace'
import { activeBindings, activeProfile, collisions, profileBindings } from './keymap'

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
