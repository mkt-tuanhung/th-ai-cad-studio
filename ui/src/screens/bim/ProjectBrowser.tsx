import { useState, type ReactNode } from 'react'
import { Box, Camera, ChevronDown, ChevronRight, ChevronsLeft, ChevronsRight, Folder, FolderClosed, Home, Plus, Search, Sheet, Table2 } from 'lucide-react'
import { useLinkedT } from '../../i18n/ws/linked'
import { fmt, useT } from '../../i18n'
import { useBim, type BimView, type ScheduleCat } from '../../state/bim'
import { toast } from '../../state/toast'
import { PlanViewIcon } from '../../components/icons'
import type { DrawingReq } from '../../bim/drawing2d'
import s from './ProjectBrowser.module.css'

interface Node {
  key: string
  label: string
  icon: ReactNode
  children?: Node[]
  /** Leaf action: a plan / schedule, or a 3D view request (elevation, section, named 3D view). */
  open?: { view: BimView; level?: string; cat?: ScheduleCat; req?: Parameters<ReturnType<typeof useBim.getState>['requestView']>[0]; drawing?: DrawingReq; sheet?: string }
  depth?: number
}

const I = { size: 17, strokeWidth: 1.6 }

export function ProjectBrowser() {
  const T = useT()
  const t = T.bim.browser
  const { browserCollapsed, browserOpen, toggleBrowser, set, browserSel, model, requestView, bookmarks } = useBim()
  const L = useLinkedT().view3d
  const [q, setQ] = useState('')

  const tree: Node = {
    key: 'root',
    label: 'Villa Riverside',
    icon: <Folder {...I} fill="#3a4352" stroke="#3a4352" />,
    children: [
      {
        key: 'views',
        label: t.views,
        icon: <FolderClosed {...I} fill="#cfd6de" />,
        children: [
          {
            key: 'plans',
            label: t.floorPlans,
            icon: <FolderClosed {...I} />,
            children: model.levels.map((l) => ({ key: `plan-${l.id}`, label: l.name, icon: <PlanViewIcon {...I} />, open: { view: 'plan' as const, level: l.id } })),
          },
          {
            key: '3d',
            label: t.views3d,
            icon: <FolderClosed {...I} />,
            children: [
              ...(['home', 'sectionBox', 'exterior'] as const).map((kind, i) => ({ key: `3d-${i}`, label: ['{3D}', '3D - Section Box', '3D - Exterior'][i], icon: <Box {...I} fill={i === 2 ? '#cfd6de' : 'none'} />, open: { view: '3d' as const, req: { kind } } })),
              // saved viewpoints (camera, level, visibility, section, model revision) and saving the current one
              ...bookmarks.filter((b) => b.scene === 'bim').map((b) => ({ key: `bm-${b.id}`, label: b.name, icon: <Camera {...I} />, open: { view: '3d' as const, req: { kind: 'bookmark' as const, id: b.id } } })),
              { key: '3d-save', label: L.save, icon: <Plus {...I} />, open: { view: '3d' as const, req: { kind: 'saveView' as const } } },
            ],
          },
          {
            key: 'elev',
            label: t.elevations,
            icon: <FolderClosed {...I} />,
            // 2D drawings by hidden-line removal from that side (East = seen from +X, North = from +Y)
            children: ([['East Elevation', 'right'], ['West Elevation', 'left'], ['North Elevation', 'back'], ['South Elevation', 'front']] as const).map(([n, face]) => ({ key: n, label: n, icon: <Home {...I} />, open: { view: 'drawing' as const, drawing: { kind: 'elev' as const, face, title: n } } })),
          },
          {
            key: 'sect',
            label: t.sections,
            icon: <FolderClosed {...I} />,
            // Section 1: cut along X through the centre, seen from the south; Section 2: cut along Y, seen from the west
            children: ([['Section 1', 'y', 'front'], ['Section 2', 'x', 'left']] as const).map(([n, axis, face]) => ({ key: n, label: n, icon: <SectionIcon />, open: { view: 'drawing' as const, drawing: { kind: 'section' as const, axis, face, title: n } } })),
          },
        ],
      },
      {
        key: 'sched',
        label: t.schedules,
        icon: <Table2 {...I} />,
        children: [
          ['Door Schedule', 'doors'],
          ['Window Schedule', 'windows'],
          ['Room Schedule', 'rooms'],
          ['Material Takeoff', 'walls'],
        ].map(([n, cat]) => ({ key: n, label: n, icon: <Table2 {...I} />, open: { view: 'schedule' as const, cat: cat as ScheduleCat } })),
      },
      {
        key: 'sheets',
        label: t.sheets,
        icon: <FolderClosed {...I} />,
        // each sheet opens the view placed on it
        children: [
          { key: 'A101 - Floor Plan', label: 'A101 - Floor Plan', icon: <Sheet {...I} />, open: { view: 'plan' as const, level: model.levels[0]?.id, sheet: model.levels[0]?.name } },
          { key: 'A201 - Elevations', label: 'A201 - Elevations', icon: <Sheet {...I} />, open: { view: 'drawing' as const, drawing: { kind: 'elev' as const, face: 'front' as const, title: 'South Elevation' }, sheet: 'South Elevation' } },
          { key: 'A301 - Sections', label: 'A301 - Sections', icon: <Sheet {...I} />, open: { view: 'drawing' as const, drawing: { kind: 'section' as const, axis: 'y' as const, face: 'front' as const, title: 'Section 1' }, sheet: 'Section 1' } },
        ],
      },
    ],
  }

  const needle = q.trim().toLowerCase()
  const matches = (n: Node): boolean => !needle || n.label.toLowerCase().includes(needle) || !!n.children?.some(matches)

  const isActive = (n: Node) => n.key === browserSel

  const activate = (n: Node) => {
    if (!n.open) return
    set({ browserSel: n.key, view: n.open.view, ...(n.open.level ? { level: n.open.level } : {}), ...(n.open.cat ? { scheduleCat: n.open.cat } : {}), ...(n.open.drawing ? { drawing: n.open.drawing } : {}) })
    if (n.open.req) requestView(n.open.req)
    if (n.open.sheet) toast(fmt(T.bim.toast.sheetView, { sheet: n.label, view: n.open.sheet }))
  }

  const render = (n: Node, depth: number, index = 0): ReactNode => {
    if (!matches(n)) return null
    const open = needle ? true : (browserOpen[n.key] ?? true)
    const leaf = !n.children
    return (
      <li key={n.key}>
        <div className={`${s.row} ${leaf ? s.leaf : ''} ${isActive(n) ? s.active : ''} ${depth === 0 ? s.root : ''} ${!leaf && depth > 0 && index > 0 ? s.group : ''}`} style={{ paddingLeft: 4 + depth * 13 + (leaf ? 18 : 0) }}>
          {!leaf && (
            <button type="button" className={s.twisty} aria-label={open ? 'Collapse' : 'Expand'} aria-expanded={open} onClick={() => toggleBrowser(n.key)}>
              {open ? <ChevronDown size={13} strokeWidth={2} /> : <ChevronRight size={13} strokeWidth={2} />}
            </button>
          )}
          <button type="button" className={s.label} onClick={() => (leaf ? activate(n) : toggleBrowser(n.key))}>
            <span className={s.icon}>{n.icon}</span>
            {n.label}
          </button>
        </div>
        {!leaf && open && <ul>{n.children!.map((c, i) => render(c, depth + 1, i))}</ul>}
      </li>
    )
  }

  if (browserCollapsed)
    return (
      <section className={`${s.card} ${s.collapsed}`}>
        <button type="button" className={s.collapse} aria-label={t.expand} title={t.expand} onClick={() => set({ browserCollapsed: false })}>
          <ChevronsRight size={17} strokeWidth={1.7} />
        </button>
      </section>
    )

  return (
    <section className={s.card}>
      <header className={s.head}>
        <h2 className={s.title}>{t.title}</h2>
        <button type="button" className={s.collapse} aria-label={t.collapse} title={t.collapse} onClick={() => set({ browserCollapsed: true })}>
          <ChevronsLeft size={17} strokeWidth={1.7} />
        </button>
      </header>
      <label className={s.search}>
        <Search size={16} strokeWidth={1.7} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.search} aria-label={t.search} />
      </label>
      <ul className={`${s.tree} scroll-y`}>
        {render(tree, 0)}
        {!matches(tree) && <li className={s.none}>{t.noMatch}</li>}
      </ul>
    </section>
  )
}

function SectionIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 12 12 4l8 8-8 8z" />
      <path d="M12 4v16" fill="#3a4352" />
      <path d="M12 4 4 12l8 8z" fill="currentColor" />
    </svg>
  )
}
