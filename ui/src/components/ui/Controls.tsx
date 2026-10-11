import type { ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import s from './Controls.module.css'

/** On/off switch (role="switch"), teal when on — the mockups' toggle. */
export function Switch({ checked, onChange, label, size = 'md' }: { checked: boolean; onChange: (v: boolean) => void; label: string; size?: 'sm' | 'md' }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className={`${s.switch} ${s[size]} ${checked ? s.on : ''}`} onClick={() => onChange(!checked)}>
      <i />
    </button>
  )
}

/** Native <select> dressed as the mockups' dropdown field. */
export function Dropdown<T extends string | number>({ value, onChange, options, label, className, children }: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string; disabled?: boolean }[]
  label: string
  className?: string
  children?: ReactNode
}) {
  const current = options.find((o) => o.value === value)
  return (
    <label className={`${s.dropdown} ${className ?? ''}`}>
      {children}
      <span className={s.value}>{current?.label ?? String(value)}</span>
      <ChevronDown size={15} strokeWidth={1.8} aria-hidden="true" />
      <select
        value={String(value)}
        aria-label={label}
        onChange={(e) => {
          const o = options.find((x) => String(x.value) === e.target.value)
          if (o) onChange(o.value)
        }}
      >
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)} disabled={o.disabled}>{o.label}</option>
        ))}
      </select>
    </label>
  )
}
