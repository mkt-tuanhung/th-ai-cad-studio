/**
 * AutoCAD-compatible command table (the spec the native engine must also satisfy).
 * `status` is honest: 'prototype' = works on the TS prototype model; 'native' = requires the native
 * CAD engine and only reports that it is unavailable here.
 */
export type ToolId =
  | 'select'
  | 'line'
  | 'polyline'
  | 'rectangle'
  | 'circle'
  | 'arc'
  | 'trim'
  | 'offset'
  | 'hatch'
  | 'dimension'
  | 'text'
  | 'move'
  | 'erase'
  | 'dist'
  | 'area'
  | 'insert'

export interface CommandSpec {
  name: string
  aliases: string[]
  tool?: ToolId
  status: 'prototype' | 'native'
}

export const COMMANDS: CommandSpec[] = [
  { name: 'SELECT', aliases: [], tool: 'select', status: 'prototype' },
  { name: 'LINE', aliases: ['L'], tool: 'line', status: 'prototype' },
  { name: 'PLINE', aliases: ['PL'], tool: 'polyline', status: 'prototype' },
  { name: 'RECTANG', aliases: ['REC', 'RECTANGLE'], tool: 'rectangle', status: 'prototype' },
  { name: 'CIRCLE', aliases: ['C'], tool: 'circle', status: 'prototype' },
  { name: 'ARC', aliases: ['A'], tool: 'arc', status: 'prototype' },
  { name: 'TRIM', aliases: ['TR'], tool: 'trim', status: 'prototype' },
  { name: 'OFFSET', aliases: ['O'], tool: 'offset', status: 'prototype' },
  { name: 'HATCH', aliases: ['H', 'BH'], tool: 'hatch', status: 'prototype' },
  { name: 'DIMLINEAR', aliases: ['DIM', 'DLI', 'DIMALIGNED', 'DAL'], tool: 'dimension', status: 'prototype' },
  { name: 'TEXT', aliases: ['T', 'DT', 'MTEXT', 'MT'], tool: 'text', status: 'prototype' },
  { name: 'MOVE', aliases: ['M'], tool: 'move', status: 'prototype' },
  { name: 'ERASE', aliases: ['E'], tool: 'erase', status: 'prototype' },
  { name: 'INSERT', aliases: ['I'], tool: 'insert', status: 'prototype' },
  { name: 'DIST', aliases: ['DI'], tool: 'dist', status: 'prototype' },
  { name: 'AREA', aliases: ['AA'], tool: 'area', status: 'prototype' },
  { name: 'UNDO', aliases: ['U'], status: 'prototype' },
  { name: 'REDO', aliases: [], status: 'prototype' },
  { name: 'ZOOM', aliases: ['Z'], status: 'prototype' },
  { name: 'ORTHO', aliases: [], status: 'prototype' },
  { name: 'OSNAP', aliases: ['OS'], status: 'prototype' },
  { name: 'GRID', aliases: [], status: 'prototype' },
  { name: 'SNAP', aliases: ['SN'], status: 'prototype' },
  { name: 'LAYER', aliases: ['LA'], status: 'prototype' },
  { name: 'PROPERTIES', aliases: ['PR', 'PROPS'], status: 'prototype' },
  { name: 'QSAVE', aliases: ['SAVE'], status: 'prototype' },
  { name: 'SAVEAS', aliases: [], status: 'prototype' },
  { name: 'NEW', aliases: ['QNEW'], status: 'prototype' },
  { name: 'OPEN', aliases: [], status: 'prototype' },
  { name: 'DXFOUT', aliases: ['EXPORT'], status: 'prototype' },
  { name: 'PLOT', aliases: ['PRINT'], status: 'prototype' },
]

export function resolveCommand(input: string): CommandSpec | null {
  const k = input.trim().toUpperCase().replace(/^[_.-]+/, '')
  return COMMANDS.find((c) => c.name === k || c.aliases.includes(k)) ?? null
}

/** Function-key toggles (AutoCAD defaults). */
export const FKEYS: Record<string, 'osnap' | 'grid' | 'ortho' | 'snap' | 'polar'> = {
  F3: 'osnap',
  F7: 'grid',
  F8: 'ortho',
  F9: 'snap',
  F10: 'polar',
}

/** Parses AutoCAD point input: "x,y" absolute, "@dx,dy" relative, "@d<ang" polar. */
export function parsePointInput(text: string, last: { x: number; y: number } | null): { x: number; y: number } | null {
  const s = text.trim().replace(/\s+/g, '')
  const rel = s.startsWith('@')
  const body = rel ? s.slice(1) : s
  const polar = body.match(/^(-?\d+(?:\.\d+)?)<(-?\d+(?:\.\d+)?)$/)
  const cart = body.match(/^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/)
  let p: { x: number; y: number } | null = null
  if (polar) {
    const d = +polar[1]
    const a = (+polar[2] * Math.PI) / 180
    p = { x: d * Math.cos(a), y: d * Math.sin(a) }
    if (!rel && !last) return p
    return last ? { x: last.x + p.x, y: last.y + p.y } : p
  }
  if (cart) p = { x: +cart[1], y: +cart[2] }
  if (!p) return null
  if (rel) return last ? { x: last.x + p.x, y: last.y + p.y } : null
  return p
}
