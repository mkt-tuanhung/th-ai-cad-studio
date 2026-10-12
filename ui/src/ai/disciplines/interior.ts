import type { Discipline, Op, OpSpec } from '../discipline'
import { MATERIALS, area, cutList, dimsLabel, type Item, type ItemCategory } from '../../interior/model'
import { validateInterior, type InteriorDoc } from '../../state/interior'
import { interiorVi } from '../../i18n/ws/interior'

const CATS: ItemCategory[] = ['sofas', 'tables', 'cabinet', 'chairs', 'lighting', 'beds', 'decor', 'rugs']
const mats = MATERIALS.map((m) => m.name)

export const interiorAi: Discipline<InteriorDoc> = {
  key: 'interior',
  role: 'interior design',
  ops: (d): OpSpec[] => {
    const items = d.items.map((i) => i.id), rooms = d.rooms.map((r) => r.id)
    return [
      { op: 'setItemMaterial', desc: 'change the material / finish of a furniture item', args: { item: { kind: 'enum', values: items }, material: { kind: 'enum', values: mats } } },
      { op: 'setItemQuantity', desc: 'change how many of an item', args: { item: { kind: 'enum', values: items }, qty: { kind: 'number', min: 1, max: 50, integer: true } } },
      { op: 'setItemSize', desc: 'change width × depth × height of a rectangular item', args: { item: { kind: 'enum', values: items }, w: { kind: 'number', min: 100, max: 8000, unit: 'mm', integer: true }, d: { kind: 'number', min: 100, max: 8000, unit: 'mm', integer: true }, h: { kind: 'number', min: 5, max: 3000, unit: 'mm', integer: true } } },
      { op: 'moveItem', desc: 'move an item to another room', args: { item: { kind: 'enum', values: items }, room: { kind: 'enum', values: rooms } } },
      { op: 'setItemStatus', desc: 'mark an item placed or planned', args: { item: { kind: 'enum', values: items }, status: { kind: 'enum', values: ['placed', 'planned'] } } },
      { op: 'addItem', desc: 'add a new (planned) furniture item to a room', args: { name: { kind: 'string', desc: 'short product name' }, category: { kind: 'enum', values: CATS }, room: { kind: 'enum', values: rooms }, w: { kind: 'number', min: 100, max: 8000, unit: 'mm', integer: true }, d: { kind: 'number', min: 100, max: 8000, unit: 'mm', integer: true }, h: { kind: 'number', min: 5, max: 3000, unit: 'mm', integer: true }, material: { kind: 'enum', values: mats }, qty: { kind: 'number', min: 1, max: 50, integer: true } } },
      { op: 'removeItem', desc: 'remove an item from the design', args: { item: { kind: 'enum', values: items } } },
      { op: 'setRoomFinish', desc: 'change the floor, wall or ceiling finish of a room', args: { room: { kind: 'enum', values: rooms }, surface: { kind: 'enum', values: ['floor', 'wall', 'ceiling'] }, material: { kind: 'enum', values: mats } } },
      { op: 'setCabinet', desc: 'resize a parametric cabinet (the production cut list is regenerated)', args: { cabinet: { kind: 'enum', values: d.cabinets.map((c) => c.id) }, w: { kind: 'number', min: 300, max: 6000, unit: 'mm', integer: true }, d: { kind: 'number', min: 250, max: 900, unit: 'mm', integer: true }, h: { kind: 'number', min: 300, max: 2800, unit: 'mm', integer: true }, shelves: { kind: 'number', min: 0, max: 10, integer: true }, doors: { kind: 'number', min: 0, max: 12, integer: true } } },
    ]
  },
  context: (d) =>
    [
      'Rooms (id | name | area m² | floor | wall | ceiling finish):',
      ...d.rooms.map((r) => `${r.id} | ${r.name} | ${area(r.outline).toFixed(1)} | ${r.floorFinish} | ${r.wallFinish} | ${r.ceilingFinish}`),
      'Items (id | name | category | room | size mm | material | qty | status | cabinet):',
      ...d.items.map((i) => `${i.id} | ${i.name} | ${i.category} | ${i.room} | ${dimsLabel(i)} | ${i.material} | ${i.qty} | ${i.status} | ${i.cabinet ?? '-'}`),
      'Cabinets (id | name | w×d×h mm | shelves | doors | board):',
      ...d.cabinets.map((c) => `${c.id} | ${c.name} | ${c.w}×${c.d}×${c.h} | ${c.shelves} | ${c.doors} | ${c.board}`),
      // Vietnamese names help requests written in Vietnamese (gỗ óc chó = walnut, …)
      `Materials (name = Vietnamese): ${mats.map((n) => (interiorVi.matNames[n] ? `${n} = ${interiorVi.matNames[n]}` : n)).join('; ')}`,
    ].join('\n'),
  apply: (d, op: Op) => {
    const a = op as Record<string, unknown>
    const item = d.items.find((i) => i.id === a.item)
    const upd = (patch: Partial<Item>) => ({ ...d, items: d.items.map((i) => (i.id === item!.id ? { ...i, ...patch } : i)) })
    const room = (id: unknown) => d.rooms.find((r) => r.id === id)?.name ?? String(id)
    switch (op.op) {
      case 'setItemMaterial':
        return { model: upd({ material: a.material as string }), change: `${item!.name}: ${item!.material} → ${a.material}` }
      case 'setItemQuantity':
        return { model: upd({ qty: a.qty as number }), change: `${item!.name}: qty ${item!.qty} → ${a.qty}` }
      case 'setItemSize':
        if (item!.dia) return { error: `${item!.name} is round (Ø) — size by diameter is not supported` }
        return { model: upd({ w: a.w as number, d: a.d as number, h: a.h as number }), change: `${item!.name}: ${dimsLabel(item!)} → ${a.w} × ${a.d} × ${a.h} mm` }
      case 'moveItem':
        return { model: upd({ room: a.room as string }), change: `${item!.name}: ${room(item!.room)} → ${room(a.room)}` }
      case 'setItemStatus':
        return { model: upd({ status: a.status as Item['status'] }), change: `${item!.name}: ${item!.status} → ${a.status}` }
      case 'addItem': {
        const it: Item = { id: `i${Date.now()}${Math.floor(Math.random() * 1000)}`, name: String(a.name).slice(0, 60) || 'Item', category: a.category as ItemCategory, room: a.room as string, w: a.w as number, d: a.d as number, h: a.h as number, material: a.material as string, qty: a.qty as number, status: 'planned' }
        return { model: { ...d, items: [...d.items, it] }, change: `+ ${it.name} (${it.category}) in ${room(it.room)}: ${dimsLabel(it)} mm, ${it.material} × ${it.qty} (planned)` }
      }
      case 'removeItem':
        return { model: { ...d, items: d.items.filter((i) => i.id !== item!.id) }, change: `− ${item!.name} (${room(item!.room)})` }
      case 'setRoomFinish': {
        const r = d.rooms.find((x) => x.id === a.room)!
        const key = a.surface === 'floor' ? 'floorFinish' : a.surface === 'wall' ? 'wallFinish' : 'ceilingFinish'
        return { model: { ...d, rooms: d.rooms.map((x) => (x.id === r.id ? { ...x, [key]: a.material as string } : x)) }, change: `${r.name}: ${a.surface} ${r[key]} → ${a.material}` }
      }
      case 'setCabinet': {
        const c = d.cabinets.find((x) => x.id === a.cabinet)!
        const nc = { ...c, w: a.w as number, d: a.d as number, h: a.h as number, shelves: a.shelves as number, doors: a.doors as number }
        const parts = (x: typeof c) => cutList(x).reduce((s, p) => s + p.qty, 0)
        return {
          model: { ...d, cabinets: d.cabinets.map((x) => (x.id === c.id ? nc : x)), items: d.items.map((i) => (i.cabinet === c.id ? { ...i, w: nc.w, d: nc.d, h: nc.h } : i)) },
          change: `${c.name}: ${c.w}×${c.d}×${c.h}, ${c.shelves} shelves, ${c.doors} doors → ${nc.w}×${nc.d}×${nc.h}, ${nc.shelves} shelves, ${nc.doors} doors · cut list ${parts(c)} → ${parts(nc)} parts`,
        }
      }
    }
    return { error: 'unknown operation' }
  },
  validate: validateInterior,
  examples: [
    { request: 'Change the dining chairs to linen fabric', reply: { title: 'Dining chairs in linen', ops: [{ op: 'setItemMaterial', item: 'i5', material: 'Fabric - Linen' }] } },
    { request: 'Build a new wall between the kitchen and the living room', reply: { title: 'Walls are edited in the BIM model, not in the interior design', ops: [] } },
    { request: 'Thêm một kệ sách gỗ sồi 1200x350x1800 vào phòng ngủ 1', reply: { title: 'Thêm kệ sách gỗ sồi vào Phòng ngủ 1', ops: [{ op: 'addItem', name: 'Bookshelf', category: 'cabinet', room: 'bed1', w: 1200, d: 350, h: 1800, material: 'Wood - Oak', qty: 1 }] } },
  ],
}
