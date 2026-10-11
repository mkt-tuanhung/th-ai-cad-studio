import { CheckCircle2, Info, TriangleAlert } from 'lucide-react'
import { useToasts } from '../../state/toast'
import s from './ToastHost.module.css'

export function ToastHost() {
  const { toasts, dismiss } = useToasts()
  return (
    <div className={s.host} aria-live="polite">
      {toasts.map((t) => (
        <button key={t.id} type="button" className={`${s.toast} ${s[t.tone]}`} onClick={() => dismiss(t.id)}>
          {t.tone === 'success' ? <CheckCircle2 size={16} /> : t.tone === 'warning' ? <TriangleAlert size={16} /> : <Info size={16} />}
          <span>{t.message}</span>
        </button>
      ))}
    </div>
  )
}
