import type { ReactNode } from 'react'
import { ChevronDown, File, FolderOpen, Layers, Printer, Redo2, Save, Settings, Share, Undo2 } from 'lucide-react'
import { useT } from '../../i18n'
import {
  AiSparkIcon,
  ExportToolIcon,
  LayoutToolIcon,
  PropertiesToolIcon,
  SaveAsIcon,
  SheetToolIcon,
  ViewportToolIcon,
} from '../../components/icons'
import { MenuList, PopoverPanel, useDismissable } from '../../components/ui/Popover'
import s from './CadRibbon.module.css'

export interface RibbonActions {
  onNew: () => void
  onOpen: () => void
  onSave: () => void
  onSaveAs: () => void
  onExport: (format: 'dxf' | 'dxf12' | 'dwg' | 'pdf' | 'png') => void
  onUndo: () => void
  onRedo: () => void
  canUndo: boolean
  canRedo: boolean
  onLayer: () => void
  onProperties: () => void
  onPlot: () => void
  onShare: () => void
  aiOpen: boolean
  onAiAssist: () => void
  onViewport: () => void
  onLayout: () => void
  onSheetSet: () => void
  onSettings: () => void
}

const I = 23
const SW = 1.5

function Btn({ label, icon, onClick, disabled, w, ml, trailing, hideLabel }: { label: string; icon: ReactNode; onClick: () => void; disabled?: boolean; w: number; ml: number; trailing?: ReactNode; hideLabel?: boolean }) {
  return (
    <button type="button" className={s.btn} style={{ width: w, marginLeft: ml }} onClick={onClick} disabled={disabled} title={label}>
      <span className={s.icon}>{icon}</span>
      <span className={`${s.label} ${hideLabel ? s.hidden : ''}`}>
        {label}
        {trailing}
      </span>
    </button>
  )
}

const Sep = ({ ml }: { ml: number }) => <span className={s.sep} style={{ marginLeft: ml }} />

/** Widths / gaps reproduce the mockup's button centres (card starts at x=270 on the 1528px window). */
export function CadRibbon(a: RibbonActions) {
  const t = useT().cad.ribbon
  const [exportOpen, setExportOpen, exportRef] = useDismissable<HTMLDivElement>()
  return (
    <div className={s.ribbon} role="toolbar">
      <Btn label={t.new} icon={<File size={I} strokeWidth={SW} />} onClick={a.onNew} w={56} ml={12} />
      <Btn label={t.open} icon={<FolderOpen size={I} strokeWidth={SW} />} onClick={a.onOpen} w={58} ml={0} />
      <Btn label={t.save} icon={<Save size={I} strokeWidth={SW} />} onClick={a.onSave} w={58} ml={2} />
      <Btn label={t.saveAs} icon={<SaveAsIcon size={I} strokeWidth={SW} />} onClick={a.onSaveAs} w={64} ml={2} />
      <Sep ml={4} />
      <div className={s.anchor} ref={exportRef}>
        <Btn
          label={t.export}
          icon={<ExportToolIcon size={I} strokeWidth={SW} />}
          onClick={() => setExportOpen(!exportOpen)}
          w={74}
          ml={3}
          trailing={<ChevronDown size={13} strokeWidth={2} className={s.caret} />}
        />
        {exportOpen && (
          <PopoverPanel align="left" width={230}>
            <MenuList
              onClose={() => setExportOpen(false)}
              items={[
                { label: t.exportDxf, onSelect: () => a.onExport('dxf') },
                { label: t.exportDxf12, onSelect: () => a.onExport('dxf12') },
                { label: t.exportDwg, onSelect: () => a.onExport('dwg') },
                { label: t.exportPdf, onSelect: () => a.onExport('pdf') },
                { label: t.exportPng, onSelect: () => a.onExport('png') },
              ]}
            />
          </PopoverPanel>
        )}
      </div>
      <Sep ml={6} />
      <Btn label={t.undo} icon={<Undo2 size={I} strokeWidth={SW} />} onClick={a.onUndo} disabled={!a.canUndo} w={54} ml={11} />
      <Btn label={t.redo} icon={<Redo2 size={I} strokeWidth={SW} />} onClick={a.onRedo} disabled={!a.canRedo} w={54} ml={0} />
      <Sep ml={12} />
      <Btn label={t.layer} icon={<Layers size={I} strokeWidth={SW} />} onClick={a.onLayer} w={62} ml={1} />
      <Btn label={t.properties} icon={<PropertiesToolIcon size={I} strokeWidth={SW} />} onClick={a.onProperties} w={76} ml={0} />
      <Sep ml={2} />
      <Btn label={t.plot} icon={<Printer size={I} strokeWidth={SW} />} onClick={a.onPlot} w={56} ml={5} />
      <Sep ml={1} />
      <button type="button" className={s.share} onClick={a.onShare}>
        <Share size={21} strokeWidth={SW} />
        <span>{t.share}</span>
      </button>
      <button type="button" className={`${s.ai} ${a.aiOpen ? s.aiOn : ''}`} aria-pressed={a.aiOpen} onClick={a.onAiAssist}>
        <AiSparkIcon size={21} strokeWidth={1.7} />
        <span>{t.aiAssist}</span>
      </button>
      <span className={s.spacer} />
      <Sep ml={0} />
      <Btn label={t.viewport} icon={<ViewportToolIcon size={I} strokeWidth={SW} />} onClick={a.onViewport} w={70} ml={12} />
      <Btn label={t.layout} icon={<LayoutToolIcon size={I} strokeWidth={SW} />} onClick={a.onLayout} w={64} ml={8} />
      <Btn label={t.sheetSet} icon={<SheetToolIcon size={I} strokeWidth={SW} />} onClick={a.onSheetSet} w={50} ml={10} hideLabel />
      <Sep ml={33} />
      <Btn label={t.settings} icon={<Settings size={I} strokeWidth={SW} />} onClick={a.onSettings} w={58} ml={7} />
    </div>
  )
}
