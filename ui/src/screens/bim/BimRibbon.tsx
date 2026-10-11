import type { ComponentType } from 'react'
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
  const native = (label: string) => toast(fmt(t.toast.native, { what: label }))
  return (
    <div className={s.ribbon} role="toolbar">
      <div className={s.track}>
        <button type="button" className={`${s.tool} ${s.select}`} style={{ left: 8, width: 67 }} aria-pressed="true">
          <MousePointer2 size={22} strokeWidth={1.6} />
          <span>{t.tools.select}</span>
        </button>
        {ITEMS.map(({ key, Icon, c }) => (
          <button key={key} type="button" className={s.tool} style={{ left: c - 34, width: 68 }} onClick={() => native(t.tools[key])} title={t.tools[key]}>
            <Icon size={25} strokeWidth={1.45} />
            <span>{t.tools[key]}</span>
          </button>
        ))}
        {SEPS.map((x) => (
          <span key={x} className={s.sep} style={{ left: x }} />
        ))}
        <div className={s.anchor} ref={moreRef} style={{ left: 1067 }}>
          <button type="button" className={s.tool} style={{ position: 'static', width: 104 }} aria-expanded={moreOpen} onClick={() => setMoreOpen(!moreOpen)}>
            <Ellipsis size={24} strokeWidth={2} />
            <span>
              {t.tools.more}
              <ChevronDown size={12} strokeWidth={2} className={s.caret} />
            </span>
          </button>
          {moreOpen && (
            <PopoverPanel width={180}>
              <MenuList
                onClose={() => setMoreOpen(false)}
                items={(['curtainWall', 'ceiling', 'railing', 'component'] as const).map((k) => ({ label: t.tools[k], onSelect: () => native(t.tools[k]) }))}
              />
            </PopoverPanel>
          )}
        </div>
      </div>
    </div>
  )
}
