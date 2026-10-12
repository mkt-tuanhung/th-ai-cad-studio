import { useState, type ComponentType } from 'react'
import { ChevronRight, DraftingCompass, FileCheck2, FileScan, Minus, SquarePen, X } from 'lucide-react'
import { fmt, useT } from '../../i18n'
import { useCad, type AiTab } from '../../state/cad'
import { toast } from '../../state/toast'
import { sendToAiStudio } from '../../state/aiStudio'
import { AiSparkIcon } from '../../components/icons'
import s from './AiAssistPanel.module.css'

const ICONS: ComponentType<{ size?: number; strokeWidth?: number }>[] = [FileScan, DraftingCompass, SquarePen, FileCheck2]
const TABS: AiTab[] = ['suggestions', 'generate', 'modify']

/**
 * AI Assist: each suggestion / description is sent to AI Studio's chat, which routes it on the local model
 * (answer, or an edit of the open drawing). Edits come back as a proposal that is previewed and must be
 * approved before commit (see docs/ARCHITECTURE.md §2); without a model the chat says so.
 */
export function AiAssistPanel() {
  const t = useT().cad.ai
  const { aiPanel, setAi } = useCad()
  const selection = useCad((st) => st.selection)
  const [gen, setGen] = useState('')
  const [mod, setMod] = useState('')
  const ask = (name: string, text: string) => {
    toast(fmt(t.sent, { name }))
    sendToAiStudio(text)
  }

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
                    <button type="button" className={`${s.item} ${i === 0 ? s.itemHi : ''}`} onClick={() => ask(it.title, it.prompt)}>
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
                if (gen.trim()) ask(t.generate, gen.trim())
              }}
            >
              <textarea className={s.prompt} placeholder={t.generatePlaceholder} aria-label={t.generatePlaceholder} rows={4} value={gen} onChange={(e) => setGen(e.target.value)} />
              <button type="submit" className={s.run} disabled={!gen.trim()}>
                <AiSparkIcon size={16} strokeWidth={1.8} />
                {t.generateRun}
              </button>
            </form>
          )}
          {aiPanel.tab === 'modify' && (
            <form
              className={s.form}
              onSubmit={(e) => {
                e.preventDefault()
                if (mod.trim() && selection.length) ask(t.modify, fmt(t.modifyPrompt, { ids: selection.join(', '), text: mod.trim() }))
              }}
            >
              <p className={s.hint}>{t.modifyHint}</p>
              <p className={s.count}>{fmt(t.selectedCount, { n: selection.length })}</p>
              <textarea className={s.prompt} placeholder={t.modifyPlaceholder} aria-label={t.modifyPlaceholder} rows={3} value={mod} onChange={(e) => setMod(e.target.value)} />
              <button type="submit" className={s.run} disabled={!mod.trim() || !selection.length}>
                <AiSparkIcon size={16} strokeWidth={1.8} />
                {t.modifyRun}
              </button>
            </form>
          )}
        </>
      )}
    </section>
  )
}
