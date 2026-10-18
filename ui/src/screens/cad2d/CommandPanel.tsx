import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { ChevronRight, CircleHelp, History, Settings, TriangleAlert } from 'lucide-react'
import { AnchoredMenu } from '../../components/ui/AnchoredMenu'
import { bboxOf, unionBBox } from '../../cad/geometry'
import { fmt, useT } from '../../i18n'
import { useCad, type BottomTab } from '../../state/cad'
import { cadUi, useCadSession } from '../../state/cadSession'
import { openReview } from '../../cad/provenance'
import { itemText } from './ReviewDialog'
import { toast } from '../../state/toast'
import { sendToAiStudio } from '../../state/aiStudio'
import { runChecks } from '../../cad/checks'
import { formatLength } from '../../cad/geometry'
import s from './CommandPanel.module.css'

export interface CommandPanelHandle {
  focus: (initial?: string) => void
}

export const CommandPanel = forwardRef<CommandPanelHandle>(function CommandPanel(_, ref) {
  const T = useT()
  const t = T.cad.cmd
  const { bottomTab, set, log, print, setSelection, cmdFont, spaceEnter, clearLog, setView } = useCad()
  const doc = useCad((st) => st.activeDoc())
  const session = useCadSession()
  const [value, setValue] = useState('')
  const [recall, setRecall] = useState<string[]>([])
  const [recallIdx, setRecallIdx] = useState(-1)
  const input = useRef<HTMLInputElement>(null)
  const logRef = useRef<HTMLDivElement>(null)
  const findings = useMemo(() => (doc ? runChecks(doc) : []), [doc])
  // v2.4: open review items of an imported / surveyed drawing are listed with the findings
  const review = useMemo(() => (doc ? openReview(doc) : []), [doc])

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
    { k: 'detected', label: fmt(t.detected, { n: findings.length + review.length }) },
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
          <AnchoredMenu
            label={t.settings}
            className={s.tbtn}
            icon={<Settings size={17} strokeWidth={1.6} />}
            width={220}
            align="right"
            items={[
              ...[12, 13, 15].map((n) => ({ label: fmt(t.fontSize, { n }), checked: cmdFont === n, onSelect: () => set({ cmdFont: n }) })),
              { label: t.spaceEnter, checked: spaceEnter, onSelect: () => set({ spaceEnter: !spaceEnter }) },
              { label: t.clear, onSelect: clearLog, danger: true },
            ]}
          />
          <button type="button" className={s.tbtn} aria-label={t.help} title={`${t.help} (F1)`} onClick={() => print(t.helpText, 'info')}>
            <CircleHelp size={17} strokeWidth={1.6} />
          </button>
        </div>
      </div>

      {bottomTab === 'command' && (
        <>
          <div ref={logRef} className={`${s.log} scroll-y`} role="log" aria-live="polite" style={{ fontSize: cmdFont }}>
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
              style={{ fontSize: cmdFont }}
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
                } else if (e.key === ' ' && spaceEnter && !value.trim() && session.stage !== 'textValue') {
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
          {findings.length + review.length === 0 && <li className={s.none}>{T.cad.detected.none}</li>}
          {findings.map((f) => (
            <li key={f.id}>
              <button
                type="button"
                className={s.finding}
                onClick={() => {
                  setSelection([f.entityId])
                  // zoom to it: the entity's box fills about a third of the view
                  const e = doc?.entities.find((x) => x.id === f.entityId)
                  const b = e && unionBBox([bboxOf(e)])
                  if (doc && b) setView(doc.id, { center: { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 }, mmPerPx: Math.max(1, Math.max(b.maxX - b.minX, b.maxY - b.minY) / 300) })
                }}
              >
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
          {doc && review.map((it) => (
            <li key={it.id}>
              <button type="button" className={s.finding} data-testid="detected-review" onClick={() => { if (it.entityId) setSelection([it.entityId]); cadUi.review?.() }}>
                <TriangleAlert size={15} strokeWidth={1.8} />
                <span>{fmt(T.importCal.review.detected, { text: itemText(T.importCal, it, doc.provenance?.sources[it.sourceId]) })}</span>
                <em>{T.importCal.review.open}</em>
              </button>
            </li>
          ))}
        </ul>
      )}

      {bottomTab === 'ai' && (
        <ul className={`${s.list} scroll-y`}>
          {T.cad.ai.items.map((it) => (
            <li key={it.title}>
              <button type="button" className={s.finding} onClick={() => { toast(fmt(T.cad.ai.sent, { name: it.title })); sendToAiStudio(it.prompt) }}>
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
