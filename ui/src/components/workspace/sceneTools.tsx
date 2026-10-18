import { useRef, useState } from 'react'
import { fmt, useT } from '../../i18n'
import { toast } from '../../state/toast'
import type { SceneCtl } from './NativeScene'
import s from './NativeScene.module.css'

export type SceneTool = 'orbit' | 'pan' | 'zoomRegion' | 'walk'

const b64 = (dataUrl: string) => Uint8Array.from(atob(dataUrl.slice(dataUrl.indexOf(',') + 1)), (c) => c.charCodeAt(0))

/** Saves a data: URL as a file (desktop: save dialog; browser: download). */
export function saveDataUrl(name: string, dataUrl: string, type = 'image/png') {
  const url = URL.createObjectURL(new Blob([b64(dataUrl) as BlobPart], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * Shared state of the 3D view side tools (Interior, MEP, Mechanical): the active pointer tool, hidden /
 * isolated items, the section box, and the snapshot. Spread `props` onto <NativeScene>, render <Chips />
 * inside the viewport.
 */
export function useSceneTools(fileBase: string) {
  const t = useT().view3d
  const [tool, setTool] = useState<SceneTool>('orbit')
  const [hidden, setHidden] = useState<string[]>([])
  const [keep, setKeep] = useState<string[]>([])
  const [visible, setVisible] = useState(0)
  const isolated = keep.length > 0
  const [section, setSection] = useState<{ on: boolean; around: string[]; top?: number; planes?: number[][] }>({ on: false, around: [] })
  const ctl = useRef<SceneCtl | null>(null)
  const toggleTool = (k: SceneTool) => setTool((cur) => (cur === k ? 'orbit' : k))
  const showAll = () => (setHidden([]), setKeep([]))
  /** Exact hidden / isolated sets (camera bookmark restore). */
  const setVisibility = (h: string[], k: string[]) => (setHidden([...h]), setKeep([...k]))
  /** Isolate the given items (toggle: a second isolate shows everything again). */
  const isolate = (keepIds: string[]) => {
    if (isolated) return showAll()
    if (!keepIds.length) return toast(t.selectFirst)
    setKeep(keepIds)
  }
  const hide = (id: string | undefined, name?: string) => {
    if (!id) return toast(t.selectFirst)
    setHidden((h) => (h.includes(id) ? h : [...h, id]))
    toast(fmt(t.hiddenOne, { name: name ?? id }))
  }
  /** Section box around the given items (whole model cut at mid-height when none); toggles off. */
  const toggleSection = (around: string[] = []) => setSection((sb) => (sb.on ? { on: false, around: [] } : { on: true, around }))
  const snapshot = async () => {
    const r = await ctl.current?.snapshot(2)
    if (!r?.ok || !r.url) return toast(fmt(t.snapshotFailed, { why: r?.error ?? 'no view' }), 'warning')
    const file = `${fileBase} - ${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.png`
    saveDataUrl(file, r.url)
    toast(fmt(t.snapshot, { file, w: r.w ?? 0, h: r.h ?? 0 }), 'success')
  }
  const Chips = () =>
    hidden.length || isolated || (section.on && section.top === undefined) ? (
      <div className={s.chips} data-testid="scene-chips">
        {(hidden.length > 0 || isolated) && (
          <span>
            {isolated ? fmt(t.isolated, { n: visible }) : fmt(t.hidden, { n: hidden.length })}
            <button type="button" onClick={showAll}>{t.showAll}</button>
          </span>
        )}
        {section.on && section.top === undefined && (
          <span>
            {t.section}
            <button type="button" onClick={() => setSection({ on: false, around: [] })}>{t.sectionOff}</button>
          </span>
        )}
      </div>
    ) : null
  return {
    tool,
    setTool,
    toggleTool,
    hidden,
    keep,
    setVisibility,
    isolated,
    section,
    ctl,
    isolate,
    hide,
    showAll,
    toggleSection,
    setSection,
    snapshot,
    Chips,
    props: { tool, onToolDone: () => setTool('orbit'), hidden, keep, section, ctlRef: ctl, onVisible: setVisible },
  }
}
