import { useMemo, useRef, useState, type ComponentType } from 'react'
import { componentsInbox } from '../../platform/ui'
import {
  AirVent, Archive, Armchair, ArrowUpToLine, Bath, Box, Building2, ChevronDown, ChevronRight, ChevronsLeft, ChevronsRight, CookingPot, Cog, DoorOpen, Download,
  Droplet, Ellipsis, Flame, Folder, Grid2x2, Image as ImageIcon, Lamp, Layers, LayoutGrid, LayoutPanelTop, Lightbulb, List, Palette, Search, Sofa, Star, StickyNote,
  Trees, Type, Upload, Boxes, PanelsTopLeft, Wind, Zap,
} from 'lucide-react'
import { fmt, relativeTime, useLang, useT } from '../../i18n'
import { useLibrary, allComponents } from '../../state/library'
import { useRouter } from '../../state/router'
import { toast } from '../../state/toast'
import { GROUP_CATEGORIES, type Category, type Discipline, type Group, type LibComponent } from '../../library/catalog'
import { bounds } from '../../library/shapes'
import { canInsert, componentBytes, downloadText, formatSize, queueInsert } from '../../library/insert'
import { decodeDxf, importDxf } from '../../cad/dxfImport'
import { translateEntity } from '../../cad/geometry'
import { convertDwg, dwgReader } from '../../services/dwg'
import { PipeIcon } from '../../components/icons'
import { MenuList, PopoverPanel, useDismissable } from '../../components/ui/Popover'
import { ComponentThumb } from './ComponentThumb'
import { ComponentPanel } from './ComponentPanel'
import { recommend, rankWithModel } from '../../library/recommend'
import { getHost } from '../../services/host'
import s from './Components.module.css'

type Ico = ComponentType<{ size?: number; strokeWidth?: number }>
const GROUP_ICON: Record<'all' | Group, Ico> = { all: Boxes, blocks: ImageIcon, families: PanelsTopLeft, mechanical: Box, mep: PipeIcon, materials: Layers, interior: LayoutPanelTop }
const TREE_ICON: Record<Group, Ico> = { ...GROUP_ICON, blocks: Folder, families: Folder }
const CAT_ICON: Record<Category, Ico> = {
  architecture: Building2, interior: Armchair, site: Trees, annotation: Type, doors: DoorOpen, windows: Grid2x2, furniture: Sofa, lighting: Lightbulb, fixtures: Lamp,
  hvac: AirVent, piping: PipeIcon, equipment: Cog, ductwork: Wind, electrical: Zap, plumbing: Droplet, fire: Flame, surface: Palette, kitchen: CookingPot, storage: Archive, bath: Bath,
}
const GROUPS: Group[] = ['blocks', 'families', 'mechanical', 'mep', 'materials', 'interior']
type Sort = 'popular' | 'name' | 'newest' | 'size'
type SizeBucket = 'small' | 'medium' | 'large'
type FileKind = 'param' | 'dwg' | 'dxf' | 'material'
interface Filters { discipline?: Discipline; fileType?: FileKind; software?: LibComponent['software']; size?: SizeBucket; tag?: string }

const bucket = (c: LibComponent): SizeBucket | null => {
  if (!c.size) return null
  const m = Math.max(c.size.w, c.size.d)
  return m < 600 ? 'small' : m <= 1500 ? 'medium' : 'large'
}
const fileKind = (c: LibComponent): FileKind => (c.group === 'materials' ? 'material' : c.source === 'builtin' ? 'param' : c.tags[1] === 'DWG' ? 'dwg' : 'dxf')

export function ComponentsScreen() {
  const t = useT()
  const T = t.components
  const lang = useLang()
  const navigate = useRouter((st) => st.navigate)
  const lib = useLibrary()
  const all = useMemo(() => allComponents(lib.uploads), [lib.uploads])
  const [group, setGroup] = useState<'all' | Group>('all')
  const [category, setCategory] = useState<Category | null>(null)
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState<Filters>({})
  const [sort, setSort] = useState<Sort>('popular')
  const [desc, setDesc] = useState(true)
  const [view, setView] = useState<'grid' | 'list'>('grid')
  // ⌘K → a component: open with it selected
  const [selectedId, setSelectedId] = useState(() => {
    const asked = componentsInbox.id && all.some((c) => c.id === componentsInbox.id) ? componentsInbox.id : null
    componentsInbox.id = null
    return asked ?? all.find((c) => c.name === 'Modern Sofa 3-Seater')?.id ?? all[0].id
  })
  const [treeOpen, setTreeOpen] = useState(true)
  const [catQuery, setCatQuery] = useState('')
  const [expanded, setExpanded] = useState<Record<Group, boolean>>({ blocks: true, families: true, mechanical: true, mep: false, materials: false, interior: false })
  const [strip, setStrip] = useState<'recent' | 'shared' | 'ai'>('recent')
  const [onlyIds, setOnlyIds] = useState<string[] | null>(null)
  const [moreOpen, setMoreOpen, moreRef] = useDismissable<HTMLDivElement>()
  const upload = useRef<HTMLInputElement>(null)

  const count = (g: 'all' | Group, cat?: Category) => all.filter((c) => (g === 'all' || c.group === g) && (!cat || c.category === cat)).length
  const tags = useMemo(() => [...new Set(all.flatMap((c) => c.tags))].sort(), [all])

  const list = useMemo(() => {
    const q = query.trim().toLowerCase()
    const rows = all.filter((c) => {
      if (onlyIds && !onlyIds.includes(c.id)) return false
      if (group !== 'all' && c.group !== group) return false
      if (category && c.category !== category) return false
      if (filters.discipline && c.discipline !== filters.discipline) return false
      if (filters.fileType && fileKind(c) !== filters.fileType) return false
      if (filters.software && c.software !== filters.software) return false
      if (filters.size && bucket(c) !== filters.size) return false
      if (filters.tag && !c.tags.includes(filters.tag)) return false
      if (q && !`${c.name} ${c.tags.join(' ')} ${c.tags.map((tg) => T.tagNames[tg] ?? '').join(' ')} ${c.discipline} ${T.disciplines[c.discipline]} ${T.cats[c.category]} ${c.sizeLabel ?? ''}`.toLowerCase().includes(q)) return false
      return true
    })
    const pop = (c: LibComponent) => c.popularity + (lib.uses[c.id] ?? 0) * 50
    const key: Record<Sort, (a: LibComponent, b: LibComponent) => number> = {
      popular: (a, b) => pop(b) - pop(a),
      name: (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }),
      newest: (a, b) => b.addedAt - a.addedAt,
      size: (a, b) => (b.size ? b.size.w * b.size.d : 0) - (a.size ? a.size.w * a.size.d : 0),
    }
    rows.sort(key[sort])
    return desc ? rows : rows.reverse()
  }, [all, group, category, filters, query, sort, desc, onlyIds, lib.uses, T])

  const selected = all.find((c) => c.id === selectedId) ?? null

  const insert = (c: LibComponent) => {
    if (!canInsert(c)) return toast(T.notInsertable, 'info')
    queueInsert(c, lib.insert, lib.layerFor[c.id] ?? c.layer)
    navigate('cad2d')
    toast(fmt(T.toast.queued, { name: c.name }), 'info')
  }

  const onUpload = async (files: FileList | null) => {
    for (const f of Array.from(files ?? [])) {
      const ext = f.name.split('.').pop()?.toLowerCase()
      let bytes = new Uint8Array(await f.arrayBuffer())
      if (ext === 'dwg') {
        if (!(await dwgReader())) { toast(t.cad.toast.dwgNative, 'warning'); continue }
        bytes = new Uint8Array((await convertDwg(bytes, f.name)).dxf)
      } else if (ext !== 'dxf') { toast(fmt(t.toast.unsupported, { ext: `.${ext}` }), 'warning'); continue }
      const { entities } = importDxf(decodeDxf(bytes).text)
      if (!entities.length) { toast(fmt(T.toast.uploadEmpty, { file: f.name }), 'warning'); continue }
      const b = bounds(entities)
      const up = lib.addUpload({ name: f.name.replace(/\.(dxf|dwg)$/i, ''), fileName: f.name, format: ext === 'dwg' ? 'DWG' : 'DXF', entities: entities.map((e) => translateEntity(e, { x: -b.min.x, y: -b.min.y })), bytes: f.size })
      setSelectedId(up.id)
      toast(fmt(T.toast.uploaded, { name: up.name, n: entities.length }), 'success')
    }
    if (upload.current) upload.current.value = ''
  }

  const recs = useMemo(() => (strip === 'ai' ? recommend(all, lib.recent, lib.favorites) : []), [strip, all, lib.recent, lib.favorites])
  const [aiOrder, setAiOrder] = useState<{ ids: string[]; label: string } | null>(null)
  const [aiBusy, setAiBusy] = useState(false)
  const rankAi = async () => {
    const host = await getHost()
    if (!host) return toast(T.aiNoModel)
    setAiBusy(true)
    const r = await rankWithModel(host, recs)
    setAiBusy(false)
    if (!r || !r.ids.length) return toast(T.aiNoModel)
    setAiOrder({ ids: r.ids, label: fmt(T.aiRanked, { model: r.model ?? 'local', s: r.seconds.toFixed(1) }) })
  }
  const aiList = aiOrder ? [...aiOrder.ids.map((id) => recs.find((r) => r.c.id === id)!).filter(Boolean), ...recs.filter((r) => !aiOrder.ids.includes(r.c.id))] : recs
  const stripItems: { c: LibComponent; at?: number }[] =
    strip === 'recent'
      ? lib.recent.map((r) => ({ c: all.find((x) => x.id === r.id)!, at: r.at })).filter((x) => x.c)
      : strip === 'shared'
        ? all.filter((c) => c.shared).map((c) => ({ c }))
        : aiList.map((r) => ({ c: r.c }))

  const chip = <K extends keyof Filters>(k: K, label: string, opts: [NonNullable<Filters[K]>, string][]) => (
    <FilterChip key={k} label={label} value={filters[k] ? opts.find((o) => o[0] === filters[k])?.[1] : undefined}
      options={opts.map(([v, l]) => ({ label: l, onSelect: () => setFilters((f) => ({ ...f, [k]: v })) }))} />
  )

  return (
    <div className={s.screen}>
      <header className={s.header}>
        <div className={s.headText}>
          <h1 className={s.title}>{T.title}</h1>
          <p className={s.subtitle}>{T.subtitle}</p>
        </div>
        <button type="button" className={s.uploadBtn} onClick={() => upload.current?.click()}>
          <Upload size={19} strokeWidth={1.7} />
          <span>{T.upload}</span>
        </button>
        <div className={s.moreWrap} ref={moreRef}>
          <button type="button" className={s.moreBtn} aria-label={T.more} aria-expanded={moreOpen} onClick={() => setMoreOpen(!moreOpen)}><Ellipsis size={18} strokeWidth={2} /></button>
          {moreOpen && (
            <PopoverPanel width={220}>
              <MenuList onClose={() => setMoreOpen(false)} items={[{
                label: T.exportCatalog,
                onSelect: () => downloadText('th-ai-cad-components.json', JSON.stringify(all.map(({ plan, front, side, ...m }) => ({ ...m, insertable: !!plan, hasElevations: !!(front && side) })), null, 2), 'application/json'),
              }]} />
            </PopoverPanel>
          )}
        </div>
        <input ref={upload} type="file" accept=".dxf,.dwg" multiple hidden onChange={(e) => void onUpload(e.target.files)} />
      </header>

      <div className={s.tiles} role="tablist">
        {(['all', ...GROUPS] as const).map((g) => {
          const Icon = GROUP_ICON[g]
          return (
            <button key={g} type="button" role="tab" aria-selected={group === g} className={`${s.tile} ${group === g ? s.tileOn : ''}`}
              onClick={() => { setGroup(g); setCategory(null); setOnlyIds(null) }}>
              <span className={s.tileIcon}><Icon size={26} strokeWidth={1.4} /></span>
              <span><b>{T.groups[g]}</b><small>{fmt(T.items, { n: count(g).toLocaleString(lang === 'vi' ? 'vi-VN' : 'en-US') })}</small></span>
            </button>
          )
        })}
      </div>

      <div className={s.body}>
        <div className={`${s.left} ${treeOpen ? '' : s.leftWide}`}>
          {treeOpen ? (
            <nav className={s.tree} aria-label={T.categories}>
              <div className={s.treeHead}>
                <h2>{T.categories}</h2>
                <button type="button" aria-label={T.collapse} onClick={() => setTreeOpen(false)}><ChevronsLeft size={17} strokeWidth={1.8} /></button>
              </div>
              <label className={s.catSearch}>
                <Search size={14} strokeWidth={1.8} />
                <input value={catQuery} onChange={(e) => setCatQuery(e.target.value)} placeholder={T.searchCats} aria-label={T.searchCats} />
              </label>
              <ul className={s.treeList}>
                <li>
                  <button type="button" className={`${s.node} ${s.lvl0} ${group === 'all' && !category ? s.nodeOn : ''}`} onClick={() => { setGroup('all'); setCategory(null); setOnlyIds(null) }}>
                    <ChevronDown size={14} strokeWidth={2} className={s.chev} /><Boxes size={17} strokeWidth={1.6} /><span>{T.groups.all}</span><em>{count('all').toLocaleString('en-US')}</em>
                  </button>
                </li>
                {GROUPS.map((g) => {
                  const Icon = TREE_ICON[g]
                  const cats = GROUP_CATEGORIES[g].filter((c) => !catQuery || T.cats[c].toLowerCase().includes(catQuery.toLowerCase()))
                  if (catQuery && !cats.length && !T.groups[g].toLowerCase().includes(catQuery.toLowerCase())) return null
                  const open = expanded[g] || !!catQuery
                  return (
                    <li key={g}>
                      <div className={`${s.node} ${s.lvl1} ${group === g && !category ? s.nodeOn : ''}`}>
                        <button type="button" className={s.twist} aria-label={T.groups[g]} aria-expanded={open} onClick={() => setExpanded((e) => ({ ...e, [g]: !e[g] }))}>
                          {open ? <ChevronDown size={14} strokeWidth={2} /> : <ChevronRight size={14} strokeWidth={2} />}
                        </button>
                        <button type="button" className={s.nodeLabel} onClick={() => { setGroup(g); setCategory(null); setOnlyIds(null) }}>
                          <Icon size={17} strokeWidth={1.6} /><span>{T.groups[g]}</span><em>{count(g).toLocaleString('en-US')}</em>
                        </button>
                      </div>
                      {open && (
                        <ul>
                          {cats.map((c) => { const CatIcon = CAT_ICON[c]; return (
                            <li key={c}>
                              <button type="button" className={`${s.node} ${s.lvl2} ${category === c ? s.nodeOn : ''}`} onClick={() => { setGroup(g); setCategory(c); setOnlyIds(null) }}>
                                <CatIcon size={15} strokeWidth={1.5} /><span>{T.cats[c]}</span><em>{count(g, c).toLocaleString('en-US')}</em>
                              </button>
                            </li>
                          )})}
                        </ul>
                      )}
                    </li>
                  )
                })}
              </ul>
            </nav>
          ) : (
            <button type="button" className={s.treeRail} aria-label={T.expand} onClick={() => setTreeOpen(true)}><ChevronsRight size={17} strokeWidth={1.8} /></button>
          )}

          <section className={s.main} aria-label={T.title}>
            <div className={s.toolbar}>
              <label className={s.search}>
                <Search size={16} strokeWidth={1.8} />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={T.search} aria-label={T.search} />
              </label>
              <SortBox value={sort} onChange={setSort} />
              <div className={s.views}>
                <button type="button" aria-pressed={view === 'grid'} aria-label={T.grid} className={view === 'grid' ? s.viewOn : ''} onClick={() => setView('grid')}><LayoutGrid size={16} strokeWidth={1.8} /></button>
                <button type="button" aria-pressed={view === 'list'} aria-label={T.list} className={view === 'list' ? s.viewOn : ''} onClick={() => setView('list')}><List size={16} strokeWidth={1.8} /></button>
              </div>
              <button type="button" className={`${s.dirBtn} ${desc ? '' : s.dirOn}`} aria-pressed={!desc} aria-label={T.sortDir} title={T.sortDir} onClick={() => setDesc(!desc)}>
                <ArrowUpToLine size={17} strokeWidth={1.8} />
              </button>
            </div>
            <div className={s.chips}>
              {chip('discipline', T.filters.discipline, (['Architecture', 'Interior', 'Mechanical', 'MEP', 'Civil', 'Structural'] as Discipline[]).map((d) => [d, T.disciplines[d]]))}
              {chip('fileType', T.filters.fileType, (['param', 'dwg', 'dxf', 'material'] as FileKind[]).map((k) => [k, T.fileTypes[k]]))}
              {chip('software', T.filters.software, (['MD CAD AI STUDIO', 'AutoCAD'] as const).map((k) => [k, k]))}
              {chip('size', T.filters.size, (['small', 'medium', 'large'] as SizeBucket[]).map((k) => [k, T.sizes[k]]))}
              {chip('tag', T.filters.tag, tags.map((k) => [k, T.tagNames[k] ?? k]))}
              <button type="button" className={s.reset} onClick={() => { setFilters({}); setQuery(''); setOnlyIds(null) }}>{T.filters.reset}</button>
            </div>

            <div className={view === 'grid' ? s.grid : s.rows}>
              {list.map((c) => (
                <ComponentCard key={c.id} c={c} layout={view} selected={c.id === selectedId} fav={lib.favorites.includes(c.id)}
                  onSelect={() => setSelectedId(c.id)} onInsert={() => insert(c)} onFav={() => lib.toggleFavorite(c.id)} />
              ))}
              {list.length === 0 && <p className={s.empty}>{T.empty}</p>}
            </div>
          </section>
        </div>

        <section className={s.strip} aria-label={T.tabs[strip]}>
          <div className={s.stripHead} role="tablist">
            {(['recent', 'shared', 'ai'] as const).map((k) => (
              <button key={k} type="button" role="tab" aria-selected={strip === k} className={`${s.stab} ${strip === k ? s.stabOn : ''}`} onClick={() => setStrip(k)}>{T.tabs[k]}</button>
            ))}
            <button type="button" className={s.viewAll} disabled={!stripItems.length} onClick={() => { setOnlyIds(stripItems.map((x) => x.c.id)); setGroup('all'); setCategory(null) }}>{T.viewAll}</button>
          </div>
          <div className={s.stripItems}>
            {stripItems.slice(0, 6).map(({ c, at }) => (
              <article key={c.id} className={`${s.mini} ${c.id === selectedId ? s.miniOn : ''}`} onClick={() => setSelectedId(c.id)} onDoubleClick={() => insert(c)} aria-label={c.name}>
                <div className={s.miniImg}>
                  <ComponentThumb comp={c} w={120} h={64} className={s.miniThumb} />
                  <StarBtn on={lib.favorites.includes(c.id)} onClick={() => lib.toggleFavorite(c.id)} />
                </div>
                <b>{c.name}</b>
                <small>{at ? fmt(T.used, { time: relativeTime(at, lang) }) : c.sizeLabel}</small>
              </article>
            ))}
            {strip === 'ai' && !stripItems.length && <p className={s.empty}>{T.aiNone}</p>}
            {strip === 'ai' && stripItems.length > 0 && (
              <p className={s.aiNote} data-testid="ai-rec-note">
                {aiBusy ? T.aiBusy : aiOrder ? aiOrder.label : T.aiRule}
                {!aiOrder && !aiBusy && <button type="button" className={s.aiAsk} onClick={() => void rankAi()}>{T.aiAsk}</button>}
              </p>
            )}
            {strip === 'recent' && !stripItems.length && <p className={s.empty}>{T.noRecent}</p>}
          </div>
        </section>

        <ComponentPanel comp={selected} />
      </div>
    </div>
  )
}

function StarBtn({ on, onClick }: { on: boolean; onClick: () => void }) {
  const T = useT().components
  return (
    <button type="button" className={`${s.star} ${on ? s.starOn : ''}`} aria-pressed={on} aria-label={on ? T.unfavorite : T.favorite} onClick={(e) => { e.stopPropagation(); onClick() }}>
      <Star size={17} strokeWidth={1.6} fill={on ? 'currentColor' : 'none'} />
    </button>
  )
}

function ComponentCard({ c, layout, selected, fav, onSelect, onInsert, onFav }: {
  c: LibComponent; layout: 'grid' | 'list'; selected: boolean; fav: boolean; onSelect: () => void; onInsert: () => void; onFav: () => void
}) {
  const T = useT().components
  const ok = canInsert(c)
  const size = c.plan ? formatSize(componentBytes(c)) : '—'
  const fileType = c.group === 'materials' ? T.fileTypes.material : c.source === 'builtin' ? 'DXF' : c.tags[1]
  const insertBtn = (
    <button type="button" className={s.dl} aria-label={`${T.insert}: ${c.name}`} title={ok ? T.insert : T.notInsertable} disabled={!ok} onClick={(e) => { e.stopPropagation(); onInsert() }}>
      <Download size={15} strokeWidth={2} />
    </button>
  )
  if (layout === 'list')
    return (
      <article className={`${s.row} ${selected ? s.cardOn : ''}`} onClick={onSelect} onDoubleClick={() => ok && onInsert()} aria-label={c.name} aria-selected={selected}>
        <ComponentThumb comp={c} w={64} h={40} className={s.rowThumb} />
        <b>{c.name}</b>
        <span>{T.kinds[c.kind]} • {fileType}</span>
        <span>{c.sizeLabel}</span>
        <span>{c.version}</span>
        <span>{size}</span>
        <StarBtn on={fav} onClick={onFav} />
        {insertBtn}
      </article>
    )
  return (
    <article className={`${s.card} ${selected ? s.cardOn : ''}`} onClick={onSelect} onDoubleClick={() => ok && onInsert()} tabIndex={0} aria-label={c.name} aria-selected={selected}
      onKeyDown={(e) => e.key === 'Enter' && ok && onInsert()}>
      <div className={s.cardImg}>
        <ComponentThumb comp={c} w={150} h={96} className={s.thumb} />
        <StarBtn on={fav} onClick={onFav} />
      </div>
      <h3>{c.name}</h3>
      <p className={s.kind}>{T.kinds[c.kind]} • {fileType}</p>
      <div className={s.tags}>{c.tags.map((tg, i) => <span key={tg} className={selected && i < 2 ? s.tagOn : ''}>{T.tagNames[tg] ?? tg}</span>)}</div>
      <p className={s.dims}><StickyNote size={14} strokeWidth={1.6} />{c.sizeLabel}</p>
      <div className={s.foot}>
        <span>{c.version}</span>
        <span>{size}</span>
        {insertBtn}
      </div>
    </article>
  )
}

function FilterChip({ label, value, options }: { label: string; value?: string; options: { label: string; onSelect: () => void }[] }) {
  const [open, setOpen, ref] = useDismissable<HTMLDivElement>()
  return (
    <div className={s.chipWrap} ref={ref}>
      <button type="button" className={`${s.chip} ${value ? s.chipOn : ''}`} aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>{value ?? label}</span>
        <ChevronDown size={13} strokeWidth={2.2} />
      </button>
      {open && (
        <PopoverPanel align="left" width={210} className={s.chipPop}>
          <MenuList onClose={() => setOpen(false)} items={options} />
        </PopoverPanel>
      )}
    </div>
  )
}

function SortBox({ value, onChange }: { value: Sort; onChange: (v: Sort) => void }) {
  const T = useT().components
  return (
    <label className={s.sortBox}>
      <span className={s.sortLbl}>{T.sortBy}</span>
      <span className={s.sortVal}>{T.sort[value]}</span>
      <ChevronDown size={15} strokeWidth={1.8} />
      <select value={value} onChange={(e) => onChange(e.target.value as Sort)} aria-label={T.sortBy}>
        {(['popular', 'name', 'newest', 'size'] as Sort[]).map((k) => <option key={k} value={k}>{T.sort[k]}</option>)}
      </select>
    </label>
  )
}
