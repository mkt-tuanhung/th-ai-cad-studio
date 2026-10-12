import type { ReactNode } from 'react'
import { Box, Folder, FolderClosed, Ruler, Crosshair, CircleDot, Equal, Square, Triangle } from 'lucide-react'
import { fmt, useT } from '../../i18n'
import { toast } from '../../state/toast'
import { useMech } from '../../state/mech'
import { WsTree, type TreeNode } from '../../components/workspace/Workspace'
import type { MateKind } from '../../mech/model'

const I = { size: 15, strokeWidth: 1.6 }
const MATE_ICON: Record<MateKind, ReactNode> = {
  Concentric: <CircleDot {...I} />, Coincident: <Equal {...I} />, Distance: <Ruler {...I} />, Angle: <Triangle {...I} />, Parallel: <Equal {...I} style={{ transform: 'rotate(60deg)' }} />,
}

export function MechBrowser() {
  const t = useT().mechanical
  const b = t.browser
  const { doc, browserSel, set } = useMech()
  const parts = doc.components.filter((c) => c.id !== 'fasteners')
  const fastenerQty = doc.bom.filter((x) => x.component === 'fasteners').reduce((a, x) => a + x.qty, 0)
  const kinds: MateKind[] = ['Concentric', 'Coincident', 'Distance', 'Angle', 'Parallel']
  const root: TreeNode = {
    key: 'root',
    label: 'Centrifugal_Pump_Assembly',
    icon: <Folder size={16} strokeWidth={1.6} fill="#3a4352" stroke="#3a4352" />,
    childH: 20.6,
    children: [
      { key: 'gcs', label: b.gcs, icon: <Crosshair {...I} />, open: false, children: [{ key: 'gcs-xyz', label: 'X · Y · Z', icon: <Crosshair {...I} /> }] },
      { key: 'planes', label: b.planes, icon: <FolderClosed {...I} />, children: ['XY Plane', 'YZ Plane', 'ZX Plane'].map((p) => ({ key: `pl-${p}`, label: p, icon: <Square {...I} /> })) },
      { key: 'origin', label: b.origin, icon: <Crosshair {...I} /> },
      {
        key: 'asm',
        gap: 3,
        label: fmt(b.assembly, { n: doc.bom.length }),
        icon: <FolderClosed {...I} />,
        childH: 23.2,
        children: [
          ...parts.map((c) => ({ key: `c-${c.id}`, label: c.file, icon: <Box {...I} />, open: false, children: doc.bom.filter((x) => x.component === c.id).map((x) => ({ key: `b-${x.n}`, label: `${x.name}${x.qty > 1 ? ` × ${x.qty}` : ''}`, icon: <Box {...I} /> })) })),
          { key: 'c-fasteners', label: fmt(b.fasteners, { n: fastenerQty }), icon: <Box {...I} />, open: false, children: doc.bom.filter((x) => x.component === 'fasteners').map((x) => ({ key: `b-${x.n}`, label: `${x.name} × ${x.qty}`, icon: <Box {...I} /> })) },
        ],
      },
      {
        key: 'mates',
        gap: 6,
        label: fmt(b.mates, { n: doc.mates.length }),
        icon: <Triangle {...I} />,
        childH: 25,
        children: kinds.map((k, i) => ({ key: `mt-${k}`, gap: i === 0 ? 5 : undefined, label: `${t.mateKinds[k]} (${doc.mates.filter((m) => m.kind === k).length})`, icon: MATE_ICON[k] })),
      },
    ],
  }
  const onSelect = (n: TreeNode) => {
    if (n.key.startsWith('c-')) return set({ browserSel: n.key, sel: n.key.slice(2), right: 'properties' })
    if (n.key.startsWith('mt-') || n.key === 'mates') return set({ browserSel: n.key, bottom: 'mates' })
    if (n.key.startsWith('b-') || n.key === 'asm') return set({ browserSel: n.key, bottom: 'bom' })
    // a datum plane: the view normal to it; the origin / coordinate system: the home view
    const view = ({ 'pl-XY Plane': 'top', 'pl-YZ Plane': 'right', 'pl-ZX Plane': 'front', origin: 'home', 'gcs-xyz': 'home' } as const)[n.key as 'origin']
    if (view) return set({ browserSel: n.key, camReq: { view, label: n.label, n: (useMech.getState().camReq?.n ?? 0) + 1 } })
    if (!n.children) toast(fmt(t.toast.native, { what: n.label }))
  }
  return <WsTree title={b.title} placeholder={b.search} root={root} active={browserSel} onSelect={onSelect} collapseLabel={b.collapse} expandLabel={b.expand} rowH={20.6} indent={{ base: -15, step: 26, leaf: 14 }} extraTop={6} styleHead={{ height: 34 }} />
}
