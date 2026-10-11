import { useEffect } from 'react'
import { useT } from './i18n'
import { useRouter, type Route } from './state/router'
import { useSettings } from './state/settings'
import { AppWindow } from './components/shell/AppWindow'
import { Sidebar } from './components/shell/Sidebar'
import { TopBar } from './components/shell/TopBar'
import { ToastHost } from './components/ui/ToastHost'
import { DashboardScreen } from './screens/dashboard/DashboardScreen'
import { PlaceholderScreen } from './screens/placeholder/PlaceholderScreen'
import { Cad2DScreen } from './screens/cad2d/Cad2DScreen'
import { AiStudioScreen } from './screens/ai/AiStudioScreen'
import { BimScreen } from './screens/bim/BimScreen'
import { ProjectsScreen } from './screens/projects/ProjectsScreen'
import { SettingsScreen } from './screens/settings/SettingsScreen'
import { ComponentsScreen } from './screens/components/ComponentsScreen'
import { InteriorScreen } from './screens/interior/InteriorScreen'
import { MepScreen } from './screens/mep/MepScreen'
import { CivilScreen } from './screens/civil/CivilScreen'
import { MechanicalScreen } from './screens/mechanical/MechanicalScreen'
import { RendersScreen } from './screens/renders/RendersScreen'
import s from './App.module.css'

const shellMode: 'framed' | 'native' =
  new URLSearchParams(window.location.search).get('shell') === 'native' ? 'native' : 'framed'

const TITLE_KEY: Record<Exclude<Route, 'dashboard'>, keyof ReturnType<typeof useT>['nav']> = {
  cad2d: 'cadTools',
  'ai-studio': 'aiAssistant',
  bim: 'bim',
  projects: 'projects',
  mechanical: 'mechanical',
  interior: 'interior',
  mep: 'mep',
  civil: 'civil',
  components: 'components',
  renders: 'renders',
  settings: 'settings',
}

export default function App() {
  const t = useT()
  const route = useRouter((st) => st.route)
  const lang = useSettings((st) => st.language)

  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  return (
    <AppWindow mode={shellMode}>
      <div className={s.shell}>
        <Sidebar promo={route === 'dashboard' ? '/assets/dashboard_sidebar_promo.png' : '/assets/common_sidebar_promo.png'} />
        <div className={s.column}>
          <TopBar />
          <div className={s.content}>
            {route === 'dashboard' ? (
              <DashboardScreen />
            ) : route === 'cad2d' ? (
              <Cad2DScreen />
            ) : route === 'ai-studio' ? (
              <AiStudioScreen />
            ) : route === 'bim' ? (
              <BimScreen />
            ) : route === 'projects' ? (
              <ProjectsScreen />
            ) : route === 'settings' ? (
              <SettingsScreen />
            ) : route === 'components' ? (
              <ComponentsScreen />
            ) : route === 'interior' ? (
              <InteriorScreen />
            ) : route === 'mep' ? (
              <MepScreen />
            ) : route === 'civil' ? (
              <CivilScreen />
            ) : route === 'mechanical' ? (
              <MechanicalScreen />
            ) : route === 'renders' ? (
              <RendersScreen />
            ) : (
              <PlaceholderScreen route={route} title={t.nav[TITLE_KEY[route]]} />
            )}
          </div>
        </div>
        <ToastHost />
      </div>
    </AppWindow>
  )
}
