import { useEffect, useRef, useState, type ReactNode } from 'react'
import { getHost, type HostApi } from '../../services/host'
import { NativeModelView, nativeCamera } from './NativeModelView'
import { useNativeSlot } from '../../lib/useNativeSlot'
import { Box, Camera, ChevronDown, Expand, EyeOff, Focus, Hand, Home, Maximize2, Minimize2, RefreshCcw, ScanSearch, ZoomIn, ZoomOut } from 'lucide-react'
import { fmt, useT } from '../../i18n'
import { useBim, type DisplayMode } from '../../state/bim'
import { toast } from '../../state/toast'
import { CroppedImage } from '../../components/ui/CroppedImage'
import s from './Viewer3D.module.css'

const MODES: DisplayMode[] = ['realistic', 'shaded', 'wireframe', 'hidden']
const MODE_W: Record<DisplayMode, number> = { realistic: 80, shaded: 80, wireframe: 82, hidden: 92 }
export const SCALES = ['1 : 50', '1 : 100', '1 : 200']

/**
 * 3D viewer slot. In the desktop host (architecture option A) the native OCCT viewer renders here.
 * In the browser the approved render is shown 1:1 at its mockup position and every overlay is a real
 * component placed exactly over the matching area of the render.
 */
export function Viewer3D() {
  const T = useT()
  const t = T.bim.viewer
  const { display, set, level, scale, model, maximized } = useBim()
  const native = (what: string) => toast(fmt(T.bim.toast.native, { what }))
  const lvl = model.levels.find((l) => l.id === level)
  const slotRef = useRef<HTMLDivElement>(null)
  useNativeSlot(slotRef, 'bim-3d')
  // desktop app: the non-photographic modes show the live OCCT model; "Realistic" keeps the approved render
  const [host, setHost] = useState<HostApi | null>(null)
  useEffect(() => {
    getHost().then(setHost)
  }, [])
  const live = !!host && display !== 'realistic'
  const cam = (action: string, a = 0, b = 0, c = 0) => (live && nativeCamera.current ? (nativeCamera.current(action, a, b, c), true) : false)
  const tool = (label: string, icon: ReactNode, onClick?: () => void) => (
    <button type="button" className={s.tbtn} aria-label={label} title={label} onClick={onClick ?? (() => native(label))}>
      {icon}
    </button>
  )

  return (
    <div ref={slotRef} className={`${s.viewer} ${s[`m_${display}`]}`} data-native-viewport-slot="bim-3d">
      <svg width="0" height="0" className={s.defs} aria-hidden="true">
        <filter id="bimWire">
          <feColorMatrix type="saturate" values="0" />
          <feConvolveMatrix order="3" kernelMatrix="-1 -1 -1 -1 8 -1 -1 -1 -1" preserveAlpha="true" />
          <feComponentTransfer>
            <feFuncR type="linear" slope="-3" intercept="1" />
            <feFuncG type="linear" slope="-3" intercept="1" />
            <feFuncB type="linear" slope="-3" intercept="1" />
          </feComponentTransfer>
        </filter>
        <filter id="bimHidden">
          <feColorMatrix type="saturate" values="0" />
          <feComponentTransfer>
            <feFuncR type="discrete" tableValues="0.2 0.75 1 1" />
            <feFuncG type="discrete" tableValues="0.2 0.75 1 1" />
            <feFuncB type="discrete" tableValues="0.2 0.75 1 1" />
          </feComponentTransfer>
        </filter>
      </svg>
      {live ? (
        <NativeModelView host={host!} mode={display as 'shaded' | 'wireframe' | 'hidden'} />
      ) : (
        <img className={s.render} src="/assets/bim_main_3d_model.png" alt="Villa Riverside — 3D section view" draggable={false} />
      )}

      <label className={s.viewSelect}>
        <span>{t.sectionView}</span>
        <ChevronDown size={15} strokeWidth={1.8} />
        <select aria-label={t.sectionView} value="section" onChange={() => native('3D view')}>
          <option value="section">{t.sectionView}</option>
          <option value="exterior">3D - Exterior</option>
        </select>
      </label>

      <div className={s.toolbar} role="toolbar">
        {tool(t.orbit, <RefreshCcw size={18} strokeWidth={1.7} />)}
        {tool(t.pan, <Hand size={18} strokeWidth={1.7} />)}
        {tool(t.zoom, <ZoomOut size={18} strokeWidth={1.7} />)}
        {tool(t.fit, <Expand size={17} strokeWidth={1.7} />, () => cam('fit') || native(t.fit))}
        {tool(t.snapshot, <Camera size={17} strokeWidth={1.7} />)}
        {tool(t.hide, <EyeOff size={17} strokeWidth={1.7} />)}
        {tool(t.isolate, <Focus size={17} strokeWidth={1.7} />)}
      </div>

      <section className={s.plan}>
        <header className={s.planHead}>
          <span>{fmt(t.planPreview, { level: lvl?.name ?? '' })}</span>
          <button type="button" className={s.planOpen} aria-label={t.openPlan} title={t.openPlan} onClick={() => set({ view: 'plan' })}>
            <Maximize2 size={14} strokeWidth={1.8} />
          </button>
        </header>
        {level === 'L1' ? (
          <CroppedImage className={s.planImg} src="/assets/bim_main_3d_model.png" natW={651} natH={504} crop={{ x: 19, y: 79, w: 205, h: 145 }} alt={fmt(t.planPreview, { level: 'Level 1' })} />
        ) : (
          <div className={`${s.planImg} ${s.planNone}`}>{t.noPlanPreview}</div>
        )}
      </section>

      <div className={s.cube} aria-label="View cube">
        <button type="button" className={s.cubeTop} onClick={() => cam('top') || native(`${t.cube.top} view`)}>{t.cube.top}</button>
        <button type="button" className={s.cubeFront} onClick={() => cam('front') || native(`${t.cube.front} view`)}>{t.cube.front}</button>
        <button type="button" className={s.cubeRight} onClick={() => cam('right') || native(`${t.cube.right} view`)}>{t.cube.right}</button>
      </div>

      <div className={s.nav}>
        {tool(t.home, <Home size={17} strokeWidth={1.6} />, () => cam('home') || set({ display: 'realistic' }))}
        {tool(t.zoomIn, <ZoomIn size={17} strokeWidth={1.6} />, () => cam('zoom', 370, 265, 2) || native(t.zoomIn))}
        {tool(t.zoomRegion, <ScanSearch size={17} strokeWidth={1.6} />)}
        {tool(t.zoomOut, <ZoomOut size={17} strokeWidth={1.6} />, () => cam('zoom', 370, 265, -2) || native(t.zoomOut))}
        {tool(t.box, <Box size={17} strokeWidth={1.6} />)}
      </div>

      <div className={s.modes} role="radiogroup" aria-label="Display mode">
        {MODES.map((m) => (
          <button key={m} type="button" role="radio" aria-checked={display === m} className={`${s.mode} ${display === m ? s.modeOn : ''}`} style={{ width: MODE_W[m] }} onClick={() => set({ display: m })}>
            {t.modes[m]}
          </button>
        ))}
      </div>

      <div className={s.levelBar}>
        <label className={s.sel}>
          <span>{lvl?.name}</span>
          <ChevronDown size={14} strokeWidth={1.8} />
          <select aria-label={t.level} value={level} onChange={(e) => set({ level: e.target.value })}>
            {model.levels.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <label className={`${s.sel} ${s.scaleSel}`}>
          <span>{scale}</span>
          <ChevronDown size={14} strokeWidth={1.8} />
          <select aria-label={t.scale} value={scale} onChange={(e) => set({ scale: e.target.value })}>
            {SCALES.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
        <button type="button" className={s.full} aria-label={maximized ? t.restore : t.fullscreen} title={maximized ? t.restore : t.fullscreen} onClick={() => set({ maximized: !maximized })}>
          {maximized ? <Minimize2 size={16} strokeWidth={1.7} /> : <Expand size={16} strokeWidth={1.7} />}
        </button>
      </div>
    </div>
  )
}
