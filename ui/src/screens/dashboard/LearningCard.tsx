import { ChevronDown, ChevronRight } from 'lucide-react'
import { useT } from '../../i18n'
import { useSettings } from '../../state/settings'
import { LinkButton, SectionHeader } from '../../components/ui/SectionHeader'
import s from './RailCards.module.css'

export function LearningCard({ onOpenGuide }: { onOpenGuide: () => void }) {
  const t = useT()
  const L = t.dashboard.learning
  const { learningExpanded, setLearningExpanded } = useSettings()
  return (
    <section className={s.card}>
      <SectionHeader
        title={L.title}
        className={s.header}
        action={
          <LinkButton
            onClick={() => setLearningExpanded(!learningExpanded)}
            trailing={<ChevronDown size={13} strokeWidth={2} className={learningExpanded ? '' : s.flip} />}
          >
            {learningExpanded ? L.open : L.collapse}
          </LinkButton>
        }
      />
      {learningExpanded && (
        <button type="button" className={s.learn} onClick={onOpenGuide}>
          <img className={s.learnThumb} src="/assets/extracted/learning_thumb.png" alt="" />
          <span className={s.learnText}>
            <span className={s.learnTitle}>
              {L.cardTitle1}
              <br />
              {L.cardTitle2}
            </span>
            <span className={s.learnDesc}>{L.cardDesc}</span>
          </span>
          <ChevronRight size={17} strokeWidth={1.8} className={s.learnChev} />
        </button>
      )}
    </section>
  )
}
