import type { ComponentType } from 'react'
import { Box, Database, Folder, Image, Settings, Armchair } from 'lucide-react'
import { useT } from '../../i18n'
import { useRouter, type Route } from '../../state/router'
import { AiSparkIcon, CadToolsIcon, HomeIcon, LogoMark, PeaksIcon, PipeIcon, type IconProps } from '../icons'
import { PromoCard } from './PromoCard'
import s from './Sidebar.module.css'

type NavKey = keyof ReturnType<typeof useT>['nav']

const NAV: { key: NavKey; route: Route; Icon: ComponentType<IconProps & { filled?: boolean }> }[] = [
  { key: 'dashboard', route: 'dashboard', Icon: HomeIcon },
  { key: 'projects', route: 'projects', Icon: Folder as ComponentType<IconProps> },
  { key: 'aiAssistant', route: 'ai-studio', Icon: AiSparkIcon },
  { key: 'cadTools', route: 'cad2d', Icon: CadToolsIcon },
  { key: 'bim', route: 'bim', Icon: Box as ComponentType<IconProps> },
  { key: 'mechanical', route: 'mechanical', Icon: Settings as ComponentType<IconProps> },
  { key: 'interior', route: 'interior', Icon: Armchair as ComponentType<IconProps> },
  { key: 'mep', route: 'mep', Icon: PipeIcon },
  { key: 'civil', route: 'civil', Icon: PeaksIcon },
  { key: 'components', route: 'components', Icon: Database as ComponentType<IconProps> },
  { key: 'renders', route: 'renders', Icon: Image as ComponentType<IconProps> },
  { key: 'settings', route: 'settings', Icon: Settings as ComponentType<IconProps> },
]

export function Sidebar({ promo }: { promo: string }) {
  const t = useT()
  const { route, navigate } = useRouter()
  return (
    <aside className={s.sidebar}>
      <button type="button" className={s.brand} onClick={() => navigate('dashboard')} aria-label={t.app.name}>
        <LogoMark />
        <span className={s.brandText}>
          <span className={s.brandName}>{t.app.name}</span>
          <span className={s.brandTag}>{t.app.tagline}</span>
        </span>
      </button>
      <nav className={s.nav} aria-label="Primary">
        {NAV.map(({ key, route: r, Icon }) => {
          const active = route === r
          return (
            <button
              key={key}
              type="button"
              className={`${s.item} ${active ? s.active : ''}`}
              aria-current={active ? 'page' : undefined}
              onClick={() => navigate(r)}
            >
              {Icon === HomeIcon ? <HomeIcon size={24} strokeWidth={1.8} filled={active} /> : <Icon size={24} strokeWidth={1.8} />}
              <span>{t.nav[key]}</span>
            </button>
          )
        })}
      </nav>
      <PromoCard src={promo} />
    </aside>
  )
}
