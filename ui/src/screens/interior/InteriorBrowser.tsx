import { Box, ChevronsUpDown, Diamond, Folder, FolderClosed, Grid3x3, Home, Image as ImageIcon, LayoutPanelTop, Square, Table2 } from 'lucide-react'
import { fmt, useT } from '../../i18n'
import { useRouter } from '../../state/router'
import { toast } from '../../state/toast'
import { useInterior, type InteriorBottom } from '../../state/interior'
import { WsTree, type TreeNode } from '../../components/workspace/Workspace'

const I = { size: 15, strokeWidth: 1.6 }

export function InteriorBrowser() {
  const T = useT()
  const t = T.interior
  const b = t.browser
  const navigate = useRouter((st) => st.navigate)
  const { doc, browserSel, set } = useInterior()
  const rn = (n: string) => t.roomNames[n] ?? n

  const sched = (key: string, label: string, bottom: InteriorBottom, filter: string | null = null): TreeNode => ({ key, label, icon: <Table2 {...I} /> , ...{ meta: { bottom, filter } } })
  const root: TreeNode = {
    key: 'root',
    label: 'Villa Riverside',
    icon: <Folder size={16} strokeWidth={1.6} fill="#3a4352" stroke="#3a4352" />,
    children: [
      {
        key: 'views',
        label: b.views,
        icon: <FolderClosed {...I} fill="#cfd6de" />,
        children: [
          { key: 'v3d', label: b.v3d, icon: <Box {...I} /> },
          { key: 'vexp', label: b.exploded, icon: <Box {...I} /> },
          { key: 'vwalk', label: b.walk, icon: <Box {...I} /> },
          { key: 'vrender', label: b.render, icon: <ImageIcon {...I} /> },
        ],
      },
      {
        key: 'plans',
        label: b.plans,
        icon: <LayoutPanelTop {...I} />,
        children: [
          {
            key: 'level1',
            label: b.level1,
            icon: <Grid3x3 {...I} />,
            children: [
              {
                key: 'rooms',
                label: b.rooms,
                icon: <FolderClosed {...I} />,
                children: doc.rooms.map((r) => ({ key: `room-${r.id}`, label: rn(r.name), icon: <Square {...I} /> })),
              },
              { key: 'layouts', label: b.layouts, icon: <FolderClosed {...I} />, open: false, children: [{ key: 'layout-a', label: 'Layout A', icon: <Square {...I} /> }] },
              { key: 'ceiling', label: b.ceiling, icon: <FolderClosed {...I} />, open: false, children: [{ key: 'ceiling-l1', label: T.interior.viewer.level1, icon: <Square {...I} /> }] },
              { key: 'finish', label: b.finish, icon: <FolderClosed {...I} />, open: false, children: [{ key: 'finish-l1', label: T.interior.viewer.level1, icon: <Square {...I} /> }] },
            ],
          },
        ],
      },
      {
        key: 'elev',
        label: b.elevations,
        icon: <Home {...I} />,
        children: [
          { key: 'elev-living', label: b.livingElev, icon: <ChevronsUpDown {...I} /> },
          { key: 'elev-kitchen', label: b.kitchenElev, icon: <ChevronsUpDown {...I} /> },
        ],
      },
      {
        key: 'sections',
        label: b.sections,
        icon: <Diamond {...I} />,
        children: [
          { key: 'sec-a', label: b.secA, icon: <Diamond {...I} /> },
          { key: 'sec-b', label: b.secB, icon: <Diamond {...I} /> },
        ],
      },
      {
        key: 'schedules',
        label: b.schedules,
        icon: <Table2 {...I} />,
        children: [
          sched('s-furn', b.furnSched, 'furniture'),
          sched('s-mat', b.matSched, 'materials'),
          sched('s-cut', b.cabCut, 'cutlist'),
          sched('s-light', b.lightSched, 'furniture', 'lighting'),
        ],
      },
    ],
  }

  const onSelect = (n: TreeNode) => {
    if (n.children) return
    if (n.key.startsWith('room-')) {
      const id = n.key.slice(5)
      return set({ browserSel: n.key, room: id, sel: { kind: 'room', id } })
    }
    const meta = (n as TreeNode & { meta?: { bottom: InteriorBottom; filter: string | null } }).meta
    if (meta) return set({ browserSel: n.key, bottom: meta.bottom, filter: meta.filter, tab: 'design' })
    if (n.key === 'v3d') return set({ browserSel: n.key, view: 'perspective', tab: 'design', plan: null, cut: null })
    if (n.key === 'vexp' || n.key === 'vwalk') return set({ browserSel: n.key, view: n.key === 'vexp' ? 'exploded' : 'walk', tab: 'design', plan: null, cut: null, mode: useInterior.getState().mode === 'realistic' ? 'shaded' : useInterior.getState().mode })
    if (n.key === 'layout-a' || n.key === 'ceiling-l1' || n.key === 'finish-l1') return set({ browserSel: n.key, tab: 'design', plan: n.key === 'ceiling-l1' ? 'ceiling' : n.key === 'finish-l1' ? 'finish' : 'floor' })
    if (n.key.startsWith('elev-') || n.key.startsWith('sec-')) return set({ browserSel: n.key, tab: 'design', plan: null, cut: n.key, view: 'perspective', mode: useInterior.getState().mode === 'realistic' ? 'shaded' : useInterior.getState().mode })
    if (n.key === 'vrender') return navigate('renders')
    toast(fmt(t.toast.native, { what: n.label }))
  }

  return (
    <WsTree
      title={b.title}
      placeholder={b.search}
      root={root}
      active={browserSel}
      onSelect={onSelect}
      collapseLabel={b.collapse}
      expandLabel={b.expand}
      rowH={20.2}
      extraTop={10}
      indent={{ base: -1, step: 14, leaf: 23 }}
    />
  )
}
