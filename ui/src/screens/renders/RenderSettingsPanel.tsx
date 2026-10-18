import { ChevronDown, ChevronRight, Ellipsis, Play, Sparkles, Wand2, Lightbulb, Paintbrush, Shapes } from 'lucide-react'
import type { ReactNode } from 'react'
import { fmt, useT } from '../../i18n'
import { toast } from '../../state/toast'
import { useRenders } from '../../state/renders'
import { PanelTabs, wsStyles as w } from '../../components/workspace/Workspace'
import { MenuList, PopoverPanel, useDismissable } from '../../components/ui/Popover'
import { MATERIAL_OPTIONS, renderMemoryBytes } from '../../renders/provenance'
import { DEFAULT_FX, ENGINES, isBlender, FORMATS, HDRIS, QUALITIES, QUALITY_PRESETS, RESOLUTIONS, dims, fileSizeMb, printCm, type PostFx, type RenderSettings } from '../../renders/model'
import s from './Renders.module.css'

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className={`${s.toggle} ${on ? s.toggleOn : ''}`} onClick={() => onChange(!on)}><i /></button>
}

function Slider({ value, min, max, step = 1, onChange, label, suffix = '', width = 42 }: { value: number; min: number; max: number; step?: number; onChange: (v: number) => void; label: string; suffix?: string; width?: number }) {
  return (
    <span className={s.slider}>
      <input type="range" min={min} max={max} step={step} value={value} aria-label={label} onChange={(e) => onChange(Number(e.target.value))} />
      <input className={s.num} style={{ width }} value={`${value}${suffix}`} aria-label={`${label} value`} onChange={(e) => {
        const v = Number(e.target.value.replace(/[^\d.-]/g, ''))
        if (Number.isFinite(v) && v >= min && v <= max) onChange(v)
      }} />
    </span>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return <div className={s.srow}><span>{label}</span><div>{children}</div></div>
}

function Sel<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <label className={s.sel}>
      <span>{options.find((o) => o.value === value)?.label ?? value}</span>
      <ChevronDown size={14} strokeWidth={1.8} />
      <select value={value} aria-label={label} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  )
}

export function RenderSettingsPanel({ onRender, onRenderAll, onRenderMaterials }: { onRender: () => void; onRenderAll: () => void; onRenderMaterials?: () => void }) {
  const T = useT()
  const t = T.renders
  const R = T.render24
  const c = t.settings
  const { doc, right, open, edit, set } = useRenders()
  const S = doc.settings
  const up = (label: string, patch: Partial<RenderSettings>) => {
    const err = edit(label, (d) => ({ ...d, settings: { ...d.settings, ...patch } }))
    if (err) toast(fmt(t.toast.invalid, { why: err }), 'warning')
  }
  const upFx = (patch: Partial<PostFx>) => edit(t.settings.tabs.post, (d) => ({ ...d, fx: { ...d.fx, ...patch } }))
  const sec = (key: string, title: string, body: ReactNode, icon?: ReactNode) => (
    <section className={s.sec}>
      <button type="button" className={s.secHead} aria-expanded={open[key] !== false} onClick={() => set({ open: { ...open, [key]: open[key] === false } })}>
        {icon}{title}<ChevronDown size={14} strokeWidth={1.8} className={open[key] === false ? s.flip : undefined} />
      </button>
      {open[key] !== false && body}
    </section>
  )
  const d = dims(S.resolution)
  const aspectName = d.w > d.h ? c.aspectLandscape : d.w === d.h ? c.aspectSquare : c.aspectPortrait
  const [renderMenu, setRenderMenu, renderRef] = useDismissable<HTMLDivElement>()
  const hdri = HDRIS.find((h) => h.name === S.hdri) ?? HDRIS[0]
  return (
    <section className={`${w.card} ${s.rcard}`} aria-label={c.tabs[right]}>
      <PanelTabs tabs={[{ key: 'settings', label: c.tabs.settings }, { key: 'post', label: c.tabs.post }]} active={right} onTab={(k) => set({ right: k })} widths={[122, 118]} />
      <div className={s.rbody}>
        {right === 'settings' ? (
          <>
            {sec('output', c.output, (
              <>
                <Row label={c.resolution}><Sel label={c.resolution} value={S.resolution} onChange={(v) => up(c.resolution, { resolution: v })} options={RESOLUTIONS.map((r) => ({ value: r.key, label: r.label }))} /></Row>
                <Row label={c.aspect}><Sel label={c.aspect} value={d.aspect} onChange={(v) => { const r = RESOLUTIONS.find((x) => dims(x.key).aspect === v); if (r) up(c.aspect, { resolution: r.key }) }} options={[...new Set(RESOLUTIONS.map((r) => dims(r.key).aspect))].map((a) => ({ value: a, label: `${a} (${a === d.aspect ? aspectName : a === '1:1' ? c.aspectSquare : a === '9:16' ? c.aspectPortrait : c.aspectLandscape})` }))} /></Row>
                <Row label={c.format}><Sel label={c.format} value={S.format} onChange={(v) => up(c.format, { format: v })} options={FORMATS.map((f) => ({ value: f.key, label: f.label }))} /></Row>
                <Row label={c.dpi}><input className={s.field} value={S.dpi} aria-label={c.dpi} onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) up(c.dpi, { dpi: v }) }} /></Row>
                <p className={s.est}>{c.estimate}: ≈ {fileSizeMb(S.resolution, S.format).toFixed(1)} MB · {d.mp.toFixed(1)} MP · {c.print}: {printCm(S.resolution, S.dpi).w.toFixed(1)} × {printCm(S.resolution, S.dpi).h.toFixed(1)} cm · {fmt(R.estimateMem, { gb: (renderMemoryBytes(d.w, d.h, isBlender(S) ? 'blender' : 'occt') / 1073741824).toFixed(1) })}</p>
              </>
            ))}
            {sec('rendering', c.rendering, (
              <>
                <Row label={c.engine}><Sel label={c.engine} value={S.engine} onChange={(v) => up(c.engine, { engine: v })} options={ENGINES.map((e) => ({ value: e, label: R.engines[e] ?? e }))} /></Row>
                <Row label={c.samples}><Slider label={c.samples} value={S.samples} min={16} max={4096} step={16} onChange={(v) => up(c.samples, { samples: v })} /></Row>
                <Row label={c.denoise}><Toggle label={c.denoise} on={S.denoise} onChange={(v) => up(c.denoise, { denoise: v })} /></Row>
                <Row label={c.bounces}><Sel label={c.bounces} value={String(S.bounces)} onChange={(v) => up(c.bounces, { bounces: Number(v) })} options={[2, 4, 6, 8, 12, 16, 32].map((n) => ({ value: String(n), label: String(n) }))} /></Row>
                <Row label={c.quality}><Sel label={c.quality} value={S.quality} onChange={(v) => up(c.quality, { quality: v, ...QUALITY_PRESETS[v as keyof typeof QUALITY_PRESETS] })} options={QUALITIES.map((q) => ({ value: q, label: c.qualities[q] }))} /></Row>
              </>
            ))}
            {sec('environment', c.environment, (
              <>
                <Row label={c.hdri}>
                  <span className={s.hdri}>
                    {hdri.thumb ? <img src={hdri.thumb} alt="" /> : <i />}
                    <Sel label={c.hdri} value={S.hdri} onChange={(v) => up(c.hdri, { hdri: v })} options={HDRIS.map((h) => ({ value: h.name, label: h.name }))} />
                  </span>
                  <Ellipsis size={16} strokeWidth={2} className={s.hdriDots} />
                </Row>
                <Row label={c.rotation}><Slider label={c.rotation} value={S.rotation} min={0} max={360} onChange={(v) => up(c.rotation, { rotation: v })} suffix="°" /></Row>
                <Row label={c.sunSky}><Toggle label={c.sunSky} on={S.sunSky} onChange={(v) => up(c.sunSky, { sunSky: v })} /></Row>
                <Row label={c.sunIntensity}><Slider label={c.sunIntensity} value={S.sunIntensity} min={0} max={10} step={0.1} onChange={(v) => up(c.sunIntensity, { sunIntensity: Math.round(v * 10) / 10 })} /></Row>
                <Row label={c.sunDirection}><Slider label={c.sunDirection} value={S.sunDirection} min={0} max={360} onChange={(v) => up(c.sunDirection, { sunDirection: v })} suffix="°" /></Row>
                <button type="button" className={s.adv} onClick={() => toast(c.advancedNote)}><ChevronRight size={13} strokeWidth={1.8} />{c.advanced}</button>
              </>
            ))}
            {sec('ai', c.ai, (
              <>
                {([['denoise', c.aiDenoise, <Wand2 key="a" size={14} />], ['lighting', c.aiLighting, <Lightbulb key="b" size={14} />], ['material', c.aiMaterial, <Paintbrush key="c" size={14} />], ['style', c.aiStyle, <Shapes key="d" size={14} />]] as const).map(([k, label, icon]) => (
                  <div key={k} className={s.aiRow}>
                    {icon}<span>{label}</span>
                    <Toggle label={label} on={S.ai[k]} onChange={(v) => up(label, { ai: { ...S.ai, [k]: v } })} />
                  </div>
                ))}
                <p className={s.est}>{c.aiNote}</p>
              </>
            ), <Sparkles size={16} strokeWidth={1.7} className={s.aiIcon} />)}
          </>
        ) : (
          <>
            <Row label={t.post.exposure}><Slider label={t.post.exposure} value={doc.fx.exposure} min={-2} max={2} step={0.1} onChange={(v) => upFx({ exposure: Math.round(v * 10) / 10 })} /></Row>
            <Row label={t.post.contrast}><Slider label={t.post.contrast} value={doc.fx.contrast} min={50} max={150} onChange={(v) => upFx({ contrast: v })} suffix="%" /></Row>
            <Row label={t.post.saturation}><Slider label={t.post.saturation} value={doc.fx.saturation} min={0} max={200} onChange={(v) => upFx({ saturation: v })} suffix="%" /></Row>
            <Row label={t.post.temperature}><Slider label={t.post.temperature} value={doc.fx.temperature} min={-100} max={100} onChange={(v) => upFx({ temperature: v })} /></Row>
            <Row label={t.post.vignette}><Slider label={t.post.vignette} value={doc.fx.vignette} min={0} max={100} onChange={(v) => upFx({ vignette: v })} suffix="%" /></Row>
            <button type="button" className={w.link} style={{ margin: '8px 10px' }} onClick={() => edit(t.post.reset, (x) => ({ ...x, fx: DEFAULT_FX }))}>{t.post.reset}</button>
            <p className={s.est}>{t.post.note}</p>
          </>
        )}
      </div>
      <div className={s.renderBar} ref={renderRef}>
        <button type="button" className={s.renderMain} onClick={onRender}><Play size={16} strokeWidth={1.8} />{c.renderCurrent}</button>
        <button type="button" className={s.renderMore} aria-label={c.renderAll} aria-expanded={renderMenu} onClick={() => setRenderMenu(!renderMenu)}><ChevronDown size={16} strokeWidth={1.8} /></button>
        {renderMenu && <div className={s.renderPop}><PopoverPanel width={230}><MenuList onClose={() => setRenderMenu(false)} items={[{ label: c.renderAll, onSelect: onRenderAll }, ...(onRenderMaterials ? [{ label: fmt(R.materials.batch, { n: MATERIAL_OPTIONS.length }), onSelect: onRenderMaterials }] : [])]} /></PopoverPanel></div>}
      </div>
    </section>
  )
}
