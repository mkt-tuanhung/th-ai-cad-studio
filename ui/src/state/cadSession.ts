import { create } from 'zustand'
import type { Entity, Vec2 } from '../cad/types'
import { COMMANDS, parsePointInput, resolveCommand, type ToolId } from '../cad/commands'
import {
  add,
  arcFrom3,
  bboxInside,
  bboxIntersects,
  bboxOf,
  dist,
  norm,
  perp,
  scale,
  sub,
  translateEntity,
} from '../cad/geometry'
import type { CadOp, ValidationError } from '../cad/commandBus'
import { fmt, getMessages } from '../i18n'
import { useSettings } from './settings'
import { useCad, type DraftToggle } from './cad'
import { formatAngle, formatArea, formatLength, polygonMetrics } from '../lib/units'

/**
 * Interactive command session — the AutoCAD-style state machine behind the tool palette, the
 * viewport clicks and the command line. It only talks to the document through the command bus.
 */
export type Stage =
  | null
  | 'firstPoint'
  | 'nextPoint'
  | 'plStart'
  | 'plNext'
  | 'corner1'
  | 'corner2'
  | 'center'
  | 'radius'
  | 'arc1'
  | 'arc2'
  | 'arc3'
  | 'dim1'
  | 'dim2'
  | 'dim3'
  | 'textPoint'
  | 'textValue'
  | 'selectObjects'
  | 'basePoint'
  | 'secondPoint'
  | 'offsetDist'
  | 'offsetPick'
  | 'offsetSide'
  | 'opposite'
  | 'zoom'
  | 'distP1'
  | 'distP2'
  | 'areaFirst'
  | 'areaNext'
  | 'insertPoint'

interface SessionState {
  stage: Stage
  points: Vec2[]
  windowStart: Vec2 | null
  /** Stage to return to after a selection window completes (MOVE/ERASE "Select objects:"). */
  afterWindow: Stage
  offsetDist: number | null
  offsetTarget: string | null
  lastCommand: string | null
  /** Effective cursor (after snaps) for rubber-band previews. */
  hover: Vec2 | null

  prompt: () => string
  start: (tool: ToolId, commandName?: string) => void
  cancel: () => void
  click: (p: Vec2, hitId: string | null, shift: boolean) => void
  input: (text: string) => void
  setHover: (p: Vec2 | null) => void
  eraseSelection: () => void
}

/** UI hooks registered by the CAD screen (zoom, file dialogs, export). */
export const cadUi: { zoomExtents?: () => void; openFile?: () => void; exportDxf?: () => void } = {}
/**
 * Block waiting to be placed by INSERT (set by the Components library). Entities are in block
 * coordinates, already offset to the chosen insertion point and rotated.
 */
export interface PendingInsert {
  componentId: string
  name: string
  entities: Entity[]
  layer: string | null
  layerColor: string
  color: string
  linetype: Entity['linetype']
  explode: boolean
  onPlaced?: () => void
}
export const insertQueue: { next: PendingInsert | null } = { next: null }

/** Files handed to CAD 2D by another screen (e.g. Projects → Open in CAD 2D); consumed on mount. */
export const cadInbox: { files: File[] } = { files: [] }

const t = () => getMessages(useSettings.getState().language).cad
const cad = () => useCad.getState()
const print = (s: string, tone?: 'error' | 'info') => cad().print(s, tone)

let eid = 0
const newId = () => `e-${Date.now().toString(36)}-${(++eid).toString(36)}`

function entityBase() {
  const doc = cad().activeDoc()
  return { id: newId(), layer: doc?.currentLayer ?? '0', color: 'ByLayer', linetype: 'ByLayer' as const, lineweight: 'ByLayer' as const, transparency: 0 }
}

function run(op: CadOp): boolean {
  const err = cad().exec(op)
  if (err) {
    reportError(err)
    return false
  }
  return true
}

function reportError(err: ValidationError) {
  const p = t().prompts
  print(err.code === 'locked-layer' ? p.locked : err.code === 'degenerate' ? p.degenerate : `${err.code}: ${err.detail}`, 'error')
}

const firstStage: Partial<Record<ToolId, Stage>> = {
  line: 'firstPoint',
  polyline: 'plStart',
  rectangle: 'corner1',
  circle: 'center',
  arc: 'arc1',
  dimension: 'dim1',
  text: 'textPoint',
  offset: 'offsetDist',
  dist: 'distP1',
  area: 'areaFirst',
  insert: 'insertPoint',
}

export const useCadSession = create<SessionState>()((set, get) => {
  const reset = (stage: Stage = null) =>
    set({ stage, points: [], windowStart: null, afterWindow: null, offsetDist: null, offsetTarget: null })

  const finish = () => {
    cad().setTool('select')
    reset(null)
  }

  /** Ends multi-point tools (LINE/PLINE) on Enter/Esc, committing what was drawn. */
  const endMulti = () => {
    const { points } = get()
    const tool = cad().tool
    if (tool === 'polyline' && points.length >= 2) {
      run({ type: 'add', label: 'PLINE', entities: [{ ...entityBase(), kind: 'polyline', pts: points, closed: false }] })
    }
    finish()
  }

  const toggleNames: Record<DraftToggle, string> = { ortho: 'Ortho', osnap: 'Osnap', grid: 'Grid', snap: 'Snap', polar: 'Polar', model: 'Model' }

  return {
    stage: null,
    points: [],
    windowStart: null,
    afterWindow: null,
    offsetDist: null,
    offsetTarget: null,
    lastCommand: null,
    hover: null,

    prompt: () => {
      const s = get().stage
      return s ? t().prompts[s] : t().prompts.command
    },

    setHover: (hover) => set({ hover }),

    start: (tool, commandName) => {
      const spec = COMMANDS.find((c) => c.tool === tool)
      const name = commandName ?? spec?.name ?? tool.toUpperCase()
      const queued = insertQueue.next // cancel() of a previous INSERT must not drop the newly queued block
      get().cancel()
      insertQueue.next = queued
      print(`${t().prompts.command} ${name}`)
      set({ lastCommand: name })
      if (spec?.status === 'native') {
        print(fmt(t().cmd.native, { c: name }), 'error')
        finish()
        return
      }
      if (tool === 'insert' && !insertQueue.next) {
        print(t().prompts.noInsert, 'error')
        finish()
        return
      }
      cad().setTool(tool)
      if (tool === 'select') return reset(null)
      if (tool === 'erase' || tool === 'move') {
        if (cad().selection.length) {
          if (tool === 'erase') return get().eraseSelection()
          return reset('basePoint')
        }
        return set({ stage: 'selectObjects', points: [], windowStart: null, afterWindow: null })
      }
      reset(firstStage[tool] ?? null)
    },

    cancel: () => {
      if (cad().tool === 'insert') insertQueue.next = null
      const s = get()
      if (s.stage || s.windowStart) {
        if (cad().tool === 'polyline' || cad().tool === 'line') return endMulti()
        print(t().prompts.cancel)
      }
      finish()
    },

    eraseSelection: () => {
      const ids = cad().selection
      if (!ids.length) return
      if (run({ type: 'erase', ids, label: 'ERASE' })) {
        print(fmt(t().prompts.erased, { n: ids.length }))
        cad().setSelection([])
      }
      finish()
    },

    click: (p, hitId, shift) => {
      const s = get()
      const tool = cad().tool
      const doc = cad().activeDoc()
      if (!doc) return

      // ---- selection (SELECT tool, or "Select objects:" inside MOVE/ERASE) ----
      if (tool === 'select' || s.stage === 'selectObjects' || s.stage === 'opposite') {
        if (s.windowStart) {
          const a = s.windowStart
          const box = { minX: Math.min(a.x, p.x), minY: Math.min(a.y, p.y), maxX: Math.max(a.x, p.x), maxY: Math.max(a.y, p.y) }
          const crossing = p.x < a.x // right→left = crossing, left→right = window (AutoCAD)
          const visible = new Set(doc.layers.filter((l) => l.visible).map((l) => l.name))
          const ids = doc.entities
            .filter((e) => visible.has(e.layer))
            .filter((e) => (crossing ? bboxIntersects(bboxOf(e), box) : bboxInside(bboxOf(e), box)))
            .map((e) => e.id)
          const sel = shift ? [...new Set([...cad().selection, ...ids])] : ids
          cad().setSelection(sel)
          set({ windowStart: null, stage: s.afterWindow })
          return
        }
        if (hitId) {
          const cur = cad().selection
          // blocks inserted from the Components library select as one object
          const hit = doc.entities.find((e) => e.id === hitId)
          const group = hit?.block ? doc.entities.filter((e) => e.block?.id === hit.block!.id).map((e) => e.id) : [hitId]
          const has = group.every((id) => cur.includes(id))
          cad().setSelection(shift ? (has ? cur.filter((x) => !group.includes(x)) : [...new Set([...cur, ...group])]) : group)
          return
        }
        print(t().prompts.opposite)
        set({ windowStart: p, afterWindow: s.stage === 'opposite' ? null : s.stage, stage: 'opposite' })
        return
      }

      const pts = [...s.points, p]
      const L = t().prompts
      switch (tool) {
        case 'line': {
          if (pts.length >= 2) {
            run({ type: 'add', label: 'LINE', entities: [{ ...entityBase(), kind: 'line', a: pts[pts.length - 2], b: p }] })
          }
          return set({ points: pts, stage: 'nextPoint' })
        }
        case 'polyline':
          return set({ points: pts, stage: 'plNext' })
        case 'dist': {
          if (pts.length < 2) return set({ points: pts, stage: 'distP2' })
          const [a, b] = pts
          const u = useSettings.getState()
          const d = { x: b.x - a.x, y: b.y - a.y }
          print(fmt(L.distResult, { d: formatLength(Math.hypot(d.x, d.y), u), angle: formatAngle(Math.atan2(d.y, d.x) < 0 ? Math.atan2(d.y, d.x) + 2 * Math.PI : Math.atan2(d.y, d.x), u), dx: formatLength(d.x, u), dy: formatLength(d.y, u) }), 'info')
          return finish()
        }
        case 'area':
          return set({ points: pts, stage: 'areaNext' })
        case 'insert': {
          const pend = insertQueue.next
          if (!pend) return finish()
          const docNow = cad().activeDoc()
          const layer = pend.layer ?? docNow?.currentLayer ?? '0'
          const ops: CadOp[] = []
          if (docNow && !docNow.layers.some((l) => l.name === layer)) ops.push({ type: 'addLayer', name: layer, color: pend.layerColor, label: 'LAYER' })
          const block = pend.explode ? undefined : { id: newId(), name: pend.name }
          const entities = pend.entities.map((e) => ({
            ...translateEntity(e, p), id: newId(), layer, color: pend.color, linetype: pend.linetype, lineweight: 'ByLayer' as const, transparency: 0,
            ...(block ? { block } : {}),
          }))
          ops.push({ type: 'add', label: `INSERT ${pend.name}`, entities })
          const err = cad().execBatch(ops, `INSERT ${pend.name}`)
          if (err) reportError(err)
          else {
            print(fmt(L.inserted, { name: pend.name, n: entities.length, layer }))
            pend.onPlaced?.()
          }
          insertQueue.next = null
          return finish()
        }
        case 'rectangle': {
          if (pts.length < 2) return set({ points: pts, stage: 'corner2' })
          const [a, b] = pts
          run({
            type: 'add',
            label: 'RECTANG',
            entities: [{ ...entityBase(), kind: 'polyline', closed: true, pts: [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }] }],
          })
          return finish()
        }
        case 'circle': {
          if (pts.length < 2) return set({ points: pts, stage: 'radius' })
          run({ type: 'add', label: 'CIRCLE', entities: [{ ...entityBase(), kind: 'circle', c: pts[0], r: dist(pts[0], p) }] })
          return finish()
        }
        case 'arc': {
          if (pts.length < 3) return set({ points: pts, stage: pts.length === 1 ? 'arc2' : 'arc3' })
          const arc = arcFrom3(pts[0], pts[1], pts[2])
          if (!arc) {
            print(L.degenerate, 'error')
            return finish()
          }
          run({ type: 'add', label: 'ARC', entities: [{ ...entityBase(), kind: 'arc', c: arc.c, r: arc.r, start: arc.start, end: arc.end }] })
          return finish()
        }
        case 'dimension': {
          if (pts.length < 3) return set({ points: pts, stage: pts.length === 1 ? 'dim2' : 'dim3' })
          const [a, b, loc] = pts
          const n = perp(norm(sub(b, a)))
          const offset = (loc.x - a.x) * n.x + (loc.y - a.y) * n.y
          const scaleDen = Number(cad().scale.split(':')[1]) || 100
          run({
            type: 'add',
            label: 'DIMLINEAR',
            entities: [{ ...entityBase(), kind: 'dimension', a, b, offset, override: null, textHeight: 2.5 * scaleDen }],
          })
          return finish()
        }
        case 'text':
          return set({ points: [p], stage: 'textValue' })
        case 'move': {
          if (s.stage === 'basePoint') return set({ points: [p], stage: 'secondPoint' })
          const d = sub(p, s.points[0])
          const sel = new Set(cad().selection)
          const moved = doc.entities.filter((e) => sel.has(e.id)).map((e) => translateEntity(e, d))
          run({ type: 'replace', label: 'MOVE', entities: moved })
          return finish()
        }
        case 'offset': {
          if (s.stage === 'offsetPick') {
            if (!hitId) return
            return set({ offsetTarget: hitId, stage: 'offsetSide' })
          }
          if (s.stage === 'offsetSide' && s.offsetTarget && s.offsetDist !== null) {
            const target = doc.entities.find((e) => e.id === s.offsetTarget)
            const made = target && offsetEntity(target, s.offsetDist, p)
            if (!made) print(L.offsetUnsupported, 'error')
            else run({ type: 'add', label: 'OFFSET', entities: [{ ...made, id: newId() }] })
            // AutoCAD keeps offsetting with the same distance until Enter/Esc
            return set({ offsetTarget: null, stage: 'offsetPick' })
          }
          return
        }
      }
    },

    input: (raw) => {
      const text = raw.trim()
      const s = get()
      const tool = cad().tool
      const L = t().prompts
      const echo = () => print(`${get().prompt()} ${text}`)

      // ---- answers to an active prompt ----
      if (s.stage === 'textValue') {
        echo()
        if (text) {
          const scaleDen = Number(cad().scale.split(':')[1]) || 100
          run({ type: 'add', label: 'TEXT', entities: [{ ...entityBase(), kind: 'text', p: s.points[0], height: 2.5 * scaleDen, value: text, rotation: 0, align: 'left' }] })
        }
        return finish()
      }
      if (s.stage === 'offsetDist') {
        echo()
        const d = parseFloat(text)
        if (!(d > 0)) return print(L.invalidPoint, 'error')
        return set({ offsetDist: d, stage: 'offsetPick' })
      }
      if (s.stage === 'zoom') {
        echo()
        if (!text || /^(e|ext|extents|a|all)$/i.test(text)) cadUi.zoomExtents?.()
        else print(L.invalidPoint, 'error')
        return finish()
      }
      if (s.stage === 'selectObjects' && !text) {
        echo()
        if (tool === 'erase') return get().eraseSelection()
        if (tool === 'move' && cad().selection.length) return set({ stage: 'basePoint' })
        return finish()
      }
      if (s.stage && !text) {
        // Enter: finish multi-point / repeat-less tools
        if (tool === 'line' || tool === 'polyline' || tool === 'offset') {
          echo()
          return endMulti()
        }
        if (tool === 'area') {
          echo()
          if (s.points.length < 3) {
            print(L.areaNeedPoints, 'error')
            return finish()
          }
          const u = useSettings.getState()
          const m = polygonMetrics(s.points)
          print(fmt(L.areaResult, { area: formatArea(m.area, u), perimeter: formatLength(m.perimeter, u) }), 'info')
          return finish()
        }
        return get().cancel()
      }
      if (s.stage && tool === 'polyline' && /^c(lose)?$/i.test(text)) {
        echo()
        if (s.points.length >= 3) run({ type: 'add', label: 'PLINE', entities: [{ ...entityBase(), kind: 'polyline', pts: s.points, closed: true }] })
        return finish()
      }
      if (s.stage && (tool === 'polyline' || tool === 'line') && /^u(ndo)?$/i.test(text)) {
        echo()
        if (tool === 'line' && s.points.length >= 2) cad().undo()
        return set({ points: s.points.slice(0, -1), stage: s.points.length <= 1 ? firstStage[tool]! : s.stage })
      }
      if (s.stage === 'radius') {
        const r = parseFloat(text)
        if (r > 0 && !text.includes(',')) {
          echo()
          run({ type: 'add', label: 'CIRCLE', entities: [{ ...entityBase(), kind: 'circle', c: s.points[0], r }] })
          return finish()
        }
      }
      if (s.stage && s.stage !== 'selectObjects' && s.stage !== 'opposite') {
        const last = s.points.at(-1) ?? null
        const p = parsePointInput(text, last)
        if (!p) {
          echo()
          return print(L.invalidPoint, 'error')
        }
        echo()
        return get().click(p, null, false)
      }

      // ---- new command ----
      if (!text) {
        if (s.lastCommand) {
          const spec = resolveCommand(s.lastCommand)
          if (spec?.tool) return get().start(spec.tool, spec.name)
        }
        return
      }
      const spec = resolveCommand(text)
      if (!spec) {
        print(`${L.command} ${text}`)
        return print(fmt(t().cmd.unknown, { c: text }), 'error')
      }
      if (spec.tool) return get().start(spec.tool, spec.name)
      print(`${L.command} ${spec.name}`)
      set({ lastCommand: spec.name })
      switch (spec.name) {
        case 'UNDO': {
          const label = cad().undo()
          return print(label ? fmt(L.undone, { label }) : L.nothingUndo, label ? undefined : 'error')
        }
        case 'REDO': {
          const label = cad().redo()
          return print(label ? fmt(L.redone, { label }) : L.nothingRedo, label ? undefined : 'error')
        }
        case 'ZOOM':
          return set({ stage: 'zoom' })
        case 'ORTHO':
        case 'OSNAP':
        case 'GRID':
        case 'SNAP': {
          const k = spec.name.toLowerCase() as DraftToggle
          cad().toggle(k)
          return print(fmt(cad().toggles[k] ? L.toggleOn : L.toggleOff, { name: toggleNames[k] }))
        }
        case 'LAYER':
          return cad().set({ rightTab: 'layers' })
        case 'PROPERTIES':
          return cad().set({ rightTab: 'properties' })
        case 'QSAVE':
          cad().save()
          return print(fmt(t().toast.saved, { name: cad().activeDoc()?.name ?? '' }))
        case 'NEW':
          cad().newDrawing()
          return
        case 'OPEN':
          return cadUi.openFile?.()
        case 'DXFOUT':
          return cadUi.exportDxf?.()
        default:
          return print(fmt(t().cmd.native, { c: spec.name }), 'error')
      }
    },
  }
})

/** OFFSET for lines and circles (prototype scope). */
function offsetEntity(e: Entity, d: number, side: Vec2): Entity | null {
  if (e.kind === 'line') {
    const n = perp(norm(sub(e.b, e.a)))
    const sign = (side.x - e.a.x) * n.x + (side.y - e.a.y) * n.y >= 0 ? 1 : -1
    const off = scale(n, d * sign)
    return { ...e, a: add(e.a, off), b: add(e.b, off) }
  }
  if (e.kind === 'circle') {
    const r = dist(side, e.c) > e.r ? e.r + d : e.r - d
    return r > 0 ? { ...e, r } : null
  }
  return null
}

/** Helper used by the viewport to hit-test with a pixel tolerance. */
export function hitTest(entities: Entity[], visibleLayers: Set<string>, p: Vec2, tolMm: number, distance: (e: Entity, p: Vec2) => number) {
  let best: { id: string; d: number } | null = null
  for (let i = entities.length - 1; i >= 0; i--) {
    const e = entities[i]
    if (!visibleLayers.has(e.layer)) continue
    const d = distance(e, p)
    if (d <= tolMm && (!best || d < best.d)) best = { id: e.id, d }
  }
  return best?.id ?? null
}
