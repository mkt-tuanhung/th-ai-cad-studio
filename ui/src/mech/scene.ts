/**
 * Parametric 3D model of the centrifugal pump assembly, built from the driving parameters.
 * Shaft axis = world X (pump at +X, motor at −X), Z up, base plate top at z = 0.
 * Every component id matches the Model Browser / BOM so picking selects the same item.
 */
import { box, cylBetween, revolve, vcyl, type Prim, type Scene, type SceneItem, type V3 } from '../engine3d/scene'
import { CASING_BORE, param, type MechModel } from './model'

const AX: V3 = [1, 0, 0]

/** Disc / ring on the shaft axis from x0 to x1 (outer r, inner ri). */
function ring(x0: number, x1: number, r: number, zA: number, ri = 0): Prim {
  // solid discs are exact cylinders: a profile touching the axis makes a degenerate revolved solid
  // that OCCT booleans cannot cut reliably
  if (ri <= 0) return { k: 'cyl', o: [x0, 0, zA], z: AX, x: [0, 0, 1], s: [r, x1 - x0, 0] }
  return revolve([x0, 0, zA], AX, [[ri, 0], [r, 0], [r, x1 - x0], [ri, x1 - x0]], [0, 0, 1])
}

export function pumpScene(m: MechModel, explode = 0): Scene {
  const imp = param(m, 'Impeller_Dia'), shaftD = param(m, 'Shaft_Dia'), t = param(m, 'Casing_Thickness')
  const dIn = param(m, 'D_inlet'), dOut = param(m, 'D_outlet'), bc = param(m, 'Bearing_Center'), kw = param(m, 'Motor_Power')
  const boreR = CASING_BORE / 2
  const rOut = boreR + t // volute outer radius
  const B = Math.max(60, imp * 0.32) // casing width along the axis
  const zA = rOut + 120 // shaft height above the base plate
  const e = explode // exploded-view offset (mm)
  const opacity = (id: string) => 1 - (m.components.find((c) => c.id === id)?.opacity ?? 100) / 100
  const items: SceneItem[] = []

  // ---- casing: volute disc + suction (axial, +X) and discharge (vertical) nozzles with flanges; cavity and bores cut
  const xs0 = B / 2, xs1 = B / 2 + 180
  const zd0 = zA, zd1 = zA + rOut + 170
  items.push({
    id: 'casing',
    rgb: [0.72, 0.74, 0.77],
    transparency: opacity('casing'),
    fuse: true,
    parts: [
      ring(-B / 2 - t, B / 2, rOut, zA),
      ring(xs0, xs1, dIn / 2 + t, zA),
      ring(xs1 - 22, xs1, dIn / 2 + 62, zA),
      vcyl(0, rOut * 0.55, zd0, dOut / 2 + t, zd1 - zd0),
      vcyl(0, rOut * 0.55, zd1 - 22, dOut / 2 + 58, 22),
      box(-B / 2 - t, -rOut * 0.95, 0, B + t, rOut * 1.9, zA - rOut + 20), // casing foot
    ],
    cuts: [
      ring(-B / 2, B / 2 - t, boreR, zA), // impeller chamber
      ring(B / 2 - t - 1, xs1 + 1, dIn / 2, zA), // suction bore
      vcyl(0, rOut * 0.55, zA, dOut / 2, zd1 - zA + 1), // discharge bore
      ring(-B / 2 - t - 1, -B / 2 + 1, shaftD / 2 + 12, zA), // shaft passage in the back wall
    ],
  })

  // ---- impeller: back shroud, front shroud (eye), hub and 6 vanes, inside the chamber
  const ri = imp / 2, w = Math.min(B - 2 * t - 8, imp * 0.12)
  const ix0 = -w / 2 + e * 1.2
  const vanes: Prim[] = []
  for (let k = 0; k < 6; k++) {
    const a = (k * Math.PI) / 3
    const r0 = Math.max(shaftD / 2 + 18, dIn / 2 * 0.8)
    vanes.push({ k: 'box', o: [ix0 + 6, Math.cos(a) * r0 - Math.sin(a) * 3, zA + Math.sin(a) * r0 + Math.cos(a) * 3], x: [0, Math.cos(a), Math.sin(a)], z: [1, 0, 0], s: [ri - r0 - 2, 6, w - 12] })
  }
  items.push({
    id: 'impeller',
    rgb: [0.8, 0.66, 0.42],
    transparency: opacity('impeller'),
    fuse: true,
    parts: [ring(ix0, ix0 + 6, ri, zA), ring(ix0 + w - 6, ix0 + w, ri, zA, dIn / 2 * 0.85), ring(ix0 - 10, ix0 + w * 0.6, shaftD / 2 + 14, zA), ...vanes],
    cuts: [ring(ix0 - 11, ix0 + w + 1, shaftD / 2, zA)],
  })

  // ---- shaft from the impeller through the bearings to the coupling
  const xbh0 = -B / 2 - t - 90, xbh1 = xbh0 - bc - 80
  const xc = xbh1 - 70 // coupling face (pump-side hub)
  items.push({ id: 'shaft', rgb: [0.55, 0.58, 0.62], transparency: opacity('shaft'), parts: [cylBetween([w / 2 + 12 + e * 1.2, 0, zA], [xc - 58 - e * 1.6, 0, zA], shaftD / 2)] })

  // ---- mechanical seal between casing and bearing housing
  items.push({ id: 'seal', rgb: [0.25, 0.27, 0.3], transparency: opacity('seal'), parts: [ring(-B / 2 - t - 70 - e * 0.6, -B / 2 - t - 20 - e * 0.6, shaftD / 2 + 22, zA, shaftD / 2)] })

  // ---- bearing housing (2 × 6208: OD 80) with foot; bore for the bearings
  items.push({
    id: 'bearing',
    rgb: [0.45, 0.48, 0.52],
    transparency: opacity('bearing'),
    fuse: true,
    parts: [
      ring(xbh1 - e * 0.8, xbh0 - e * 0.8, 92, zA),
      ring(xbh0 - 18 - e * 0.8, xbh0 - e * 0.8, 120, zA),
      box(xbh1 + 20 - e * 0.8, -112, 0, 60, 224, zA - 60), // feet (cast pads)
      box(xbh0 - 80 - e * 0.8, -112, 0, 60, 224, zA - 60),
    ],
    cuts: [ring(xbh1 - 1 - e * 0.8, xbh0 + 1 - e * 0.8, 40, zA), ring(xbh1 + 40 - e * 0.8, xbh0 - 40 - e * 0.8, 70, zA, 0)], // bearing bore, oil sump
  })

  // ---- coupling: two hubs and the elastic spider gap
  items.push({
    id: 'coupling',
    rgb: [0.2, 0.22, 0.26],
    transparency: opacity('coupling'),
    parts: [ring(xc - 60 - e * 1.6, xc - e * 1.6, 68, zA, shaftD / 2), ring(xc - 126 - e * 1.6, xc - 66 - e * 1.6, 68, zA, shaftD / 2)],
  })

  // ---- motor (frame size grows with power ∝ kW^(1/3)), terminal box, feet, on its mount
  const rm = 118 * Math.cbrt(kw / 11), lm = rm * 3.2
  const xm1 = xc - 170 - e * 2.2, xm0 = xm1 - lm
  const fins: Prim[] = []
  for (let k = 0; k < 12; k++) fins.push(ring(xm0 + 40 + k * (lm - 120) / 12, xm0 + 46 + k * (lm - 120) / 12, rm + 10, zA))
  items.push({
    id: 'motormount',
    rgb: [0.16, 0.35, 0.65],
    transparency: opacity('motormount'),
    parts: [
      ring(xm0, xm1, rm, zA, rm - 12), // frame
      ring(xm0 + 25, xm1 - 25, rm - 12, zA, rm * 0.62), // stator core
      ring(xm0 + 30, xm1 - 30, rm * 0.58, zA), // rotor
      ring(xm0, xm0 + 18, rm, zA), // end shields
      ring(xm1 - 18, xm1, rm, zA),
      ring(xm1, xm1 + 30, rm * 0.75, zA),
      ...fins,
      box(xm0 + lm * 0.35, -rm * 0.45, zA + rm - 10, lm * 0.3, rm * 0.9, 90), // terminal box
      box(xm0 + 30, -rm - 40, 0, lm - 60, 60, zA - rm + 10), // mount rails
      box(xm0 + 30, rm - 20, 0, lm - 60, 60, zA - rm + 10),
      cylBetween([xm1 + 30, 0, zA], [xc - 68 - e * 1.6, 0, zA], shaftD / 2), // motor shaft end, into the motor-side hub
    ],
  })

  // ---- hold-down bolts (fasteners) through drilled holes in the feet and the base plate
  const bolts: Prim[] = []
  const holes: Prim[] = []
  // [x, top of the foot it holds]: shank through foot + plate, head on the foot
  // [x, top of the foot, bolt offset across] — bolts sit outside the round bodies above the feet
  const feet: [number, number, number][] = [
    [xbh1 + 50 - e * 0.8, zA - 60, 94], [xbh0 - 50 - e * 0.8, zA - 60, 94],
    [xm0 + 60, zA - rm + 10, rm + 14], [xm1 - 60, zA - rm + 10, rm + 14],
    [-B / 2 - t + 10, zA - rOut + 20, rOut * 0.95 - 16], [B / 2 - 10, zA - rOut + 20, rOut * 0.95 - 16],
  ]
  for (const [x, top, off] of feet)
    for (const y of [-off, off]) {
      bolts.push(vcyl(x, y, -100, 8, top + 100), vcyl(x, y, top, 13, 10))
      holes.push(vcyl(x, y, -130, 8, top + 130))
    }
  items.push({ id: 'fasteners', rgb: [0.3, 0.32, 0.35], transparency: opacity('fasteners'), parts: bolts })
  for (const it of items) if (it.id === 'casing' || it.id === 'bearing' || it.id === 'motormount') it.cuts = [...(it.cuts ?? []), ...holes]

  // ---- base plate (fabricated) under everything
  const bx0 = xm0 - 80, bx1 = xs1 + 60
  items.push({ id: 'baseplate', rgb: [0.62, 0.64, 0.67], transparency: opacity('baseplate'), parts: [
    box(bx0, -rOut - 120, -16 - e * 0.3, bx1 - bx0, (rOut + 120) * 2, 16), // deck plate
    box(bx0, -rOut - 120, -110 - e * 0.3, bx1 - bx0, 70, 94), // side channels
    box(bx0, rOut + 50, -110 - e * 0.3, bx1 - bx0, 70, 94),
    ...[bx0, (bx0 + bx1) / 2, bx1 - 60].map((x) => box(x, -rOut - 50, -110 - e * 0.3, 60, (rOut + 50) * 2, 94)), // cross members
  ], fuse: true, cuts: holes })

  return { items, volumes: true }
}
