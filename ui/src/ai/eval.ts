/**
 * Held-out evaluation of the discipline assistants with the real local model (run inside the desktop
 * app: tools/ai-discipline-eval.js). Each request is checked by machine on the RESULT model — not on
 * the wording of the reply. None of these requests appear in the prompt examples.
 */
import type { Discipline, Op, Preview } from './discipline'
import { mepAi } from './disciplines/mep'
import { interiorAi } from './disciplines/interior'
import { civilAi } from './disciplines/civil'
import { mechAi } from './disciplines/mechanical'
import { bimAi } from './disciplines/bim'
import { createVillaMep, designChecks as mepFindings, findClashes } from '../mep/model'
import { CABINETS, ITEMS, ROOMS } from '../interior/model'
import { checks, createNorthCanal, interp, segments } from '../civil/model'
import { createPump, param } from '../mech/model'
import { createVillaBim } from '../bim/model'

export interface EvalCase<M> {
  request: string
  check: (m: M, ops: Op[]) => boolean
}

export interface EvalSet<M> {
  d: Discipline<M>
  base: () => M
  cases: EvalCase<M>[]
}

const near = (a: number, b: number, tol = 1e-6) => Math.abs(a - b) <= tol

export const EVAL: EvalSet<any>[] = [
  {
    d: mepAi,
    base: createVillaMep,
    cases: [
      { request: 'Resize SA-02 on level 2 to 600 x 300', check: (m) => { const d = m.ducts.find((x: any) => x.id === 'SA-02-L2'); return d.w === 600 && d.h === 300 } },
      { request: 'Lower OA-15 on level 2 below the beams', check: (m) => !findClashes(m).some((c: any) => c.id.includes('OA-15-L2')) },
      { request: 'Tăng tiết diện cáp của mạch C5 lên 10 mm²', check: (m) => m.circuits.find((c: any) => c.id === 'C5').cable === 10 },
      { request: 'Change pipe CHWS-1 to DN 80', check: (m) => m.pipes.find((p: any) => p.id === 'CHWS-1').dn === 80 },
      { request: 'Set the breaker of circuit C12 to 32 A', check: (m) => m.circuits.find((c: any) => c.id === 'C12').breaker === 32 },
      { request: 'Raise duct RA-01 on level 2 to an elevation of 2900 mm', check: (m) => m.ducts.find((x: any) => x.id === 'RA-01-L2').elevation === 2900 },
      { request: 'Fix the voltage drop of every circuit that is above 3 %', check: (m) => !mepFindings(m).some((f: any) => f.rule === 'vd') },
      { request: 'Đổi ống gió EA-01 tầng 2 thành 500x300 và đặt cao độ 2600', check: (m) => { const d = m.ducts.find((x: any) => x.id === 'EA-01-L2'); return d.w === 500 && d.h === 300 && d.elevation === 2600 } },
    ],
  },
  {
    d: interiorAi,
    base: () => ({ rooms: ROOMS, items: ITEMS, cabinets: CABINETS }),
    cases: [
      { request: 'Make the sofa olive fabric', check: (m) => m.items.find((i: any) => i.id === 'i1').material === 'Fabric - Olive' },
      { request: 'Đổi sàn phòng khách sang đá marble trắng', check: (m) => m.rooms.find((r: any) => r.id === 'living').floorFinish === 'Marble - White' },
      { request: 'We need 8 dining chairs instead of 6', check: (m) => m.items.find((i: any) => i.id === 'i5').qty === 8 },
      { request: 'Remove the linear pendant', check: (m) => !m.items.some((i: any) => i.id === 'i10') && m.items.length === ITEMS.length - 1 },
      { request: 'Mark the wardrobe as placed', check: (m) => m.items.find((i: any) => i.id === 'i11').status === 'placed' },
      { request: 'Move the lounge armchair to the master bedroom', check: (m) => m.items.find((i: any) => i.id === 'i7').room === 'master' },
      { request: 'Make the TV cabinet 2800 mm wide; keep its depth, height, 1 shelf and 4 doors', check: (m) => { const c = m.cabinets.find((x: any) => x.id === 'c1'); return c.w === 2800 && c.d === 400 && c.h === 500 && c.shelves === 1 && c.doors === 4 } },
      { request: 'Thêm 2 tab đầu giường gỗ óc chó 500x400x550 vào phòng ngủ chính', check: (m) => m.items.some((i: any) => !ITEMS.some((x) => x.id === i.id) && i.room === 'master' && i.qty === 2 && i.material === 'Wood - Walnut' && i.w === 500 && i.d === 400 && i.h === 550) },
    ],
  },
  {
    d: civilAi,
    base: createNorthCanal,
    cases: [
      { request: 'Set the bottom width to 7.5 m', check: (m) => m.params.bottomWidth === 7.5 },
      { request: 'Đặt hệ số nhám Manning là 0.014', check: (m) => m.params.manningN === 0.014 },
      { request: 'Fix the flat segment 480–500 with a slope of 0.0005', check: (m) => near((interp(m.invert, 480) - interp(m.invert, 500)) / 20, 0.0005, 2e-5) },
      { request: 'Move culvert CL-02 to station 540', check: (m) => m.culverts.find((c: any) => c.id === 'CL-02').station === 540 },
      { request: 'Increase the freeboard to 0.6 m', check: (m) => m.params.freeboard === 0.6 },
      { request: 'The design discharge is now 8 m3/s', check: (m) => m.params.discharge === 8 },
      { request: 'Fix all flat segments using the minimum design slope', check: (m) => checks(m).flat.length === 0 && segments(m.invert).length >= 2 },
      { request: 'Set the invert at station 300 to 6.10 m', check: (m) => near(interp(m.invert, 300), 6.1, 1e-6) },
    ],
  },
  {
    d: mechAi,
    base: createPump,
    cases: [
      { request: 'Set the impeller diameter to 210 mm', check: (m) => param(m, 'Impeller_Dia') === 210 },
      { request: 'Change the pump casing material to Duplex 2205', check: (m) => m.components.find((c: any) => c.id === 'casing').material === 'Duplex 2205' },
      { request: 'Đổi công suất động cơ lên 15 kW', check: (m) => param(m, 'Motor_Power') === 15 },
      { request: 'Make the casing walls 10 mm thick', check: (m) => param(m, 'Casing_Thickness') === 10 },
      { request: 'The shaft should be made of AISI 1045', check: (m) => m.components.find((c: any) => c.id === 'shaft').material === 'AISI 1045' },
      { request: 'Use a DN 50 outlet flange', check: (m) => param(m, 'D_outlet') === 50 },
      { request: 'Run the pump at 1450 rpm', check: (m) => param(m, 'Speed') === 1450 },
      { request: 'Tăng khoảng cách giữa hai ổ bi lên 320 mm', check: (m) => param(m, 'Bearing_Center') === 320 },
    ],
  },
  {
    d: bimAi,
    base: createVillaBim,
    cases: [
      { request: 'Use the insulated 250 mm wall type for W8', check: (m) => m.walls.find((w: any) => w.mark === 'W8').typeId === 'I250' },
      { request: 'Make window WN5 1800 wide and 1500 high with a 900 sill', check: (m) => { const o = m.windows.find((x: any) => x.mark === 'WN5'); return o.width === 1800 && o.height === 1500 && o.sill === 900 } },
      { request: 'Move door D2 to an offset of 1200 mm', check: (m) => m.doors.find((x: any) => x.mark === 'D2').offset === 1200 },
      { request: 'The top of wall W4 should be Level 3 minus 300 mm', check: (m) => { const w = m.walls.find((x: any) => x.mark === 'W4'); return w.topLevel === 'L3' && w.topOffset === -300 } },
      { request: 'Đổi tường W10 sang loại tường bê tông 200', check: (m) => m.walls.find((w: any) => w.mark === 'W10').typeId === 'C200' },
      { request: 'Raise the sill of window WN9 to 1200 mm and keep its size', check: (m) => { const o = m.windows.find((x: any) => x.mark === 'WN9'); return o.sill === 1200 && o.width === 1500 && o.height === 1500 } },
      { request: 'Make the four level 1 exterior walls W6, W7, W8 and W9 the 250 mm insulated type', check: (m) => ['W6', 'W7', 'W8', 'W9'].every((k) => m.walls.find((w: any) => w.mark === k).typeId === 'I250') },
      { request: 'Add a staircase between level 1 and level 2', check: (_m, ops) => ops.length === 0 },
    ],
  },
]

export interface CaseResult {
  discipline: string
  request: string
  pass: boolean
  seconds: number
  retried: boolean
  changes: string[]
  error?: string
}

/** Scores one reply: applied without error and the check holds on the result. */
export function score<M>(set: EvalSet<M>, c: EvalCase<M>, pv: Preview<M> | null): boolean {
  if (!pv) return false
  if (pv.ops.length === 0) return c.check(set.base(), [])
  return !!pv.model && !pv.error && c.check(pv.model, pv.ops)
}

/**
 * Second held-out set, written after the first run and BEFORE the fixes it motivated (validate only new
 * errors, computed cable upsizing, Vietnamese material names) — to measure what the fixes generalise to.
 */
export const EVAL_B: EvalSet<any>[] = [
  {
    d: mepAi,
    base: createVillaMep,
    cases: [
      { request: 'Make duct SA-01 on level 2 800 x 400', check: (m) => { const d = m.ducts.find((x: any) => x.id === 'SA-01-L2'); return d.w === 800 && d.h === 400 } },
      { request: 'Đổi CB của mạch C3 thành 25 A', check: (m) => m.circuits.find((c: any) => c.id === 'C3').breaker === 25 },
      { request: 'Pipe SAN-2 should be DN 100', check: (m) => m.pipes.find((p: any) => p.id === 'SAN-2').dn === 100 },
      { request: 'Upsize the cable of circuit C14 so its voltage drop is within the limit', check: (m) => { const c = m.circuits.find((x: any) => x.id === 'C14'); return !mepFindings(m).some((f: any) => f.target.id === 'C14' && f.rule === 'vd') && c.cable >= 1.5 } },
      { request: 'Install a new chiller on the roof', check: (_m, ops) => ops.length === 0 },
    ],
  },
  {
    d: interiorAi,
    base: () => ({ rooms: ROOMS, items: ITEMS, cabinets: CABINETS }),
    cases: [
      { request: 'Sơn tường phòng ngủ 1 màu trắng ấm', check: (m) => m.rooms.find((r: any) => r.id === 'bed1').wallFinish === 'Paint - Warm White' },
      { request: 'Use black metal for the pendant lights over the dining table', check: (m) => m.items.find((i: any) => i.id === 'i6').material === 'Metal - Black' },
      { request: 'Bỏ tấm thảm phòng khách', check: (m) => !m.items.some((i: any) => i.id === 'i8') },
      { request: 'Make the kitchen base cabinet 3000 wide with 5 doors, same depth and height, 1 shelf', check: (m) => { const c = m.cabinets.find((x: any) => x.id === 'c2'); return c.w === 3000 && c.doors === 5 && c.d === 600 && c.h === 850 && c.shelves === 1 } },
      { request: 'Đổi sofa sang vải màu be', check: (m) => m.items.find((i: any) => i.id === 'i1').material === 'Fabric - Beige' },
    ],
  },
  {
    d: civilAi,
    base: createNorthCanal,
    cases: [
      { request: 'Use a side slope of 1.5', check: (m) => m.params.sideSlope === 1.5 },
      { request: 'Đổi chiều dày lớp lót thành 0.15 m', check: (m) => m.params.liningT === 0.15 },
      { request: 'Regrade 0+000 to 0+120 at 0.0012', check: (m) => near((interp(m.invert, 0) - interp(m.invert, 120)) / 120, 0.0012, 2e-5) },
      { request: 'Dời cống CL-01 đến lý trình 0+260', check: (m) => m.culverts.find((c: any) => c.id === 'CL-01').station === 260 },
      { request: 'Design a fish ladder at station 400', check: (_m, ops) => ops.length === 0 },
    ],
  },
  {
    d: mechAi,
    base: createPump,
    cases: [
      { request: 'Shaft diameter 50 mm please', check: (m) => param(m, 'Shaft_Dia') === 50 },
      { request: 'Đổi vật liệu cánh bơm sang đồng (bronze)', check: (m) => m.components.find((c: any) => c.id === 'impeller').material === 'Bronze' },
      { request: 'Inlet flange DN 100', check: (m) => param(m, 'D_inlet') === 100 },
      { request: 'Make the base plate from stainless 304', check: (m) => m.components.find((c: any) => c.id === 'baseplate').material === 'Stainless Steel - 304' },
      { request: 'Tốc độ quay 1800 vòng/phút', check: (m) => param(m, 'Speed') === 1800 },
    ],
  },
  {
    d: bimAi,
    base: createVillaBim,
    cases: [
      { request: 'Change W2 to the 150 mm partition type', check: (m) => m.walls.find((w: any) => w.mark === 'W2').typeId === 'P150' },
      { request: 'Cửa sổ WN12 rộng 1800, cao 1500, bậu 900', check: (m) => { const o = m.windows.find((x: any) => x.mark === 'WN12'); return o.width === 1800 && o.height === 1500 && o.sill === 900 } },
      { request: 'Move door D5 to an offset of 300 mm', check: (m) => m.doors.find((x: any) => x.mark === 'D5').offset === 300 },
      { request: 'Wall W21 should stop 200 mm below the roof level', check: (m) => { const w = m.walls.find((x: any) => x.mark === 'W21'); return w.topLevel === 'RF' && w.topOffset === -200 } },
      { request: 'Create a new floor level at 12000 mm', check: (_m, ops) => ops.length === 0 },
    ],
  },
]

/** Third set, written before running it, after adding the refusal rule and refusal examples. */
export const EVAL_C: EvalSet<any>[] = [
  { d: mepAi, base: createVillaMep, cases: [
    { request: 'Add a new fan coil unit in bedroom 2', check: (_m, ops) => ops.length === 0 },
    { request: 'Set duct SA-01 on level 2 to 650 x 400', check: (m) => { const d = m.ducts.find((x: any) => x.id === 'SA-01-L2'); return d.w === 650 && d.h === 400 } },
  ] },
  { d: interiorAi, base: () => ({ rooms: ROOMS, items: ITEMS, cabinets: CABINETS }), cases: [
    { request: 'Install underfloor heating in the bathroom', check: (_m, ops) => ops.length === 0 },
    { request: 'Change the coffee table to walnut wood', check: (m) => m.items.find((i: any) => i.id === 'i2').material === 'Wood - Walnut' },
  ] },
  { d: civilAi, base: createNorthCanal, cases: [
    { request: 'Build a pumping station at 0+600', check: (_m, ops) => ops.length === 0 },
    { request: 'Set the minimum design slope to 0.0004', check: (m) => m.params.slopeMin === 0.0004 },
  ] },
  { d: mechAi, base: createPump, cases: [
    { request: 'Add a cooling jacket to the casing', check: (_m, ops) => ops.length === 0 },
    { request: 'Casing thickness 14 mm', check: (m) => param(m, 'Casing_Thickness') === 14 },
  ] },
  { d: bimAi, base: createVillaBim, cases: [
    { request: 'Add a railing around the roof terrace', check: (_m, ops) => ops.length === 0 },
    { request: 'Door D9 should be 1000 wide and 2100 high', check: (m) => { const o = m.doors.find((x: any) => x.mark === 'D9'); return o.width === 1000 && o.height === 2100 && o.sill === 0 } },
  ] },
]
