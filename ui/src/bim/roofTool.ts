/**
 * Roof from perimeter (v2.4, SP09 / V24-011): a pitched roof (bim/roof.ts: hip or gable over a rectangle) over the
 * outside faces of a level's walls plus an overhang, its eaves on the level the walls reach — added as a new element;
 * the walls are not touched. Pure: returns the new model for one undoable edit.
 */
import { levelOf, type BimModel, type PitchedRoof } from './model'
import { nextMark, uid } from './geometry'
import { levelWalls } from './rooms'
import { wallOutline } from './walls'

export interface PerimeterRoofSpec {
  /** the level whose walls the roof covers */
  level: string
  kind: 'hip' | 'gable'
  slope: number
  /** eaves overhang past the outside faces (mm) */
  overhang: number
}

export function roofFromPerimeter(m: BimModel, s: PerimeterRoofSpec): { model: BimModel; roof: string; walls: string[] } | { error: 'noWalls' | 'noTop' | 'slope' } {
  if (!(s.slope >= 5 && s.slope <= 70)) return { error: 'slope' }
  const walls = levelWalls(m, s.level).filter((w) => w.baseLevel === s.level)
  if (!walls.length) return { error: 'noWalls' }
  // the eaves sit on the level the walls are topped at (the most common one, at no offset)
  const tops = new Map<string, number>()
  for (const w of walls) if (Math.abs(w.topOffset) < 1) tops.set(w.topLevel, (tops.get(w.topLevel) ?? 0) + 1)
  const top = [...tops.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
  if (!top || !levelOf(m, top)) return { error: 'noTop' }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const w of walls)
    for (const [x, y] of wallOutline(m, w)) {
      x0 = Math.min(x0, x)
      y0 = Math.min(y0, y)
      x1 = Math.max(x1, x)
      y1 = Math.max(y1, y)
    }
  const o = Math.max(0, s.overhang)
  const r = (v: number) => Math.round(v)
  const roof: PitchedRoof = {
    id: uid('roof'),
    category: 'roof',
    mark: nextMark((m.roofs ?? []).map((x) => x.mark), 'R'),
    level: top,
    outline: [[r(x0 - o), r(y0 - o)], [r(x1 + o), r(y0 - o)], [r(x1 + o), r(y1 + o)], [r(x0 - o), r(y1 + o)]],
    kind: s.kind,
    slope: s.slope,
  }
  return { model: { ...m, roofs: [...(m.roofs ?? []), roof] }, roof: roof.id, walls: walls.map((w) => w.id) }
}
