import { Check, CircleCheck, CircleCheckBig, Columns2, Eye, FileStack, LayoutList, Settings, Undo2, X } from 'lucide-react'
import { fmt, useLang, useT } from '../../i18n'
import { useAiStudio, type StudioTab } from '../../state/aiStudio'
import { useCad } from '../../state/cad'
import { PROPOSALS, type Proposal } from '../../ai/sampleSession'
import { CroppedImage } from '../../components/ui/CroppedImage'
import { PreviewViewport } from './PreviewViewport'
import s from './ProposalWorkspace.module.css'

export interface WorkspaceActions {
  onUndo: () => void
  onApprove: () => void
  onReject: () => void
  onOpenDoc: (id: string) => void
}

export function useProposalText(p: Proposal) {
  const lang = useLang()
  return lang === 'vi' ? { name: p.vi.name, planName: p.vi.planName, details: p.vi.details, improvements: p.vi.improvements, actions: p.vi.actions } : { name: p.name, planName: p.planName, details: p.details, improvements: p.improvements, actions: p.actions.map((a) => a.label) }
}

export function ProposalWorkspace(a: WorkspaceActions) {
  const T = useT()
  const t = T.ai
  const lang = useLang()
  const { option, tab, compare, rejected, set } = useAiStudio()
  const p = PROPOSALS[option - 1]
  const txt = useProposalText(p)
  const isRejected = rejected.includes(option)

  const tabs: { k: StudioTab; label: string; Icon: typeof LayoutList }[] = [
    { k: 'preview', label: fmt(t.tabs.preview, { n: PROPOSALS.length }), Icon: LayoutList },
    { k: 'actions', label: t.tabs.actions, Icon: Settings },
    { k: 'files', label: t.tabs.files, Icon: FileStack },
  ]

  return (
    <section className={s.card}>
      <div className={s.tabs} role="tablist">
        {tabs.map(({ k, label, Icon }) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={`${s.tab} ${tab === k ? s.tabOn : ''}`} onClick={() => set({ tab: k })}>
            <Icon size={19} strokeWidth={1.6} />
            {label}
          </button>
        ))}
      </div>

      <div className={s.options}>
        {PROPOSALS.map((q) => (
          <OptionCard key={q.n} p={q} active={q.n === option} rejected={rejected.includes(q.n)} onClick={() => set({ option: q.n })} />
        ))}
        <button type="button" className={`${s.compare} ${compare ? s.compareOn : ''}`} aria-pressed={compare} onClick={() => set({ compare: !compare, tab: 'preview' })}>
          <Columns2 size={18} strokeWidth={1.6} />
          {t.sideBySide}
        </button>
      </div>

      <div className={s.content}>
        {tab === 'preview' && (
          <>
            <div className={`${s.previewWrap} ${compare ? s.split : ''}`}>
              {compare ? (
                <>
                  <PreviewViewport key="c1" option={1} name={nameOf(PROPOSALS[0], lang)} hasPreview compact />
                  <PreviewViewport key={`c${option === 1 ? 2 : option}`} option={option === 1 ? 2 : option} name={nameOf(PROPOSALS[option === 1 ? 1 : option - 1], lang)} hasPreview={PROPOSALS[option === 1 ? 1 : option - 1].hasPreview} compact />
                </>
              ) : (
                <PreviewViewport key={option} option={option} name={txt.planName} hasPreview={p.hasPreview} />
              )}
            </div>
            <Details p={p} />
          </>
        )}
        {tab === 'actions' && <ActionsList p={p} />}
        {tab === 'files' && <FilesList onOpenDoc={a.onOpenDoc} />}
      </div>

      <div className={s.actions}>
        <button type="button" className={`${s.btn} ${s.undo}`} onClick={a.onUndo}>
          <Undo2 size={18} strokeWidth={1.7} />
          {t.actions.undo}
        </button>
        <button type="button" className={`${s.btn} ${s.preview}`} disabled={isRejected} onClick={() => set({ tab: 'actions' })}>
          <Eye size={19} strokeWidth={1.7} />
          {t.actions.previewChanges}
        </button>
        <button type="button" className={`${s.btn} ${s.approve}`} disabled={isRejected} onClick={a.onApprove}>
          <Check size={19} strokeWidth={2} />
          {t.actions.approve}
        </button>
        <button type="button" className={`${s.btn} ${s.reject}`} disabled={isRejected} onClick={a.onReject}>
          <X size={19} strokeWidth={2} />
          {isRejected ? t.actions.rejected : t.actions.reject}
        </button>
      </div>
    </section>
  )
}

const nameOf = (p: Proposal, lang: string) => (lang === 'vi' ? p.vi.planName : p.planName)

function OptionCard({ p, active, rejected, onClick }: { p: Proposal; active: boolean; rejected: boolean; onClick: () => void }) {
  const t = useT().ai
  const txt = useProposalText(p)
  return (
    <button type="button" className={`${s.option} ${active ? s.optionOn : ''} ${rejected ? s.optionRejected : ''}`} aria-pressed={active} onClick={onClick}>
      <span className={s.radio}>{active && <Check size={16} strokeWidth={2.4} />}</span>
      <span className={s.optText}>
        <span className={s.optTitle}>{fmt(t.option, { n: p.n })}</span>
        <span className={s.optName}>{rejected ? t.actions.rejected : txt.name}</span>
      </span>
    </button>
  )
}

function Details({ p }: { p: Proposal }) {
  const t = useT().ai.details
  const txt = useProposalText(p)
  const rows: [string, string, 'plain' | 'outline' | 'filled'][] = [
    [t.totalArea, txt.details.totalArea, 'plain'],
    [t.offices, txt.details.offices, 'plain'],
    [t.meeting, txt.details.meeting, 'plain'],
    [t.pantry, txt.details.pantry, 'plain'],
    [t.structure, txt.details.structure, 'outline'],
    [t.compliance, txt.details.compliance, 'filled'],
  ]
  return (
    <aside className={s.details}>
      <h3 className={s.detailsTitle}>{t.title}</h3>
      {p.hasPreview ? (
        <CroppedImage className={s.photo} src="/assets/ai_proposal_details_panel.png" natW={228} natH={354} crop={{ x: 43, y: 45, w: 185, h: 75 }} alt={txt.name} />
      ) : (
        <div className={`${s.photo} ${s.photoNone}`} />
      )}
      <dl className={s.rows}>
        {rows.map(([k, v, kind]) => (
          <div key={k} className={s.drow}>
            <dt>{k}</dt>
            <dd className={kind !== 'plain' ? s.good : undefined}>
              {kind === 'outline' && <CircleCheck size={13} strokeWidth={2} />}
              {kind === 'filled' && <span className={s.filledCheck}><Check size={9} strokeWidth={3.2} /></span>}
              {v}
            </dd>
          </div>
        ))}
      </dl>
      <h4 className={s.impTitle}>{t.improvements}</h4>
      <ul className={s.imps}>
        {txt.improvements.map((it) => (
          <li key={it}>
            <span className={s.impCheck}>
              <Check size={10} strokeWidth={3.2} />
            </span>
            {it}
          </li>
        ))}
      </ul>
    </aside>
  )
}

function ActionsList({ p }: { p: Proposal }) {
  const T = useT()
  const t = T.ai.actions
  const txt = useProposalText(p)
  return (
    <div className={`${s.listPane} scroll-y`}>
      <h3 className={s.listTitle}>{fmt(t.listTitle, { option: fmt(T.ai.option, { n: p.n }) })}</h3>
      <p className={s.listNote}>{t.listNote}</p>
      <ol className={s.opList}>
        {p.actions.map((op, i) => (
          <li key={i}>
            <code>{op.op}</code>
            <span>{txt.actions[i]}</span>
            <em>{fmt(t.count, { n: op.count })}</em>
          </li>
        ))}
      </ol>
    </div>
  )
}

function FilesList({ onOpenDoc }: { onOpenDoc: (id: string) => void }) {
  const t = useT().ai.files
  const docs = useCad((st) => st.docs)
  const applied = useAiStudio((st) => st.applied)
  const appliedIds = new Set(applied.map((x) => x.docId))
  return (
    <div className={`${s.listPane} scroll-y`}>
      <ul className={s.files}>
        {Object.values(docs).map((d) => (
          <li key={d.id}>
            <span className={s.fileBadge}>{appliedIds.has(d.id) ? 'AI' : 'DWG'}</span>
            <span className={s.fileName}>
              {d.name}
              <small>{appliedIds.has(d.id) ? t.proposal : t.current}</small>
            </span>
            <button type="button" className={s.fileOpen} onClick={() => onOpenDoc(d.id)}>
              {t.openInCad}
            </button>
          </li>
        ))}
        {PROPOSALS.map((p) => (
          <li key={p.n}>
            <span className={`${s.fileBadge} ${s.fileBadgeAi}`}>v{p.n}</span>
            <span className={s.fileName}>
              Office Layout - Option {p.n}
              <small>{t.proposal}</small>
            </span>
            {p.hasPreview ? <CircleCheckBig size={16} className={s.fileOk} /> : <span className={s.fileDash}>—</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}
