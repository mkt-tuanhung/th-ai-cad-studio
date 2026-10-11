import type { ComponentType } from 'react'
import { Box, Database, Folder, Image, Settings, Armchair } from 'lucide-react'
import { useT } from '../../i18n'
import { useRouter, type Route } from '../../state/router'
import { useSettings } from '../../state/settings'
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

/**
 * Per-row vertical nudge (px) measured on the 12 approved mockups: their rows are not evenly
 * spaced (the first rows sit tighter). Applied only at the reference layout height.
 */
const NUDGE = [1, -1, -3, -1, 1, -1, 0, 1, 1, 1, 1, 1]

export function Sidebar({ promo }: { promo: string }) {
  const t = useT()
  const { route, navigate } = useRouter()
  const compact = useSettings((st) => st.compactUi)
  return (
    <aside className={`${s.sidebar} ${compact ? s.compact : ''}`}>
      <button type="button" className={s.brand} onClick={() => navigate('dashboard')} aria-label={t.app.name}>
        <LogoMark />
        <span className={s.brandText}>
          <span className={s.brandName}>{t.app.name}</span>
          <span className={s.brandTag}>{t.app.tagline}</span>
        </span>
      </button>
      <nav className={s.nav} aria-label="Primary">
        {NAV.map(({ key, route: r, Icon }, i) => {
          const active = route === r
          return (
            <button
              key={key}
              type="button"
              className={`${s.item} ${active ? s.active : ''}`}
              style={{ ['--nudge' as string]: `${NUDGE[i]}px` }}
              aria-current={active ? 'page' : undefined}
              onClick={() => navigate(r)}
            >
              {Icon === HomeIcon ? <HomeIcon size={28} strokeWidth={1.55} filled={active} /> : <Icon size={28} strokeWidth={1.55} />}
              <span>{t.nav[key]}</span>
            </button>
          )
        })}
      </nav>
      <PromoCard src={promo} />
    </aside>
  )
}
