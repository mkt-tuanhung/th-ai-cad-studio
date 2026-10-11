/**
 * MEP coordination scene for the native OCCT engine: the ducts, pipes and primary beams of one level,
 * with the level's floor slab for reference. Ducts are drawn at their insulated outer size (the size the
 * clash rules use), pipes at DN. Equipment and circuits carry no geometry in the model, so they are not
 * drawn. Clashing elements are highlighted; the engine can then measure the exact overlap volume.
 */
import { cylBetween, hex, rectBetween, box, type Scene, type SceneItem, type V3 } from '../engine3d/scene'
import { LEVELS, type Clash, type LevelId, type MepModel } from './model'

export type MepView = 'coord' | 'hvac' | 'plumbing' | 'electrical'

const DUCT_RGB: Record<string, string> = {
  'Supply Air Duct': '#3d7fd9',
  'Return Air Duct': '#4fa36b',
  'Exhaust Air Duct': '#d98a2b',
  'Outdoor Air Duct': '#8a6fd1',
}
const PIPE_RGB: Record<string, string> = {
  'Chilled Water Supply': '#2459b8',
  'Chilled Water Return': '#6a8fd6',
  'Domestic Cold Water': '#1f9e8f',
  'Domestic Hot Water': '#d1493f',
  'Sanitary Drain': '#7a5c3e',
  'Fire Sprinkler': '#c4262e',
}

function ends(r: { x: number; y: number; axis: 'x' | 'y'; length: number; elevation: number }, z0: number): [V3, V3] {
  const z = z0 + r.elevation
  return [[r.x, r.y, z], r.axis === 'x' ? [r.x + r.length, r.y, z] : [r.x, r.y + r.length, z]]
}

export function mepScene(m: MepModel, level: LevelId, view: MepView): Scene {
  const z0 = LEVELS.find((l) => l.id === level)?.elev ?? 0
  const items: SceneItem[] = [
    // floor slab of the level (reference only)
    { id: `slab:${level}`, rgb: [0.86, 0.87, 0.88], transparency: 0.55, parts: [box(-300, -300, z0 - 200, 15600, 12600, 200)] },
  ]
  for (const b of m.beams.filter((x) => x.level === level)) {
    const [a, c] = ends(b, z0)
    items.push({ id: b.id, rgb: [0.66, 0.66, 0.64], parts: [rectBetween(a, c, b.w, b.h)] })
  }
  if (view === 'coord' || view === 'hvac')
    for (const d of m.ducts.filter((x) => x.level === level)) {
      const [a, c] = ends(d, z0)
      items.push({ id: d.id, rgb: hex(DUCT_RGB[d.type] ?? '#3d7fd9'), parts: [rectBetween(a, c, d.w + 2 * d.insulation, d.h + 2 * d.insulation)] })
    }
  if (view === 'coord' || view === 'plumbing')
    for (const p of m.pipes.filter((x) => x.level === level)) {
      const [a, c] = ends(p, z0)
      items.push({ id: p.id, rgb: hex(PIPE_RGB[p.service] ?? '#2459b8'), parts: [cylBetween(a, c, p.dn / 2)] })
    }
  return { items }
}

/** Scene ids of both elements of each clash (clash.id = `${a.id}×${b.id}`). */
export const clashIds = (clashes: Clash[], level: LevelId) => [...new Set(clashes.filter((c) => c.level === level).flatMap((c) => c.id.split('×')))]
