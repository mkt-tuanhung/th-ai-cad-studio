/**
 * MEP coordination scene for the native OCCT engine: the ducts, pipes, cable trays, fixtures, air
 * terminals, fittings and primary beams of one level, with the level's floor slab for reference. Ducts are
 * drawn at their insulated outer size (the size the clash rules use), pipes at DN. Equipment and circuits
 * carry no geometry in the model, so they are not drawn. Runs take the colour filter (system / velocity /
 * clashes); hidden categories are left out.
 */
import { boxAt, cylBetween, hex, rectBetween, box, vcyl, type Scene, type SceneItem, type V3 } from '../engine3d/scene'
import { LEVELS, type Clash, type Duct, type LevelId, type MepModel, type Pipe } from './model'
import { ductLoss, LIMITS, pipeCheck } from './calc'

export type ColorBy = 'system' | 'velocity' | 'clashes'

/** Velocity ramp: green below 60 % of the limit, amber up to the limit, red above. */
export function velocityColor(v: number, limit: number): string {
  return v > limit ? '#d1343a' : v > 0.6 * limit ? '#e2a12b' : '#2f9e5b'
}

/** Colour of a duct / pipe under the active colour filter. */
export function runColor(r: Duct | Pipe, by: ColorBy, clashing: Set<string>): string {
  if (by === 'clashes') return clashing.has(r.id) ? '#d1343a' : '#b8bec7'
  if ('service' in r) return by === 'velocity' ? velocityColor(pipeCheck(r.dn, r.flow).v, LIMITS.pipeVel) : PIPE_RGB[r.service] ?? '#2459b8'
  return by === 'velocity' ? velocityColor(ductLoss(r.w, r.h, r.flow).v, LIMITS.ductVelMain) : DUCT_RGB[r.type] ?? '#3d7fd9'
}

export const TRAY_RGB = { Power: '#e07b22', Data: '#7c5cc4' }
export const FIXTURE_RGB: Record<string, string> = { Downlight: '#f2d16b', 'Linear Light': '#f2d16b', Socket: '#e07b22', WC: '#f4f4f2', Basin: '#f4f4f2', Sink: '#c9ccd1', 'Floor Drain': '#7a5c3e', Sprinkler: '#c4262e' }

export type MepView = 'coord' | 'hvac' | 'plumbing' | 'electrical'

export const DUCT_RGB: Record<string, string> = {
  'Supply Air Duct': '#3d7fd9',
  'Return Air Duct': '#4fa36b',
  'Exhaust Air Duct': '#d98a2b',
  'Outdoor Air Duct': '#8a6fd1',
}
export const PIPE_RGB: Record<string, string> = {
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

export function mepScene(m: MepModel, level: LevelId, view: MepView, opts: { colorBy?: ColorBy; clashing?: Set<string>; hidden?: string[] } = {}): Scene {
  const z0 = LEVELS.find((l) => l.id === level)?.elev ?? 0
  const by = opts.colorBy ?? 'system'
  const clashing = opts.clashing ?? new Set<string>()
  const off = new Set(opts.hidden ?? [])
  const items: SceneItem[] = [
    // floor slab of the level (reference only)
    { id: `slab:${level}`, rgb: [0.86, 0.87, 0.88], transparency: 0.55, parts: [box(-300, -300, z0 - 200, 15600, 12600, 200)] },
  ]
  for (const b of off.has('beams') ? [] : m.beams.filter((x) => x.level === level)) {
    const [a, c] = ends(b, z0)
    items.push({ id: b.id, rgb: [0.66, 0.66, 0.64], parts: [rectBetween(a, c, b.w, b.h)] })
  }
  const hvac = view === 'coord' || view === 'hvac', plumbing = view === 'coord' || view === 'plumbing', elec = view === 'coord' || view === 'electrical'
  if (hvac && !off.has('ducts'))
    for (const d of m.ducts.filter((x) => x.level === level)) {
      const [a, c] = ends(d, z0)
      items.push({ id: d.id, rgb: hex(runColor(d, by, clashing)), parts: [rectBetween(a, c, d.w + 2 * d.insulation, d.h + 2 * d.insulation)] })
    }
  if (plumbing && !off.has('pipes'))
    for (const p of m.pipes.filter((x) => x.level === level)) {
      const [a, c] = ends(p, z0)
      items.push({ id: p.id, rgb: hex(runColor(p, by, clashing)), parts: [cylBetween(a, c, p.dn / 2)] })
    }
  if (elec && !off.has('trays'))
    for (const t of m.trays.filter((x) => x.level === level)) {
      const [a, c] = ends(t, z0)
      // open trough: bottom plate and two side rails
      const side = t.axis === 'x' ? [0, 1] : [1, 0]
      const parts = [rectBetween([a[0], a[1], a[2] - t.h / 2 + 3], [c[0], c[1], c[2] - t.h / 2 + 3], t.w, 6)]
      for (const sgn of [-1, 1]) {
        const dx = (side[0] * sgn * (t.w / 2 - 2)), dy = (side[1] * sgn * (t.w / 2 - 2))
        parts.push(rectBetween([a[0] + dx, a[1] + dy, a[2]], [c[0] + dx, c[1] + dy, c[2]], 4, t.h))
      }
      items.push({ id: t.id, rgb: hex(TRAY_RGB[t.kind]), mat: 'metal', parts })
    }
  if (!off.has('fixtures'))
    for (const f of m.fixtures.filter((x) => x.level === level)) {
      const z = z0 + f.elevation
      const electrical = f.kind === 'Downlight' || f.kind === 'Linear Light' || f.kind === 'Socket'
      if (electrical ? !elec : !plumbing) continue
      const part =
        f.kind === 'Downlight' ? vcyl(f.x, f.y, z - 60, 90, 60)
        : f.kind === 'Linear Light' ? boxAt(f.x, f.y, z - 60, 1200, 120, 60)
        : f.kind === 'Sprinkler' ? vcyl(f.x, f.y, z - 80, 30, 80)
        : f.kind === 'Socket' ? boxAt(f.x, f.y, z - 40, 86, 40, 86)
        : f.kind === 'WC' ? boxAt(f.x, f.y, z0, 380, 680, 400)
        : f.kind === 'Basin' ? boxAt(f.x, f.y, z0 + 800, 550, 450, 150)
        : f.kind === 'Sink' ? boxAt(f.x, f.y, z0 + 750, 800, 500, 200)
        : vcyl(f.x, f.y, z0, 75, 20)
      items.push({ id: f.id, rgb: hex(FIXTURE_RGB[f.kind] ?? '#cccccc'), mat: f.kind === 'Sink' ? 'metal' : undefined, parts: [part] })
    }
  if (hvac && !off.has('terminals'))
    for (const t of m.terminals.filter((x) => x.level === level)) {
      const z = z0 + t.elevation
      items.push({ id: t.id, rgb: hex(t.kind === 'Supply Diffuser' ? '#dfe7f1' : '#e8e8e4'), parts: [boxAt(t.x, t.y, z - 40, t.size, t.size, 40), boxAt(t.x, t.y, z, t.size * 0.6, t.size * 0.6, 200)] })
    }
  if (!off.has('fittings'))
    for (const f of m.fittings.filter((x) => x.level === level)) {
      const d = m.ducts.find((x) => x.id === f.on), p = m.pipes.find((x) => x.id === f.on)
      if (d && hvac && !off.has('ducts')) {
        const s = Math.max(d.w, d.h) + 2 * d.insulation + 60
        items.push({ id: f.id, rgb: hex(runColor(d, by, clashing)), parts: [boxAt(f.x, f.y, z0 + d.elevation - (d.h + 2 * d.insulation + 60) / 2, s, s, d.h + 2 * d.insulation + 60)] })
      } else if (p && plumbing && !off.has('pipes')) items.push({ id: f.id, rgb: hex(runColor(p, by, clashing)), parts: [{ k: 'sphere', o: [f.x, f.y, z0 + p.elevation], s: [p.dn * 0.75, 0, 0] }] })
    }
  return { items }
}

/** Scene ids of both elements of each clash (clash.id = `${a.id}×${b.id}`). */
export const clashIds = (clashes: Clash[], level: LevelId) => [...new Set(clashes.filter((c) => c.level === level).flatMap((c) => c.id.split('×')))]
