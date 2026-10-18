import { useEffect } from 'react'
import { fmt, getMessages } from '../i18n'
import { useRouter } from '../state/router'
import { matchesShortcut, useSettings } from '../state/settings'
import { toast } from '../state/toast'
import { useWorkspace } from '../state/workspace'
import { useBim } from '../state/bim'
import { useInterior } from '../state/interior'
import { useMep } from '../state/mep'
import { useCivil } from '../state/civil'
import { useCad } from '../state/cad'
import { actionHandler, comboOf, resolveKey, scopeOfRoute } from './keymap'
import { currentKeys } from './profileState'
import { captureStores, countsOf, isApplying, snapshotOn, type ModelStore } from './snapshots'
import { usePlatformUi } from './ui'
import { Cheatsheet } from './Cheatsheet'
import { VersionHistory } from './VersionHistory'

const typing = (el: EventTarget | null) =>
  el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || !!(el as HTMLElement | null)?.isContentEditable

const msgs = () => getMessages(useSettings.getState().language)
const total = (store: ModelStore, doc: unknown) => Object.values(countsOf(store, doc)).reduce((a, b) => a + b, 0)

/**
 * App-wide platform behaviour, mounted once in App: the interaction-profile key dispatcher, the cheatsheet and
 * version history dialogs, ⌘S outside CAD 2D (= save a version), the auto-recover interval and the
 * "before a large replacement" snapshot.
 */
export function PlatformHost() {
  const ui = usePlatformUi()

  // keys: cheatsheet, ⌘S outside CAD 2D, then the profile's keys of the current workspace
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || e.repeat) return
      const sc = useSettings.getState().shortcuts
      if (matchesShortcut(e, sc.cheatsheet)) {
        e.preventDefault()
        usePlatformUi.getState().set({ cheatsheet: !usePlatformUi.getState().cheatsheet })
        return
      }
      if (typing(e.target) || document.querySelector('[role=dialog]')) return
      const route = useRouter.getState().route
      if (route !== 'cad2d' && matchesShortcut(e, sc.save)) {
        e.preventDefault()
        const H = msgs().platform.history
        void snapshotOn('save', `⌘S · ${msgs().nav[route === 'bim' ? 'bim' : route === 'interior' ? 'interior' : route === 'mep' ? 'mep' : route === 'civil' ? 'civil' : route === 'mechanical' ? 'mechanical' : route === 'renders' ? 'renders' : 'dashboard']}`).then((m) =>
          toast(m ? fmt(H.onSave, { label: m.label }) : useSettings.getState().backup ? H.nothing : H.off, m ? 'success' : 'info'))
        return
      }
      const id = resolveKey(currentKeys().active, scopeOfRoute(route), comboOf(e))
      const run = id ? actionHandler(id) : null
      if (!run) return
      e.preventDefault()
      run()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Settings → Auto-recover: a version every N minutes (the current project's auto-save interval) when something changed
  useEffect(() => {
    let lastAt = Date.now()
    const timer = window.setInterval(() => {
      const ws = useWorkspace.getState()
      const p = ws.projects.find((x) => x.id === ws.currentId)
      const minutes = Math.max(1, p?.details?.autoSave?.minutes ?? 10)
      if (p?.details?.autoSave && !p.details.autoSave.enabled) return
      if (Date.now() - lastAt < minutes * 60_000) return
      lastAt = Date.now()
      void snapshotOn('interval', msgs().platform.history.reasons.interval)
    }, 30_000)
    return () => window.clearInterval(timer)
  }, [])

  // Settings → backup: a version of the previous model before a large replacement (half the elements gone at once)
  useEffect(() => {
    const watch = <S,>(store: ModelStore, api: { subscribe: (fn: (s: S, p: S) => void) => () => void; persist: { hasHydrated: () => boolean } }, pick: (s: S) => unknown) =>
      api.subscribe((st, prev) => {
        const a = pick(prev), b = pick(st)
        if (a === b || !api.persist.hasHydrated() || isApplying()) return
        const before = total(store, store === 'cad' ? { docs: a } : a), after = total(store, store === 'cad' ? { docs: b } : b)
        if (before < 10 || after > before * 0.5) return
        const stores = captureStores()
        stores[store] = store === 'cad' ? { ...(stores.cad as object), docs: a } : a
        void snapshotOn('risky', fmt(msgs().platform.history.reasons.risky + ': {ws}', { ws: msgs().platform.history.stores[store] }), stores)
      })
    const offs = [
      watch('bim', useBim, (s) => s.model),
      watch('interior', useInterior, (s) => s.doc),
      watch('mep', useMep, (s) => s.doc),
      watch('civil', useCivil, (s) => s.doc),
      watch('cad', useCad, (s) => s.docs),
    ]
    return () => offs.forEach((f) => f())
  }, [])

  return (
    <>
      {ui.cheatsheet && <Cheatsheet />}
      {ui.history && <VersionHistory />}
    </>
  )
}
