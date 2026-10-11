import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { ChevronRight, CircleHelp, History, Settings, TriangleAlert } from 'lucide-react'
import { fmt, useT } from '../../i18n'
import { useCad, type BottomTab } from '../../state/cad'
import { useCadSession } from '../../state/cadSession'
import { toast } from '../../state/toast'
import { runChecks } from '../../cad/checks'
import { formatLength } from '../../cad/geometry'
import s from './CommandPanel.module.css'

export interface CommandPanelHandle {
  focus: (initial?: string) => void
}

export const CommandPanel = forwardRef<CommandPanelHandle>(function CommandPanel(_, ref) {
  const T = useT()
  const t = T.cad.cmd
  const { bottomTab, set, log, print, setSelection } = useCad()
  const doc = useCad((st) => st.activeDoc())
  const session = useCadSession()
  const [value, setValue] = useState('')
  const [recall, setRecall] = useState<string[]>([])
  const [recallIdx, setRecallIdx] = useState(-1)
  const input = useRef<HTMLInputElement>(null)
  const logRef = useRef<HTMLDivElement>(null)
  const findings = useMemo(() => (doc ? runChecks(doc) : []), [doc])

  useImperativeHandle(ref, () => ({
    focus: (initial) => {
      set({ bottomTab: 'command' })
      input.current?.focus()
      if (initial !== undefined) setValue((v) => v + initial)
    },
  }))

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [log, bottomTab])

  const submit = () => {
    const v = value
    if (v.trim()) setRecall((r) => [...r.filter((x) => x !== v.trim()), v.trim()].slice(-50))
    setValue('')
    setRecallIdx(-1)
    session.input(v)
  }

  const tabs: { k: BottomTab; label: string }[] = [
    { k: 'command', label: t.tab },
    { k: 'detected', label: fmt(t.detected, { n: findings.length }) },
    { k: 'ai', label: t.aiTab },
  ]

  return (
    <section className={s.card}>
      <div className={s.head}>
        <div className={s.tabs} role="tablist">
          {tabs.map(({ k, label }) => (
            <button key={k} type="button" role="tab" aria-selected={bottomTab === k} className={`${s.tab} ${bottomTab === k ? s.tabOn : ''}`} onClick={() => set({ bottomTab: k })}>
              {label}
            </button>
          ))}
        </div>
        <div className={s.tools}>
          <button type="button" className={s.tbtn} aria-label={t.history} title={t.history} onClick={() => set({ bottomTab: 'command' })}>
            <History size={17} strokeWidth={1.6} />
          </button>
          <span className={s.toolsSep} />
          <button type="button" className={s.tbtn} aria-label={t.settings} title={t.settings} onClick={() => toast(fmt(T.toast.notImplemented, { feature: t.settings }))}>
            <Settings size={17} strokeWidth={1.6} />
          </button>
          <button type="button" className={s.tbtn} aria-label={t.help} title={`${t.help} (F1)`} onClick={() => print(t.helpText, 'info')}>
            <CircleHelp size={17} strokeWidth={1.6} />
          </button>
        </div>
      </div>

      {bottomTab === 'command' && (
        <>
          <div ref={logRef} className={`${s.log} scroll-y`} role="log" aria-live="polite">
            {log.map((l) => (
              <div key={l.id} className={l.tone === 'error' ? s.err : l.tone === 'info' ? s.info : undefined}>
                {l.text}
              </div>
            ))}
          </div>
          <div className={s.inputWrap}>
            {session.stage && <span className={s.prompt}>{session.prompt()}</span>}
            <input
              ref={input}
              className={s.input}
              value={value}
              spellCheck={false}
              autoComplete="off"
              placeholder={session.stage ? '' : t.placeholder}
              aria-label={t.placeholder}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  submit()
                } else if (e.key === 'Escape') {
                  setValue('')
                  session.cancel()
                  input.current?.blur()
                } else if (e.key === 'ArrowUp' && recall.length) {
                  e.preventDefault()
                  const i = recallIdx < 0 ? recall.length - 1 : Math.max(0, recallIdx - 1)
                  setRecallIdx(i)
                  setValue(recall[i])
                } else if (e.key === 'ArrowDown' && recallIdx >= 0) {
                  e.preventDefault()
                  const i = recallIdx + 1
                  setRecallIdx(i >= recall.length ? -1 : i)
                  setValue(i >= recall.length ? '' : recall[i])
                } else if (e.key === ' ' && !value.trim() && session.stage !== 'textValue') {
                  // AutoCAD: space = Enter on the command line
                  e.preventDefault()
                  submit()
                }
              }}
            />
          </div>
        </>
      )}

      {bottomTab === 'detected' && (
        <ul className={`${s.list} scroll-y`}>
          {findings.length === 0 && <li className={s.none}>{T.cad.detected.none}</li>}
          {findings.map((f) => (
            <li key={f.id}>
              <button type="button" className={s.finding} onClick={() => setSelection([f.entityId])}>
                <TriangleAlert size={15} strokeWidth={1.8} />
                <span>
                  {f.kind === 'dimension-override'
                    ? fmt(T.cad.detected.dimOverride, { shown: f.shown ?? '', measured: formatLength(f.measured ?? 0) })
                    : T.cad.detected.zero}
                </span>
                <em>{T.cad.detected.zoomTo}</em>
              </button>
            </li>
          ))}
        </ul>
      )}

      {bottomTab === 'ai' && (
        <ul className={`${s.list} scroll-y`}>
          {T.cad.ai.items.map((it) => (
            <li key={it.title}>
              <button type="button" className={s.finding} onClick={() => toast(fmt(T.cad.ai.runtimeMissing, { name: it.title }))}>
                <ChevronRight size={15} strokeWidth={1.8} />
                <span>
                  {it.title} — {it.desc}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
})
