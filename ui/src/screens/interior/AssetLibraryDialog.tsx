import { useEffect, useMemo, useRef, useState } from 'react'
import { Box, Download, FolderOpen, Image as ImageIcon, Plus, Trash2, Upload } from 'lucide-react'
import { fmt, useLang, useT } from '../../i18n'
import { toast } from '../../state/toast'
import { useHost, type HostApi } from '../../services/host'
import { useInterior } from '../../state/interior'
import { Modal } from '../../components/ui/Modal'
import { NativeScene, type SceneCtl } from '../../components/workspace/NativeScene'
import { hex, type Scene } from '../../engine3d/scene'
import { LIB_CATEGORIES, composedDims, useAssetLibrary, type ComposedPart, type LibAsset, type LibCategory } from '../../library/assets'
import { catalogue, downloadAsset, downloadStarter, ensureLibrary, loadThumbs, onLibraryEvent, refreshLibrary, starterList, type LibraryEvent } from '../../library/assetService'
import { PRESETS, composedPrims, presetAssets, validateParts } from '../../library/composer'
import { STARTER_HDRIS, STARTER_MATERIALS, STARTER_MODELS, searchCatalogue } from '../../library/polyhaven'
import { assignLib, assetDims, placeLibAsset, replaceWithLib } from '../../library/libraryEdits'
import { MATERIALS } from '../../interior/model'
import { cabinetPartsTagged, furnitureParts } from '../../interior/scene'
import { partMaterial } from '../../interior/materials'
import { commit } from './spaceKit'
import s from './AssetLibrary.module.css'

type Tab = 'browse' | 'import' | 'online' | 'compose' | 'share'
const mb = (b = 0) => (b >= 1e9 ? `${(b / 1e9).toFixed(2)} GB` : `${Math.max(0, b / 1e6).toFixed(b < 1e7 ? 1 : 0)} MB`)

/**
 * The 3D asset library (v2.4): browse / search / filter the built-in, downloaded and user pieces and place them in the
 * Interior plan; add pieces from files (Blender converts them), download from Poly Haven (CC0, explicit action only),
 * compose pieces from parts ("Tự vẽ"), export / import the user's own pieces. A dialog — no screen layout changes.
 */
export function AssetLibraryDialog({ onClose, initialTab = 'browse' }: { onClose: () => void; initialTab?: Tab }) {
  const T = useT()
  const t = T.assetLib
  const host = useHost()
  const [tab, setTab] = useState<Tab>(initialTab)
  const { dir, bytes, loaded } = useAssetLibrary()
  useEffect(() => {
    if (host) void ensureLibrary(host)
  }, [host])
  const tabs: Tab[] = ['browse', 'import', 'online', 'compose', 'share']
  return (
    <Modal title={t.title} onClose={onClose} width={980}>
      <div className={s.wrap} data-testid="asset-library">
        <div className={s.tabs} role="tablist" aria-label={t.title}>
          {tabs.map((k) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? s.on : undefined} onClick={() => setTab(k)} data-testid={`assetlib-tab-${k}`}>
              {t.tabs[k]}
            </button>
          ))}
        </div>
        <div className={s.body}>
          {tab === 'browse' && <Browse host={host} />}
          {tab === 'import' && <ImportFile host={host} onSaved={() => setTab('browse')} />}
          {tab === 'online' && <Online host={host} />}
          {tab === 'compose' && <Compose host={host} onSaved={() => setTab('browse')} />}
          {tab === 'share' && <Share host={host} />}
        </div>
        <div className={s.foot}>
          {host && loaded ? (
            <>
              <span data-testid="assetlib-folder">{fmt(t.folder, { dir, size: mb(bytes) })}</span>
              <button type="button" className={s.btn} onClick={() => void host.libraryReveal()}><FolderOpen size={13} /> {t.reveal}</button>
            </>
          ) : (
            <span>{host ? '…' : t.desktopOnly}</span>
          )}
        </div>
      </div>
    </Modal>
  )
}

/* ---------------- browse ---------------- */

function Browse({ host }: { host: HostApi | null }) {
  const T = useT()
  const t = T.assetLib
  const lang = useLang()
  const { assets, thumbs } = useAssetLibrary()
  const { doc, room, sel, set } = useInterior()
  const [q, setQ] = useState('')
  const [kind, setKind] = useState<'all' | 'model' | 'material' | 'hdri'>('model')
  const [cat, setCat] = useState<LibCategory | 'all'>('all')
  const [origin, setOrigin] = useState<string>('all')
  const [editing, setEditing] = useState<LibAsset | null>(null)
  const all = useMemo(() => [...assets, ...presetAssets()], [assets])
  const list = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    return all.filter((a) => (kind === 'all' || a.kind === kind) && (cat === 'all' || a.category === cat) && (origin === 'all' || a.origin === origin) && words.every((w) => `${a.id} ${a.name} ${a.nameVi} ${a.category ?? ''} ${a.tags.join(' ')} ${t.cats[a.category ?? ''] ?? ''}`.toLowerCase().includes(w)))
  }, [all, q, kind, cat, origin, t])
  const shown = list.slice(0, 120)
  useEffect(() => {
    if (host) void loadThumbs(host, shown.filter((a) => a.thumb).map((a) => a.id))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host, shown.map((a) => a.id).join(',')])
  const roomName = (id: string) => {
    const r = doc.rooms.find((x) => x.id === id)
    return r ? T.interior.roomNames[r.name] ?? r.name : id
  }
  const selItem = sel?.kind === 'item' ? doc.items.find((i) => i.id === sel.id) : undefined
  const nm = (a: LibAsset) => (lang === 'vi' ? a.nameVi : a.name)
  const place = (a: LibAsset) => {
    const r = placeLibAsset(useInterior.getState().doc, a, room)
    if (!commit(`Place ${a.name}`, r)) return
    set({ sel: { kind: 'item', id: r.id! }, inst: 0, right: 'properties' })
    const d = assetDims(a)
    toast(fmt(t.placed, { name: nm(a), room: roomName(room), dims: fmt(t.size, { ...d }) }), 'success')
  }
  const replace = (a: LibAsset) => {
    if (!selItem) return toast(t.noSelection, 'warning')
    if (commit(`Replace ${selItem.name}`, replaceWithLib(useInterior.getState().doc, selItem.id, a))) toast(fmt(t.replaced, { item: selItem.name, name: nm(a) }), 'success')
  }
  const assign = (a: LibAsset) => {
    if (!selItem) return toast(t.noSelection, 'warning')
    if (commit(`Render model ${selItem.name}`, assignLib(useInterior.getState().doc, selItem.id, a))) toast(fmt(t.assigned, { item: selItem.name, name: nm(a) }), 'success')
  }
  const remove = async (a: LibAsset) => {
    if (!host || !window.confirm(fmt(t.removeConfirm, { name: nm(a) }))) return
    await host.libraryRemove(a.id)
    await refreshLibrary(host)
    toast(fmt(t.removed, { name: nm(a) }))
  }
  return (
    <>
      <div className={s.row}>
        <input className={s.search} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.search} aria-label={t.search} data-testid="assetlib-search" />
        <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} aria-label={t.kinds.all}>
          {(['all', 'model', 'material', 'hdri'] as const).map((k) => <option key={k} value={k}>{t.kinds[k]}</option>)}
        </select>
        <select value={cat} onChange={(e) => setCat(e.target.value as LibCategory | 'all')} aria-label={t.allCats} data-testid="assetlib-cat">
          <option value="all">{t.allCats}</option>
          {LIB_CATEGORIES.map((c) => <option key={c} value={c}>{t.cats[c]}</option>)}
        </select>
        <select value={origin} onChange={(e) => setOrigin(e.target.value)} aria-label={t.origins.all}>
          {(['all', 'builtin-download', 'user-import', 'user-drawn', 'builtin-preset'] as const).map((k) => <option key={k} value={k}>{t.origins[k]}</option>)}
        </select>
        <small className={s.muted}>{fmt(t.count, { n: list.length })}</small>
      </div>
      <div className={s.row}>
        <small className={s.muted}>{fmt(t.room, { room: roomName(room) })} · {selItem ? fmt(t.selected, { name: selItem.name }) : t.noSelection}</small>
      </div>
      {!host && <p className={s.note}>{t.desktopOnly}</p>}
      <p className={s.note}>{t.presentation}</p>
      <div className={s.grid} data-testid="assetlib-grid">
        {shown.map((a) => {
          const d = a.kind === 'model' ? assetDims(a) : null
          const thumb = thumbs[a.id]
          const user = a.origin === 'user-import' || a.origin === 'user-drawn'
          return (
            <div key={a.id} className={`${s.card} ${selItem?.asset === a.id ? s.sel : ''}`} data-asset={a.id}>
              {thumb ? <img className={s.thumb} src={thumb} alt={nm(a)} /> : <div className={s.thumb}>{a.kind === 'model' ? <Box size={28} strokeWidth={1.2} /> : <ImageIcon size={28} strokeWidth={1.2} />}</div>}
              <b>{nm(a)}</b>
              <small>{a.category ? t.cats[a.category] : t.kinds[a.kind]}{d ? ` · ${fmt(t.size, { ...d })}` : a.sizeMm ? ` · ${a.sizeMm[0]} × ${a.sizeMm[1]} mm` : ''}</small>
              <small>{fmt(t.source, { site: a.source.site || '—', author: a.source.author ? ` — ${a.source.author}` : '' })} · {fmt(t.licence, { licence: a.license || '—' })}</small>
              {a.kind === 'model' && (
                <div className={s.actions}>
                  <button type="button" onClick={() => place(a)} data-testid="assetlib-place">{t.place}</button>
                  <button type="button" onClick={() => replace(a)} disabled={!selItem}>{t.replace}</button>
                  <button type="button" onClick={() => assign(a)} disabled={!selItem}>{t.assign}</button>
                  {host && user && <button type="button" onClick={() => setEditing(a)}>{t.edit}</button>}
                  {host && a.origin !== 'builtin-preset' && <button type="button" onClick={() => void remove(a)} aria-label={`${t.remove} ${nm(a)}`}><Trash2 size={12} /></button>}
                </div>
              )}
              {a.kind !== 'model' && host && a.origin !== 'builtin-preset' && (
                <div className={s.actions}>
                  <button type="button" onClick={() => void remove(a)} aria-label={`${t.remove} ${nm(a)}`}><Trash2 size={12} /></button>
                </div>
              )}
            </div>
          )
        })}
        {!shown.length && <p className={s.note}>{t.empty}</p>}
      </div>
      {editing && host && <EditAsset host={host} a={editing} onClose={() => setEditing(null)} />}
    </>
  )
}

/** Edit a user piece: names, category, real size, licence. */
function EditAsset({ host, a, onClose }: { host: HostApi; a: LibAsset; onClose: () => void }) {
  const t = useT().assetLib
  const [v, setV] = useState({ name: a.name, nameVi: a.nameVi, category: a.category ?? 'decor', license: a.license, ...(a.dims ?? { w: 500, d: 500, h: 500 }) })
  const save = async () => {
    if (!v.license.trim()) return toast(t.import.needLicence, 'warning')
    const entry: LibAsset = { ...a, name: v.name, nameVi: v.nameVi, category: v.category as LibCategory, license: v.license, ...(a.files.main ? { dims: { w: +v.w, d: +v.d, h: +v.h } } : {}) }
    const r = await host.libraryPut(JSON.stringify(entry), '')
    if (!r.ok) return toast(r.error ?? 'error', 'warning')
    await refreshLibrary(host)
    onClose()
  }
  return (
    <Modal title={fmt(t.editor.title, { name: a.nameVi })} onClose={onClose} width={520} footer={<button type="button" className={`${s.btn} ${s.primary}`} onClick={() => void save()}>{t.editor.save}</button>}>
      <div className={s.form}>
        <label>{t.import.name}</label><input value={v.nameVi} onChange={(e) => setV({ ...v, nameVi: e.target.value })} />
        <label>{t.import.nameEn}</label><input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
        <label>{t.import.category}</label>
        <select value={v.category} onChange={(e) => setV({ ...v, category: e.target.value as LibCategory })}>{LIB_CATEGORIES.map((c) => <option key={c} value={c}>{t.cats[c]}</option>)}</select>
        {a.files.main && (
          <>
            <label>W × D × H (mm)</label>
            <div className={s.dims}>{(['w', 'd', 'h'] as const).map((k) => <input key={k} type="number" min={1} value={v[k]} onChange={(e) => setV({ ...v, [k]: +e.target.value })} aria-label={k.toUpperCase()} />)}</div>
          </>
        )}
        <label>{t.import.licence}</label><textarea value={v.license} onChange={(e) => setV({ ...v, license: e.target.value })} />
      </div>
    </Modal>
  )
}

/* ---------------- add from file ---------------- */

interface ImportResult extends LibraryEvent {
  dims?: { w: number; d: number; h: number }
  unit?: string
  tris?: number
  materials?: number
  dir?: string
  file?: string
  srcName?: string
  thumbUrl?: string
}

function ImportFile({ host, onSaved }: { host: HostApi | null; onSaved: () => void }) {
  const t = useT().assetLib
  const [busy, setBusy] = useState<string | null>(null)
  const [res, setRes] = useState<ImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [f, setF] = useState({ nameVi: '', name: '', category: 'decor' as LibCategory, w: 0, d: 0, h: 0, material: '', license: '', url: '' })
  const pending = useRef<string | null>(null)
  useEffect(
    () =>
      onLibraryEvent((e) => {
        if (e.type !== 'import' || e.id !== pending.current) return
        pending.current = null
        setBusy(null)
        if (!e.ok) return setError(fmt(t.import.failed, { why: String(e.error ?? '') }))
        const r = e as ImportResult
        setRes(r)
        const base = (r.srcName ?? '').replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ')
        setF((x) => ({ ...x, nameVi: base, name: base, w: r.dims?.w ?? 0, d: r.dims?.d ?? 0, h: r.dims?.h ?? 0 }))
      }),
    [t],
  )
  if (!host) return <p className={s.note}>{t.desktopOnly}</p>
  const pick = async () => {
    setError(null)
    setRes(null)
    const r = await host.libraryImport('')
    if (r.cancelled) return
    if (!r.ok) return setError(r.code === 'blender-not-found' ? t.import.noBlender : fmt(t.import.failed, { why: r.error ?? '' }))
    pending.current = r.id ?? null
    setBusy(r.id ?? '')
  }
  const discard = async () => {
    if (res?.id) await host.libraryRemove(res.id)
    setRes(null)
  }
  const save = async () => {
    if (!res?.id || !res.dir) return
    if (!f.license.trim()) return toast(t.import.needLicence, 'warning')
    if (!(f.w > 0 && f.d > 0 && f.h > 0)) return toast(t.import.needSize, 'warning')
    const entry: LibAsset = {
      id: res.id, kind: 'model', name: f.name || f.nameVi, nameVi: f.nameVi || f.name, category: f.category, tags: ['user'], dims: { w: f.w, d: f.d, h: f.h },
      files: { main: res.file ?? 'model.glb' }, dir: res.dir, ...(res.thumbUrl ? { thumb: 'thumb.png' } : {}), source: { site: f.url ? new URL(f.url, 'https://x').hostname : res.srcName ?? '', ...(f.url ? { url: f.url } : {}) },
      license: f.license.trim(), addedAt: Date.now(), origin: 'user-import', ...(f.material ? { material: f.material } : {}),
    }
    const r = await host.libraryPut(JSON.stringify(entry), '')
    if (!r.ok) return toast(r.error ?? 'error', 'warning')
    await refreshLibrary(host)
    toast(fmt(t.import.saved, { name: entry.nameVi }), 'success')
    setRes(null)
    onSaved()
  }
  return (
    <>
      <div className={s.panel}>
        <div className={s.row}>
          <button type="button" className={`${s.btn} ${s.primary}`} onClick={() => void pick()} disabled={busy !== null} data-testid="assetlib-import-pick"><Upload size={13} /> {t.import.pick}</button>
          {busy !== null && <span className={s.muted}>{fmt(t.import.working, { file: '…' })}</span>}
        </div>
        <p className={s.note}>{t.import.formats}</p>
        {error && <p className={s.err} data-testid="assetlib-import-error">{error}</p>}
      </div>
      {res && (
        <div className={s.panel} data-testid="assetlib-import-form">
          <div className={s.row} style={{ alignItems: 'flex-start' }}>
            {res.thumbUrl ? <img className={s.importThumb} src={res.thumbUrl} alt={res.srcName} /> : <div className={`${s.importThumb} ${s.thumb}`}><Box size={40} /></div>}
            <div style={{ flex: 1, display: 'grid', gap: 6 }}>
              <b>{res.srcName}</b>
              <small className={s.muted}>{fmt(t.import.detected, { w: res.dims?.w ?? 0, d: res.dims?.d ?? 0, h: res.dims?.h ?? 0, unit: res.unit ?? '?', tris: res.tris ?? 0, materials: res.materials ?? 0 })}</small>
              <div className={s.form}>
                <label>{t.import.confirmSize}</label>
                <div className={s.dims}>{(['w', 'd', 'h'] as const).map((k) => <input key={k} type="number" min={1} value={f[k]} onChange={(e) => setF({ ...f, [k]: +e.target.value })} aria-label={k.toUpperCase()} data-testid={`assetlib-import-${k}`} />)}<span>mm</span></div>
                <label>{t.import.name}</label><input value={f.nameVi} onChange={(e) => setF({ ...f, nameVi: e.target.value })} data-testid="assetlib-import-name" />
                <label>{t.import.nameEn}</label><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
                <label>{t.import.category}</label>
                <select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value as LibCategory })} data-testid="assetlib-import-cat">{LIB_CATEGORIES.map((c) => <option key={c} value={c}>{t.cats[c]}</option>)}</select>
                <label>{t.import.finish}</label>
                <select value={f.material} onChange={(e) => setF({ ...f, material: e.target.value })}>
                  <option value="">{t.import.keepModel}</option>
                  {MATERIALS.filter((m) => m.kind !== 'board').map((m) => <option key={m.name} value={m.name}>{m.name}</option>)}
                </select>
                <label>{t.import.licence}</label>
                <textarea value={f.license} onChange={(e) => setF({ ...f, license: e.target.value })} placeholder={t.import.licenceHint} data-testid="assetlib-import-licence" />
                <label>{t.import.url}</label><input value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} />
              </div>
              <p className={s.warn}>{t.import.licenceNote}</p>
              <div className={s.row}>
                <button type="button" className={`${s.btn} ${s.primary}`} onClick={() => void save()} data-testid="assetlib-import-save">{t.import.save}</button>
                <button type="button" className={s.btn} onClick={() => void discard()}>{t.import.cancel}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

/* ---------------- download (Poly Haven) ---------------- */

function Online({ host }: { host: HostApi | null }) {
  const t = useT().assetLib
  const { assets, progress } = useAssetLibrary()
  const [type, setType] = useState<'models' | 'textures' | 'hdris'>('models')
  const [q, setQ] = useState('')
  const [results, setResults] = useState<{ id: string; info: { name?: string; category?: string; dimensions?: number[] } }[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [probing, setProbing] = useState(false)
  useEffect(() => onLibraryEvent((e) => e.type === 'probe' && setProbing(!e.done)), [])
  if (!host) return <p className={s.note}>{t.desktopOnly}</p>
  const missing = starterList(assets).length
  const running = !!progress && !progress.done
  const pct = progress?.total ? Math.min(100, Math.floor(((progress.received ?? 0) / progress.total) * 100)) : progress?.phase === 'plan' && progress.assets ? Math.floor(((progress.index ?? 0) / progress.assets) * 100) : 0
  const line = !progress
    ? ''
    : progress.phase === 'plan'
      ? fmt(t.online.planning, { i: progress.index ?? 0, n: progress.assets ?? 0 })
      : progress.done
        ? progress.cancelled ? t.online.paused : fmt(t.online.finished, { n: progress.added ?? 0 }) + (progress.failed?.length ? ' · ' + fmt(t.online.failed, { list: progress.failed.join(', ') }) : '')
        : fmt(t.online.downloading, { got: mb(progress.received), total: mb(progress.total), i: progress.index ?? 0, n: progress.assets ?? 0, speed: mb(progress.bytesPerSecond) })
  const search = async () => {
    setErr(null)
    try {
      setResults(searchCatalogue(await catalogue(host, type), q))
    } catch (e) {
      setErr(fmt(t.online.noNet, { why: String((e as Error).message ?? e) }))
    }
  }
  const have = new Set(assets.map((a) => a.id))
  return (
    <>
      <div className={s.panel} data-testid="assetlib-starter">
        <h3>{t.online.starterTitle}</h3>
        <p className={s.note}>{fmt(t.online.starterText, { models: STARTER_MODELS.length, materials: STARTER_MATERIALS.length, hdris: STARTER_HDRIS.length })}</p>
        <div className={s.row}>
          {running ? (
            <button type="button" className={s.btn} onClick={() => void host.libraryCancel()}>{t.online.cancel}</button>
          ) : (
            <button type="button" className={`${s.btn} ${s.primary}`} disabled={!missing} onClick={() => void downloadStarter(host).then((r) => { if (r && !r.ok && 'error' in r && r.error) toast(String(r.error), 'warning') })} data-testid="assetlib-starter-download">
              <Download size={13} /> {missing ? t.online.starterButton : t.online.starterDone}
            </button>
          )}
          <small className={s.muted}>{missing ? fmt(t.online.starterMissing, { n: missing }) : ''}</small>
        </div>
        {progress && (
          <>
            {running && <div className={s.bar}><span style={{ width: `${pct}%` }} /></div>}
            <small className={progress.done && progress.failed?.length ? s.warn : s.muted} data-testid="assetlib-progress">{line}</small>
          </>
        )}
        {probing && <small className={s.muted}>{t.online.probing}</small>}
      </div>
      <div className={s.panel}>
        <h3>{t.online.searchTitle}</h3>
        <p className={s.note}>{t.online.searchText}</p>
        <div className={s.row}>
          <select value={type} onChange={(e) => { setType(e.target.value as typeof type); setResults(null) }}>{(['models', 'textures', 'hdris'] as const).map((k) => <option key={k} value={k}>{t.online.types[k]}</option>)}</select>
          <input className={s.search} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.online.query} onKeyDown={(e) => e.key === 'Enter' && void search()} />
          <button type="button" className={s.btn} onClick={() => void search()}>{t.online.find}</button>
        </div>
        {err && <p className={s.err}>{err}</p>}
        {results && (
          <>
            <small className={s.muted}>{fmt(t.online.results, { n: results.length })}</small>
            <ul className={s.list}>
              {results.map((r) => (
                <li key={r.id}>
                  <span><b>{r.info.name ?? r.id}</b> <small className={s.muted}>{r.info.category ?? ''}{r.info.dimensions ? ` · ${r.info.dimensions.slice(0, 3).map((v) => Math.round(v)).join(' × ')} mm` : ''}</small></span>
                  <small className={s.muted}>CC0</small>
                  {have.has(r.id) ? (
                    <small className={s.ok}>{t.online.have}</small>
                  ) : (
                    <button type="button" className={s.btn} disabled={running} onClick={() => { toast(fmt(t.online.started, { name: r.info.name ?? r.id })); void downloadAsset(host, type, r.id) }}>{t.online.get}</button>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </>
  )
}

/* ---------------- draw your own ---------------- */

const MAT_RGB = (m: string) => hex(MATERIALS.find((x) => x.name === m)?.color ?? '#c8c8c8')

/** Composed parts of an interior item as drawn (parametric furniture or cabinet panels), in its own frame. */
function partsOfItem(itemId: string): ComposedPart[] {
  const d = useInterior.getState().doc
  const i = d.items.find((x) => x.id === itemId)
  if (!i) return []
  const cab = i.cabinet ? d.cabinets.find((c) => c.id === i.cabinet) : undefined
  const room = d.rooms.find((r) => r.id === i.room)
  const tagged = cab ? cabinetPartsTagged(cab, { x: 0, y: 0, rot: 0 }) : furnitureParts(i, { x: 0, y: 0, rot: 0 }, room?.ceilingHeight ?? 3000)
  const out: ComposedPart[] = []
  for (const { part, prim } of tagged) {
    const material = partMaterial(i, part, cab).material
    const z = prim.o[2] - (i.category === 'lighting' ? (room?.ceilingHeight ?? 3000) - 900 : 0)
    if (prim.k === 'box') out.push({ shape: 'box', x: prim.o[0] + prim.s[0] / 2, y: prim.o[1] + prim.s[1] / 2, z: Math.max(0, z), w: prim.s[0], d: prim.s[1], h: prim.s[2], material, name: part })
    else if ((prim.k === 'cyl' || prim.k === 'cone') && (!prim.z || Math.abs(prim.z[2]) > 0.99)) out.push({ shape: 'cyl', x: prim.o[0], y: prim.o[1], z: Math.max(0, z), w: prim.s[0] * 2, d: prim.s[0] * 2, h: prim.k === 'cone' ? prim.s[2] : prim.s[1], material, name: part })
  }
  return out.map((p) => ({ ...p, x: Math.round(p.x), y: Math.round(p.y), z: Math.round(p.z), w: Math.round(p.w), d: Math.round(p.d), h: Math.round(p.h) }))
}

function Compose({ host, onSaved }: { host: HostApi | null; onSaved: () => void }) {
  const T = useT()
  const t = T.assetLib
  const lang = useLang()
  const { sel } = useInterior()
  const [preset, setPreset] = useState(PRESETS[0].key)
  const p0 = PRESETS[0]
  const [size, setSize] = useState({ ...p0.size })
  const [parts, setParts] = useState<ComposedPart[]>(() => p0.make(p0.size.w, p0.size.d, p0.size.h))
  const [name, setName] = useState(lang === 'vi' ? p0.vi : p0.en)
  const [category, setCategory] = useState<LibCategory>(p0.category)
  const ctl = useRef<SceneCtl | null>(null)
  const dims = composedDims(parts)
  const scene: Scene = useMemo(() => ({ items: parts.map((p, k) => ({ id: `p${k}`, rgb: MAT_RGB(p.material), parts: composedPrims([p], { x: 0, y: 0, rot: 0 }) })) }), [parts])
  const usePreset = () => {
    const p = PRESETS.find((x) => x.key === preset)!
    setParts(p.make(size.w, size.d, size.h))
    setName(lang === 'vi' ? p.vi : p.en)
    setCategory(p.category)
  }
  const fromItem = () => {
    const i = sel?.kind === 'item' ? sel.id : sel?.kind === 'cabinet' ? useInterior.getState().doc.items.find((x) => x.cabinet === sel.id)?.id : undefined
    const ps = i ? partsOfItem(i) : []
    if (!ps.length) return toast(t.compose.fromItemNone, 'warning')
    const it = useInterior.getState().doc.items.find((x) => x.id === i)!
    setParts(ps)
    setName(it.name)
  }
  const upd = (k: number, patch: Partial<ComposedPart>) => setParts(parts.map((p, j) => (j === k ? { ...p, ...patch } : p)))
  const save = async () => {
    if (validateParts(parts)) return toast(t.compose.invalid, 'warning')
    const id = `d-${Date.now().toString(36)}`
    const entry: LibAsset = {
      id, kind: 'model', name, nameVi: name, category, tags: ['drawn'], dims, files: {}, dir: `user/${id}`, source: { site: 'MD CAD AI STUDIO' }, license: t.compose.licence, addedAt: Date.now(), origin: 'user-drawn', parts,
    }
    if (!host) return toast(t.desktopOnly, 'warning')
    let thumb = ''
    try {
      const shot = await ctl.current?.snapshot(1)
      thumb = shot?.url ?? ''
    } catch {
      thumb = ''
    }
    const r = await host.libraryPut(JSON.stringify(entry), thumb)
    if (!r.ok) return toast(r.error ?? 'error', 'warning')
    await refreshLibrary(host)
    toast(fmt(t.compose.saved, { name }), 'success')
    onSaved()
  }
  return (
    <div className={s.compose} data-testid="assetlib-compose">
      <div style={{ display: 'grid', gap: 8 }}>
        <div className={s.row}>
          <label className={s.muted}>{t.compose.preset}</label>
          <select value={preset} onChange={(e) => { const p = PRESETS.find((x) => x.key === e.target.value)!; setPreset(p.key); setSize({ ...p.size }) }}>
            {PRESETS.map((p) => <option key={p.key} value={p.key}>{lang === 'vi' ? p.vi : p.en}</option>)}
          </select>
          {(['w', 'd', 'h'] as const).map((k) => <input key={k} type="number" min={1} style={{ width: 70 }} value={size[k]} onChange={(e) => setSize({ ...size, [k]: +e.target.value })} aria-label={k.toUpperCase()} />)}
          <button type="button" className={s.btn} onClick={usePreset}>{t.compose.make}</button>
          <button type="button" className={s.btn} onClick={fromItem}>{t.compose.fromItem}</button>
        </div>
        <b>{t.compose.parts}</b>
        <table className={s.parts}>
          <thead>
            <tr>{(['shape', 'x', 'y', 'z', 'w', 'd', 'h', 'r', 'material'] as const).map((c) => <th key={c}>{t.compose.cols[c]}</th>)}<th /></tr>
          </thead>
          <tbody>
            {parts.map((p, k) => (
              <tr key={k}>
                <td><select value={p.shape} onChange={(e) => upd(k, { shape: e.target.value as ComposedPart['shape'] })}>{(['box', 'rbox', 'cyl'] as const).map((x) => <option key={x} value={x}>{t.compose.shape[x]}</option>)}</select></td>
                {(['x', 'y', 'z', 'w', 'd', 'h'] as const).map((c) => <td key={c}><input type="number" value={p[c]} onChange={(e) => upd(k, { [c]: +e.target.value })} aria-label={c} /></td>)}
                <td><input type="number" value={p.r ?? 0} onChange={(e) => upd(k, { r: +e.target.value })} aria-label="r" disabled={p.shape !== 'rbox'} /></td>
                <td><select value={p.material} onChange={(e) => upd(k, { material: e.target.value })}>{MATERIALS.map((m) => <option key={m.name} value={m.name}>{m.name}</option>)}</select></td>
                <td><button type="button" className={s.btn} onClick={() => setParts(parts.filter((_, j) => j !== k))} aria-label={T.assetLib.remove}><Trash2 size={12} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className={s.row}>
          <button type="button" className={s.btn} onClick={() => setParts([...parts, { shape: 'box', x: 0, y: 0, z: 0, w: 400, d: 400, h: 400, material: 'Wood - Oak' }])}><Plus size={12} /> {t.compose.add}</button>
          <small className={s.muted}>{fmt(t.compose.size, { ...dims })}</small>
        </div>
        <div className={s.form}>
          <label>{t.compose.name}</label><input value={name} onChange={(e) => setName(e.target.value)} data-testid="assetlib-compose-name" />
          <label>{t.import.category}</label>
          <select value={category} onChange={(e) => setCategory(e.target.value as LibCategory)}>{LIB_CATEGORIES.map((c) => <option key={c} value={c}>{t.cats[c]}</option>)}</select>
        </div>
        <div className={s.row}>
          <button type="button" className={`${s.btn} ${s.primary}`} onClick={() => void save()} disabled={!host} data-testid="assetlib-compose-save">{t.compose.save}</button>
          {validateParts(parts) && <small className={s.err}>{t.compose.invalid}</small>}
        </div>
      </div>
      <div style={{ display: 'grid', gap: 6 }}>
        <small className={s.muted}>{host ? t.compose.preview : t.compose.previewBrowser}</small>
        <div className={s.preview}>
          {host ? <NativeScene host={host} sceneKey="asset-compose" scene={scene} mode="shaded" ctlRef={ctl} label={t.compose.preview} /> : <Schematic parts={parts} />}
        </div>
      </div>
    </div>
  )
}

/** Front (x–z) and top (x–y) views of composed parts (plain browser). */
function Schematic({ parts }: { parts: ComposedPart[] }) {
  const d = composedDims(parts)
  const W = Math.max(d.w, d.d, d.h, 1)
  const sc = 120 / W
  return (
    <svg width="300" height="240" viewBox="0 0 300 240" role="img">
      <g transform="translate(15 130)">
        {parts.map((p, k) => <rect key={k} x={(p.x - p.w / 2 + d.w / 2) * sc} y={-(p.z + p.h) * sc} width={p.w * sc} height={p.h * sc} fill={MATERIALS.find((m) => m.name === p.material)?.color ?? '#ccc'} stroke="#55606e" strokeWidth={0.6} rx={p.shape === 'rbox' ? Math.min(6, (p.r ?? 0) * sc) : p.shape === 'cyl' ? 3 : 0} />)}
      </g>
      <g transform="translate(160 40)">
        {parts.map((p, k) => <rect key={k} x={(p.x - p.w / 2 + d.w / 2) * sc} y={(-p.y - p.d / 2 + d.d / 2) * sc} width={p.w * sc} height={p.d * sc} fill="none" stroke="#55606e" strokeWidth={0.6} rx={p.shape === 'cyl' ? (p.w * sc) / 2 : 0} />)}
      </g>
    </svg>
  )
}

/* ---------------- export / import ---------------- */

function Share({ host }: { host: HostApi | null }) {
  const t = useT().assetLib
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  if (!host) return <p className={s.note}>{t.desktopOnly}</p>
  const exp = async () => {
    const r = await host.libraryExport()
    if (r.cancelled) return
    setMsg(r.ok ? { ok: true, text: fmt(t.share.exported, { n: r.items ?? 0, size: mb(r.bytes), path: r.path ?? '' }) } : { ok: false, text: fmt(t.share.failed, { why: r.error ?? '' }) })
  }
  const imp = async () => {
    const r = await host.libraryImportZip()
    if (r.cancelled) return
    await refreshLibrary(host)
    setMsg(r.ok ? { ok: true, text: fmt(t.share.imported, { n: r.items ?? 0 }) } : { ok: false, text: fmt(t.share.failed, { why: r.error ?? '' }) })
  }
  return (
    <div className={s.panel}>
      <p className={s.note}>{t.share.exportText}</p>
      <div className={s.row}>
        <button type="button" className={`${s.btn} ${s.primary}`} onClick={() => void exp()} data-testid="assetlib-export">{t.share.export}</button>
        <button type="button" className={s.btn} onClick={() => void imp()} data-testid="assetlib-importzip">{t.share.importZip}</button>
      </div>
      {msg && <p className={msg.ok ? s.ok : s.err} data-testid="assetlib-share-result">{msg.text}</p>}
    </div>
  )
}
