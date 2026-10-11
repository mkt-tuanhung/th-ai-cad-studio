import type { ComponentType } from 'react'
import { Ellipsis, Move, MousePointer2, Circle } from 'lucide-react'
import { useT } from '../../i18n'
import { useCad } from '../../state/cad'
import { useCadSession } from '../../state/cadSession'
import type { ToolId } from '../../cad/commands'
import {
  ArcToolIcon,
  DimensionToolIcon,
  HatchToolIcon,
  LineToolIcon,
  OffsetToolIcon,
  PolylineToolIcon,
  RectangleToolIcon,
  TextToolIcon,
  TrimToolIcon,
  type IconProps,
} from '../../components/icons'
import { MenuList, PopoverPanel, useDismissable } from '../../components/ui/Popover'
import s from './ToolPalette.module.css'

type Item = { id: ToolId; Icon: ComponentType<IconProps>; h: number }

/** Row heights reproduce the mockup's uneven rhythm (centres at y 292…781). */
const DRAW: Item[] = [
  { id: 'line', Icon: LineToolIcon, h: 44 },
  { id: 'polyline', Icon: PolylineToolIcon, h: 44 },
  { id: 'rectangle', Icon: RectangleToolIcon, h: 42 },
  { id: 'circle', Icon: Circle as ComponentType<IconProps>, h: 42 },
  { id: 'arc', Icon: ArcToolIcon, h: 42 },
]
const MODIFY: Item[] = [
  { id: 'trim', Icon: TrimToolIcon, h: 44 },
  { id: 'offset', Icon: OffsetToolIcon, h: 42 },
  { id: 'hatch', Icon: HatchToolIcon, h: 47 },
  { id: 'dimension', Icon: DimensionToolIcon, h: 48 },
  { id: 'text', Icon: TextToolIcon, h: 44 },
  { id: 'move', Icon: Move as ComponentType<IconProps>, h: 45 },
]

export function ToolPalette() {
  const t = useT().cad.tools
  const tool = useCad((st) => st.tool)
  const start = useCadSession((st) => st.start)
  const [moreOpen, setMoreOpen, moreRef] = useDismissable<HTMLDivElement>()

  const row = ({ id, Icon, h }: Item) => (
    <button
      key={id}
      type="button"
      className={`${s.row} ${tool === id ? s.on : ''}`}
      style={{ flex: `0 1 ${h}px`, height: h }}
      aria-pressed={tool === id}
      onClick={() => start(id)}
      title={t[id]}
    >
      <Icon size={25} strokeWidth={1.45} />
      <span>{t[id]}</span>
    </button>
  )

  return (
    <nav className={s.palette} aria-label="Drawing tools">
      <button type="button" className={`${s.select} ${tool === 'select' ? s.selectOn : ''}`} aria-pressed={tool === 'select'} onClick={() => start('select')}>
        <MousePointer2 size={22} strokeWidth={1.6} />
        <span>{t.select}</span>
      </button>
      <div className={s.group}>{DRAW.map(row)}</div>
      <div className={s.divider} />
      <div className={s.group}>{MODIFY.map(row)}</div>
      <div className={s.anchor} ref={moreRef}>
        <button type="button" className={s.row} style={{ flex: '0 1 40px', height: 40 }} onClick={() => setMoreOpen(!moreOpen)} aria-expanded={moreOpen}>
          <Ellipsis size={25} strokeWidth={1.8} />
          <span>{t.more}</span>
        </button>
        {moreOpen && (
          <PopoverPanel align="left" width={170} className={s.morePop}>
            <MenuList onClose={() => setMoreOpen(false)} items={[{ label: `${t.erase} (E)`, onSelect: () => start('erase') }]} />
          </PopoverPanel>
        )}
      </div>
    </nav>
  )
}
