import { useEffect, useRef, useState } from 'react'
import { Check, Loader2, Send, Sparkles, X } from 'lucide-react'
import { fmt, useT } from '../../i18n'
import { toast } from '../../state/toast'
import { useHost } from '../../services/host'
import { ask, warm, type AiRun, type Discipline } from '../../ai/discipline'
import { Modal } from '../ui/Modal'
import s from './AiAssist.module.css'

/** State and actions of one assistant (request → proposal → approve / reject). */
export function useAiAssist<M>(d: Discipline<M>, model: M, apply: (label: string, next: M) => string | null) {
  const t = useT().aiAssist
  const host = useHost()
  const [busy, setBusy] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [run, setRun] = useState<AiRun<M> | null>(null)
  const timer = useRef<number>(0)
  // prefill the model with the prompt prefix in the background, so the first answer comes quickly
  useEffect(() => {
    if (host) void warm(host, d, model)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host, d])
  useEffect(() => () => window.clearInterval(timer.current), [])
  const send = async (text: string) => {
    if (!host || !text.trim() || busy) return
    setBusy(true)
    setRun(null)
    const t0 = Date.now()
    timer.current = window.setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 500)
    const r = await ask(host, d, model, text.trim())
    window.clearInterval(timer.current)
    setBusy(false)
    setElapsed(0)
    setRun(r)
  }
  const approve = () => {
    const pv = run?.preview
    if (!pv?.model) return false
    const err = apply(`AI: ${pv.title}`, pv.model)
    if (err) {
      toast(fmt(t.invalid, { why: err }), 'warning')
      return false
    }
    toast(fmt(t.applied, { title: pv.title }), 'success')
    setRun(null)
    return true
  }
  const reject = () => {
    setRun(null)
    toast(t.rejected)
  }
  return { host, busy, elapsed, run, send, approve, reject }
}

/** Busy line, proposal (changes + approve / reject) or why it failed. */
export function AiResult<M>({ a }: { a: ReturnType<typeof useAiAssist<M>> }) {
  const t = useT().aiAssist
  const { run, busy, elapsed } = a
  const pv = run?.preview
  return (
    <>
      {busy && <p className={s.note}>{fmt(t.thinking, { s: elapsed })}</p>}
      {run?.error === 'no-model' && <p className={s.note}>{t.noModel}</p>}
      {run && run.error !== 'no-model' && (
        <div className={s.result} data-testid="ai-proposal">
          {pv && !pv.error && pv.ops.length > 0 && (
            <>
              <b className={s.title}>{t.proposal}: {pv.title}</b>
              <small>{fmt(t.changes, { n: pv.changes.length })}</small>
              <ul>
                {pv.changes.map((c, i) => <li key={i}>{c}</li>)}
              </ul>
              <div className={s.actions}>
                <button type="button" className={s.approve} onClick={() => a.approve()}><Check size={14} />{t.approve}</button>
                <button type="button" className={s.reject} onClick={a.reject}><X size={14} />{t.reject}</button>
              </div>
            </>
          )}
          {pv && !pv.error && pv.ops.length === 0 && <p className={s.note}>{fmt(t.none, { title: pv.title })}</p>}
          {(!pv || pv.error) && <p className={s.err}>{fmt(t.invalid, { why: pv?.error ?? run.error ?? '—' })}</p>}
          <small className={s.meta}>{fmt(t.meta, { model: run.model ?? 'local model', s: run.seconds.toFixed(1), retry: run.retried ? t.retry : '' })}</small>
          {(!pv || pv.error) && run.raw && (
            <details>
              <summary>{t.raw}</summary>
              <pre>{run.raw.slice(0, 1200)}</pre>
            </details>
          )}
        </div>
      )}
    </>
  )
}

/**
 * Request box of a discipline assistant: the local model proposes typed operations, the user sees every
 * change (validated against the model rules) and approves it as one undoable edit — or rejects it.
 */
export function AiAssist<M>({ d, model, apply, example, compact }: { d: Discipline<M>; model: M; apply: (label: string, next: M) => string | null; example: string; compact?: boolean }) {
  const t = useT().aiAssist
  const a = useAiAssist(d, model, apply)
  const [text, setText] = useState('')
  const send = () => void a.send(text)
  return (
    <section className={`${s.box} ${compact ? s.compact : ''}`} aria-label={t.title} data-testid={`ai-assist-${d.key}`}>
      <header>
        <Sparkles size={15} strokeWidth={1.8} />
        <b>{t.title}</b>
      </header>
      {!a.host ? (
        <p className={s.note}>{t.browser}</p>
      ) : (
        <>
          <div className={s.input}>
            <textarea
              value={text}
              rows={compact ? 2 : 3}
              placeholder={fmt(t.placeholder, { example })}
              aria-label={t.title}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send()
              }}
            />
            <button type="button" className={s.send} aria-label={t.send} title={t.send} disabled={a.busy || !text.trim()} onClick={send}>
              {a.busy ? <Loader2 size={15} className={s.spin} /> : <Send size={15} strokeWidth={1.8} />}
            </button>
          </div>
          <AiResult a={a} />
        </>
      )}
    </section>
  )
}

/** The same box in a dialog (for screens whose AI card has no room for a request). */
export function AiAssistModal<M>(p: { d: Discipline<M>; model: M; apply: (label: string, next: M) => string | null; example: string; onClose: () => void }) {
  const t = useT().aiAssist
  return (
    <Modal title={t.title} onClose={p.onClose} width={520}>
      <AiAssist d={p.d} model={p.model} apply={p.apply} example={p.example} />
    </Modal>
  )
}
