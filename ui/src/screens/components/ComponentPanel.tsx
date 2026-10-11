import { useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, Download, Ellipsis, FileText } from 'lucide-react'
import { fmt, useLang, useT } from '../../i18n'
import type { Entity } from '../../cad/types'
import { translateEntity } from '../../cad/geometry'
import { useCad } from '../../state/cad'
import { useRouter } from '../../state/router'
import { toast } from '../../state/toast'
import { useLibrary, type InsertPrefs } from '../../state/library'
import type { LibComponent } from '../../library/catalog'
import { bounds } from '../../library/shapes'
import { COLOR_NAMES, componentBytes, componentDxf, downloadText, fileStem, formatSize } from '../../library/insert'
import { Dropdown } from '../../components/ui/Controls'
import { MenuList, PopoverPanel, useDismissable } from '../../components/ui/Popover'
import { ShapesView } from './ComponentThumb'
import s from './Components.module.css'

type Tab = 'preview' | 'details' | 'references' | 'versions'

/** Front + side elevations with overall dimensions (or the plan with W × D) for the 2D Preview. */
function previewEntities(c: LibComponent): Entity[] {
  const dim = (ax: number, ay: number, bx: number, by: number, offset: number, th: number): Entity => ({
    id: '', layer: '0', color: 'ByLayer', linetype: 'ByLayer', lineweight: 'ByLayer', transparency: 0,
    kind: 'dimension', a: { x: ax, y: ay }, b: { x: bx, y: by }, offset, override: null, textHeight: th,
  })
  const main = c.front?.() ?? c.plan?.() ?? []
  if (!main.length) return []
  const mb = bounds(main)
  const size = Math.max(mb.max.x - mb.min.x, mb.max.y - mb.min.y)
  const th = size * 0.055
  const out: Entity[] = [...main, dim(mb.min.x, mb.max.y, mb.max.x, mb.max.y, th * 2.2, th)]
  if (c.front && c.side) {
    const side = c.side()
    const sb = bounds(side)
    const dx = mb.max.x + size * 0.32 - sb.min.x
    out.push(...side.map((e) => translateEntity(e, { x: dx, y: 0 })))
    out.push(dim(sb.min.x + dx, sb.min.y, sb.min.x + dx, sb.max.y, th * 2.2, th), dim(sb.min.x + dx, sb.min.y, sb.max.x + dx, sb.min.y, -th * 2.2, th))
  } else if (!c.front) {
    out.push(dim(mb.min.x, mb.min.y, mb.min.x, mb.max.y, th * 2.2, th))
  }
  return out
}

export function ComponentPanel({ comp }: { comp: LibComponent | null }) {
  const t = useT()
  const T = t.components
  const lang = useLang()
  const lib = useLibrary()
  const docs = useCad((st) => st.docs)
  const activeDoc = useCad((st) => (st.activeId ? st.docs[st.activeId] : null))
  const navigate = useRouter((st) => st.navigate)
  const [tab, setTab] = useState<Tab>('preview')
  const [view, setView] = useState<'2d' | '3d'>('2d')
  const [editing, setEditing] = useState(false)
  const [filesOpen, setFilesOpen] = useState(true)
  const [matOpen, setMatOpen, matRef] = useDismissable<HTMLDivElement>()
  const preview = useMemo(() => (comp ? previewEntities(comp) : []), [comp])

  if (!comp) return <aside className={s.panel} />
  const ins = lib.insert
  const setIns = (p: Partial<InsertPrefs>) => lib.setInsert(p)
  const mapped = lib.layerFor[comp.id] ?? comp.layer
  const layers = [...new Set([mapped, comp.layer, ...(activeDoc?.layers.map((l) => l.name) ?? [])].filter(Boolean))]
  const bytes = componentBytes(comp)
  const stem = fileStem(comp.name)
  const files = [
    ...(comp.plan ? [{ name: `${stem}.dxf`, size: bytes, get: () => downloadText(`${stem}.dxf`, componentDxf(comp)) }] : []),
    ...(comp.photo ? [{ name: 'Thumbnail.png', size: 0, get: () => { const a = document.createElement('a'); a.href = comp.photo!; a.download = `${stem}_Thumbnail.png`; a.click() } }] : []),
    ...(comp.material?.image ? [{ name: `${fileStem(comp.material.name)}.png`, size: 0, get: () => { const a = document.createElement('a'); a.href = comp.material!.image!; a.download = `${fileStem(comp.material!.name)}.png`; a.click() } }] : []),
  ]
  const instances = Object.values(docs)
    .map((d) => ({ d, n: new Set(d.entities.filter((e) => e.block?.name === comp.name).map((e) => e.block!.id)).size }))
    .filter((x) => x.n > 0)
  const sz = comp.size
  const params: [string, string][] = [
    ...(sz ? ([[T.p.width, `${sz.w} mm`], [T.p.depth, `${sz.d} mm`], ...(sz.h ? [[T.p.height, `${sz.h} mm`]] : [])] as [string, string][]) : [[T.p.size, comp.sizeLabel ?? '—']] as [string, string][]),
    [T.p.material, comp.material?.name ?? '—'],
    [T.p.manufacturer, comp.manufacturer],
    [T.p.model, comp.name],
    [T.p.version, comp.version],
    [T.p.fileSize, comp.plan ? formatSize(bytes) : '—'],
    [T.p.discipline, T.disciplines[comp.discipline]],
    [T.p.category, T.cats[comp.category]],
  ]

  return (
    <aside className={s.panel} aria-label={comp.name}>
      <div className={s.ptabs} role="tablist">
        {(['preview', 'details', 'references', 'versions'] as Tab[]).map((id) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={`${s.ptab} ${tab === id ? s.ptabOn : ''}`} onClick={() => setTab(id)}>{T.panel[id]}</button>
        ))}
      </div>

      {tab === 'preview' && (
        <>
          <div className={s.seg} role="radiogroup">
            <button type="button" role="radio" aria-checked={view === '2d'} className={view === '2d' ? s.segOn : ''} onClick={() => setView('2d')}>{T.p2d}</button>
            <button type="button" role="radio" aria-checked={view === '3d'} className={view === '3d' ? s.segOn : ''} onClick={() => setView('3d')}>{T.p3d}</button>
          </div>
          <div className={s.previewBox}>
            {view === '2d' ? (
              preview.length ? <ShapesView entities={preview} w={362} h={128} pad={0.72} /> : <p className={s.muted}>{T.noPlan}</p>
            ) : comp.photo ? (
              <figure className={s.render}><img src={comp.photo} alt="" /><figcaption>{T.render}</figcaption></figure>
            ) : (
              <p className={s.muted}>{T.no3d}</p>
            )}
          </div>

          <div className={s.paramsRow}>
            <section className={s.params}>
              <h3>{T.params}</h3>
              <table>
                <tbody>
                  {params.map(([k, v]) => (
                    <tr key={k}><th>{k}</th><td>{v}</td></tr>
                  ))}
                </tbody>
              </table>
            </section>
            <section className={s.insertion}>
              <div className={s.insHead}>
                <h3>{T.insertion}</h3>
                <button type="button" onClick={() => setEditing(!editing)}>{editing ? T.done : T.edit}</button>
              </div>
              <fieldset disabled={!editing} className={s.fields}>
                <div className={s.insRow}>
                  <span>{T.point}</span>
                  <Dropdown className={s.insSel} label={T.point} value={ins.point} onChange={(v) => setIns({ point: v })}
                    options={(['center', 'bottom-left', 'bottom-center'] as const).map((v) => ({ value: v, label: T.points[v] }))} />
                </div>
                <div className={s.insRow}>
                  <span>{T.rotation}</span>
                  <Dropdown className={s.insSel} label={T.rotation} value={ins.rotation} onChange={(v) => setIns({ rotation: v })}
                    options={([0, 90, 180, 270] as const).map((v) => ({ value: v, label: `${v}°` }))} />
                </div>
                <label className={s.check} title={T.autoAlignHelp}><input type="checkbox" checked={ins.autoAlign} onChange={(e) => setIns({ autoAlign: e.target.checked })} />{T.autoAlign}</label>
                <label className={s.check}><input type="checkbox" checked={ins.explode} onChange={(e) => setIns({ explode: e.target.checked })} />{T.explode}</label>
                <label className={s.check}><input type="checkbox" checked={ins.currentLayer} onChange={(e) => setIns({ currentLayer: e.target.checked })} />{T.currentLayer}</label>
              </fieldset>
              <h3 className={s.mapTitle}>{T.layerMapping}</h3>
              <div className={s.mapRow}>
                <span>{T.layer}</span>
                <Dropdown className={s.mapSel} label={T.layer} value={mapped} onChange={(v) => lib.setLayerFor(comp.id, v)} options={layers.map((l) => ({ value: l, label: l }))} />
              </div>
              <div className={s.mapRow}>
                <span>{T.color}</span>
                <Dropdown className={s.mapSel} label={T.color} value={ins.color} onChange={(v) => setIns({ color: v })} options={COLOR_NAMES.map((c) => ({ value: c, label: T.colors[c as keyof typeof T.colors] }))}>
                  <i className={s.colorChip} data-color={ins.color} />
                </Dropdown>
              </div>
              <div className={s.mapRow}>
                <span>{T.linetype}</span>
                <Dropdown className={s.mapSel} label={T.linetype} value={ins.linetype} onChange={(v) => setIns({ linetype: v })}
                  options={(['ByLayer', 'Continuous', 'Dashed', 'DashDot'] as const).map((v) => ({ value: v, label: T.linetypes[v] }))} />
              </div>
            </section>
          </div>

          {comp.material && (
            <section className={s.matSec}>
              <h3>{T.materials}</h3>
              <div className={s.matCard}>
                {comp.material.image ? <img src={comp.material.image} alt="" /> : <i style={{ background: comp.material.color }} />}
                <div><b>{comp.material.name}</b><small>{T.genericMaterial}</small></div>
                <div className={s.matMenu} ref={matRef}>
                  <button type="button" aria-label={T.more} aria-expanded={matOpen} onClick={() => setMatOpen(!matOpen)}><Ellipsis size={18} strokeWidth={2} /></button>
                  {matOpen && (
                    <PopoverPanel width={180}>
                      <MenuList onClose={() => setMatOpen(false)} items={[{ label: T.copyName, onSelect: () => { void navigator.clipboard?.writeText(comp.material!.name); toast(T.toast.copied, 'success') } }]} />
                    </PopoverPanel>
                  )}
                </div>
              </div>
            </section>
          )}

          <section className={s.filesSec}>
            <div className={s.filesHead}>
              <h3>{fmt(T.files, { n: files.length })}</h3>
              <button type="button" aria-expanded={filesOpen} onClick={() => setFilesOpen(!filesOpen)}>{filesOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</button>
            </div>
            {filesOpen && (
              <ul className={s.fileList}>
                {files.map((f) => (
                  <li key={f.name}>
                    <FileText size={18} strokeWidth={1.5} />
                    <span>{f.name}</span>
                    <small>{f.size ? formatSize(f.size) : ''}</small>
                    <button type="button" aria-label={fmt(T.download, { name: f.name })} onClick={f.get}><Download size={16} strokeWidth={1.8} /></button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {tab === 'details' && (
        <dl className={s.facts}>
          {([
            [T.details.kind, T.kinds[comp.kind]],
            [T.details.group, T.groups[comp.group]],
            [T.p.category, T.cats[comp.category]],
            [T.p.discipline, T.disciplines[comp.discipline]],
            [T.p.size, comp.sizeLabel ?? '—'],
            [T.details.layer, comp.layer],
            [T.details.source, comp.source === 'builtin' ? T.details.builtin : T.details.upload],
            [T.details.software, comp.software],
            [T.details.added, new Date(comp.addedAt).toLocaleDateString(lang === 'vi' ? 'vi-VN' : 'en-US')],
            [T.details.uses, fmt(T.details.times, { n: lib.uses[comp.id] ?? 0 })],
          ] as [string, string][]).map(([k, v]) => (
            <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
          ))}
        </dl>
      )}

      {tab === 'references' && (
        <div className={s.refs}>
          <p className={s.muted}>{T.refs}</p>
          {instances.length === 0 && <p className={s.muted}>{T.refsNone}</p>}
          <ul>
            {instances.map(({ d, n }) => (
              <li key={d.id}>
                <span>{d.name}</span>
                <small>{fmt(T.instances, { n })}</small>
                <button type="button" onClick={() => { useCad.getState().setActive(d.id); navigate('cad2d') }}>{T.openDrawing}</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {tab === 'versions' && (
        <ol className={s.versions}>
          {comp.versions.map((v) => (
            <li key={v.v}><b>{v.v}</b><span>{v.date}</span><small>{T.notes[v.note] ? fmt(T.notes[v.note], { file: v.file ?? '' }) : v.note}</small></li>
          ))}
        </ol>
      )}
    </aside>
  )
}
