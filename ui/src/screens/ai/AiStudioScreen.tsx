import { ScanToCadModal } from './ScanToCad'
import { useEffect, useRef, useState } from 'react'
import { fmt, useT } from '../../i18n'
import { useAiStudio } from '../../state/aiStudio'
import { useCad } from '../../state/cad'
import { useRouter } from '../../state/router'
import { toast } from '../../state/toast'
import { runChecks } from '../../cad/checks'
import { formatLength } from '../../cad/geometry'
import { createProposalDocument, PROPOSALS } from '../../ai/sampleSession'
import { Modal } from '../../components/ui/Modal'
import { ActionButton } from '../../components/ui/Button'
import { StudioHeader, type CapKey } from './StudioHeader'
import { ChatPanel } from './ChatPanel'
import { LocalAiStrip } from './LocalAiStrip'
import { ProposalWorkspace } from './ProposalWorkspace'
import { TaskPresetsDialog } from './TaskPresets'
import { createJob, type AiJob } from '../../ai/jobs'
import { SCAN_STEPS } from '../../ai/presets'
import s from './AiStudioScreen.module.css'

export function AiStudioScreen() {
  const T = useT()
  const t = T.ai
  const studio = useAiStudio()
  const cad = useCad()
  const navigate = useRouter((st) => st.navigate)
  const [approveOpen, setApproveOpen] = useState(false)
  const scanRef = useRef<HTMLInputElement>(null)
  const [scanFile, setScanFile] = useState<File | null>(null)
  // v2.4 AI task presets + job queue (opened from the chat ⋯ menu); a preset-driven Scan to CAD runs as a job
  const [presets, setPresets] = useState<'presets' | 'jobs' | null>(null)
  const [scanJob, setScanJob] = useState<string | null>(null)
  const pendingScan = useRef<string | null>(null)
  useEffect(() => {
    const on = (e: Event) => setPresets(((e as CustomEvent).detail as 'presets' | 'jobs') ?? 'presets')
    window.addEventListener('thcad-presets', on)
    return () => window.removeEventListener('thcad-presets', on)
  }, [])
  const startScanPreset = (jobId?: string) => {
    pendingScan.current = jobId ?? 'new'
    setPresets(null)
    scanRef.current?.click()
  }
  const p = PROPOSALS[studio.option - 1]
  const optionLabel = fmt(t.option, { n: p.n })
  const file = `Office Layout - Option ${p.n}.dwg`

  const capability = (k: CapKey) => {
    switch (k) {
      case 'generateLayout':
        return studio.set({ draft: T.ai.caps.generateLayout.desc.replace('\n', ' ') + ': ' })
      case 'smartFix':
        return studio.set({ draft: 'Fix wall intersections' })
      case 'scanToCad':
        pendingScan.current = null
        return scanRef.current?.click()
      case 'compare':
        return studio.set({ tab: 'files' })
      case 'voiceCad':
        // the chat composer owns the microphone
        return window.dispatchEvent(new Event('thcad-voice'))
      case 'geometryDoctor': {
        // Deterministic local checks on the open drawing — no model involved.
        const doc = cad.activeDoc()
        if (!doc) return studio.pushTool(t.chat.doctorNoDoc, [])
        const lines = runChecks(doc).map((f) =>
          f.kind === 'dimension-override' ? fmt(t.chat.doctorDim, { shown: f.shown ?? '', measured: formatLength(f.measured ?? 0) }) : t.chat.doctorZero,
        )
        return studio.pushTool(fmt(t.chat.doctorTitle, { name: doc.name }), lines.length ? lines : [t.chat.doctorNone])
      }
    }
  }

  const confirmApprove = () => {
    const doc = { ...createProposalDocument(), name: file }
    cad.openDocument(doc)
    studio.recordApply({ option: p.n, docId: doc.id, file })
    setApproveOpen(false)
    toast(fmt(t.approve.applied, { file }), 'success')
    navigate('cad2d')
  }

  const undo = () => {
    const last = studio.popApply()
    if (!last) return toast(t.approve.nothingToUndo)
    cad.closeTab(last.docId)
    toast(fmt(t.approve.undone, { file: last.file }))
  }

  return (
    <div className={s.panel}>
      <div className={s.header}>
        <StudioHeader onCapability={capability} />
      </div>
      <div className={s.chat}>
        <ChatPanel />
      </div>
      <div className={s.right}>
        <LocalAiStrip onApply={() => setApproveOpen(true)} />
        <div className={s.work}>
          <ProposalWorkspace
            onUndo={undo}
            onApprove={() => setApproveOpen(true)}
            onReject={() => {
              studio.reject(p.n)
              toast(fmt(t.approve.rejectedToast, { option: optionLabel }))
            }}
            onOpenDoc={(id) => {
              cad.setActive(id)
              if (!cad.tabs.includes(id)) cad.openDocument(cad.docs[id])
              navigate('cad2d')
            }}
          />
        </div>
      </div>

      <input
        ref={scanRef}
        type="file"
        hidden
        accept="image/*,.pdf"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) {
            // a preset run: a new job, or the job being resumed (its file is not kept between sessions)
            const pend = pendingScan.current
            pendingScan.current = null
            if (pend === 'new') {
              const j: AiJob = createJob({ preset: 'scan', title: fmt(T.importCal.jobs.jobTitleScan, { file: f.name }), steps: SCAN_STEPS, input: { file: f.name } })
              studio.saveJob(j)
              setScanJob(j.id)
            } else if (pend) {
              const j = studio.jobs.find((x) => x.id === pend)
              if (j) studio.saveJob({ ...j, status: 'in-progress', questions: j.questions.filter((q) => q.code !== 'reselect-file'), input: { ...j.input, file: f.name }, updatedAt: Date.now() })
              setScanJob(pend)
            } else setScanJob(null)
            setScanFile(f)
          }
          e.target.value = ''
        }}
      />

      {scanFile && <ScanToCadModal file={scanFile} jobId={scanJob} onClose={() => setScanFile(null)} />}
      {presets && <TaskPresetsDialog tab={presets} onClose={() => setPresets(null)} onStartScan={startScanPreset} />}

      {approveOpen && (
        <Modal
          title={fmt(t.approve.title, { option: optionLabel })}
          onClose={() => setApproveOpen(false)}
          footer={
            <>
              <ActionButton onClick={() => setApproveOpen(false)}>{t.approve.cancel}</ActionButton>
              <ActionButton variant="primary" disabled={!p.hasPreview} onClick={confirmApprove}>
                {t.approve.confirm}
              </ActionButton>
            </>
          }
        >
          <p className={s.modalText}>{p.hasPreview ? fmt(t.approve.body, { file }) : t.noPreview}</p>
        </Modal>
      )}
    </div>
  )
}
