import { useState, type ReactNode } from 'react'
import { Check, ChevronDown, DoorOpen, Ellipsis, Lightbulb, Pencil, SquareDashed } from 'lucide-react'
import { fmt, useLang, useT } from '../../i18n'
import { ruleMessage, useBim, type BimRightTab } from '../../state/bim'
import { linkedT, useLinkedT } from '../../i18n/ws/linked'
import { arcOf, ends, faceLengths, heightsOf, moveWall, setEnds, stretchWall } from '../../bim/walls'
import { roomFigures } from '../../bim/rooms'
import { useRouter } from '../../state/router'
import { toast } from '../../state/toast'
import { levelOf, typeOf, wallArea, wallHeight, wallVolume, type BimModel, type ElementRef, type Wall } from '../../bim/model'
import { dist, markOf, polyArea } from '../../bim/geometry'
import { stairFlight } from '../../bim/scene'
import { CroppedImage } from '../../components/ui/CroppedImage'
import { MenuList, PopoverPanel, useDismissable } from '../../components/ui/Popover'
import { Modal } from '../../components/ui/Modal'
import { ActionButton } from '../../components/ui/Button'
import { AiAssist } from '../../components/ai/AiAssist'
import { bimAi } from '../../ai/disciplines/bim'
import s from './PropertiesPanel.module.css'

const TABS: BimRightTab[] = ['properties', 'ai', 'comments']
const mm = (n: number) => `${n.toFixed(1)} mm`

export function PropertiesPanel() {
  const t = useT().bim.props
  const { rightTab, set } = useBim()
  return (
    <section className={s.card}>
      <div className={s.tabs} role="tablist">
        {TABS.map((k) => (
          <button key={k} type="button" role="tab" aria-selected={rightTab === k} className={`${s.tab} ${rightTab === k ? s.tabOn : ''}`} onClick={() => set({ rightTab: k })}>
            {t.tabs[k]}
          </button>
        ))}
      </div>
      <div className={`${s.body} scroll-y`}>
        {rightTab === 'properties' && <PropertiesTab />}
        {rightTab === 'ai' && <AiTab />}
        {rightTab === 'comments' && <CommentsTab />}
      </div>
      {rightTab === 'properties' && <Recommendations />}
    </section>
  )
}

type RowDef = { label: string; value: string; edit?: { kind: 'text' | 'level' | 'choice'; options?: [string, string][]; apply: (v: string) => string | null }; muted?: boolean }

type ListKey = 'columns' | 'slabs' | 'stairs' | 'railings' | 'components' | 'grids' | 'annotations'

function rowsFor(m: BimModel, sel: ElementRef, t: ReturnType<typeof useT>['bim']['props'], updateWall: (id: string, p: Partial<Wall>, label: string) => string | null, edit: (label: string, fn: (m: BimModel) => BimModel) => string | null) {
  const lvl = (id: string) => levelOf(m, id)?.name ?? '—'
  /** Undoable patch of one element of a list. */
  const patch = (key: ListKey, id: string, p: object, label: string) => edit(label, (x) => ({ ...x, [key]: (x[key] as { id: string }[]).map((e) => (e.id === id ? { ...e, ...p } : e)) }))
  /** Editable positive number (mm unless stated). */
  const num = (label: string, value: number, key: ListKey, id: string, field: string, unit = 'mm'): RowDef => ({
    label,
    value: unit === 'mm' ? mm(value) : `${value} ${unit}`,
    edit: {
      kind: 'text',
      apply: (v: string) => {
        const n = Number(v.replace(/[^\d.-]/g, ''))
        if (!Number.isFinite(n) || (unit !== '°' && n <= 0)) return t.badNumber
        return patch(key, id, { [field]: n }, label)
      },
    },
  })
  const levelRow = (label: string, value: string, key: ListKey, id: string, field: string): RowDef => ({ label, value: lvl(value), edit: { kind: 'level' as const, apply: (v: string) => patch(key, id, { [field]: v }, label) } })
  const markRow = (value: string, key: ListKey, id: string): RowDef => ({ label: t.mark, value, edit: { kind: 'text' as const, apply: (v: string) => patch(key, id, { mark: v.trim() || value }, t.mark) } })
  if (sel.category === 'column') {
    const c = m.columns.find((x) => x.id === sel.id)
    if (!c) return null
    return { kind: t.kinds.column, title: t.kinds.column, subtitle: `${c.w} × ${c.d} mm`, icon: 'room' as const, sections: [
      { title: t.identity, rows: [markRow(c.mark, 'columns', c.id)] },
      { title: t.constraints, rows: [levelRow(t.baseLevel, c.level, 'columns', c.id, 'level'), levelRow(t.topLevel, c.topLevel, 'columns', c.id, 'topLevel')] },
      { title: t.dimensions, rows: [num(t.width, c.w, 'columns', c.id, 'w'), num(t.depth, c.d, 'columns', c.id, 'd'), { label: t.height, value: mm((levelOf(m, c.topLevel)?.elevation ?? 0) - (levelOf(m, c.level)?.elevation ?? 0)), muted: true }] },
    ] }
  }
  if (sel.category === 'slab') {
    const x = m.slabs.find((q) => q.id === sel.id)
    if (!x) return null
    const area = polyArea(x.outline) / 1e6
    return { kind: t.kinds.slab[x.kind], title: t.kinds.slab[x.kind], subtitle: `${x.thickness} mm`, icon: 'room' as const, sections: [
      { title: t.identity, rows: [markRow(x.mark, 'slabs', x.id)] },
      { title: t.constraints, rows: [levelRow(t.level, x.level, 'slabs', x.id, 'level'), num(t.offset, x.offset, 'slabs', x.id, 'offset')] },
      { title: t.dimensions, rows: [num(t.thickness, x.thickness, 'slabs', x.id, 'thickness'), { label: t.area, value: `${area.toFixed(2)} m²`, muted: true }, { label: t.volume, value: `${((area * x.thickness) / 1000).toFixed(2)} m³`, muted: true }] },
    ] }
  }
  if (sel.category === 'stair') {
    const x = m.stairs.find((q) => q.id === sel.id)
    if (!x) return null
    const r = stairFlight(m, x)
    return { kind: t.kinds.stair, title: t.kinds.stair, subtitle: `${r.n} × ${r.riser.toFixed(0)} mm`, icon: 'room' as const, sections: [
      { title: t.identity, rows: [markRow(x.mark, 'stairs', x.id)] },
      { title: t.constraints, rows: [levelRow(t.baseLevel, x.baseLevel, 'stairs', x.id, 'baseLevel'), levelRow(t.topLevel, x.topLevel, 'stairs', x.id, 'topLevel')] },
      { title: t.dimensions, rows: [num(t.width, x.width, 'stairs', x.id, 'width'), num(t.length, x.length, 'stairs', x.id, 'length'), { label: t.risers, value: String(r.n), muted: true }, { label: t.riserHeight, value: mm(r.riser), muted: true }, { label: t.going, value: mm(x.length / r.n), muted: true }] },
    ] }
  }
  if (sel.category === 'railing') {
    const x = m.railings.find((q) => q.id === sel.id)
    if (!x) return null
    const L = x.pts.slice(1).reduce((a, p, i) => a + dist(x.pts[i], p), 0)
    return { kind: t.kinds.railing, title: t.kinds.railing, subtitle: `${x.height} mm`, icon: 'room' as const, sections: [
      { title: t.identity, rows: [markRow(x.mark, 'railings', x.id)] },
      { title: t.constraints, rows: [levelRow(t.level, x.level, 'railings', x.id, 'level')] },
      { title: t.dimensions, rows: [num(t.height, x.height, 'railings', x.id, 'height'), { label: t.length, value: mm(L), muted: true }, { label: t.points, value: String(x.pts.length), muted: true }] },
    ] }
  }
  if (sel.category === 'component') {
    const x = m.components.find((q) => q.id === sel.id)
    if (!x) return null
    return { kind: t.kinds.component, title: x.name, subtitle: `${x.w} × ${x.d} × ${x.h} mm`, icon: 'room' as const, sections: [
      { title: t.identity, rows: [markRow(x.mark, 'components', x.id), { label: t.name, value: x.name, edit: { kind: 'text' as const, apply: (v: string) => patch('components', x.id, { name: v.trim() || x.name }, t.name) } }] },
      { title: t.constraints, rows: [levelRow(t.level, x.level, 'components', x.id, 'level'), num(t.rotation, x.rot, 'components', x.id, 'rot', '°')] },
      { title: t.dimensions, rows: [num(t.width, x.w, 'components', x.id, 'w'), num(t.depth, x.d, 'components', x.id, 'd'), num(t.height, x.h, 'components', x.id, 'h')] },
    ] }
  }
  if (sel.category === 'grid') {
    const x = m.grids.find((q) => q.id === sel.id)
    if (!x) return null
    return { kind: t.kinds.grid, title: `${t.kinds.grid} ${x.label}`, subtitle: mm(dist(x.a, x.b)), icon: 'room' as const, sections: [
      { title: t.identity, rows: [{ label: t.label, value: x.label, edit: { kind: 'text' as const, apply: (v: string) => patch('grids', x.id, { label: v.trim() || x.label }, t.label) } }] },
    ] }
  }
  if (sel.category === 'annotation') {
    const x = m.annotations.find((q) => q.id === sel.id)
    if (!x) return null
    const rows: RowDef[] = x.kind === 'text' ? [{ label: t.text, value: x.text ?? '', edit: { kind: 'text' as const, apply: (v: string) => patch('annotations', x.id, { text: v.trim() || x.text }, t.text) } }]
      : x.kind === 'dimension' ? [{ label: t.length, value: mm(dist(x.a, x.b ?? x.a)), muted: true }]
      : [{ label: t.mark, value: x.target ? markOf(m, { category: 'wall', id: x.target }) : '—', muted: true }]
    return { kind: t.kinds.annotation[x.kind], title: t.kinds.annotation[x.kind], subtitle: lvl(x.level), icon: 'room' as const, sections: [{ title: t.identity, rows }] }
  }
  // v2.4: identity of the element (guid / revision / provenance)
  const L = linkedT().props
  const idSection = (e: { guid?: string; rev?: number; src?: { kind: keyof typeof L.srcKind; reviewRequired?: boolean } }) => ({
    title: L.identity,
    rows: [
      { label: L.guid, value: e.guid ?? '—', muted: true },
      { label: L.rev, value: String(e.rev ?? 1), muted: true },
      { label: L.src, value: e.src ? `${L.srcKind[e.src.kind] ?? e.src.kind}${e.src.reviewRequired ? ` · ${L.review}` : ''}` : '—', muted: true },
    ] as RowDef[],
  })
  /** An editable number: `apply` gets the parsed value (mm unless stated). */
  const numEdit = (label: string, value: number, apply: (n: number) => string | null, o: { unit?: string; zero?: boolean; negative?: boolean; digits?: number } = {}): RowDef => ({
    label,
    value: o.unit ? `${value.toFixed(o.digits ?? 1)} ${o.unit}` : mm(value),
    edit: {
      kind: 'text',
      apply: (v: string) => {
        const n = Number(v.replace(',', '.').replace(/[^\d.-]/g, ''))
        if (!Number.isFinite(n) || (!o.negative && n < 0) || (!o.zero && !o.negative && n === 0)) return t.badNumber
        return apply(n)
      },
    },
  })
  const editWall = (_id: string, label: string, fn: (m: BimModel) => BimModel) => edit(label, fn)
  if (sel.category === 'wall') {
    const w = m.walls.find((x) => x.id === sel.id)
    if (!w) return null
    const ty = typeOf(m, w)
    const arc = arcOf(w)
    const hs = heightsOf(m, w)
    const faces = faceLengths(m, w)
    const base = (levelOf(m, w.baseLevel)?.elevation ?? 0) + w.baseOffset
    const topLv = levelOf(m, w.topLevel)?.elevation ?? 0
    /** wall thickness: a type of the same family with that thickness, else a copy of this type with it */
    const setThickness = (th: number) =>
      editWall(w.id, L.thickness, (x) => {
        const same = x.wallTypes.find((q) => q.family === ty.family && q.thickness === th && q.structure === ty.structure) ?? x.wallTypes.find((q) => q.family === ty.family && q.thickness === th)
        if (same) return { ...x, walls: x.walls.map((q) => (q.id === w.id ? { ...q, typeId: same.id } : q)) }
        const id = `${ty.id}-${th}`
        const nt = { ...ty, id, name: ty.name.replace(/\d+\s*mm/, `${th}mm`) === ty.name ? `${ty.name} (${th}mm)` : ty.name.replace(/\d+\s*mm/, `${th}mm`), thickness: th, guid: undefined, rev: undefined, src: undefined }
        return { ...x, wallTypes: [...x.wallTypes.filter((q) => q.id !== id), nt], walls: x.walls.map((q) => (q.id === w.id ? { ...q, typeId: id } : q)) }
      })
    const e = ends(w)
    return {
      kind: t.wallKind,
      title: ty.family,
      subtitle: ty.name,
      icon: 'wall' as const,
      sections: [
        {
          title: t.identity,
          rows: [
            { label: t.family, value: ty.family },
            { label: t.type, value: ty.name },
            { label: t.typeMark, value: w.mark, edit: { kind: 'text' as const, apply: (v: string) => updateWall(w.id, { mark: v.trim() || w.mark }, 'Type Mark') } },
            { label: t.description, value: w.description ?? ty.description },
          ] as RowDef[],
        },
        {
          title: t.constraints,
          rows: [
            { label: t.baseLevel, value: lvl(w.baseLevel), edit: { kind: 'level', apply: (v: string) => updateWall(w.id, { baseLevel: v }, 'Base Constraint') } },
            numEdit(t.baseOffset, w.baseOffset, (n) => updateWall(w.id, { baseOffset: n }, 'Base Offset'), { negative: true }),
            { label: t.topLevel, value: lvl(w.topLevel), edit: { kind: 'level', apply: (v: string) => updateWall(w.id, { topLevel: v }, 'Top Level') } },
            numEdit(t.topOffset, w.topOffset, (n) => updateWall(w.id, { topOffset: n }, 'Top Offset'), { negative: true }),
            // the height sets the top offset (the top level stays)
            numEdit(t.unconnected, wallHeight(m, w), (n) => updateWall(w.id, { topOffset: Math.round((base + n - topLv) * 100) / 100 }, 'Unconnected Height')),
          ] as RowDef[],
        },
        {
          title: t.dimensions,
          rows: [
            // the end moves along the wall; walls joined there move / stretch with it (the room stays closed)
            numEdit(t.length, w.length, (n) => editWall(w.id, `Length ${w.mark}`, (x) => stretchWall(x, w.id, n))),
            numEdit(L.angle, w.angle ?? 0, (n) => editWall(w.id, L.angle, (x) => ({ ...x, walls: x.walls.map((q) => (q.id === w.id ? setEnds(q, e.a, [e.a[0] + Math.cos((n * Math.PI) / 180) * q.length, e.a[1] + Math.sin((n * Math.PI) / 180) * q.length]) : q)) })), { unit: '°', zero: true, negative: true, digits: 2 }),
            numEdit(L.startX, e.a[0], (n) => editWall(w.id, L.startX, (x) => moveWall(x, w.id, [n - e.a[0], 0])), { zero: true, negative: true }),
            numEdit(L.startY, e.a[1], (n) => editWall(w.id, L.startY, (x) => moveWall(x, w.id, [0, n - e.a[1]])), { zero: true, negative: true }),
            numEdit(t.thickness, ty.thickness, setThickness),
            numEdit(t.height, hs.h0, (n) => updateWall(w.id, { topOffset: Math.round((base + n - topLv) * 100) / 100 }, 'Height')),
            // sloped top: the height at the end (0 = flat again)
            numEdit(L.heightEnd, hs.h1, (n) => updateWall(w.id, { heightEnd: n > 0 && Math.abs(n - hs.h0) > 0.5 ? n : undefined }, L.heightEnd), { zero: true }),
            // arc wall: the signed radius (0 = straight)
            numEdit(L.radius, w.arc?.radius ?? 0, (n) => updateWall(w.id, { arc: n ? { radius: n } : undefined }, L.radius), { zero: true, negative: true }),
            ...(arc ? [{ label: L.arcLength, value: mm(arc.len), muted: true }] : []),
            { label: L.faceLeft, value: mm(faces.left), muted: true },
            { label: L.faceRight, value: mm(faces.right), muted: true },
            { label: t.area, value: `${wallArea(m, w).toFixed(2)} m²`, muted: true },
            { label: t.volume, value: `${wallVolume(m, w).toFixed(2)} m³`, muted: true },
          ] as RowDef[],
        },
        {
          title: t.materials,
          rows: [
            { label: t.structure, value: ty.structure },
            { label: t.finishExt, value: ty.finishExt },
            { label: t.finishInt, value: ty.finishInt },
          ] as RowDef[],
        },
        idSection(w),
      ],
    }
  }
  if (sel.category === 'door' || sel.category === 'window') {
    const key = sel.category === 'door' ? ('doors' as const) : ('windows' as const)
    const o = m[key].find((x) => x.id === sel.id)
    if (!o) return null
    const host = m.walls.find((w) => w.id === o.hostWall)
    const po = (label: string, p: Partial<typeof o>) => edit(`${label} ${o.mark || o.id}`, (x) => ({ ...x, [key]: x[key].map((q) => (q.id === o.id ? { ...q, ...p, ...('width' in p || 'height' in p ? { type: `${p.width ?? q.width} x ${p.height ?? q.height}mm` } : {}) } : q)) }))
    const choice = (label: string, value: string, options: [string, string][], apply: (v: string) => string | null): RowDef => ({ label, value: options.find(([v]) => v === value)?.[1] ?? value, edit: { kind: 'choice', options, apply } })
    return {
      kind: sel.category === 'door' ? t.doorKind : t.windowKind,
      title: o.family,
      subtitle: o.type,
      icon: sel.category,
      sections: [
        { title: t.identity, rows: [{ label: t.family, value: o.family }, { label: t.type, value: o.type }, { label: t.typeMark, value: o.mark || '—', edit: { kind: 'text' as const, apply: (v: string) => po(t.typeMark, { mark: v.trim() }) } }] as RowDef[] },
        {
          title: t.constraints,
          rows: [
            { label: t.level, value: host ? lvl(host.baseLevel) : '—' },
            { label: t.host, value: host?.mark ?? o.hostWall },
            numEdit(L.offset, o.offset, (n) => po(L.offset, { offset: n }), { zero: true }),
            numEdit(t.sill, o.sill, (n) => po(t.sill, { sill: n }), { zero: true }),
            ...(sel.category === 'door'
              ? [
                  choice(L.hinge, o.hinge ?? 'left', [['left', L.hingeL], ['right', L.hingeR]], (v) => po(L.hinge, { hinge: v as 'left' | 'right' })),
                  choice(L.swing, o.swing ?? 'in', [['in', L.swingIn], ['out', L.swingOut]], (v) => po(L.swing, { swing: v as 'in' | 'out' })),
                ]
              : []),
          ] as RowDef[],
        },
        {
          title: t.dimensions,
          rows: [
            // a new width keeps the opening's centre on the wall
            numEdit(t.width, o.width, (n) => po(t.width, { width: n, offset: Math.round((o.offset + (o.width - n) / 2) * 10) / 10 })),
            numEdit(t.height, o.height, (n) => po(t.height, { height: n })),
          ] as RowDef[],
        },
        idSection(o),
      ],
    }
  }
  if (sel.category === 'room') {
    const r = m.rooms.find((x) => x.id === sel.id)
    if (!r) return null
    const f = roomFigures(m, r)
    const pr = (label: string, p: Partial<typeof r>) => edit(`${label} ${r.number}`, (x) => ({ ...x, rooms: x.rooms.map((q) => (q.id === r.id ? { ...q, ...p } : q)) }))
    return {
      kind: t.roomKind,
      title: r.name,
      subtitle: `${t.number} ${r.number}`,
      icon: 'room' as const,
      sections: [
        { title: t.identity, rows: [{ label: t.number, value: r.number, edit: { kind: 'text' as const, apply: (v: string) => pr(t.number, { number: v.trim() || r.number }) } }, { label: t.name, value: r.name, edit: { kind: 'text' as const, apply: (v: string) => pr(t.name, { name: v.trim() || r.name }) } }] as RowDef[] },
        { title: t.constraints, rows: [{ label: t.level, value: lvl(r.level) }] as RowDef[] },
        {
          title: t.dimensions,
          rows: [
            { label: L.net, value: `${f.net.toFixed(2)} m²`, muted: true },
            ...(f.gross !== null ? [{ label: L.gross, value: `${f.gross.toFixed(2)} m²`, muted: true }] : []),
            ...(f.perimeter !== null ? [{ label: L.perimeter, value: mm(f.perimeter), muted: true }] : []),
            { label: t.area, value: f.live ? L.liveArea : L.storedArea, muted: true },
          ] as RowDef[],
        },
        idSection(r),
      ],
    }
  }
  const l = m.levels.find((x) => x.id === sel.id)
  if (!l) return null
  // a level elevation change moves everything on it and re-shapes the stairs between levels (V24-010)
  const sorted = [...m.levels].sort((a, b) => a.elevation - b.elevation)
  return {
    kind: 'Level',
    title: l.name,
    subtitle: 'Level',
    icon: 'room' as const,
    sections: [
      {
        title: t.constraints,
        rows: [
          { label: L.name, value: l.name, edit: { kind: 'text' as const, apply: (v: string) => edit(`Level name ${l.name}`, (x) => ({ ...x, levels: x.levels.map((q) => (q.id === l.id ? { ...q, name: v.trim() || l.name } : q)) })) } },
          numEdit(t.elevation, l.elevation, (n) => {
            const i = sorted.findIndex((q) => q.id === l.id)
            // levels keep their order
            if ((i > 0 && n <= sorted[i - 1].elevation) || (i < sorted.length - 1 && n >= sorted[i + 1].elevation)) return t.badNumber
            return edit(`Elevation ${l.name}`, (x) => ({ ...x, levels: x.levels.map((q) => (q.id === l.id ? { ...q, elevation: n } : q)) }))
          }, { zero: true, negative: true }),
        ] as RowDef[],
      },
      idSection(l),
    ],
  }
}

function PropertiesTab() {
  const T = useT()
  const t = T.bim.props
  const { model, selection, updateWall, set, edit, deleteSelection, focusRoom, live3d, setLive3d } = useBim()
  const LP = useLinkedT().props
  const [menuOpen, setMenuOpen, menuRef] = useDismissable<HTMLDivElement>()
  if (!selection) return <p className={s.empty}>{t.noSelection}</p>
  const data = rowsFor(model, selection, t, updateWall, edit)
  if (!data) return <p className={s.empty}>{t.noSelection}</p>
  return (
    <>
      <div className={s.elem}>
        {data.icon === 'wall' ? (
          <CroppedImage className={s.thumb} src="/assets/bim_properties_panel.png" natW={272} natH={661} crop={{ x: 49, y: 22, w: 52, h: 50 }} alt="" />
        ) : (
          <span className={`${s.thumb} ${s.thumbIcon}`}>{data.icon === 'door' ? <DoorOpen size={26} strokeWidth={1.4} /> : <SquareDashed size={26} strokeWidth={1.4} />}</span>
        )}
        <span className={s.elemText}>
          <strong>{data.title}</strong>
          <span>{data.subtitle}</span>
        </span>
        <div className={s.anchor} ref={menuRef}>
          <button type="button" className={s.dots} aria-label={t.more} onClick={() => setMenuOpen(!menuOpen)}>
            <Ellipsis size={18} strokeWidth={2.2} />
          </button>
          {menuOpen && (
            <PopoverPanel width={190}>
              <MenuList
                onClose={() => setMenuOpen(false)}
                items={[
                  { label: t.showInSchedule, onSelect: () => set({ view: 'schedule', scheduleCat: selection.category === 'wall' ? 'walls' : selection.category === 'door' ? 'doors' : selection.category === 'window' ? 'windows' : 'rooms' }) },
                  { label: t.copyMark, onSelect: () => navigator.clipboard?.writeText(data.sections[0].rows.find((r) => r.label === t.typeMark || r.label === t.mark)?.value ?? '') },
                  ...(selection.category === 'room' ? [{ label: LP.focus3d, onSelect: () => focusRoom(selection.id) }] : []),
                  ...(selection.category === 'door' ? [{ label: live3d.doorsOpen ? LP.doorClosed : LP.doorOpen, onSelect: () => setLive3d({ doorsOpen: !live3d.doorsOpen }) }] : []),
                  ...(selection.category === 'level' ? [] : [{ label: t.delete, onSelect: () => { const l = deleteSelection(); if (l) toast(fmt(t.deleted, { what: l.replace(/^Delete /, '') })) } }]),
                ]}
              />
            </PopoverPanel>
          )}
        </div>
      </div>
      {data.sections.map((sec) => (
        <Section key={sec.title} title={sec.title}>
          {sec.rows.map((r) => (
            <PropRow key={r.label} row={r} levels={model.levels} />
          ))}
        </Section>
      ))}
    </>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(true)
  return (
    <div className={s.section}>
      <button type="button" className={s.secHead} aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className={s.bullet}>•</span>
        <span className={s.secTitle}>{title}</span>
        <ChevronDown size={13} strokeWidth={1.9} className={open ? '' : s.flip} />
      </button>
      {open && <div className={s.rows}>{children}</div>}
    </div>
  )
}

function PropRow({ row, levels }: { row: RowDef; levels: BimModel['levels'] }) {
  const T = useT()
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(row.value)
  const commit = (v: string) => {
    const err = row.edit!.apply(v)
    if (err) toast(err === T.bim.props.badNumber ? err : (ruleMessage(err) ?? fmt(T.bim.props.invalid, { mark: err })), 'warning')
    setEditing(false)
  }
  return (
    <div className={s.row}>
      <span className={`${s.label} ${row.muted ? s.mutedLabel : ''}`}>{row.label}</span>
      <span className={`${s.value} ${row.muted ? s.muted : ''}`}>
        {editing && row.edit?.kind === 'text' && (
          <input
            className={s.input}
            autoFocus
            value={val}
            onChange={(e) => setVal(e.target.value)}
            onBlur={() => commit(val)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit(val)
              if (e.key === 'Escape') setEditing(false)
            }}
          />
        )}
        {editing && row.edit?.kind === 'choice' && (
          <select className={s.input} autoFocus aria-label={row.label} defaultValue={row.edit.options?.find(([, l]) => l === row.value)?.[0]} onChange={(e) => commit(e.target.value)} onBlur={() => setEditing(false)}>
            {row.edit.options?.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        )}
        {editing && row.edit?.kind === 'level' && (
          <select className={s.input} autoFocus defaultValue={levels.find((l) => l.name === row.value)?.id} onChange={(e) => commit(e.target.value)} onBlur={() => setEditing(false)}>
            {levels.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        )}
        {!editing && <span className={s.valueText}>{row.value}</span>}
        {row.edit && !editing && (
          <button
            type="button"
            className={s.pencil}
            aria-label={`${T.bim.props.edit} ${row.label}`}
            onClick={() => {
              setVal(row.value)
              setEditing(true)
            }}
          >
            <Pencil size={11} strokeWidth={1.9} />
          </button>
        )}
      </span>
    </div>
  )
}

function Recommendations() {
  const T = useT()
  const t = T.bim.rec
  const { model, updateWall, appliedRecommendation, set } = useBim()
  const [confirm, setConfirm] = useState(false)
  const [details, setDetails] = useState(false)
  const w1 = model.walls.find((w) => w.id === 'W1')!
  const from = typeOf(model, w1)
  const to = model.wallTypes.find((x) => x.id === 'I250')!
  const preview = { ...model, walls: model.walls.map((w) => (w.id === 'W1' ? { ...w, typeId: 'I250' } : w)) }
  const pw = preview.walls.find((w) => w.id === 'W1')!
  return (
    <div className={s.rec} data-source="demo">
      <div className={s.recHead}>
        <span className={s.bulb}>
          <Lightbulb size={17} strokeWidth={1.7} />
        </span>
        <strong>{t.title}</strong>
        <span className={s.badge}>3</span>
      </div>
      <p className={s.recText}>{t.text}</p>
      <div className={s.recBtns}>
        <button type="button" className={s.apply} disabled={appliedRecommendation || from.id === 'I250'} onClick={() => setConfirm(true)}>
          {appliedRecommendation || from.id === 'I250' ? (
            <>
              <Check size={14} strokeWidth={2.4} /> {t.applied}
            </>
          ) : (
            t.apply
          )}
        </button>
        <button type="button" className={s.details} onClick={() => setDetails(true)}>
          {t.details}
        </button>
      </div>
      {confirm && (
        <Modal
          title={t.confirmTitle}
          onClose={() => setConfirm(false)}
          footer={
            <>
              <ActionButton onClick={() => setConfirm(false)}>{T.newProject.cancel}</ActionButton>
              <ActionButton
                variant="primary"
                onClick={() => {
                  const err = updateWall('W1', { typeId: 'I250' }, 'Apply suggestion W1')
                  setConfirm(false)
                  if (err) return toast(fmt(T.bim.props.invalid, { mark: err }), 'warning')
                  set({ appliedRecommendation: true, selection: { category: 'wall', id: 'W1' } })
                  toast(fmt(t.done, { mark: 'W1', to: to.name }), 'success')
                }}
              >
                {t.confirm}
              </ActionButton>
            </>
          }
        >
          <p className={s.modalText}>{fmt(t.confirmBody, { mark: 'W1', from: from.name, to: to.name, area: wallArea(model, w1).toFixed(2), volume: wallVolume(preview, pw).toFixed(2) })}</p>
          <p className={s.modalNote}>{t.sample}</p>
        </Modal>
      )}
      {details && (
        <Modal title={t.title} onClose={() => setDetails(false)} footer={<ActionButton onClick={() => setDetails(false)}>{T.newProject.cancel}</ActionButton>}>
          <ol className={s.recList}>
            {t.list.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ol>
          <p className={s.modalNote}>{t.sample}</p>
        </Modal>
      )}
    </div>
  )
}

function AiTab() {
  const T = useT()
  const t = T.bim.ai
  const navigate = useRouter((st) => st.navigate)
  const { model, edit } = useBim()
  return (
    <div className={s.aiTab}>
      <AiAssist d={bimAi} model={model} apply={(label, next) => edit(label, () => next)} example={T.aiAssist.examples.bim} />
      <ActionButton onClick={() => navigate('ai-studio')}>
        {t.open}
      </ActionButton>
    </div>
  )
}

function CommentsTab() {
  const T = useT()
  const t = T.bim.comments
  const lang = useLang()
  const { comments, addComment, selection, model } = useBim()
  const [text, setText] = useState('')
  const markOf = (id: string | null) => (id ? (model.walls.find((w) => w.id === id)?.mark ?? [...model.doors, ...model.windows].find((o) => o.id === id)?.mark ?? model.rooms.find((r) => r.id === id)?.number ?? id) : null)
  return (
    <div className={s.comments}>
      <form
        className={s.commentForm}
        onSubmit={(e) => {
          e.preventDefault()
          if (!text.trim()) return
          addComment(text.trim())
          setText('')
        }}
      >
        <textarea value={text} rows={3} placeholder={t.placeholder} aria-label={t.placeholder} onChange={(e) => setText(e.target.value)} />
        <ActionButton type="submit" variant="primary" disabled={!text.trim()}>
          {t.add}
          {selection && ` · ${markOf(selection.id)}`}
        </ActionButton>
      </form>
      {comments.length === 0 && <p className={s.empty}>{t.empty}</p>}
      <ul className={s.commentList}>
        {[...comments].reverse().map((c) => (
          <li key={c.id}>
            <p>{c.text}</p>
            <small>
              {new Date(c.at).toLocaleString(lang)} · {c.elementId ? fmt(t.on, { mark: markOf(c.elementId) ?? '' }) : t.general}
            </small>
          </li>
        ))}
      </ul>
    </div>
  )
}


