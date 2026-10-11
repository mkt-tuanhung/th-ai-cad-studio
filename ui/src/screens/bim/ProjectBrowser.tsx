import { useState, type ReactNode } from 'react'
import { Box, ChevronDown, ChevronRight, ChevronsLeft, ChevronsRight, Folder, FolderClosed, Home, Search, Sheet, Table2 } from 'lucide-react'
import { fmt, useT } from '../../i18n'
import { useBim, type BimView, type ScheduleCat } from '../../state/bim'
import { toast } from '../../state/toast'
import { PlanViewIcon } from '../../components/icons'
import s from './ProjectBrowser.module.css'

interface Node {
  key: string
  label: string
  icon: ReactNode
  children?: Node[]
  /** Leaf action. */
  open?: { view: BimView; level?: string; cat?: ScheduleCat } | 'native'
  depth?: number
}

const I = { size: 17, strokeWidth: 1.6 }

export function ProjectBrowser() {
  const T = useT()
  const t = T.bim.browser
  const { browserCollapsed, browserOpen, toggleBrowser, set, browserSel } = useBim()
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
            children: [
              ['L1', 'Level 1'],
              ['L2', 'Level 2'],
              ['L3', 'Level 3'],
              ['RF', 'Roof'],
            ].map(([id, name]) => ({ key: `plan-${id}`, label: name, icon: <PlanViewIcon {...I} />, open: { view: 'plan' as const, level: id } })),
          },
          {
            key: '3d',
            label: t.views3d,
            icon: <FolderClosed {...I} />,
            children: ['{3D}', '3D - Section Box', '3D - Exterior'].map((n, i) => ({ key: `3d-${i}`, label: n, icon: <Box {...I} fill={i === 2 ? '#cfd6de' : 'none'} />, open: { view: '3d' as const } })),
          },
          {
            key: 'elev',
            label: t.elevations,
            icon: <FolderClosed {...I} />,
            children: ['East Elevation', 'West Elevation', 'North Elevation', 'South Elevation'].map((n) => ({ key: n, label: n, icon: <Home {...I} />, open: 'native' as const })),
          },
          {
            key: 'sect',
            label: t.sections,
            icon: <FolderClosed {...I} />,
            children: ['Section 1', 'Section 2'].map((n) => ({ key: n, label: n, icon: <SectionIcon />, open: 'native' as const })),
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
        children: ['A101 - Floor Plan', 'A201 - Elevations', 'A301 - Sections'].map((n) => ({ key: n, label: n, icon: <Sheet {...I} />, open: 'native' as const })),
      },
    ],
  }

  const needle = q.trim().toLowerCase()
  const matches = (n: Node): boolean => !needle || n.label.toLowerCase().includes(needle) || !!n.children?.some(matches)

  const isActive = (n: Node) => n.key === browserSel

  const activate = (n: Node) => {
    if (!n.open) return
    if (n.open === 'native') return toast(fmt(T.bim.toast.native, { what: n.label }))
    set({ browserSel: n.key, view: n.open.view, ...(n.open.level ? { level: n.open.level } : {}), ...(n.open.cat ? { scheduleCat: n.open.cat } : {}) })
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
