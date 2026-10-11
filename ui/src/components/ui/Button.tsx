import type { ButtonHTMLAttributes, ReactNode } from 'react'
import s from './Button.module.css'

export interface ActionButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost'
  icon?: ReactNode
  block?: boolean
}

export function ActionButton({ variant = 'secondary', icon, block, className, children, ...rest }: ActionButtonProps) {
  return (
    <button
      type="button"
      className={`${s.btn} ${s[variant]} ${block ? s.block : ''} ${className ?? ''}`}
      {...rest}
    >
      {icon && <span className={s.icon}>{icon}</span>}
      <span>{children}</span>
    </button>
  )
}

/** Square icon-only button (toolbar, top bar, kebab menus). */
export function IconButton({ className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={`${s.iconBtn} ${className ?? ''}`} {...rest}>
      {children}
    </button>
  )
}
