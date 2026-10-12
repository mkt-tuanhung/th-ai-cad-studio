import { useState, type ComponentType, type CSSProperties, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, ChevronsLeft, ChevronsRight, Ellipsis, Home, Search } from 'lucide-react'
import { MenuList, PopoverPanel, useDismissable, type MenuItem } from '../ui/Popover'
import s from './ws.module.css'

export { s as wsStyles }

/* ------------------------------------------------------------------ header */

export interface Crumb {
  label: string
  onClick?: () => void
}

export interface HeaderTab {
  key: string
  label: string
  icon?: ReactNode
  /** Folder tabs: fixed width measured on the mockup. */
  width?: number
}

export function WsHeader({
  crumbs,
  current,
  currentMenu,
  onHome,
  homeLabel,
  tabs,
  active,
  onTab,
  tabsStyle,
  variant = 'folder',
  big,
  crumbsStyle,
  actions,
}: {
  crumbs: Crumb[]
  current: string
  currentMenu?: MenuItem[]
  onHome: () => void
  homeLabel: string
  tabs?: HeaderTab[]
  active?: string
  onTab?: (k: string) => void
  tabsStyle?: CSSProperties
  variant?: 'folder' | 'underline'
  /** Tall discipline tabs (MEP). */
  big?: boolean
  crumbsStyle?: CSSProperties
  actions: ReactNode
}) {
  const [open, setOpen, ref] = useDismissable<HTMLDivElement>()
  return (
    <div className={s.header}>
      <nav className={s.crumbs} aria-label="Breadcrumb" style={crumbsStyle}>
        <button type="button" className={s.home} aria-label={homeLabel} onClick={onHome}>
          <Home size={15} strokeWidth={1.7} />
        </button>
        <ChevronRight size={11} strokeWidth={2} className={s.sepSmall} />
        {crumbs.map((c, i) => (
          <span key={c.label} style={{ display: 'contents' }}>
            {i > 0 && <ChevronRight size={14} strokeWidth={1.8} className={s.sep} />}
            <button type="button" className={s.crumb} onClick={c.onClick}>
              {c.label}
            </button>
          </span>
        ))}
        <ChevronRight size={14} strokeWidth={1.8} className={s.sep} />
        {currentMenu ? (
          <div className={s.anchor} ref={ref}>
            <button type="button" className={s.current} aria-expanded={open} onClick={() => setOpen(!open)}>
              {current}
              <ChevronDown size={14} strokeWidth={1.8} />
            </button>
            {open && (
              <PopoverPanel align="left" width={200}>
                <MenuList onClose={() => setOpen(false)} items={currentMenu} />
              </PopoverPanel>
            )}
          </div>
        ) : (
          <span className={s.current}>{current}</span>
        )}
      </nav>

      {tabs && (
        <div className={`${s.tabs} ${big ? s.tabsBig : ''}`} role="tablist" style={tabsStyle}>
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={active === t.key}
              className={variant === 'folder' ? `${s.ftab} ${active === t.key ? s.ftabOn : ''}` : `${s.utab} ${active === t.key ? s.utabOn : ''}`}
              style={t.width ? { width: t.width } : undefined}
              onClick={() => onTab?.(t.key)}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>
      )}

      <div className={s.actions}>{actions}</div>
    </div>
  )
}

export function WsButton({ icon, label, onClick, width, menu, primary }: { icon?: ReactNode; label: string; onClick?: () => void; width?: number; menu?: MenuItem[]; primary?: boolean }) {
  const [open, setOpen, ref] = useDismissable<HTMLDivElement>()
  const cls = primary ? s.primary : s.btn
  if (!menu)
    return (
      <button type="button" className={cls} style={width ? { minWidth: width } : undefined} onClick={onClick}>
        {icon}
        {label}
      </button>
    )
  return (
    <div className={s.anchor} ref={ref}>
      <button type="button" className={cls} style={width ? { minWidth: width } : undefined} aria-expanded={open} onClick={() => setOpen(!open)}>
        {icon}
        {label}
        <ChevronDown size={13} strokeWidth={1.9} />
      </button>
      {open && (
        <PopoverPanel width={250}>
          <MenuList onClose={() => setOpen(false)} items={menu} />
        </PopoverPanel>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ ribbon */

export interface RibbonTool {
  key: string
  label: string
  Icon: ComponentType<{ size?: number; strokeWidth?: number }>
  /** Button centre, px from the ribbon's left edge (measured on the mockup). */
  c: number
  w?: number
  onClick: () => void
  active?: boolean
  iconSize?: number
  /** Drop-down under the button instead of a plain action. */
  menu?: MenuItem[]
}

export function WsRibbon({ tools, seps, more, width = 1290, top = 7 }: { tools: RibbonTool[]; seps: number[]; more?: { c: number; label: string; items: MenuItem[] }; width?: number; top?: number }) {
  const [open, setOpen, ref] = useDismissable<HTMLDivElement>()
  const [menuKey, setMenuKey, menuRef] = useDismissable<HTMLDivElement>()
  const [which, setWhich] = useState('')
  return (
    <div className={s.ribbon} role="toolbar">
      <div className={s.track} style={{ width }}>
        {tools.map(({ key, label, Icon, c, w = 70, onClick, active, iconSize = 24, menu }) =>
          menu ? (
            <div key={key} className={s.ranchor} ref={which === key ? menuRef : undefined} style={{ left: c - w / 2 }}>
              <button type="button" className={`${s.tool} ${active ? s.toolOn : ''}`} style={{ position: 'static', width: w, marginTop: top }} aria-expanded={menuKey && which === key} aria-pressed={active} title={label} onClick={() => (setWhich(key), setMenuKey(!(menuKey && which === key)))}>
                <Icon size={iconSize} strokeWidth={1.45} />
                <span>{label}</span>
              </button>
              {menuKey && which === key && (
                <PopoverPanel width={220} align="left">
                  <MenuList onClose={() => setMenuKey(false)} items={menu} />
                </PopoverPanel>
              )}
            </div>
          ) : (
            <button key={key} type="button" className={`${s.tool} ${active ? s.toolOn : ''}`} style={{ left: c - w / 2, width: w, top }} aria-pressed={active} onClick={onClick} title={label}>
              <Icon size={iconSize} strokeWidth={1.45} />
              <span>{label}</span>
            </button>
          ),
        )}
        {seps.map((x) => (
          <span key={x} className={s.rsep} style={{ left: x }} />
        ))}
        {more && (
          <div className={s.ranchor} ref={ref} style={{ left: more.c - 55 }}>
            <button type="button" className={s.tool} style={{ position: 'static', width: 110, marginTop: top - 2 }} aria-expanded={open} onClick={() => setOpen(!open)}>
              <Ellipsis size={24} strokeWidth={2} />
              <span>
                {more.label}
                <ChevronDown size={12} strokeWidth={2} />
              </span>
            </button>
            {open && (
              <PopoverPanel width={220}>
                <MenuList onClose={() => setOpen(false)} items={more.items} />
              </PopoverPanel>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ tree */

export interface TreeNode {
  key: string
  label: string
  icon?: ReactNode
  children?: TreeNode[]
  /** Text on the right (e.g. counts). */
  count?: string
  open?: boolean
  /** Extra space above this row (px), overriding groupGap. */
  gap?: number
  /** Row height for this node's children (px), overriding rowH. */
  childH?: number
}

export function WsTree({
  title,
  placeholder,
  root,
  active,
  onSelect,
  rowH = 20.2,
  collapseLabel,
  expandLabel,
  extraTop,
  styleHead,
  indent = { base: 4, step: 13, leaf: 18 },
  groupGap = 0,
}: {
  title: string
  placeholder: string
  root: TreeNode
  active: string | null
  onSelect: (n: TreeNode) => void
  rowH?: number
  collapseLabel: string
  expandLabel: string
  extraTop?: number
  styleHead?: CSSProperties
  indent?: { base: number; step: number; leaf: number }
  /** Extra space above top-level groups after the first (mockups separate them slightly). */
  groupGap?: number
}) {
  const [q, setQ] = useState('')
  const [closed, setClosed] = useState<Record<string, boolean>>({})
  const [collapsed, setCollapsed] = useState(false)
  const needle = q.trim().toLowerCase()
  const matches = (n: TreeNode): boolean => !needle || n.label.toLowerCase().includes(needle) || !!n.children?.some(matches)

  if (collapsed)
    return (
      <section className={`${s.card} ${s.rail}`} aria-label={title}>
        <button type="button" className={s.iconBtn} aria-label={expandLabel} title={expandLabel} onClick={() => setCollapsed(false)}>
          <ChevronsRight size={17} strokeWidth={1.8} />
        </button>
      </section>
    )

  const render = (n: TreeNode, depth: number, index = 0, h = rowH): ReactNode => {
    if (!matches(n)) return null
    const leaf = !n.children
    const isOpen = needle ? true : !(closed[n.key] ?? n.open === false)
    return (
      <li key={n.key} style={n.gap !== undefined ? { marginTop: n.gap } : groupGap && depth === 1 && index > 0 && !leaf ? { marginTop: groupGap } : undefined}>
        <div className={`${s.trow} ${depth === 0 ? s.troot : ''} ${active === n.key ? s.tactive : ''}`} style={{ height: h, paddingLeft: Math.max(0, indent.base + depth * indent.step + (leaf ? indent.leaf : 0)) }}>
          {!leaf && (
            <button type="button" className={s.twisty} aria-label={n.label} aria-expanded={isOpen} onClick={() => setClosed((c) => ({ ...c, [n.key]: isOpen }))}>
              {isOpen ? <ChevronDown size={13} strokeWidth={2} /> : <ChevronRight size={13} strokeWidth={2} />}
            </button>
          )}
          <button type="button" className={s.tlabel} aria-current={active === n.key || undefined} onClick={() => onSelect(n)}>
            {n.icon && <span className={s.ticon}>{n.icon}</span>}
            <span>{n.label}</span>
          </button>
          {n.count && <span className={s.tcount}>{n.count}</span>}
        </div>
        {!leaf && isOpen && <ul>{n.children!.map((c, i) => render(c, depth + 1, i, n.childH ?? rowH))}</ul>}
      </li>
    )
  }
  const tree = render(root, 0)
  return (
    <section className={s.card} aria-label={title}>
      <header className={s.cardHead} style={styleHead}>
        <h2 className={s.cardTitle}>{title}</h2>
        <button type="button" className={s.iconBtn} aria-label={collapseLabel} title={collapseLabel} onClick={() => setCollapsed(true)}>
          <ChevronsLeft size={17} strokeWidth={1.8} />
        </button>
      </header>
      <label className={s.search}>
        <Search size={14} strokeWidth={1.8} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
      </label>
      <ul className={s.tree} style={extraTop ? { paddingTop: extraTop } : undefined}>
        {tree ?? <li className={s.none}>—</li>}
      </ul>
    </section>
  )
}

/* ------------------------------------------------------------------ viewport */

export interface ViewTool {
  label: string
  icon: ReactNode
  onClick: () => void
  on?: boolean
}

export function ToolStrip({ items, style, vertical }: { items: ViewTool[]; style?: CSSProperties; vertical?: boolean }) {
  return (
    <div className={vertical ? s.vnav : s.vtoolbar} style={style} role="toolbar">
      {items.map((t) => (
        <button key={t.label} type="button" className={`${s.tbtn} ${t.on ? s.tbtnOn : ''}`} aria-label={t.label} title={t.label} aria-pressed={t.on} onClick={t.onClick}>
          {t.icon}
        </button>
      ))}
    </div>
  )
}

export function Select<T extends string>({ value, options, onChange, label, style, className }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string; style?: CSSProperties; className?: string }) {
  const cur = options.find((o) => o.value === value)
  return (
    <label className={`${s.vsel} ${className ?? ''}`} style={style}>
      <span>{cur?.label ?? value}</span>
      <ChevronDown size={14} strokeWidth={1.8} />
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

export function Modes<T extends string>({ items, value, onChange, style, label }: { items: { key: T; label: string; w: number }[]; value: T; onChange: (v: T) => void; style?: CSSProperties; label: string }) {
  return (
    <div className={s.modes} style={style} role="radiogroup" aria-label={label}>
      {items.map((m) => (
        <button key={m.key} type="button" role="radio" aria-checked={value === m.key} className={`${s.mode} ${value === m.key ? s.modeOn : ''}`} style={{ width: m.w }} onClick={() => onChange(m.key)}>
          {m.label}
        </button>
      ))}
    </div>
  )
}

export function ViewCube({ style, labels, onFace }: { style?: CSSProperties; labels: { top: string; front: string; right: string }; onFace: (f: 'top' | 'front' | 'right') => void }) {
  return (
    <div className={s.cube} style={style} aria-label="View cube">
      <button type="button" className={s.cubeTop} onClick={() => onFace('top')}>{labels.top}</button>
      <button type="button" className={s.cubeFront} onClick={() => onFace('front')}>{labels.front}</button>
      <button type="button" className={s.cubeRight} onClick={() => onFace('right')}>{labels.right}</button>
    </div>
  )
}

/** Card that hosts a DEMO render (or a live view) with display-mode filters and overlay slots. */
export function Viewport({ mode, img, alt, children, label, demo }: { mode: string; img?: string; alt: string; children?: ReactNode; label: string; demo?: { text: string; style: CSSProperties } }) {
  return (
    <section className={`${s.viewport} ${s[`m_${mode}`] ?? ''}`} aria-label={label}>
      <svg width="0" height="0" className={s.defs} aria-hidden="true">
        <filter id="wsWire">
          <feColorMatrix type="saturate" values="0" />
          <feConvolveMatrix order="3" kernelMatrix="-1 -1 -1 -1 8 -1 -1 -1 -1" preserveAlpha="true" />
          <feComponentTransfer>
            <feFuncR type="linear" slope="-3" intercept="1" />
            <feFuncG type="linear" slope="-3" intercept="1" />
            <feFuncB type="linear" slope="-3" intercept="1" />
          </feComponentTransfer>
        </filter>
        <filter id="wsHidden">
          <feColorMatrix type="saturate" values="0" />
          <feComponentTransfer>
            <feFuncR type="discrete" tableValues="0.2 0.75 1 1" />
            <feFuncG type="discrete" tableValues="0.2 0.75 1 1" />
            <feFuncB type="discrete" tableValues="0.2 0.75 1 1" />
          </feComponentTransfer>
        </filter>
      </svg>
      {img && <img className={s.vpImg} src={img} alt={alt} draggable={false} />}
      {children}
      {demo && <span className={s.demoBadge} style={demo.style}>{demo.text}</span>}
    </section>
  )
}

/* ------------------------------------------------------------------ tabbed card + table */

export function TabCard<T extends string>({ tabs, active, onTab, right, children, label, tabStyle }: { tabs: { key: T; label: string }[]; active: T; onTab: (k: T) => void; right?: ReactNode; children: ReactNode; label: string; tabStyle?: (k: T) => CSSProperties | undefined }) {
  return (
    <section className={s.tcard} aria-label={label}>
      <div className={s.ttabs} role="tablist">
        {tabs.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={active === t.key} className={`${s.ttab} ${active === t.key ? s.ttabOn : ''}`} style={tabStyle?.(t.key)} onClick={() => onTab(t.key)}>
            {t.label}
          </button>
        ))}
        {right && <div className={s.ttabsRight}>{right}</div>}
      </div>
      {children}
    </section>
  )
}

export interface Column<R> {
  key: string
  label: string
  /** CSS grid track, e.g. '62px' or 'minmax(0,1fr)'. */
  w: string
  align?: 'right' | 'center'
  render: (r: R) => ReactNode
}

export function Table<R>({ columns, rows, rowKey, selected, onSelect, rowH = 25, checkbox, menu, empty, label }: {
  columns: Column<R>[]
  rows: R[]
  rowKey: (r: R) => string
  selected?: string | null
  onSelect?: (r: R) => void
  rowH?: number
  checkbox?: { checked: (r: R) => boolean; toggle: (r: R) => void; all: boolean; toggleAll: () => void }
  menu?: (r: R) => MenuItem[]
  empty?: string
  label: string
}) {
  const tracks = [checkbox ? '26px' : null, ...columns.map((c) => c.w), menu ? '34px' : null].filter(Boolean).join(' ')
  return (
    <div className={s.tbody}>
      <div className={s.table} role="table" aria-label={label}>
        <div className={s.thead} role="row" style={{ gridTemplateColumns: tracks }}>
          {checkbox && (
            <span className={`${s.cell} ${s.cb}`}>
              <input type="checkbox" aria-label="Select all" checked={checkbox.all} onChange={checkbox.toggleAll} />
            </span>
          )}
          {columns.map((c) => (
            <span key={c.key} role="columnheader" className={`${s.cell} ${c.align ? s[c.align] : ''}`}>
              {c.label}
            </span>
          ))}
          {menu && <span />}
        </div>
        {rows.map((r) => {
          const k = rowKey(r)
          return (
            <div key={k} role="row" aria-selected={selected === k} className={`${s.tr} ${selected === k ? s.trSel : ''}`} style={{ gridTemplateColumns: tracks, height: rowH }} onClick={() => onSelect?.(r)}>
              {checkbox && (
                <span className={`${s.cell} ${s.cb}`} onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" aria-label={`Select ${k}`} checked={checkbox.checked(r)} onChange={() => checkbox.toggle(r)} />
                </span>
              )}
              {columns.map((c) => (
                <span key={c.key} role="cell" className={`${s.cell} ${c.align ? s[c.align] : ''}`}>
                  {c.render(r)}
                </span>
              ))}
              {menu && <RowMenu items={menu(r)} label={k} />}
            </div>
          )
        })}
        {rows.length === 0 && <p className={s.none}>{empty ?? '—'}</p>}
      </div>
    </div>
  )
}

function RowMenu({ items, label }: { items: MenuItem[]; label: string }) {
  const [open, setOpen, ref] = useDismissable<HTMLDivElement>()
  return (
    <div className={s.anchor} ref={ref} onClick={(e) => e.stopPropagation()}>
      <button type="button" className={s.dots} aria-label={`Actions ${label}`} aria-expanded={open} onClick={() => setOpen(!open)}>
        <Ellipsis size={15} strokeWidth={2.2} />
      </button>
      {open && (
        <PopoverPanel width={190}>
          <MenuList onClose={() => setOpen(false)} items={items} />
        </PopoverPanel>
      )}
    </div>
  )
}

export function Status({ tone, children }: { tone: 'ok' | 'warn' | 'err' | 'idle'; children: ReactNode }) {
  return (
    <span className={`${s.status} ${s[tone]}`}>
      <i />
      {children}
    </span>
  )
}

/* ------------------------------------------------------------------ right panel */

export function PanelTabs<T extends string>({ tabs, active, onTab, widths }: { tabs: { key: T; label: string }[]; active: T; onTab: (k: T) => void; widths?: number[] }) {
  return (
    <div className={s.ptabs} role="tablist">
      {tabs.map((t, i) => (
        <button key={t.key} type="button" role="tab" aria-selected={active === t.key} className={`${s.ptab} ${active === t.key ? s.ptabOn : ''}`} style={widths ? { flex: `0 0 ${widths[i]}px` } : undefined} onClick={() => onTab(t.key)}>
          {t.label}
        </button>
      ))}
    </div>
  )
}

export function Section({ title, children, defaultOpen = true }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className={s.section}>
      <button type="button" className={s.secHead} aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className={s.bullet}>•</span>
        <span className={s.secTitle}>{title}</span>
        <ChevronDown size={13} strokeWidth={1.8} className={open ? undefined : s.flip} />
      </button>
      {open && children}
    </section>
  )
}

export function PRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={s.prow}>
      <span className={s.plabel}>{label}</span>
      <span className={s.pvalue}>{children}</span>
    </div>
  )
}

/** Numeric field that only commits valid values (Enter / blur); invalid input is flagged and reverted. */
export function NumField({ value, onCommit, label, min, max, unit }: { value: number; onCommit: (v: number) => void; label: string; min?: number; max?: number; unit?: string }) {
  const [draft, setDraft] = useState<string | null>(null)
  const parsed = draft === null ? value : Number(draft.replace(',', '.'))
  const bad = draft !== null && (!Number.isFinite(parsed) || (min !== undefined && parsed < min) || (max !== undefined && parsed > max))
  const commit = () => {
    if (draft !== null && !bad && parsed !== value) onCommit(parsed)
    setDraft(null)
  }
  return (
    <>
      <input
        className={`${s.pinput} ${bad ? s.pinputErr : ''}`}
        aria-label={label}
        aria-invalid={bad}
        value={draft ?? String(value)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          if (e.key === 'Escape') setDraft(null)
        }}
      />
      {unit && <span className={s.muted} style={{ flex: 'none' }}>{unit}</span>}
    </>
  )
}

export function PSelect<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  const cur = options.find((o) => o.value === value)
  return (
    <label className={s.psel}>
      <span>{cur?.label ?? value}</span>
      <ChevronDown size={13} strokeWidth={1.8} />
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

export function DemoTag({ children = 'DEMO' }: { children?: ReactNode }) {
  return <em className={s.tag}>{children}</em>
}

export function downloadFile(name: string, text: string | Uint8Array, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob([text as BlobPart], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export const csv = (rows: (string | number)[][]) => rows.map((r) => r.map((c) => (/[",\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : String(c))).join(',')).join('\n')
