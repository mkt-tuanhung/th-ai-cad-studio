import type { ComponentType } from 'react'
import { Armchair, ArrowRight, Box, Settings } from 'lucide-react'
import { useT } from '../../i18n'
import { useRouter, type Route } from '../../state/router'
import { AiSparkIcon, CadNodeIcon, PeaksIcon, PipeIcon, type IconProps } from '../../components/icons'
import s from './CategoryGrid.module.css'

type CatKey = keyof ReturnType<typeof useT>['dashboard']['categories']

const CATS: { key: CatKey; route: Route; Icon: ComponentType<IconProps>; tone?: 'blue' }[] = [
  { key: 'cad', route: 'cad2d', Icon: CadNodeIcon },
  { key: 'bim', route: 'bim', Icon: Box as ComponentType<IconProps>, tone: 'blue' },
  { key: 'mechanical', route: 'mechanical', Icon: Settings as ComponentType<IconProps> },
  { key: 'interior', route: 'interior', Icon: Armchair as ComponentType<IconProps> },
  { key: 'mep', route: 'mep', Icon: PipeIcon },
  { key: 'civil', route: 'civil', Icon: PeaksIcon },
  { key: 'aiTools', route: 'ai-studio', Icon: AiSparkIcon },
]

export function CategoryGrid() {
  const t = useT()
  const navigate = useRouter((st) => st.navigate)
  return (
    <div className={s.grid}>
      {CATS.map(({ key, route, Icon, tone }) => (
        <button key={key} type="button" className={s.card} onClick={() => navigate(route)}>
          <Icon size={32} strokeWidth={1.6} className={`${s.icon} ${tone === 'blue' ? s.blue : ''}`} />
          <span className={s.title}>{t.dashboard.categories[key].title}</span>
          <span className={s.desc}>{t.dashboard.categories[key].desc}</span>
          <ArrowRight size={13} strokeWidth={1.8} className={s.arrow} />
        </button>
      ))}
    </div>
  )
}
