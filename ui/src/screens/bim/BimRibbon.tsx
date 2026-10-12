import { useState, type ComponentType } from 'react'
import { ChevronDown, Ellipsis, MousePointer2 } from 'lucide-react'
import { fmt, useT } from '../../i18n'
import { toast } from '../../state/toast'
import {
  ColumnToolIcon,
  DimensionToolIcon,
  DoorToolIcon,
  GridToolIcon,
  LevelToolIcon,
  ModelTextIcon,
  RoofToolIcon,
  RoomToolIcon,
  SlabToolIcon,
  StairToolIcon,
  TagToolIcon,
  WallToolIcon,
  WindowToolIcon,
  type IconProps,
} from '../../components/icons'
import { MenuList, PopoverPanel, useDismissable } from '../../components/ui/Popover'
import { Modal } from '../../components/ui/Modal'
import { useBim, type BimTool } from '../../state/bim'
import { nextMark } from '../../bim/geometry'
import { FromCadDialog } from './FromCadDialog'
import s from './BimRibbon.module.css'

type ToolKey = keyof ReturnType<typeof useT>['bim']['tools']

/** Button centres (px from ribbon left) and separators, measured on mockup 04. */
const ITEMS: { key: ToolKey; Icon: ComponentType<IconProps>; c: number }[] = [
  { key: 'wall', Icon: WallToolIcon, c: 104 },
  { key: 'door', Icon: DoorToolIcon, c: 169 },
  { key: 'window', Icon: WindowToolIcon, c: 236 },
  { key: 'slab', Icon: SlabToolIcon, c: 308 },
  { key: 'stair', Icon: StairToolIcon, c: 374 },
  { key: 'column', Icon: ColumnToolIcon, c: 447 },
  { key: 'roof', Icon: RoofToolIcon, c: 518 },
  { key: 'room', Icon: RoomToolIcon, c: 585 },
  { key: 'level', Icon: LevelToolIcon, c: 659 },
  { key: 'modelText', Icon: ModelTextIcon, c: 737 },
  { key: 'dimension', Icon: DimensionToolIcon, c: 831 },
  { key: 'tag', Icon: TagToolIcon, c: 924 },
  { key: 'grid', Icon: GridToolIcon, c: 1002 },
]
const SEPS = [280, 416, 627, 682, 774, 889, 962, 1042]

export function BimRibbon() {
  const t = useT().bim
  const [moreOpen, setMoreOpen, moreRef] = useDismissable<HTMLDivElement>()
  const { tool, set } = useBim()
  const [levelOpen, setLevelOpen] = useState(false)
  const [fromCad, setFromCad] = useState(false)
  // drawing tools work in the plan view of the current level
  const pick = (k: ToolKey) => (k === 'level' ? setLevelOpen(true) : set({ tool: k as BimTool, view: 'plan', selection: null, pendingComponent: null }))
  return (
    <div className={s.ribbon} role="toolbar">
      <div className={s.track}>
        <button type="button" className={`${s.tool} ${tool === 'select' ? s.select : ''}`} style={{ left: 8, width: 67 }} aria-pressed={tool === 'select'} onClick={() => set({ tool: 'select' })}>
          <MousePointer2 size={22} strokeWidth={1.6} />
          <span>{t.tools.select}</span>
        </button>
        {ITEMS.map(({ key, Icon, c }) => (
          <button key={key} type="button" className={`${s.tool} ${tool === key ? s.select : ''}`} style={{ left: c - 34, width: 68 }} aria-pressed={tool === key} onClick={() => pick(key)} title={t.tools[key]}>
            <Icon size={25} strokeWidth={1.45} />
            <span>{t.tools[key]}</span>
          </button>
        ))}
        {SEPS.map((x) => (
          <span key={x} className={s.sep} style={{ left: x }} />
        ))}
        <div className={s.anchor} ref={moreRef} style={{ left: 1058 }}>
          <button type="button" className={s.tool} style={{ position: 'static', width: 104, marginTop: 8 }} aria-expanded={moreOpen} onClick={() => setMoreOpen(!moreOpen)}>
            <Ellipsis size={24} strokeWidth={2} />
            <span>
              {t.tools.more}
              <ChevronDown size={12} strokeWidth={2} className={s.caret} />
            </span>
          </button>
          {moreOpen && (
            <PopoverPanel width={210}>
              <MenuList
                onClose={() => setMoreOpen(false)}
                items={[...(['curtainWall', 'ceiling', 'railing', 'component'] as const).map((k) => ({ label: t.tools[k], onSelect: () => pick(k) })), { label: t.fromCad.menu, onSelect: () => setFromCad(true) }]}
              />
            </PopoverPanel>
          )}
        </div>
      </div>
      {levelOpen && <LevelDialog onClose={() => setLevelOpen(false)} />}
      {fromCad && <FromCadDialog onClose={() => setFromCad(false)} />}
    </div>
  )
}

/** Level tool: a new level by name and elevation (levels are datums, not drawn). */
function LevelDialog({ onClose }: { onClose: () => void }) {
  const T = useT()
  const t = T.bim.draw
  const { model, edit, set } = useBim()
  const topEl = Math.max(...model.levels.map((l) => l.elevation))
  const [name, setName] = useState(`Level ${model.levels.length}`)
  const [elev, setElev] = useState(String(topEl + 3000))
  return (
    <Modal title={t.levelTitle} onClose={onClose} width={380}>
      <form
        className={s.levelForm}
        onSubmit={(e) => {
          e.preventDefault()
          const z = Number(elev)
          if (!Number.isFinite(z) || model.levels.some((l) => Math.abs(l.elevation - z) < 1)) return toast(t.levelBad, 'warning')
          const id = nextMark(model.levels.map((l) => l.id), 'LV')
          const err = edit(`Add ${name}`, (m) => ({ ...m, levels: [...m.levels, { id, name: name.trim() || id, elevation: z }].sort((a, b) => a.elevation - b.elevation) }))
          if (err) return toast(fmt(T.bim.props.invalid, { mark: err }), 'warning')
          set({ level: id, selection: { category: 'level', id } })
          toast(fmt(t.added, { what: name }))
          onClose()
        }}
      >
        <label>
          <span>{t.levelName}</span>
          <input aria-label={t.levelName} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
        <label>
          <span>{t.levelElev}</span>
          <input aria-label={t.levelElev} value={elev} onChange={(e) => setElev(e.target.value)} inputMode="numeric" />
        </label>
        <button type="submit">{t.levelAdd}</button>
      </form>
    </Modal>
  )
}
