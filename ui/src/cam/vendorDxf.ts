/**
 * "DXF for vendor CAM": machines with a PROPRIETARY controller (Biesse CIX / BPP, Homag MPR, SCM Xilog…) run
 * programs that their vendor CAM (bSolid, woodWOP, Maestro…) generates. This app does NOT write those native
 * formats; it exports one DXF R12 per part (finished size, face A up, x along the part length from its W1 end,
 * y from its L1 edge) whose LAYER NAMES carry the machining data the vendor CAM imports by layer mapping:
 *
 *   outline  OUTLINE                      closed polyline of the finished part
 *   drill    DRILL_D{d}_Z{z}              circle Ø d, depth z (vertical, from face A)
 *   hdrill   HDRILL_D{d}_Z{z}             short line from the edge inward: horizontal hole Ø d, depth z
 *   groove   GROOVE_W{w}_Z{z}             closed polyline of the groove / rebate, depth z
 *   pocket   POCKET_Z{z}                  (reserved; this cabinet model has none)
 *
 * The names are templates ({d} {z} {w} replaced, decimals with "_" for "."): the profile's ext.dxf_layers sets them
 * so they match the layer table configured in the vendor CAM. A TEXT on layer INFO states part id, revision,
 * material, thickness, finished / cut size, banding and "face A up".
 */
import { DEFAULT_EDGE_BAND, cutList, type Cabinet, type CutPart } from '../interior/model'
import { hardwarePlan, hingeCountFor, shelfPinHoles } from './hardware'
import type { MachineExt } from './machine'

export type DxfLayers = NonNullable<MachineExt['dxf_layers']>
export const DEFAULT_DXF_LAYERS: DxfLayers = { outline: 'OUTLINE', drill: 'DRILL_D{d}_Z{z}', groove: 'GROOVE_W{w}_Z{z}', pocket: 'POCKET_Z{z}' }

const num = (v: number) => (Math.round(v * 100) / 100).toString().replace('.', '_')
export const layerName = (tpl: string, v: { d?: number; z?: number; w?: number }) => tpl.replace('{d}', v.d !== undefined ? num(v.d) : '').replace('{z}', v.z !== undefined ? num(v.z) : '').replace('{w}', v.w !== undefined ? num(v.w) : '')

export interface PartFeature {
  kind: 'drill' | 'hdrill' | 'groove'
  x: number
  y: number
  d?: number
  depth: number
  /** groove: x1 / y1 (rectangle). */
  x1?: number
  y1?: number
  width?: number
  edge?: 'W1' | 'W2'
}

/** Features of a part in its FINISHED frame (same rules as the router CAM: legacy cups, shelf pins, hardware). */
export function partFeatures(c: Cabinet, p: CutPart, s: { hingeCups: boolean; shelfPins: boolean; backGroove: boolean }, piece: 1 | 2 = 1): PartFeature[] {
  const code = p.id.split('.').pop()
  const plan = hardwarePlan(c, { shelfPins: s.shelfPins })
  const out: PartFeature[] = []
  if (s.hingeCups && p.part === 'Door' && plan.legacyHinge) {
    const n = hingeCountFor(p.finished.l)
    for (let k = 0; k < n; k++) out.push({ kind: 'drill', x: 100 + (k * (p.finished.l - 200)) / (n - 1), y: 22.5, d: 35, depth: 12.5 })
  }
  if (s.shelfPins && c.shelves > 0 && (p.part === 'Side panel' || p.part === 'Divider')) for (const h of shelfPinHoles(p.finished.l, p.finished.w)) out.push({ kind: 'drill', ...h })
  for (const h of plan.holes) {
    if (h.part !== code || (h.piece && h.piece !== piece) || (h.purpose.startsWith('hinge') && !s.hingeCups)) continue
    out.push(h.op === 'DRILL_VERTICAL' ? { kind: 'drill', x: h.x, y: h.y, d: h.d, depth: h.depth } : { kind: 'hdrill', x: h.x, y: h.y, d: h.d, depth: h.depth, edge: h.x <= 1e-9 ? 'W1' : 'W2' })
  }
  if (s.backGroove) for (const g of p.grooves ?? []) out.push({ kind: 'groove', x: 0, y: p.finished.w - g.setback - g.width, x1: p.finished.l, y1: p.finished.w - g.setback, width: g.width, depth: g.depth })
  return out
}

/** DXF R12 text of one part. */
export function partDxf(p: CutPart, features: PartFeature[], layers: DxfLayers = DEFAULT_DXF_LAYERS): string {
  const o: string[] = ['0', 'SECTION', '2', 'ENTITIES']
  const poly = (layer: string, pts: [number, number][]) => {
    o.push('0', 'POLYLINE', '8', layer, '66', '1', '70', '1')
    for (const [x, y] of pts) o.push('0', 'VERTEX', '8', layer, '10', x.toFixed(3), '20', y.toFixed(3))
    o.push('0', 'SEQEND')
  }
  const L = p.finished.l, W = p.finished.w
  poly(layers.outline, [[0, 0], [L, 0], [L, W], [0, W]])
  const band = (['L1', 'L2', 'W1', 'W2'] as const).filter((k) => p.edges[k] > 0).map((k) => `${k}:${p.edges[k]}`).join(' ') || '-'
  o.push('0', 'TEXT', '8', 'INFO', '10', '0', '20', String(W + 20), '40', '12', '1', `${p.id} r${p.rev} ${p.part} ${p.material} T${p.t} finished ${L}x${W} cut ${p.cut.l}x${p.cut.w} band ${band} FACE A UP`)
  for (const f of features) {
    if (f.kind === 'drill') o.push('0', 'CIRCLE', '8', layerName(layers.drill, { d: f.d, z: f.depth }), '10', f.x.toFixed(3), '20', f.y.toFixed(3), '40', ((f.d ?? 0) / 2).toFixed(3))
    else if (f.kind === 'hdrill') {
      const x0 = f.edge === 'W2' ? L : 0, x1 = f.edge === 'W2' ? L - f.depth : f.depth
      o.push('0', 'LINE', '8', layerName(`H${layers.drill}`, { d: f.d, z: f.depth }), '10', x0.toFixed(3), '20', f.y.toFixed(3), '11', x1.toFixed(3), '21', f.y.toFixed(3))
    } else poly(layerName(layers.groove, { w: f.width, z: f.depth }), [[f.x, f.y], [f.x1!, f.y], [f.x1!, f.y1!], [f.x, f.y1!]])
  }
  o.push('0', 'ENDSEC', '0', 'EOF')
  return o.join('\r\n') + '\r\n'
}

/** One DXF per distinct part (side panels: left and right when their drilling differs). */
export function vendorDxfFiles(cabinets: Cabinet[], s: { hingeCups: boolean; shelfPins: boolean; backGroove: boolean }, layers: DxfLayers = DEFAULT_DXF_LAYERS, band = DEFAULT_EDGE_BAND): { name: string; text: string }[] {
  const out: { name: string; text: string }[] = []
  for (const c0 of cabinets) {
    const c = c0.edgeBand === undefined ? { ...c0, edgeBand: band } : c0
    for (const p of cutList(c)) {
      const f1 = partFeatures(c, p, s, 1), f2 = partFeatures(c, p, s, 2)
      const differ = p.qty > 1 && JSON.stringify(f1) !== JSON.stringify(f2)
      const base = `${p.id} ${p.part.replace(/\W+/g, '_')} r${p.rev}`
      if (differ) {
        out.push({ name: `${base} LEFT x${Math.ceil(p.qty / 2)}.dxf`, text: partDxf(p, f1, layers) }, { name: `${base} RIGHT x${Math.floor(p.qty / 2)}.dxf`, text: partDxf(p, f2, layers) })
      } else out.push({ name: `${base} x${p.qty}.dxf`, text: partDxf(p, f1, layers) })
    }
  }
  return out
}

/** README for the vendor-CAM DXF ZIP (EN; the UI states the same in VI). */
export function vendorDxfReadme(layers: DxfLayers, vendorCam: string | null): string {
  return [
    'DXF FOR VENDOR CAM - this ZIP is not a machine program.',
    `The machine program is generated by the vendor CAM${vendorCam ? ` (${vendorCam})` : ''} from these DXF files.`,
    'MD CAD AI STUDIO does not write CIX / BPP / MPR / Xilog or other native vendor formats.',
    '',
    'One DXF per part, finished size, face A up, X along the part length from its W1 end, Y from its L1 edge (mm).',
    'Layer names (set them to match the layer table of your vendor CAM in the machine profile):',
    `  outline : ${layers.outline}`,
    `  drill   : ${layers.drill}   (circle; {d} = diameter, {z} = depth, "_" = decimal point)`,
    `  h-drill : H${layers.drill}  (line from the edge inward; horizontal hole)`,
    `  groove  : ${layers.groove}  (closed polyline; {w} = width, {z} = depth)`,
    `  pocket  : ${layers.pocket}`,
    '  INFO    : text with part id, revision, material, thickness, finished / cut size, edge banding',
    '',
  ].join('\n')
}
