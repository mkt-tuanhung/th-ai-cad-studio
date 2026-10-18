import { CalendarDays, ChevronDown, ChevronRight, Home, Share } from 'lucide-react'
import { fmt, useT } from '../../i18n'
import { useBim, type BimView } from '../../state/bim'
import { useRouter } from '../../state/router'
import { toast } from '../../state/toast'
import { AiSparkIcon, CubeSolidIcon, ExportToolIcon, PlanViewIcon } from '../../components/icons'
import { MenuList, PopoverPanel, useDismissable } from '../../components/ui/Popover'
import { downloadFile } from '../../components/workspace/Workspace'
import { toIfc } from '../../bim/ifc'
import { getHost } from '../../services/host'
import { bimSpec, exportGlb } from '../../renders/snapshot'
import s from './BimHeader.module.css'

export function BimHeader({ onExportCsv }: { onExportCsv: () => void }) {
  const T = useT()
  const t = T.bim
  const navigate = useRouter((st) => st.navigate)
  const { view, set, discipline } = useBim()
  const exportIfc = () => {
    const file = 'Villa Riverside.ifc'
    const r = toIfc(useBim.getState().model, 'Villa Riverside')
    downloadFile(file, r.text, 'application/x-step')
    toast(fmt(t.toast.ifcSaved, { file, summary: Object.entries(r.counts).map(([k, n]) => `${n} ${k}`).join(', ') }), 'success')
  }
  // v2.4 SP38: glTF binary of the BIM building (presentation geometry from the exact OCCT solids)
  const exportGlbFile = async () => {
    const host = await getHost()
    if (!host) return toast(T.render24.glb.desktop)
    const r = await exportGlb(host, bimSpec(useBim.getState().model, { architecture: true, landscape: false }), 'Villa Riverside.glb')
    if (r.ok) toast(fmt(T.render24.glb.saved, { file: (r.path ?? '').split(/[\\/]/).pop() ?? '', n: r.nodes ?? 0, m: r.materials?.length ?? 0 }), 'success')
    else if (!('cancelled' in r && r.cancelled)) toast(fmt(T.render24.glb.failed, { why: r.error ?? '' }), 'warning')
  }
  const [discOpen, setDiscOpen, discRef] = useDismissable<HTMLDivElement>()
  const [expOpen, setExpOpen, expRef] = useDismissable<HTMLDivElement>()
  const views: { k: Exclude<BimView, 'drawing'>; icon: React.ReactNode }[] = [
    { k: 'plan', icon: <PlanViewIcon size={17} strokeWidth={1.6} /> },
    { k: '3d', icon: <CubeSolidIcon size={17} /> },
    { k: 'schedule', icon: <CalendarDays size={16} strokeWidth={1.6} /> },
  ]
  return (
    <div className={s.header}>
      <nav className={s.crumbs} aria-label="Breadcrumb">
        <button type="button" className={s.home} aria-label={T.nav.dashboard} onClick={() => navigate('dashboard')}>
          <Home size={15} strokeWidth={1.7} />
        </button>
        <ChevronRight size={11} strokeWidth={2} className={s.sepSmall} />
        <button type="button" className={s.crumb} onClick={() => navigate('projects')}>
          {t.crumbs.projects}
        </button>
        <ChevronRight size={14} strokeWidth={1.8} className={s.sep} />
        <button type="button" className={s.crumb} onClick={() => navigate('dashboard')}>
          {t.crumbs.project}
        </button>
        <ChevronRight size={14} strokeWidth={1.8} className={s.sep} />
        <div className={s.anchor} ref={discRef}>
          <button type="button" className={s.current} aria-expanded={discOpen} onClick={() => setDiscOpen(!discOpen)}>
            {discipline === 'structure' ? t.disciplines.structure : t.crumbs.discipline}
            <ChevronDown size={14} strokeWidth={1.8} />
          </button>
          {discOpen && (
            <PopoverPanel align="left" width={180}>
              <MenuList
                onClose={() => setDiscOpen(false)}
                items={[
                  { label: t.disciplines.architecture, onSelect: () => (set({ discipline: 'architecture' }), toast(t.toast.architecture)) },
                  { label: t.disciplines.structure, onSelect: () => (set({ discipline: 'structure' }), toast(t.toast.structure)) },
                  { label: t.disciplines.mep, onSelect: () => navigate('mep') },
                ]}
              />
            </PopoverPanel>
          )}
        </div>
      </nav>

      <div className={s.switch} role="tablist">
        {views.map(({ k, icon }) => (
          <button key={k} type="button" role="tab" aria-selected={view === k} className={`${s.vtab} ${s[`v_${k}`]} ${view === k ? s.vOn : ''}`} onClick={() => set({ view: k })}>
            {icon}
            {t.views[k]}
          </button>
        ))}
      </div>

      <div className={s.actions}>
        <button type="button" className={s.btn} onClick={() => toast(t.toast.shareOffline)}>
          <Share size={16} strokeWidth={1.7} />
          {t.share}
        </button>
        <div className={s.anchor} ref={expRef}>
          <button type="button" className={`${s.btn} ${s.export}`} aria-expanded={expOpen} onClick={() => setExpOpen(!expOpen)}>
            <ExportToolIcon size={20} strokeWidth={1.5} />
            {t.export}
            <ChevronDown size={13} strokeWidth={1.9} />
          </button>
          {expOpen && (
            <PopoverPanel width={230}>
              <MenuList
                onClose={() => setExpOpen(false)}
                items={[
                  { label: t.exportCsv, onSelect: onExportCsv },
                  { label: t.exportIfc, onSelect: exportIfc },
                  { label: T.render24.glb.export, onSelect: () => void exportGlbFile() },
                ]}
              />
            </PopoverPanel>
          )}
        </div>
        <button type="button" className={s.ai} onClick={() => navigate('ai-studio')}>
          <AiSparkIcon size={21} strokeWidth={1.7} />
          {t.aiAssistant}
        </button>
      </div>
    </div>
  )
}
