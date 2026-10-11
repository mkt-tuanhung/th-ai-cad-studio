import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react'
import s from './Field.module.css'

export function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <label className={s.field}>
      <span className={s.label}>{label}</span>
      {children}
      {error && <span className={s.error}>{error}</span>}
    </label>
  )
}

export const TextInput = (p: InputHTMLAttributes<HTMLInputElement>) => <input className={s.input} {...p} />

export const Select = ({ children, ...p }: SelectHTMLAttributes<HTMLSelectElement>) => (
  <select className={s.input} {...p}>
    {children}
  </select>
)
