import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { MenuList, type MenuItem } from './Popover'
import s from './Popover.module.css'

/**
 * Icon button with a menu rendered in a portal (fixed position) so containers that clip their overflow —
 * status bar, command panel, cards — do not cut it off. Opens up or down; closes on outside click / Escape.
 */
export function AnchoredMenu({ label, icon, className, items, width = 210, align = 'left', direction = 'up' }: { label: string; icon: ReactNode; className?: string; items: MenuItem[]; width?: number; align?: 'left' | 'right'; direction?: 'up' | 'down' }) {
  const [at, setAt] = useState<{ left: number; top?: number; bottom?: number } | null>(null)
  const btn = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!at) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (!btn.current?.contains(t) && !panel.current?.contains(t)) setAt(null)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setAt(null)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [at])
  const toggle = () => {
    if (at) return setAt(null)
    const r = btn.current!.getBoundingClientRect()
    const left = align === 'left' ? r.left : r.right - width
    setAt(direction === 'up' ? { left, bottom: window.innerHeight - r.top + 6 } : { left, top: r.bottom + 6 })
  }
  return (
    <>
      <button ref={btn} type="button" className={className} aria-label={label} title={label} aria-expanded={!!at} onClick={toggle}>
        {icon}
      </button>
      {at &&
        createPortal(
          <div ref={panel} className={s.panel} role="menu" style={{ position: 'fixed', top: at.top ?? 'auto', left: at.left, bottom: at.bottom ?? 'auto', width }}>
            <MenuList items={items} onClose={() => setAt(null)} />
          </div>,
          document.body,
        )}
    </>
  )
}
