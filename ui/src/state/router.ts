import { create } from 'zustand'
import { useSettings } from './settings'

/** Screens with an approved mockup + module placeholders reachable from the sidebar. */
export type Route =
  | 'dashboard'
  | 'cad2d'
  | 'ai-studio'
  | 'bim'
  | 'projects'
  | 'mechanical'
  | 'interior'
  | 'mep'
  | 'civil'
  | 'components'
  | 'renders'
  | 'settings'
  /** Brand preview: intro, installer welcome, loaders, icon (and the installer art export). */
  | 'brand'

const ROUTES: Route[] = [
  'dashboard', 'cad2d', 'ai-studio', 'bim', 'projects', 'mechanical',
  'interior', 'mep', 'civil', 'components', 'renders', 'settings', 'brand',
]

function parseHash(): Route {
  const r = window.location.hash.replace(/^#\/?/, '').split('?')[0] as Route
  return ROUTES.includes(r) ? r : 'dashboard'
}

interface RouterState {
  route: Route
  navigate: (r: Route) => void
}

/** Launch screen: the URL, else the Dashboard — or the last screen when the start page is off. */
function initialRoute(): Route {
  if (window.location.hash.replace(/^#\/?/, '')) return parseHash()
  const s = useSettings.getState()
  return !s.startPage && ROUTES.includes(s.lastRoute as Route) ? (s.lastRoute as Route) : 'dashboard'
}

export const useRouter = create<RouterState>()((set) => ({
  route: initialRoute(),
  navigate: (route) => {
    if (window.location.hash !== `#/${route}`) window.location.hash = `#/${route}`
    set({ route })
  },
}))

window.addEventListener('hashchange', () => useRouter.setState({ route: parseHash() }))
