import { useEffect, useMemo, useState } from 'react'
import {
  Camera as CameraIcon, ChevronsLeft, Crosshair, Ellipsis, Expand, Focus, Hand, Maximize, Play, Plus, RefreshCcw, Save, ScanSearch, Search, Share, Trash2,
  ZoomIn, ZoomOut, Box,
} from 'lucide-react'
import { fmt, useT } from '../../i18n'
import { useRouter } from '../../state/router'
import { toast } from '../../state/toast'
import { useRenders, type AssetTab, type RenderMode, type RenderTab } from '../../state/renders'
import { undoKeys } from '../../state/undoable'
import { Modes, Select, ToolStrip, WsButton, WsHeader, downloadFile, wsStyles as w } from '../../components/workspace/Workspace'
import { MenuList, PopoverPanel, useDismissable } from '../../components/ui/Popover'
import { MATERIALS, VARIATIONS, fxFilter } from '../../renders/model'
import { RenderSettingsPanel } from './RenderSettingsPanel'
import s from './Renders.module.css'

const MODES: { key: RenderMode; w: number }[] = [
  { key: 'wireframe', w: 78 },
  { key: 'clay', w: 64 },
  { key: 'shaded', w: 70 },
  { key: 'rendered', w: 74 },
]

/** Renders workspace — mockup 12 (Render Studio). */
export function RendersScreen() {
  const T = useT()
  const t = T.renders
  const navigate = useRouter((st) => st.navigate)
  const st = useRenders()
  const native = (what: string) => toast(fmt(t.toast.native, { what }))
  const [q, setQ] = useState('')
  const cam = st.doc.cameras.find((c) => c.id === st.camera) ?? st.doc.cameras[0]
  const variation = VARIATIONS.find((v) => v.key === st.variation)!
  // the large DEMO render exists only for Cam 01 / Original; other cameras and variations show their thumbnails
  const img = cam.id === 'cam1' ? (st.variation === 'original' ? '/assets/v2/renders/viewport.png' : variation.img) : cam.thumb
  const lowRes = img !== '/assets/v2/renders/viewport.png'

  useEffect(() => {
    const onKey = undoKeys(st.undo, st.redo, (label, redo) => toast(label ? fmt(redo ? t.toast.redone : t.toast.undone, { label }) : t.toast.nothing))
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [st.undo, st.redo, t])

  const addCamera = (fromId?: string) => {
    const src = st.doc.cameras.find((c) => c.id === (fromId ?? st.camera))!
    const n = st.doc.cameras.length + 1
    const name = fmt(t.scene.newName, { n: String(n).padStart(2, '0') })
    const id = `cam-${Date.now()}`
    st.edit(`Add ${name}`, (d) => ({ ...d, cameras: [...d.cameras, { ...src, id, name, kind: t.scene.fromView }] }))
    st.set({ camera: id })
    toast(fmt(t.toast.cameraAdded, { name }), 'success')
  }
  const queue = (ids: string[]) => toast(fmt(t.toast.queued, { n: st.enqueue(ids) }))

  const tabs = (['studio', 'panorama', 'video', 'ai', 'batch'] as RenderTab[]).map((k) => ({ key: k, label: t.tabs[k] }))
  const filteredMats = useMemo(() => MATERIALS.filter((m) => !q || t.mats[m].toLowerCase().includes(q.toLowerCase()) || m.includes(q.toLowerCase())), [q, t])
  const tool = (label: string, icon: React.ReactNode, onClick?: () => void) => ({ label, icon, onClick: onClick ?? (() => native(label)) })

  return (
    <div className={s.screen}>
      <div className={s.header}>
        <WsHeader
          homeLabel={T.nav.dashboard}
          onHome={() => navigate('dashboard')}
          crumbs={[{ label: t.crumbs.projects, onClick: () => navigate('projects') }, { label: t.crumbs.project, onClick: () => navigate('projects') }]}
          current={t.crumbs.current}
          actions={
            <>
              <WsButton icon={<Share size={15} strokeWidth={1.7} />} label={t.share} width={86} onClick={() => toast(t.toast.shareOffline)} />
              <WsButton icon={<Save size={16} strokeWidth={1.6} />} label={t.saveView} width={130} menu={[
                { label: t.saveItems.camera, onSelect: () => addCamera() },
                { label: t.saveItems.settings, onSelect: () => { downloadFile('Villa Riverside - render settings.json', JSON.stringify({ camera: cam, settings: st.doc.settings, post: st.doc.fx }, null, 2), 'application/json'); toast(fmt(t.toast.exported, { file: 'Villa Riverside - render settings.json' }), 'success') } },
                { label: t.saveItems.image, onSelect: () => { const a = document.createElement('a'); a.href = img; a.download = `${cam.name} - DEMO preview.png`; a.click() } },
              ]} />
              <WsButton primary icon={<Play size={16} strokeWidth={1.8} />} label={t.render} width={120} onClick={() => queue([cam.id])} />
            </>
          }
        />
      </div>
      <div className={s.tabs} role="tablist">
        {tabs.map((x) => (
          <button key={x.key} type="button" role="tab" aria-selected={st.tab === x.key} className={st.tab === x.key ? s.tabOn : undefined} onClick={() => (x.key === 'studio' ? st.set({ tab: 'studio' }) : x.key === 'batch' ? (st.set({ bottom: 'queue' }), queue(st.doc.cameras.map((c) => c.id))) : native(x.label))}>{x.label}</button>
        ))}
      </div>

      {/* ---------- left: scene & cameras ---------- */}
      <section className={`${w.card} ${s.scene}`} aria-label={t.scene.title}>
        <header className={s.head}>
          <h2>{t.scene.title}</h2>
          <button type="button" className={w.iconBtn} aria-label={t.scene.collapse} title={t.scene.collapse} onClick={() => native(t.scene.collapse)}><ChevronsLeft size={17} strokeWidth={1.8} /></button>
        </header>
        <div className={s.seg} role="tablist">
          {(['scene', 'cameras', 'layers'] as const).map((k) => (
            <button key={k} type="button" role="tab" aria-selected={st.left === k} className={st.left === k ? s.segOn : undefined} onClick={() => st.set({ left: k })}>{t.scene.tabs[k]}</button>
          ))}
        </div>
        {st.left === 'cameras' && (
          <>
            <ul className={s.cams}>
              {st.doc.cameras.map((c) => (
                <li key={c.id} className={c.id === cam.id ? s.camOn : undefined}>
                  <button type="button" className={s.camBtn} aria-pressed={c.id === cam.id} onClick={() => st.set({ camera: c.id })}>
                    <img src={c.thumb} alt="" draggable={false} />
                    <span>
                      <b>{c.name}</b>
                      <small>{t.camKinds[c.kind] ?? c.kind}</small>
                      <small>{c.aspect} &nbsp; {c.w} × {c.h}</small>
                    </span>
                  </button>
                  <CamMenu label={c.name} items={[
                    { label: t.scene.queue, onSelect: () => queue([c.id]) },
                    { label: t.scene.duplicate, onSelect: () => addCamera(c.id) },
                    { label: t.scene.remove, danger: true, onSelect: () => { if (st.doc.cameras.length > 1) { st.edit(`Delete ${c.name}`, (d) => ({ ...d, cameras: d.cameras.filter((x) => x.id !== c.id) })); if (c.id === st.camera) st.set({ camera: st.doc.cameras[0].id }) } } },
                  ]} />
                </li>
              ))}
            </ul>
            <button type="button" className={s.addCam} onClick={() => addCamera()}><Plus size={15} strokeWidth={1.8} />{t.scene.add}</button>
          </>
        )}
        {st.left === 'scene' && (
          <dl className={s.info}>
            {[[t.sceneInfo.project, 'Villa Riverside'], [t.sceneInfo.model, 'Villa_Riverside.ifc'], [t.sceneInfo.objects, '1 284'], [t.sceneInfo.lights, '1 sun + 24 IES'], [t.sceneInfo.materials, '42']].map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
            <p>{t.sceneInfo.note}</p>
          </dl>
        )}
        {st.left === 'layers' && (
          <ul className={s.layers}>
            {(Object.keys(t.layers) as (keyof typeof t.layers)[]).map((k) => (
              <li key={k}><label><input type="checkbox" checked={st.layers[k] !== false} onChange={() => st.set({ layers: { ...st.layers, [k]: !(st.layers[k] !== false) } })} />{t.layers[k]}</label></li>
            ))}
          </ul>
        )}
      </section>

      <section className={`${w.card} ${s.assets}`} aria-label={t.assets.title}>
        <header className={s.head}>
          <h2>{t.assets.title}</h2>
          <button type="button" className={w.iconBtn} aria-label={t.scene.collapse} onClick={() => native(t.scene.collapse)}><ChevronsLeft size={17} strokeWidth={1.8} /></button>
        </header>
        <label className={w.search}>
          <Search size={14} strokeWidth={1.8} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.assets.search} aria-label={t.assets.search} />
        </label>
        <div className={s.atabs} role="tablist">
          {(['materials', 'models', 'plants', 'people'] as AssetTab[]).map((k) => (
            <button key={k} type="button" role="tab" aria-selected={st.assets === k} className={st.assets === k ? s.atabOn : undefined} onClick={() => st.set({ assets: k })}>{t.assets.tabs[k]}</button>
          ))}
        </div>
        {st.assets === 'materials' ? (
          <ul className={s.mats}>
            {filteredMats.map((m) => (
              <li key={m}><button type="button" onClick={() => toast(fmt(t.assets.applied, { name: t.mats[m] }))}><img src={`/assets/v2/renders/mat-${m}.png`} alt="" draggable={false} /><span>{t.mats[m]}</span></button></li>
            ))}
          </ul>
        ) : (
          <div className={s.goLib}><p>{t.assets.components}</p><button type="button" className={w.link} onClick={() => navigate('components')}>{t.assets.open}</button></div>
        )}
      </section>

      {/* ---------- centre: preview ---------- */}
      <section className={`${w.card} ${s.view}`} aria-label={t.viewer.label}>
        <header className={s.vhead}>
          <Select label={t.viewer.camera} value={cam.id} onChange={(v) => st.set({ camera: v })} options={st.doc.cameras.map((c) => ({ value: c.id, label: `${c.name} - ${t.camKinds[c.kind] ?? c.kind}` }))} className={s.camSel} />
          <span className={s.camIcon}><CameraIcon size={16} strokeWidth={1.7} /></span>
          <ToolStrip style={{ position: 'static', boxShadow: 'none', background: 'transparent' }} items={[
            { ...tool(t.viewer.orbit, <RefreshCcw size={17} strokeWidth={1.7} />), on: true },
            tool(t.viewer.pan, <Hand size={17} strokeWidth={1.7} />),
            tool(t.viewer.zoomOut, <ZoomOut size={17} strokeWidth={1.7} />),
            tool(t.viewer.zoomIn, <ZoomIn size={17} strokeWidth={1.7} />),
            tool(t.viewer.fit, <Expand size={16} strokeWidth={1.7} />),
            tool(t.viewer.frame, <Maximize size={16} strokeWidth={1.7} />),
            tool(t.viewer.remove, <Trash2 size={16} strokeWidth={1.7} />),
          ]} />
          <Select label={t.viewer.projection.perspective} value={st.projection} onChange={(v) => st.set({ projection: v })} options={(['perspective', 'orthographic', 'two-point'] as const).map((k) => ({ value: k, label: t.viewer.projection[k] }))} className={s.projSel} />
        </header>
        <div className={`${s.stage} ${w[`m_${st.mode === 'rendered' ? 'realistic' : st.mode}`] ?? ''}`}>
          <svg width="0" height="0" className={w.defs} aria-hidden="true">
            <filter id="wsWire"><feColorMatrix type="saturate" values="0" /><feConvolveMatrix order="3" kernelMatrix="-1 -1 -1 -1 8 -1 -1 -1 -1" preserveAlpha="true" /><feComponentTransfer><feFuncR type="linear" slope="-3" intercept="1" /><feFuncG type="linear" slope="-3" intercept="1" /><feFuncB type="linear" slope="-3" intercept="1" /></feComponentTransfer></filter>
          </svg>
          <img className={`${w.vpImg} ${lowRes ? s.lowRes : ''}`} src={img} alt={`${cam.name} (DEMO)`} draggable={false} style={st.mode === 'rendered' ? { filter: fxFilter(st.doc.fx) } : undefined} />
          {st.mode === 'rendered' && st.doc.fx.vignette > 0 && <div className={s.vignette} style={{ opacity: st.doc.fx.vignette / 100 }} />}
          <span className={w.demoBadge} style={{ left: 10, top: 10 }}>{t.viewer.demo}</span>
          <ToolStrip vertical style={{ right: 8, top: 12 }} items={[
            tool(t.viewer.target, <Crosshair size={16} strokeWidth={1.6} />),
            tool(t.viewer.region, <ScanSearch size={16} strokeWidth={1.6} />),
            tool(t.viewer.frame, <Focus size={16} strokeWidth={1.6} />),
            tool(t.viewer.zoomIn, <ZoomIn size={16} strokeWidth={1.6} />),
            tool(t.viewer.box, <Box size={16} strokeWidth={1.6} />),
          ]} />
          <Modes label={t.viewer.modeLabel} style={{ left: 8, bottom: 3 }} value={st.mode} onChange={(m) => st.set({ mode: m })} items={MODES.map((m) => ({ ...m, label: t.viewer.modes[m.key] }))} />
          <div className={s.qbar}>
            <Select label={t.viewer.quality.high} value={st.preview} onChange={(v) => st.set({ preview: v })} options={(['high', 'medium', 'draft'] as const).map((k) => ({ value: k, label: t.viewer.quality[k] }))} className={s.qSel} />
            <button type="button" className={w.tbtn} aria-label={t.viewer.full} title={t.viewer.full} onClick={() => document.querySelector(`.${s.stage}`)?.requestFullscreen?.()}><Maximize size={16} strokeWidth={1.7} /></button>
          </div>
        </div>
      </section>

      {/* ---------- variations ---------- */}
      <section className={`${w.card} ${s.vars}`} aria-label={fmt(t.variations.title, { n: VARIATIONS.length })}>
        <header className={s.vheadRow}>
          <b>{fmt(t.variations.title, { n: VARIATIONS.length })}</b>
          <button type="button" className={s.aiVar} onClick={() => native(t.variations.ai)}>{t.variations.ai}</button>
          <button type="button" className={w.link} onClick={() => native(t.variations.viewAll)}>{t.variations.viewAll}</button>
        </header>
        <ul className={s.varList}>
          {VARIATIONS.map((v) => (
            <li key={v.key}>
              <button type="button" className={st.variation === v.key ? s.varOn : undefined} aria-pressed={st.variation === v.key} onClick={() => {
                st.edit(`${t.variations.names[v.key]}`, (d) => ({ ...d, settings: { ...d.settings, ...v.patch } }))
                st.set({ variation: v.key, camera: 'cam1' })
                toast(fmt(t.variations.applied, { name: t.variations.names[v.key] }))
              }}>
                <img src={v.img} alt="" draggable={false} />
                <span>{t.variations.names[v.key]}</span>
              </button>
            </li>
          ))}
          <li><button type="button" className={s.gen} onClick={() => native(t.variations.generate)}><Plus size={22} strokeWidth={1.5} /><span>{t.variations.generate}</span></button></li>
        </ul>
      </section>

      {/* ---------- queue ---------- */}
      <section className={`${w.card} ${s.queue}`} aria-label={fmt(t.queue.title, { n: st.doc.queue.length })}>
        <div className={s.qtabs} role="tablist">
          <button type="button" role="tab" aria-selected={st.bottom === 'queue'} className={st.bottom === 'queue' ? s.qtabOn : undefined} onClick={() => st.set({ bottom: 'queue' })}>{fmt(t.queue.title, { n: st.doc.queue.length })}</button>
          <button type="button" role="tab" aria-selected={st.bottom === 'history'} className={st.bottom === 'history' ? s.qtabOn : undefined} onClick={() => st.set({ bottom: 'history' })}>{fmt(t.queue.history, { n: 0 })}</button>
          <button type="button" className={w.link} onClick={() => toast(t.toast.cleared)}>{t.queue.clear}</button>
        </div>
        {st.bottom === 'queue' ? (
          <div className={s.qtable} role="table" aria-label={t.queue.title.replace(' ({n})', '')}>
            <div className={s.qrow} role="row">
              {[t.queue.n, t.queue.camera, t.queue.settings, t.queue.output, t.queue.status, t.queue.progress, t.queue.actions].map((h) => <span key={h} role="columnheader">{h}</span>)}
            </div>
            {st.doc.queue.map((j, i) => (
              <div key={j.id} className={s.qrow} role="row">
                <span role="cell">{i + 1}</span>
                <span role="cell">{j.camera}</span>
                <span role="cell">{j.settings}</span>
                <span role="cell">{j.output}</span>
                <span role="cell" className={s.waiting}><i />{t.queue.waiting}</span>
                <span role="cell" className={s.prog}><i><b style={{ width: '0%' }} /></i>0%</span>
                <span role="cell" className={s.acts}>
                  <button type="button" aria-label={t.queue.start} title={t.queue.start} onClick={() => native(t.queue.start)}><Play size={15} strokeWidth={1.8} /></button>
                  <button type="button" aria-label={t.queue.remove} title={t.queue.remove} onClick={() => st.edit(`${t.queue.remove} ${j.camera}`, (d) => ({ ...d, queue: d.queue.filter((x) => x.id !== j.id) }))}><Trash2 size={14} strokeWidth={1.7} /></button>
                </span>
              </div>
            ))}
            {st.doc.queue.length === 0 && <p className={s.empty}>{t.queue.empty}</p>}
          </div>
        ) : (
          <p className={s.empty}>{t.queue.noHistory}</p>
        )}
      </section>

      {/* ---------- right ---------- */}
      <div className={s.right}>
        <RenderSettingsPanel onRender={() => queue([cam.id])} onRenderAll={() => queue(st.doc.cameras.map((c) => c.id))} />
      </div>
    </div>
  )
}

function CamMenu({ label, items }: { label: string; items: { label: string; onSelect: () => void; danger?: boolean }[] }) {
  const [open, setOpen, ref] = useDismissable<HTMLDivElement>()
  return (
    <div className={w.anchor} ref={ref}>
      <button type="button" className={s.dots} aria-label={`${label} …`} aria-expanded={open} onClick={() => setOpen(!open)}><Ellipsis size={17} strokeWidth={2} /></button>
      {open && <PopoverPanel width={200}><MenuList onClose={() => setOpen(false)} items={items} /></PopoverPanel>}
    </div>
  )
}
