import { useSettings, type Prefs } from './settings'
import { useRouter } from './router'
import { gpuPref } from '../screens/cad2d/gpu/GpuLayer'
import { getHost } from '../services/host'

/**
 * Applies saved preferences to the running app (Settings → Save Changes):
 * - compact UI / animations: classes on <html>;
 * - tooltips: native `title` hints are suppressed while hovering when turned off;
 * - hardware acceleration: the GPU layer of CAD 2D (off → SVG renderer);
 * - desktop host: models folder and GPU offload of the local model;
 * - last screen, restored on launch when the start page is turned off (see router).
 */
export function applyPrefs(p: Prefs) {
  const html = document.documentElement
  html.classList.toggle('compact', p.compactUi)
  html.classList.toggle('no-anim', !p.animations)
  gpuPref.force = p.gpu2d ? null : false
  if (p.tooltips) document.querySelectorAll('[data-title]').forEach((el) => {
    el.setAttribute('title', el.getAttribute('data-title') ?? '')
    el.removeAttribute('data-title')
  })
}

/** Sends folder / GPU preferences to the native host (desktop only). */
export async function syncHost(p: Prefs, prev?: Prefs) {
  const host = await getHost()
  if (!host) return
  if (p.modelsDir && p.modelsDir !== prev?.modelsDir) await host.setModelsDir(p.modelsDir)
  if (prev === undefined ? !p.aiGpu : p.aiGpu !== prev.aiGpu) await host.setAiGpu(p.aiGpu)
}

export function installPrefsEffects() {
  applyPrefs(useSettings.getState())
  void syncHost(useSettings.getState())
  useSettings.subscribe((s, prev) => {
    applyPrefs(s)
    void syncHost(s, prev)
  })
  document.addEventListener(
    'mouseover',
    (e) => {
      if (useSettings.getState().tooltips) return
      const el = (e.target as Element | null)?.closest?.('[title]')
      if (!el) return
      el.setAttribute('data-title', el.getAttribute('title') ?? '')
      el.removeAttribute('title')
    },
    true,
  )
  useRouter.subscribe((st) => useSettings.getState().setLastRoute(st.route))
}
