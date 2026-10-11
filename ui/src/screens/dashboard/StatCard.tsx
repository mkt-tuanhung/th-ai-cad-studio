import type { ReactNode } from 'react'
import { ArrowUp } from 'lucide-react'
import s from './StatCard.module.css'

export interface StatCardProps {
  icon: ReactNode
  tone: 'teal' | 'blue'
  label: string
  value: ReactNode
  /** Small value variant (e.g. "2 minutes ago"). */
  compactValue?: boolean
  delta?: string
  footnote?: ReactNode
  bars?: number[]
  trailing?: ReactNode
}

export function StatCard({ icon, tone, label, value, compactValue, delta, footnote, bars, trailing }: StatCardProps) {
  return (
    <div className={s.card}>
      <div className={`${s.tile} ${s[tone]}`}>{icon}</div>
      <div className={s.body}>
        <div className={s.label}>{label}</div>
        <div className={`${s.value} ${compactValue ? s.compact : ''}`}>{value}</div>
        {delta && (
          <div className={s.delta}>
            <ArrowUp size={13} strokeWidth={2.4} />
            {delta}
          </div>
        )}
        {footnote && <div className={s.foot}>{footnote}</div>}
      </div>
      {bars && <MiniBars values={bars} tone={tone} />}
      {trailing}
    </div>
  )
}

/** Decorative trend bars (values 0..1). */
export function MiniBars({ values, tone }: { values: number[]; tone: 'teal' | 'blue' }) {
  return (
    <div className={`${s.bars} ${s[`bars_${tone}`]}`} aria-hidden="true">
      {values.map((v, i) => (
        <span key={i} style={{ height: `${Math.round(v * 100)}%` }} />
      ))}
    </div>
  )
}
