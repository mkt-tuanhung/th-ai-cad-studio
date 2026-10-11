import type { ComponentType } from 'react'
import { ChevronRight, DraftingCompass, FileCheck2, FileScan, Minus, SquarePen, X } from 'lucide-react'
import { fmt, useT } from '../../i18n'
import { useCad, type AiTab } from '../../state/cad'
import { toast } from '../../state/toast'
import { AiSparkIcon } from '../../components/icons'
import s from './AiAssistPanel.module.css'

const ICONS: ComponentType<{ size?: number; strokeWidth?: number }>[] = [FileScan, DraftingCompass, SquarePen, FileCheck2]
const TABS: AiTab[] = ['suggestions', 'generate', 'modify']

/**
 * AI Assist. The local runtime (llama.cpp / MLX) is not attached in the UI prototype, so actions
 * say so instead of pretending. When attached, each item produces a CadOp that is previewed and
 * must be approved before commit (see docs/ARCHITECTURE.md §2).
 */
export function AiAssistPanel() {
  const t = useT().cad.ai
  const { aiPanel, setAi } = useCad()
  const selection = useCad((st) => st.selection)
  const notConnected = (name: string) => toast(fmt(t.runtimeMissing, { name }))

  return (
    <section className={`${s.card} ${aiPanel.minimized ? s.min : ''}`} aria-label={t.title}>
      <header className={s.head}>
        <AiSparkIcon size={24} strokeWidth={1.6} className={s.spark} />
        <h2 className={s.title}>{t.title}</h2>
        <button type="button" className={s.hbtn} aria-label={aiPanel.minimized ? t.restore : t.minimize} onClick={() => setAi({ minimized: !aiPanel.minimized })}>
          <Minus size={16} strokeWidth={1.8} />
        </button>
        <button type="button" className={s.hbtn} aria-label={t.close} onClick={() => setAi({ open: false })}>
          <X size={16} strokeWidth={1.8} />
        </button>
      </header>
      {!aiPanel.minimized && (
        <>
          <div className={s.tabs} role="tablist">
            {TABS.map((k) => (
              <button key={k} type="button" role="tab" aria-selected={aiPanel.tab === k} className={`${s.tab} ${aiPanel.tab === k ? s.tabOn : ''}`} onClick={() => setAi({ tab: k })}>
                {t[k]}
              </button>
            ))}
          </div>
          {aiPanel.tab === 'suggestions' && (
            <ul className={s.list}>
              {t.items.map((it, i) => {
                const Icon = ICONS[i]
                return (
                  <li key={it.title}>
                    <button type="button" className={`${s.item} ${i === 0 ? s.itemHi : ''}`} onClick={() => notConnected(it.title)}>
                      <span className={s.itemIcon}>
                        <Icon size={20} strokeWidth={1.5} />
                      </span>
                      <span className={s.itemText}>
                        <span className={s.itemTitle}>{it.title}</span>
                        <span className={s.itemDesc}>{it.desc}</span>
                      </span>
                      <ChevronRight size={16} strokeWidth={1.8} className={s.chev} />
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
          {aiPanel.tab === 'generate' && (
            <form
              className={s.form}
              onSubmit={(e) => {
                e.preventDefault()
                notConnected(t.generate)
              }}
            >
              <textarea className={s.prompt} placeholder={t.generatePlaceholder} rows={4} />
              <button type="submit" className={s.run}>
                <AiSparkIcon size={16} strokeWidth={1.8} />
                {t.generateRun}
              </button>
            </form>
          )}
          {aiPanel.tab === 'modify' && (
            <div className={s.form}>
              <p className={s.hint}>{t.modifyHint}</p>
              <p className={s.count}>{fmt(t.selectedCount, { n: selection.length })}</p>
            </div>
          )}
        </>
      )}
    </section>
  )
}
