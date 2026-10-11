import { ArrowLeft } from 'lucide-react'
import { fmt, useT } from '../../i18n'
import { useRouter, type Route } from '../../state/router'
import { ActionButton } from '../../components/ui/Button'
import s from './PlaceholderScreen.module.css'

/** Mockup screens scheduled after the Dashboard. */
const PLANNED: Partial<Record<Route, { n: string; file: string }>> = {
  cad2d: { n: '02', file: '02_cad2d_workspace.png' },
  'ai-studio': { n: '03', file: '03_ai_intelligence_studio.png' },
  bim: { n: '04', file: '04_architecture_bim_workspace.png' },
}

/** Honest placeholder: no fake UI is drawn for workspaces that are not built yet. */
export function PlaceholderScreen({ route, title }: { route: Route; title: string }) {
  const t = useT()
  const navigate = useRouter((st) => st.navigate)
  const planned = PLANNED[route]
  return (
    <div className={s.wrap}>
      <div className={s.box}>
        <h1 className={s.title}>{title}</h1>
        <p className={s.text}>{planned ? fmt(t.module.plannedScreen, { n: planned.n }) : t.module.comingSoon}</p>
        {planned && <code className={s.code}>mockups_full/{planned.file}</code>}
        <ActionButton icon={<ArrowLeft size={16} />} onClick={() => navigate('dashboard')}>
          {t.module.back}
        </ActionButton>
      </div>
    </div>
  )
}
