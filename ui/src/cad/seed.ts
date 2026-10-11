import type { CadDocument, Entity, Layer, Vec2 } from './types'

/**
 * "Villa Riverside - Floor Plan.dwg" as shown in mockup 02.
 *
 * The detailed plan (walls, furniture, planting) exists only as the approved raster asset
 * `cad2d_main_floorplan_canvas.png`; it is attached as an IMAGE underlay — exactly what it is.
 * The asset is clipped short of the mockup's right/bottom edge, so the annotation there (grid
 * bubbles, overall dimensions, north arrow) is real vector geometry below the image.
 *
 * Coordinates are authored in mockup pixels (1528px window) and mapped to millimetres: the default
 * view is centred on (6900, 4900) at 18000 mm across the 839 px canvas, as in the mockup's View panel.
 */
export const MM_PER_PX = 18000 / 839
const CANVAS_CX = 372 + 839 / 2 // mockup x of canvas centre
const CANVAS_CY = 233 + 590 / 2
export const SEED_VIEW = { center: { x: 6900, y: 4900 }, mmPerPx: MM_PER_PX }

/** Mockup px → world mm. */
export const mp = (X: number, Y: number): Vec2 => ({ x: 6900 + (X - CANVAS_CX) * MM_PER_PX, y: 4900 + (CANVAS_CY - Y) * MM_PER_PX })
const px = (n: number) => n * MM_PER_PX

export const LAYERS: Layer[] = [
  { name: '0', color: '#1f2937', visible: true, locked: false, linetype: 'Continuous', lineweight: 0.25 },
  { name: 'A-Wall', color: '#111827', visible: true, locked: false, linetype: 'Continuous', lineweight: 0.5 },
  { name: 'A-Door', color: '#0f766e', visible: true, locked: false, linetype: 'Continuous', lineweight: 0.25 },
  { name: 'A-Window', color: '#2563eb', visible: true, locked: false, linetype: 'Continuous', lineweight: 0.25 },
  { name: 'A-Furniture', color: '#6b7280', visible: true, locked: false, linetype: 'Continuous', lineweight: 0.13 },
  { name: 'A-Grid', color: '#9aa1ab', visible: true, locked: false, linetype: 'DashDot', lineweight: 0.13 },
  { name: 'A-Dims', color: '#3f4654', visible: true, locked: false, linetype: 'Continuous', lineweight: 0.13 },
  { name: 'A-Anno', color: '#1f2937', visible: true, locked: false, linetype: 'Continuous', lineweight: 0.25 },
  { name: 'Defpoints', color: '#9ca3af', visible: true, locked: false, linetype: 'Continuous', lineweight: 0.13 },
]

let n = 0
const id = () => `seed-${++n}`
const base = (layer: string) => ({ id: id(), layer, color: 'ByLayer', linetype: 'ByLayer' as const, lineweight: 'ByLayer' as const, transparency: 0 })

function bubble(X: number, Y: number, label: string): Entity[] {
  return [
    { ...base('A-Grid'), kind: 'circle', c: mp(X, Y), r: px(11.2), linetype: 'Continuous' },
    { ...base('A-Anno'), kind: 'text', p: mp(X, Y + 5), height: px(13), value: label, rotation: 0, align: 'center' },
  ]
}

function gridLine(x1: number, y1: number, x2: number, y2: number): Entity {
  return { ...base('A-Grid'), kind: 'line', a: mp(x1, y1), b: mp(x2, y2) }
}

function dim(ax: number, ay: number, bx: number, by: number, text: string): Entity {
  return { ...base('A-Dims'), kind: 'dimension', a: mp(ax, ay), b: mp(bx, by), offset: 0, override: text, textHeight: px(10) }
}

export function createVillaDocument(now = Date.now()): CadDocument {
  n = 0
  const rows: [number, string][] = [
    [347, '3'],
    [479, '2'],
    [698.5, '1'],
  ]
  const cols: [number, string][] = [
    [542.5, 'A'],
    [708.5, 'B'],
    [878, 'C'],
    [1028, 'D'],
  ]
  const entities: Entity[] = [
    // right-hand grid axes + bubbles
    ...rows.flatMap(([y, l]) => [gridLine(1094, y, 1165, y), ...bubble(1176.5, y, l)]),
    // bottom grid axes + bubbles
    ...cols.flatMap(([x, l]) => [gridLine(x, 772, x, 786.5), ...bubble(x, 798, l)]),
    // overall dimensions on the right (text as drafted)
    dim(1121, 479, 1121, 347, '3200'),
    dim(1121, 698.5, 1121, 479, '6600'),
    dim(1143.5, 698.5, 1143.5, 347, '9800'),
    // north arrow
    { ...base('A-Anno'), kind: 'circle', c: mp(1155, 287), r: px(19.5) },
    { ...base('A-Anno'), kind: 'polyline', pts: [mp(1155, 268), mp(1160.5, 306), mp(1155, 300)], closed: true, filled: true },
    { ...base('A-Anno'), kind: 'polyline', pts: [mp(1155, 268), mp(1149.5, 306), mp(1155, 300)], closed: true },
    { ...base('A-Anno'), kind: 'text', p: mp(1155, 263), height: px(11), value: 'N', rotation: 0, align: 'center' },
  ]
  return {
    id: 'villa-riverside-floor-plan',
    name: 'Villa Riverside - Floor Plan.dwg',
    entities,
    layers: LAYERS,
    currentLayer: 'A-Wall',
    underlay: {
      name: 'Villa Riverside - Floor Plan (scan)',
      src: '/assets/cad2d_main_floorplan_canvas.png',
      natW: 770,
      natH: 601,
      // asset top 42px is the tab-bar bleed; clipped at x 728 / y 588 where the vector annotation takes over
      crop: { x: 0, y: 42, w: 728, h: 546 },
      origin: mp(372, 233),
      mmPerPx: MM_PER_PX,
      drawIndex: entities.length,
    },
    blocks: [],
    dirty: false,
    createdAt: now,
    savedAt: now,
    source: 'seed',
  }
}

export function createBlankDocument(name: string, now = Date.now()): CadDocument {
  return {
    id: `doc-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name,
    entities: [],
    layers: LAYERS,
    currentLayer: '0',
    underlay: null,
    blocks: [],
    dirty: false,
    createdAt: now,
    savedAt: null,
    source: 'new',
  }
}
