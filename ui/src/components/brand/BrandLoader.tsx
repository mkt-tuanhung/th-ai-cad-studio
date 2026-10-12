import { create } from 'zustand'
import { BRAND, BRAND_ASSETS } from './brand'
import s from './BrandLoader.module.css'

/**
 * Brand loading state: small MD monogram, a status line and a progress line (determinate when `progress` is
 * given, otherwise an indeterminate sweep). Used by the splash (startup), and as an overlay for model,
 * project and drawing loading through `brandLoading`.
 */
export function BrandLoader({ text, progress, tone = 'dark', compact }: { text: string; progress?: number; tone?: 'dark' | 'light'; compact?: boolean }) {
  const pct = progress === undefined ? undefined : Math.max(0, Math.min(1, progress))
  return (
    <div className={`${s.loader} ${tone === 'light' ? s.light : ''} ${compact ? s.compact : ''}`} role="status" aria-live="polite" data-testid="brand-loader">
      <img className={s.mark} src={tone === 'light' ? BRAND_ASSETS.monogram : BRAND_ASSETS.monogramDark} alt={BRAND.name} draggable={false} />
      <span className={s.text}>{text}</span>
      <span className={`${s.track} ${pct === undefined ? s.indeterminate : ''}`}>
        <span className={s.fill} style={pct === undefined ? undefined : { width: `${pct * 100}%` }} />
      </span>
    </div>
  )
}

/** App-wide loading overlay: `brandLoading.start(text)` → handle; `.update(text, progress)`; `.done()`. */
interface LoadingState {
  tasks: { id: number; text: string; progress?: number }[]
}
const useLoading = create<LoadingState>(() => ({ tasks: [] }))
let seq = 0
export const brandLoading = {
  start(text: string, progress?: number) {
    const id = ++seq
    useLoading.setState((st) => ({ tasks: [...st.tasks, { id, text, progress }] }))
    return {
      update: (t: string, p?: number) => useLoading.setState((st) => ({ tasks: st.tasks.map((x) => (x.id === id ? { id, text: t, progress: p } : x)) })),
      done: () => useLoading.setState((st) => ({ tasks: st.tasks.filter((x) => x.id !== id) })),
    }
  },
  /** Runs `work` with the overlay shown. */
  async run<T>(text: string, work: () => Promise<T>): Promise<T> {
    const h = brandLoading.start(text)
    try {
      return await work()
    } finally {
      h.done()
    }
  },
}

export function BrandLoadingOverlay() {
  const task = useLoading((st) => st.tasks[st.tasks.length - 1])
  if (!task) return null
  return (
    <div className={s.overlay}>
      <BrandLoader text={task.text} progress={task.progress} tone="dark" />
    </div>
  )
}
