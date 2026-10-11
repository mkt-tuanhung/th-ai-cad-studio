import { useEffect, useRef, useState } from 'react'
import { fmt, useT } from '../../i18n'
import { useCad } from '../../state/cad'
import { cadUi, useCadSession } from '../../state/cadSession'
import { useRouter } from '../../state/router'
import { toast } from '../../state/toast'
import { useWorkspace } from '../../state/workspace'
import { FKEYS } from '../../cad/commands'
import { toDxf } from '../../cad/dxf'
import { decodeDxf, importDxf } from '../../cad/dxfImport'
import { convertDwg, dwgReader } from '../../services/dwg'
import { createBlankDocument } from '../../cad/seed'
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
import s from './Cad2DScreen.module.css'

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

  const say = (text: string, tone?: 'error' | 'info') => cad.print(text, tone)

  const save = () => {
    if (!doc) return
    cad.save()
    toast(fmt(T.cad.toast.saved, { name: doc.name }), 'success')
  }

  const exportDxf = () => {
    if (!doc) return
    const file = doc.name.replace(/\.(dwg|dxf)$/i, '') + '.dxf'
    const url = URL.createObjectURL(new Blob([toDxf(doc)], { type: 'application/dxf' }))
    const a = document.createElement('a')
    a.href = url
    a.download = file
    a.click()
    URL.revokeObjectURL(url)
    say(fmt(T.cad.toast.exported, { file }), 'info')
    toast(fmt(T.cad.toast.exported, { file }), 'success')
  }

  const openFiles = async (list: FileList | null) => {
    if (!list) return
    // drawings hydrate from IndexedDB asynchronously: never let a late hydration replace a fresh import
    if (!useCad.persist.hasHydrated()) await new Promise<void>((r) => { const off = useCad.persist.onFinishHydration(() => { off(); r() }) })
    for (const f of Array.from(list)) {
      const ext = f.name.split('.').pop()?.toLowerCase()
      let bytes: Uint8Array
      if (ext === 'dwg') {
        // desktop app: the bundled LibreDWG helper converts DWG → DXF; a browser has no reader
        const reader = await dwgReader()
        if (!reader) {
          say(T.cad.toast.dwgNative, 'error')
          toast(T.cad.toast.dwgNative, 'warning')
          continue
        }
        say(fmt(T.cad.toast.dwgConverting, { file: f.name, reader }), 'info')
        try {
          const r = await convertDwg(new Uint8Array(await f.arrayBuffer()), f.name)
          bytes = r.dxf
          say(fmt(T.cad.toast.dwgConverted, { file: f.name, ms: Math.round(r.ms), warnings: r.warnings ? fmt(T.cad.toast.dwgWarnings, { n: r.warnings }) : '' }), 'info')
        } catch (e) {
          const msg = fmt(T.cad.toast.dwgFailed, { file: f.name, error: (e as Error).message })
          say(msg, 'error')
          toast(msg, 'warning')
          continue
        }
      } else if (ext === 'dxf') {
        bytes = new Uint8Array(await f.arrayBuffer())
      } else {
        toast(fmt(T.toast.unsupported, { ext: `.${ext}` }), 'warning')
        continue
      }
      const { entities, layers, skipped, approximated } = importDxf(decodeDxf(bytes).text)
      const d = createBlankDocument(f.name)
      const known = new Set(d.layers.map((l) => l.name))
      d.layers = [...d.layers, ...layers.filter((l) => !known.has(l.name)).map(({ name, visible }) => ({ name, color: '#1f2937', visible, locked: false, linetype: 'Continuous' as const, lineweight: 0.25 }))]
      d.entities = entities
      d.source = 'dxf-import'
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

  useEffect(() => {
    cadUi.openFile = () => fileInput.current?.click()
    cadUi.exportDxf = exportDxf
  })

  // AutoCAD-style keyboard: typing goes to the command line; F-keys toggle drafting aids.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        const label = e.shiftKey ? useCad.getState().redo() : useCad.getState().undo()
        const P = T.cad.prompts
        say(label ? fmt(e.shiftKey ? P.redone : P.undone, { label }) : e.shiftKey ? P.nothingRedo : P.nothingUndo, label ? undefined : 'error')
        return
      }
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault()
        return e.shiftKey ? setSaveAsOpen(true) : save()
      }
      if (FKEYS[e.key]) {
        e.preventDefault()
        const k = FKEYS[e.key]
        useCad.getState().toggle(k)
        const on = useCad.getState().toggles[k]
        return say(fmt(on ? T.cad.prompts.toggleOn : T.cad.prompts.toggleOff, { name: k.charAt(0).toUpperCase() + k.slice(1) }))
      }
      if (e.key === 'F1') {
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

  const native = (msg: string) => {
    say(msg, 'error')
    toast(msg, 'warning')
  }

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
          onExport={(f) => (f === 'dxf' ? exportDxf() : native(fmt(T.cad.toast.formatNative, { format: f.toUpperCase() })))}
          onUndo={() => session.input('U')}
          onRedo={() => session.input('REDO')}
          canUndo={!!history?.undo.length}
          canRedo={!!history?.redo.length}
          onLayer={() => cad.set({ rightTab: 'layers' })}
          onProperties={() => cad.set({ rightTab: 'properties' })}
          onPlot={() => native(T.cad.toast.plotNative)}
          onShare={() => toast(T.cad.toast.shareNative)}
          aiOpen={cad.aiPanel.open}
          onAiAssist={() => cad.setAi({ open: !cad.aiPanel.open, minimized: false })}
          onViewport={() => {
            cad.set({ sheet: 'model' })
                }}
          onLayout={() => cad.set({ sheet: cad.sheet === 'model' ? 'layout1' : 'model' })}
          onSheetSet={() => native(T.cad.toast.layoutNative)}
          onSettings={() => navigate('settings')}
        />
      </div>
      <div className={s.palette}>
        <ToolPalette />
      </div>
      <div className={s.canvas}>
        <CanvasCard />
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
