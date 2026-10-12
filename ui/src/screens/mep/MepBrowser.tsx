import { Box, ChevronsUpDown, Folder, FolderClosed, LayoutPanelTop, Square } from 'lucide-react'
import { fmt, useT } from '../../i18n'
import { toast } from '../../state/toast'
import { useMep, MEP_CATEGORIES } from '../../state/mep'
import { WsTree, type TreeNode } from '../../components/workspace/Workspace'
import type { EquipKind } from '../../mep/model'
import s from './Mep.module.css'

const I = { size: 15, strokeWidth: 1.6 }
const dot = (c: string) => <i className={s.sysDot} style={{ background: c }} />

export function MepBrowser() {
  const t = useT().mep
  const b = t.browser
  const { doc, browserSel, set } = useMep()
  const n = (k: EquipKind) => doc.equipment.filter((e) => e.kind === k).length

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
          { key: 'v-coord', label: b.vCoord, icon: <Box {...I} /> },
          { key: 'v-hvac', label: b.vHvac, icon: <Box {...I} /> },
          { key: 'v-plumbing', label: b.vPlumb, icon: <Box {...I} /> },
          { key: 'v-electrical', label: b.vElec, icon: <Box {...I} /> },
          { key: 'v-plan', label: b.vPlan, icon: <LayoutPanelTop {...I} /> },
          { key: 'v-ceiling', label: b.vCeiling, icon: <Square {...I} /> },
        ],
      },
      {
        key: 'systems',
        label: b.systems,
        icon: <FolderClosed {...I} />,
        children: [
          { key: 'sys-hvac', label: t.systems.hvac === 'HVAC' ? 'HVAC' : t.systems.hvac, icon: dot('#2f80ed'), children: [{ key: 'sys-hvac-sa', label: 'Supply / Return / Exhaust / Outdoor air', icon: <ChevronsUpDown {...I} /> }], open: false },
          { key: 'sys-plumbing', label: t.systems.plumbing, icon: dot('#27ae60'), children: [{ key: 'sys-pl-all', label: 'CHW · DCW · DHW · SAN · FS', icon: <ChevronsUpDown {...I} /> }], open: false },
          { key: 'sys-electrical', label: t.systems.electrical, icon: dot('#f2994a'), children: [{ key: 'sys-el-all', label: 'DB-L1 · DB-L2 · DB-L3', icon: <ChevronsUpDown {...I} /> }], open: false },
        ],
      },
      {
        key: 'equipment',
        label: b.equipment,
        icon: <FolderClosed {...I} />,
        children: (['AHU', 'FCU', 'Pump', 'Chiller', 'Electrical Panel'] as EquipKind[]).map((k) => ({ key: `eq-${k}`, label: `${b.equip[k]} (${n(k)})`, icon: <Box {...I} /> })),
      },
      {
        key: 'families',
        gap: 9,
        label: b.families,
        icon: <FolderClosed {...I} />,
        children: (['ducts', 'pipes', 'trays', 'conduits', 'fixtures', 'supports'] as const).map((k) => ({ key: `fam-${k}`, label: b.fam[k], icon: <Box {...I} /> })),
      },
    ],
  }

  const onSelect = (node: TreeNode) => {
    const k = node.key
    if (k.startsWith('v-')) {
      const v = k.slice(2)
      if (v === 'plan' || v === 'ceiling') return set({ browserSel: k, view: v })
      return set({ browserSel: k, view: v, tool: 'select', discipline: v === 'coord' ? 'coordination' : (v as 'hvac' | 'plumbing' | 'electrical') })
    }
    if (k.startsWith('eq-')) return set({ browserSel: k, bottom: 'schedules', schedule: 'equipment' })
    if (k === 'sys-hvac' || k === 'sys-hvac-sa' || k === 'fam-ducts') return set({ browserSel: k, bottom: 'schedules', schedule: 'duct' })
    if (k === 'sys-plumbing' || k === 'sys-pl-all' || k === 'fam-pipes') return set({ browserSel: k, bottom: 'schedules', schedule: 'pipe' })
    if (k === 'sys-electrical' || k === 'sys-el-all') return set({ browserSel: k, bottom: 'schedules', schedule: 'electrical' })
    // a family with its own category: show only that category (plan + 3D); conduits / supports are not modelled
    if (k === 'fam-trays' || k === 'fam-fixtures') {
      const cat = k === 'fam-trays' ? 'trays' : 'fixtures'
      set({ browserSel: k, hiddenCats: MEP_CATEGORIES.filter((c) => c !== cat && c !== 'beams') })
      return toast(fmt(t.toast.only, { what: node.label }))
    }
    if (k === 'fam-conduits' || k === 'fam-supports') return toast(fmt(t.toast.none, { what: node.label.toLowerCase() }))
    if (!node.children) toast(fmt(t.toast.native, { what: node.label }))
  }

  return (
    <WsTree title={b.title} placeholder={b.search} root={root} active={browserSel} onSelect={onSelect} collapseLabel={b.collapse} expandLabel={b.expand} rowH={23.2} indent={{ base: 0, step: 14, leaf: 22 }} extraTop={8} groupGap={2} styleHead={{ height: 34 }} />
  )
}
