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
}
