import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import s from './Modal.module.css'

export function Modal({ title, onClose, children, footer, width }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; width?: number }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  return createPortal(
    <div className={s.backdrop} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={s.dialog} role="dialog" aria-modal="true" aria-label={title} style={width ? { width } : undefined}>
        <div className={s.head}>
          <h2 className={s.title}>{title}</h2>
          <button type="button" className={s.close} onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className={s.body}>{children}</div>
        {footer && <div className={s.footer}>{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}
