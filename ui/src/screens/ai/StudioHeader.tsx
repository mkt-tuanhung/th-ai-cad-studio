import type { ComponentType } from 'react'
import { BookOpen, DraftingCompass, Expand, ImageUp, Mic, WandSparkles } from 'lucide-react'
import { useT } from '../../i18n'
import s from './StudioHeader.module.css'

export type CapKey = 'generateLayout' | 'smartFix' | 'scanToCad' | 'compare' | 'geometryDoctor' | 'voiceCad'

/** Card widths reproduce the mockup's uneven row (771–1542). */
const CAPS: { key: CapKey; Icon: ComponentType<{ size?: number; strokeWidth?: number }>; w: number; tone?: 'blue' }[] = [
  { key: 'generateLayout', Icon: Expand, w: 111 },
  { key: 'smartFix', Icon: WandSparkles, w: 109 },
  { key: 'scanToCad', Icon: ImageUp, w: 119 },
  { key: 'compare', Icon: BookOpen, w: 120, tone: 'blue' },
  { key: 'geometryDoctor', Icon: DraftingCompass, w: 129 },
  { key: 'voiceCad', Icon: Mic, w: 132 },
]

export function StudioHeader({ onCapability }: { onCapability: (k: CapKey) => void }) {
  const t = useT().ai
  return (
    <header className={s.header}>
      <div className={s.intro}>
        <h1 className={s.title}>{t.title}</h1>
        <p className={s.tags}>
          {t.taglineItems.map((it, i) => (
            <span key={it}>
              {i > 0 && <span className={s.dot}>•</span>}
              {it}
            </span>
          ))}
        </p>
        <p className={s.desc}>
          {t.desc1}
          <br />
          {t.desc2}
        </p>
      </div>
      <div className={s.caps}>
        {CAPS.map(({ key, Icon, w, tone }) => (
          <button key={key} type="button" className={s.cap} style={{ flexBasis: w }} onClick={() => onCapability(key)}>
            <span className={`${s.tile} ${tone === 'blue' ? s.blue : ''}`}>
              <Icon size={22} strokeWidth={1.6} />
            </span>
            <span className={s.capTitle}>{t.caps[key].title}</span>
            <span className={s.capDesc}>{t.caps[key].desc}</span>
          </button>
        ))}
      </div>
    </header>
  )
}
