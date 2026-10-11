import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import s from './Popover.module.css'

/** Open/close state that closes on outside click and Escape. */
export function useDismissable<T extends HTMLElement>(): [boolean, (v: boolean) => void, RefObject<T | null>] {
  const [open, setOpen] = useState(false)
  const ref = useRef<T>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  return [open, setOpen, ref]
}

export function PopoverPanel({
  children,
  align = 'right',
  width,
  className,
}: {
  children: ReactNode
  align?: 'left' | 'right'
  width?: number
  className?: string
}) {
  return (
    <div className={`${s.panel} ${s[align]} ${className ?? ''}`} style={{ width }} role="menu">
      {children}
    </div>
  )
}

export interface MenuItem {
  label: string
  onSelect: () => void
  danger?: boolean
}

export function MenuList({ items, onClose }: { items: MenuItem[]; onClose: () => void }) {
  return (
    <>
      {items.map((it) => (
        <button
          key={it.label}
          type="button"
          role="menuitem"
          className={`${s.item} ${it.danger ? s.danger : ''}`}
          onClick={() => {
            onClose()
            it.onSelect()
          }}
        >
          {it.label}
        </button>
      ))}
    </>
  )
}
