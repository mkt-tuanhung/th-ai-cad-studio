import type { Discipline, Op, OpSpec } from '../discipline'
import { runModelChecks, wallArea, wallHeight, type BimModel, type Opening } from '../../bim/model'

const openings = (m: BimModel) => [...m.doors, ...m.windows]
const key = (o: Opening) => o.mark || o.id

export const bimAi: Discipline<BimModel> = {
  key: 'bim',
  role: 'BIM architecture (walls, doors, windows)',
  ops: (m): OpSpec[] => {
    const walls = m.walls.map((w) => w.mark), ops = openings(m).map(key), levels = m.levels.map((l) => l.id)
    return [
      { op: 'setWallType', desc: 'change the type (construction / thickness) of a wall', args: { wall: { kind: 'enum', values: walls }, type: { kind: 'enum', values: m.wallTypes.map((t) => t.id) } } },
      { op: 'setWallTop', desc: 'change the top constraint of a wall', args: { wall: { kind: 'enum', values: walls }, topLevel: { kind: 'enum', values: levels }, topOffset: { kind: 'number', min: -3000, max: 3000, unit: 'mm', integer: true } } },
      { op: 'setWallBase', desc: 'change the base constraint of a wall', args: { wall: { kind: 'enum', values: walls }, baseLevel: { kind: 'enum', values: levels }, baseOffset: { kind: 'number', min: -3000, max: 3000, unit: 'mm', integer: true } } },
      { op: 'setOpeningSize', desc: 'change the width, height and sill of a door or window', args: { opening: { kind: 'enum', values: ops }, width: { kind: 'number', min: 300, max: 6000, unit: 'mm', integer: true }, height: { kind: 'number', min: 300, max: 4000, unit: 'mm', integer: true }, sill: { kind: 'number', min: 0, max: 3000, unit: 'mm', integer: true } } },
      { op: 'moveOpening', desc: 'move a door or window along its host wall (offset of its left edge from the wall start)', args: { opening: { kind: 'enum', values: ops }, offset: { kind: 'number', min: 0, max: 20000, unit: 'mm', integer: true } } },
    ]
  },
  context: (m) =>
    [
      `Levels: ${m.levels.map((l) => `${l.id} ${l.name} at ${l.elevation} mm`).join('; ')}`,
      `Wall types: ${m.wallTypes.map((t) => `${t.id} = ${t.name} (${t.thickness} mm, ${t.structure})`).join('; ')}`,
      'Walls (mark | type | base level+offset | top level+offset | length mm | height mm | area m²):',
      ...m.walls.map((w) => `${w.mark} | ${w.typeId} | ${w.baseLevel}${w.baseOffset ? `+${w.baseOffset}` : ''} | ${w.topLevel}${w.topOffset ? `+${w.topOffset}` : ''} | ${w.length} | ${wallHeight(m, w)} | ${wallArea(m, w).toFixed(2)}`),
      'Doors and windows (mark | category | host wall | offset mm | width×height mm | sill mm):',
      ...openings(m).map((o) => `${key(o)} | ${o.category} | ${m.walls.find((w) => w.id === o.hostWall)?.mark ?? o.hostWall} | ${o.offset} | ${o.width}×${o.height} | ${o.sill}`),
      `Model checks: ${runModelChecks(m).map((c) => `${c.key} ${c.status} (${c.count})${c.items.length ? ': ' + c.items.slice(0, 4).map((i) => i.message).join('; ') : ''}`).join(' | ')}`,
    ].join('\n'),
  apply: (m, op: Op) => {
    const a = op as Record<string, unknown>
    const w = m.walls.find((x) => x.mark === a.wall)
    const o = openings(m).find((x) => key(x) === a.opening)
    const updO = (patch: Partial<Opening>) => ({ ...m, doors: m.doors.map((x) => (x.id === o!.id ? { ...x, ...patch } : x)), windows: m.windows.map((x) => (x.id === o!.id ? { ...x, ...patch } : x)) })
    const updW = (patch: Partial<typeof w>) => ({ ...m, walls: m.walls.map((x) => (x.id === w!.id ? { ...x, ...patch } : x)) })
    switch (op.op) {
      case 'setWallType':
        return { model: updW({ typeId: a.type as string }), change: `${w!.mark}: ${w!.typeId} → ${a.type}` }
      case 'setWallTop':
        return { model: updW({ topLevel: a.topLevel as string, topOffset: a.topOffset as number }), change: `${w!.mark}: top ${w!.topLevel}${w!.topOffset ? '+' + w!.topOffset : ''} → ${a.topLevel}${a.topOffset ? '+' + a.topOffset : ''}` }
      case 'setWallBase':
        return { model: updW({ baseLevel: a.baseLevel as string, baseOffset: a.baseOffset as number }), change: `${w!.mark}: base ${w!.baseLevel}${w!.baseOffset ? '+' + w!.baseOffset : ''} → ${a.baseLevel}${a.baseOffset ? '+' + a.baseOffset : ''}` }
      case 'setOpeningSize':
        return { model: updO({ width: a.width as number, height: a.height as number, sill: a.sill as number }), change: `${key(o!)}: ${o!.width}×${o!.height} sill ${o!.sill} → ${a.width}×${a.height} sill ${a.sill} mm` }
      case 'moveOpening':
        return { model: updO({ offset: a.offset as number }), change: `${key(o!)}: offset ${o!.offset} → ${a.offset} mm` }
    }
    return { error: 'unknown operation' }
  },
  // the AI may not ADD model errors (walls keep a positive height, openings stay inside their wall
  // without overlaps); problems already in the model are reported by the checks, not blocked here
  validate: (m, before) => {
    const bad = m.walls.find((w) => wallHeight(m, w) <= 0 || w.length <= 0)
    if (bad) return `${bad.mark}: top must stay above base`
    const errs = (x: BimModel) => runModelChecks(x).filter((c) => c.status === 'error').flatMap((c) => c.items.map((i) => i.message))
    const old = new Set(errs(before))
    const added = errs(m).filter((e) => !old.has(e))
    return added.length ? added[0] : null
  },
  examples: [
    { request: 'Use the insulated 250 mm wall type for W6', reply: { title: 'W6 → 250 mm insulated concrete', ops: [{ op: 'setWallType', wall: 'W6', type: 'I250' }] } },
    { request: 'Add a lift shaft next to the stair', reply: { title: 'New elements cannot be created by the assistant yet', ops: [] } },
    { request: 'Mở rộng cửa sổ WN1 thành 2400 rộng, giữ cao 1500, bậu 900', reply: { title: 'Cửa sổ WN1 rộng 2400 mm', ops: [{ op: 'setOpeningSize', opening: 'WN1', width: 2400, height: 1500, sill: 900 }] } },
  ],
}
