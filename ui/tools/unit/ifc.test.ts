// IFC 4 export of the villa model plus one of every drawn element (run: UNIT=ifc node tools/test-cam.mjs run).
import { createVillaBim, type BimModel } from '../../src/bim/model'
import { ifcGuid, stepString, toIfc } from '../../src/bim/ifc'

export function model(): BimModel {
  const m = createVillaBim()
  return {
    ...m,
    walls: [...m.walls, { id: 'W25', category: 'wall', mark: 'W25', typeId: 'CW100', baseLevel: 'L1', baseOffset: 0, topLevel: 'L2', topOffset: 0, length: 6000, x: 14800, y: 1500, angle: 90 }],
    columns: [{ id: 'col-1', category: 'column', mark: 'C1', level: 'L1', topLevel: 'L2', x: 0, y: -2000, w: 400, d: 400 }, { id: 'col-2', category: 'column', mark: 'C2', level: 'L1', topLevel: 'L2', x: 4600, y: -2000, w: 400, d: 400, round: true }],
    slabs: [
      { id: 'slab-1', category: 'slab', mark: 'S1', kind: 'floor', level: 'L2', offset: 0, thickness: 200, outline: [[-300, -2300], [14100, -2300], [14100, 0], [-300, 0]] },
      { id: 'slab-2', category: 'slab', mark: 'RF1', kind: 'roof', level: 'RF', offset: 0, thickness: 250, outline: [[600, 600], [13200, 600], [13200, 9200], [600, 9200]] },
      { id: 'slab-3', category: 'slab', mark: 'CL1', kind: 'ceiling', level: 'L1', offset: 2700, thickness: 20, outline: [[0, 0], [4200, 0], [4200, 3600], [0, 3600]] },
    ],
    stairs: [{ id: 'stair-1', category: 'stair', mark: 'ST1', baseLevel: 'L1', topLevel: 'L2', x: 10400, y: 5600, angle: 90, length: 3600, width: 1000 }],
    railings: [{ id: 'rail-1', category: 'railing', mark: 'R1', level: 'L2', pts: [[-300, -2300], [14100, -2300], [14100, 0]], height: 1100 }],
    components: [{ id: 'comp-1', category: 'component', mark: 'F1', name: 'Bench', level: 'L1', x: 6900, y: -1200, w: 2000, d: 500, h: 450, rot: 15 }],
    rooms: [...m.rooms, { id: 'room-x', category: 'room', number: '107', name: 'Phòng khách', level: 'L1', area: 15.12, outline: [[0, 0], [4200, 0], [4200, 3600], [0, 3600]] }],
  }
}

export function run() {
  const r = toIfc(model(), 'Villa Riverside')
  return { counts: r.counts, bytes: r.text.length, guid: ifcGuid('wall:W1'), escaped: stepString('Phòng khách'), head: r.text.split('\n').slice(0, 6) }
}

export function write(path?: string) {
  const r = toIfc(model(), 'Villa Riverside')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return { text: r.text, path }
}
