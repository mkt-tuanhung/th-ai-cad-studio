import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Roboto: matches the approved mockups' typeface (measured cap-height/advance ratios). Bundled
// locally (offline-first), includes the Vietnamese subset.
import '@fontsource-variable/roboto/wght.css'
import './styles/tokens.css'
import './styles/global.css'
import App from './App.tsx'

// Saved preferences (compact UI, animations, tooltips, GPU layer, host folders …).
import('./state/prefsEffects').then(({ installPrefsEffects }) => installPrefsEffects())

// Desktop app: mirror CAD 2D edits into the native C++ command bus.
import('./services/host').then(({ getHost, isDesktopHost }) => {
  if (!isDesktopHost()) return
  getHost().then((h) => h && import('./services/nativeSync').then(({ installNativeSync }) => installNativeSync(h)))
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Test hook (Playwright smoke tests / benchmarks read store state). Dev server, or a build made with
// VITE_QA_HOOKS=1; stripped from release builds.
if (import.meta.env.DEV || import.meta.env.VITE_QA_HOOKS === '1') {
  import('./state/cad').then(({ useCad }) => {
    const w = window as unknown as { __thcad: Record<string, unknown> }
    w.__thcad = { ...(w.__thcad ?? {}), cad: useCad }
  })
}
if (import.meta.env.DEV || import.meta.env.VITE_QA_HOOKS === '1') {
  import('./state/workspace').then(({ useWorkspace }) => {
    const w = window as unknown as { __thcad: Record<string, unknown> }
    w.__thcad = { ...(w.__thcad ?? {}), workspace: useWorkspace }
  })
  import('./state/bim').then(({ useBim }) => {
    const w = window as unknown as { __thcad: Record<string, unknown> }
    w.__thcad = { ...(w.__thcad ?? {}), bim: useBim }
  })
  import('./state/mep').then(({ useMep }) => {
    const w = window as unknown as { __thcad: Record<string, unknown> }
    w.__thcad = { ...(w.__thcad ?? {}), mep: useMep }
  })
  import('./state/mech').then(({ useMech }) => {
    const w = window as unknown as { __thcad: Record<string, unknown> }
    w.__thcad = { ...(w.__thcad ?? {}), mech: useMech }
  })
  import('./state/interior').then(({ useInterior }) => {
    const w = window as unknown as { __thcad: Record<string, unknown> }
    w.__thcad = { ...(w.__thcad ?? {}), interior: useInterior }
  })
  import('./state/renders').then(({ useRenders }) => {
    const w = window as unknown as { __thcad: Record<string, unknown> }
    w.__thcad = { ...(w.__thcad ?? {}), renders: useRenders }
  })
  import('./state/settings').then(({ useSettings }) => {
    const w = window as unknown as { __thcad: Record<string, unknown> }
    w.__thcad = { ...(w.__thcad ?? {}), settings: useSettings }
  })
  import('./platform/snapshots').then((snapshots) => {
    const w = window as unknown as { __thcad: Record<string, unknown> }
    w.__thcad = { ...(w.__thcad ?? {}), snapshots }
  })
  // v2.4 local render pipeline (desktop e2e: e2e_blender.js)
  Promise.all([import('./renders/provenance'), import('./renders/snapshot'), import('./renders/runner'), import('./renders/bookmarks')]).then(([provenance, snapshot, runner, bookmarks]) => {
    const w = window as unknown as { __thcad: Record<string, unknown> }
    w.__thcad = { ...(w.__thcad ?? {}), render24: { provenance, snapshot, runner, bookmarks } }
  })
  import('./state/aiStudio').then(({ useAiStudio }) => {
    const w = window as unknown as { __thcad: Record<string, unknown> }
    w.__thcad = { ...(w.__thcad ?? {}), aiStudio: useAiStudio }
  })
  // v2.4 manufacturing gate of a CAD 2D document (import calibration / review)
  import('./cad/provenance').then(({ fabricationAllowed }) => {
    const w = window as unknown as { __thcad: Record<string, unknown> }
    w.__thcad = { ...(w.__thcad ?? {}), fabricationAllowed }
  })
}
