import { create } from 'zustand'

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

const ROUTES: Route[] = [
  'dashboard', 'cad2d', 'ai-studio', 'bim', 'projects', 'mechanical',
  'interior', 'mep', 'civil', 'components', 'renders', 'settings',
]

function parseHash(): Route {
  const r = window.location.hash.replace(/^#\/?/, '').split('?')[0] as Route
  return ROUTES.includes(r) ? r : 'dashboard'
}

interface RouterState {
  route: Route
  navigate: (r: Route) => void
}

export const useRouter = create<RouterState>()((set) => ({
  route: parseHash(),
  navigate: (route) => {
    if (window.location.hash !== `#/${route}`) window.location.hash = `#/${route}`
    set({ route })
  },
}))

window.addEventListener('hashchange', () => useRouter.setState({ route: parseHash() }))
