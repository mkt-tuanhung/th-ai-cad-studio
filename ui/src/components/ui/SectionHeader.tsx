import type { ReactNode } from 'react'
import s from './SectionHeader.module.css'

export function SectionHeader({ title, action, className }: { title: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={`${s.row} ${className ?? ''}`}>
      <h2 className={s.title}>{title}</h2>
      {action}
    </div>
  )
}

export function LinkButton({ children, onClick, trailing }: { children: ReactNode; onClick?: () => void; trailing?: ReactNode }) {
  return (
    <button type="button" className={s.link} onClick={onClick}>
      {children}
      {trailing}
    </button>
  )
}
