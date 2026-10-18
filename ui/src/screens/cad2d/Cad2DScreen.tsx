import { brandLoading } from '../../components/brand/BrandLoader'
import { DEFAULT_LAYOUTS } from '../../cad/types'
import { useEffect, useRef, useState } from 'react'
import { fmt, useT } from '../../i18n'
import { useCad } from '../../state/cad'
import { matchesShortcut, useSettings } from '../../state/settings'
import { cadInbox, cadUi, useCadSession } from '../../state/cadSession'
import { useRouter } from '../../state/router'
import { toast } from '../../state/toast'
import { useWorkspace } from '../../state/workspace'
import { toDxf } from '../../cad/dxf'
import { toDxf2000 } from '../../cad/dxf2000'
import { readDrawing } from '../../cad/batch'
import { dwgReader } from '../../services/dwg'
import { getHost } from '../../services/host'
import { toDwgAdd } from '../../cad/dwgWrite'
import { pagePng, pageSvg, plotPage } from '../../cad/plot'
import { downloadFile } from '../../components/workspace/Workspace'
import { Modal } from '../../components/ui/Modal'
import { ActionButton } from '../../components/ui/Button'
import { Field, TextInput } from '../../components/ui/Field'
import { FileTabs } from './FileTabs'
import { CadRibbon } from './CadRibbon'
import { ToolPalette } from './ToolPalette'
import { CanvasCard } from './CanvasCard'
import { RightPanel } from './RightPanel'
import { AiAssistPanel } from './AiAssistPanel'
import { CommandPanel, type CommandPanelHandle } from './CommandPanel'
import { StatusBar, StatusRight } from './StatusBar'
import { useKeyActions } from '../../platform/useKeyActions'
import { ACTIONS } from '../../platform/keymap'
import { snapshotOn } from '../../platform/snapshots'
import { hostError } from '../../platform/hostErrors'
import { ReviewDialog } from './ReviewDialog'
import { CalibrateDialog } from './CalibrateDialog'
import { SurveyRoomDialog } from './SurveyRoomDialog'
import s from './Cad2DScreen.module.css'

/** Interaction-profile actions of CAD 2D: they type the same command as the command line (a plain letter key never
 *  reaches here — it belongs to the command line, see platform/keymap.ts). */
const CAD_ACTIONS: Record<string, () => void> = Object.fromEntries(
  ACTIONS.filter((a) => a.scope === 'cad2d' && a.command).map((a) => [a.id, () => {
    const ss = useCadSession.getState()
    ss.cancel()
    ss.input(a.command!)
    if (a.command === 'ZOOM') ss.input('E')
  }]),
)

const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || (el as HTMLElement | null)?.isContentEditable

export function Cad2DScreen() {
  const T = useT()
  const cad = useCad()
  const doc = cad.activeDoc()
  const history = useCad((st) => (doc ? st.history[doc.id] : undefined))
  const session = useCadSession()
  const navigate = useRouter((st) => st.navigate)
  const addFile = useWorkspace((st) => st.addFile)
  const cmdRef = useRef<CommandPanelHandle>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const [saveAsOpen, setSaveAsOpen] = useState(false)
  // v2.4: review list (REVIEW REQUIRED), scale calibration of an import, measured room
  const [reviewOpen, setReviewOpen] = useState(false)
  const [calibrate, setCalibrate] = useState<{ sourceId: string | null } | null>(null)
  const [surveyOpen, setSurveyOpen] = useState(false)

  const say = (text: string, tone?: 'error' | 'info') => cad.print(text, tone)

  const save = () => {
    if (!doc) return
    cad.save()
    toast(fmt(T.cad.toast.saved, { name: doc.name }), 'success')
    // Settings → File Handling → "Create backup on save": a version of every workspace (Version history)
    void snapshotOn('save', doc.name)
  }
  useKeyActions(CAD_ACTIONS)

  /** DXF 2000 with the paper-space layouts (default), or R12 with model space only (old programs). */
  const exportDxf = (r12 = false) => {
    if (!doc) return
    const file = doc.name.replace(/\.(dwg|dxf)$/i, '') + '.dxf'
    const url = URL.createObjectURL(new Blob([r12 ? toDxf(doc) : toDxf2000(doc)], { type: 'application/dxf' }))
    const a = document.createElement('a')
    a.href = url
    a.download = file
    a.click()
    URL.revokeObjectURL(url)
    say(fmt(T.cad.toast.exported, { file }), 'info')
    toast(fmt(T.cad.toast.exported, { file }), 'success')
  }

  const baseName = () => (doc ? doc.name.replace(/\.(dwg|dxf)$/i, '') : 'Drawing')
  const exportDwg = async () => {
    if (!doc) return
    const host = await getHost()
    if (!host) return toast(T.cad.toast.dwgDesktop, 'info')
    // with layouts: DXF 2000 → LibreDWG dxf2dwg; an older helper set without dxf2dwg: model only via dwgadd
    let r = await host.dwgWriteDxf(toDxf2000(doc, { leftText: true }), `${baseName()}.dwg`)
    if (r.error === 'no-writer') r = await host.dwgWrite(toDwgAdd(doc).script, `${baseName()}.dwg`)
    if (r.cancelled) return
    if (!r.ok) return toast(fmt(T.cad.toast.dwgSaveFailed, { why: hostError(r.error, useSettings.getState().language) }), 'warning')
    const file = r.path!.split(/[\\/]/).pop()!
    const msg = fmt(T.cad.toast.dwgSaved, { file, n: r.entities ?? '?', layers: r.layers ?? '?', layouts: r.layouts ?? 0 })
    say(msg, 'info')
    toast(msg, 'success')
  }
  /** Plot to PDF / PNG: the active layout (paper + scale), or A3 at the fitting scale from Model. */
  const exportPlot = async (kind: 'pdf' | 'png', layoutId?: string) => {
    if (!doc) return
    const layouts = doc.layouts ?? DEFAULT_LAYOUTS
    const lay = layouts.find((l) => l.id === (layoutId ?? cad.sheet))
    const paper = lay?.paper ?? 'A3'
    const page = plotPage(doc, paper, lay?.scale ?? undefined, { ruler: lay?.ruler })
    const name = lay ? `${baseName()} - ${lay.name}` : baseName()
    if (kind === 'png') {
      const file = `${name}.png`
      downloadFile(file, new Uint8Array(await (await pagePng(page, 200)).arrayBuffer()), 'image/png')
      return toast(fmt(T.cad.toast.pngSaved, { file, paper, dpi: 200, scale: page.scale }), 'success')
    }
    const host = await getHost()
    if (!host) {
      // browser: the vector page in a print window — the system dialog saves it as PDF
      const w = window.open('', '_blank')
      if (w) {
        w.document.write(`<!doctype html><title>${name}</title><style>@page{size:${page.w}mm ${page.h}mm;margin:0}body{margin:0}</style>${pageSvg(page)}<script>onload=()=>print()<\/script>`)
        w.document.close()
      }
      return toast(fmt(T.cad.toast.pdfBrowser, { paper, scale: page.scale }), 'info')
    }
    const r = await host.cadExportPdf(JSON.stringify(page), `${name}.pdf`)
    if (r.cancelled) return
    if (!r.ok) return toast(hostError(r.error, useSettings.getState().language), 'warning')
    const file = r.path!.split(/[\\/]/).pop()!
    toast(fmt(T.cad.toast.pdfSaved, { file, paper, scale: page.scale }), 'success')
  }

  /** Sheet set: every layout as one multi-page PDF (desktop) or a print window with one page per layout. */
  const plotSheetSet = async () => {
    if (!doc) return
    const layouts = doc.layouts ?? DEFAULT_LAYOUTS
    const pages = layouts.map((l) => ({ ...plotPage(doc, l.paper, l.scale ?? undefined, { ruler: l.ruler }), name: `${baseName()} - ${l.name}` }))
    const host = await getHost()
    if (!host) {
      const w = window.open('', '_blank')
      if (w) {
        w.document.write(`<!doctype html><title>${baseName()} - sheet set</title><style>@page{margin:0}body{margin:0}.p{page-break-after:always}</style>${pages.map((p) => `<div class="p" style="width:${p.w}mm;height:${p.h}mm">${pageSvg(p)}</div>`).join('')}<script>onload=()=>print()<\/script>`)
        w.document.close()
      }
      return toast(fmt(T.cad.sheets.setBrowser, { n: pages.length }), 'info')
    }
    const r = await host.cadExportPdf(JSON.stringify({ pages, name: `${baseName()} - sheet set` }), `${baseName()} - sheet set.pdf`)
    if (r.cancelled) return
    if (!r.ok) return toast(hostError(r.error, useSettings.getState().language), 'warning')
    toast(fmt(T.cad.sheets.setPlotted, { n: pages.length, file: r.path!.split(/[\\/]/).pop()! }), 'success')
  }

  const openFiles = async (list: FileList | File[] | null) => {
    if (!list) return
    // drawings hydrate from IndexedDB asynchronously: never let a late hydration replace a fresh import
    if (!useCad.persist.hasHydrated()) await new Promise<void>((r) => { const off = useCad.persist.onFinishHydration(() => { off(); r() }) })
    for (const f of Array.from(list)) {
      const ext = f.name.split('.').pop()?.toLowerCase()
      if (ext !== 'dwg' && ext !== 'dxf') {
        toast(fmt(T.toast.unsupported, { ext: `.${ext}` }), 'warning')
        continue
      }
      if (ext === 'dwg') {
        // desktop app: the bundled LibreDWG helper converts DWG → DXF; a browser has no reader
        const reader = await dwgReader()
        if (!reader) {
          say(T.cad.toast.dwgNative, 'error')
          toast(T.cad.toast.dwgNative, 'warning')
          continue
        }
        say(fmt(T.cad.toast.dwgConverting, { file: f.name, reader }), 'info')
      }
      let read: Awaited<ReturnType<typeof readDrawing>>
      try {
        // DWG conversion can take seconds on large drawings: the brand loader shows it is working
        read = ext === 'dwg' ? await brandLoading.run(fmt(T.cad.toast.opening, { file: f.name }), () => readDrawing(f)) : await readDrawing(f)
      } catch (e) {
        const msg = fmt(T.cad.toast.dwgFailed, { file: f.name, error: (e as Error).message })
        say(msg, 'error')
        toast(msg, 'warning')
        continue
      }
      const { doc: d, skipped, approximated, dwg } = read
      const entities = d.entities
      if (dwg) say(fmt(T.cad.toast.dwgConverted, { file: f.name, ms: Math.round(dwg.ms), warnings: dwg.warnings ? fmt(T.cad.toast.dwgWarnings, { n: dwg.warnings }) : '' }), 'info')
      cad.openDocument(d)
      addFile({ name: f.name, format: ext === 'dwg' ? 'DWG' : 'DXF', projectId: null, modifiedAt: f.lastModified || Date.now(), sizeBytes: f.size, source: 'local-import' })
      const sk = Object.entries(skipped).map(([k, n]) => `${k}×${n}`).join(', ')
      const msg = fmt(T.cad.toast.imported, { n: entities.length, file: f.name, skipped: sk ? ` (skipped: ${sk})` : '' })
      say(msg, 'info')
      const ap = Object.entries(approximated).map(([k, n]) => `${k}×${n}`).join(', ')
      if (ap) say(fmt(T.cad.toast.approximated, { list: ap }), 'info')
      toast(msg, 'success')
    }
    if (fileInput.current) fileInput.current.value = ''
  }

  // files sent from another screen (Projects → Open in CAD 2D)
  useEffect(() => {
    if (!cadInbox.files.length) return
    const files = cadInbox.files
    cadInbox.files = []
    void openFiles(files)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    cadUi.openFile = () => fileInput.current?.click()
    cadUi.exportDxf = () => exportDxf()
    cadUi.plot = () => void exportPlot('pdf')
    cadUi.review = () => setReviewOpen(true)
    cadUi.calibrate = () => setCalibrate({ sourceId: null })
    cadUi.surveyRoom = () => setSurveyOpen(true)
  })

  // AutoCAD-style keyboard: typing goes to the command line; F-keys toggle drafting aids.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      // Settings → Keyboard Shortcuts
      const sc = useSettings.getState().shortcuts
      const isRedo = matchesShortcut(e, sc.redo)
      if (isRedo || matchesShortcut(e, sc.undo)) {
        e.preventDefault()
        const label = isRedo ? useCad.getState().redo() : useCad.getState().undo()
        const P = T.cad.prompts
        say(label ? fmt(isRedo ? P.redone : P.undone, { label }) : isRedo ? P.nothingRedo : P.nothingUndo, label ? undefined : 'error')
        return
      }
      if (matchesShortcut(e, sc.saveAs)) {
        e.preventDefault()
        return setSaveAsOpen(true)
      }
      if (matchesShortcut(e, sc.save)) {
        e.preventDefault()
        return save()
      }
      const toggleKey = (['osnap', 'grid', 'ortho', 'snap', 'polar'] as const).find((k) => matchesShortcut(e, sc[k]))
      if (toggleKey) {
        e.preventDefault()
        const k = toggleKey
        useCad.getState().toggle(k)
        const on = useCad.getState().toggles[k]
        return say(fmt(on ? T.cad.prompts.toggleOn : T.cad.prompts.toggleOff, { name: k.charAt(0).toUpperCase() + k.slice(1) }))
      }
      if (matchesShortcut(e, sc.help)) {
        e.preventDefault()
        return say(T.cad.cmd.helpText, 'info')
      }
      if (isTyping(e.target) || mod || e.altKey) return
      if (e.key === 'Escape') {
        useCadSession.getState().cancel()
        useCad.getState().setSelection([])
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (useCad.getState().selection.length && !useCadSession.getState().stage) {
          e.preventDefault()
          say(`${T.cad.prompts.command} ERASE`)
          useCadSession.getState().eraseSelection()
        }
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        return useCadSession.getState().input('')
      }
      if (e.key.length === 1 && /[\w@.,<-]/.test(e.key)) {
        e.preventDefault()
        cmdRef.current?.focus(e.key)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div className={`${s.screen} ${cad.aiPanel.open ? '' : s.noAi} ${cad.aiPanel.minimized ? s.aiMin : ''}`}>
      <div className={s.tabs}>
        <FileTabs />
      </div>
      <div className={s.ribbon}>
        <CadRibbon
          onNew={() => {
            say(`${T.cad.prompts.command} NEW`)
            cad.newDrawing()
          }}
          onOpen={() => fileInput.current?.click()}
          onSave={save}
          onSaveAs={() => setSaveAsOpen(true)}
          onExport={(f) => (f === 'dxf' || f === 'dxf12' ? exportDxf(f === 'dxf12') : f === 'dwg' ? void exportDwg() : void exportPlot(f))}
          onUndo={() => session.input('U')}
          onRedo={() => session.input('REDO')}
          canUndo={!!history?.undo.length}
          canRedo={!!history?.redo.length}
          onLayer={() => cad.set({ rightTab: 'layers' })}
          onProperties={() => cad.set({ rightTab: 'properties' })}
          onPlot={() => void exportPlot('pdf')}
          onShare={() => toast(T.cad.toast.shareNative)}
          aiOpen={cad.aiPanel.open}
          onAiAssist={() => cad.setAi({ open: !cad.aiPanel.open, minimized: false })}
          onViewport={() => {
            cad.set({ sheet: 'model' })
                }}
          onLayout={() => cad.set({ sheet: cad.sheet === 'model' ? (doc?.layouts ?? DEFAULT_LAYOUTS)[0].id : 'model' })}
          onSheetSet={() => void plotSheetSet()}
          onSettings={() => navigate('settings')}
        />
      </div>
      <div className={s.palette}>
        <ToolPalette />
      </div>
      <div className={s.canvas}>
        <CanvasCard onPlot={(id) => void exportPlot('pdf', id)} onReview={() => setReviewOpen(true)} />
      </div>
      <div className={s.side}>
        <div className={s.props}>
          <RightPanel />
        </div>
        {cad.aiPanel.open && (
          <div className={s.ai}>
            <AiAssistPanel />
          </div>
        )}
      </div>
      <div className={s.cmd}>
        <CommandPanel ref={cmdRef} />
      </div>
      <div className={s.status}>
        <StatusBar />
      </div>
      <div className={s.statusRight}>
        <StatusRight />
      </div>

      <input ref={fileInput} type="file" accept=".dxf,.dwg" multiple hidden onChange={(e) => openFiles(e.target.files)} />
      {reviewOpen && doc && <ReviewDialog onClose={() => setReviewOpen(false)} onCalibrate={(sourceId) => { setReviewOpen(false); setCalibrate({ sourceId }) }} onSurvey={() => { setReviewOpen(false); setSurveyOpen(true) }} />}
      {calibrate && doc && <CalibrateDialog sourceId={calibrate.sourceId} onClose={() => setCalibrate(null)} />}
      {surveyOpen && <SurveyRoomDialog onClose={() => setSurveyOpen(false)} />}
      {saveAsOpen && doc && (
        <SaveAsModal
          initial={doc.name}
          onClose={() => setSaveAsOpen(false)}
          onSave={(name) => {
            cad.saveAs(name)
            setSaveAsOpen(false)
            toast(fmt(T.cad.toast.saved, { name }), 'success')
          }}
        />
      )}
    </div>
  )
}

function SaveAsModal({ initial, onClose, onSave }: { initial: string; onClose: () => void; onSave: (n: string) => void }) {
  const T = useT()
  const [name, setName] = useState(initial)
  return (
    <Modal
      title={T.cad.saveAs.title}
      onClose={onClose}
      footer={
        <>
          <ActionButton onClick={onClose}>{T.newProject.cancel}</ActionButton>
          <ActionButton variant="primary" onClick={() => name.trim() && onSave(name.trim())}>
            {T.cad.saveAs.save}
          </ActionButton>
        </>
      }
    >
      <form
        style={{ display: 'contents' }}
        onSubmit={(e) => {
          e.preventDefault()
          if (name.trim()) onSave(name.trim())
        }}
      >
        <Field label={T.cad.saveAs.name}>
          <TextInput autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
      </form>
    </Modal>
  )
}
