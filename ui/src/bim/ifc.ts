/**
 * IFC 4 export (ISO 10303-21 STEP physical file, Reference View geometry: swept solids).
 *
 * Project → Site → Building → one IfcBuildingStorey per level. Walls are extruded rectangles on their
 * placement line; each door / window cuts its host through an IfcOpeningElement (IfcRelVoidsElement) and
 * fills it (IfcRelFillsElement). Slabs / roofs are extruded outlines (IfcSlab FLOOR / ROOF), ceilings are
 * IfcCovering CEILING, columns, stairs (the flight's section — steps on the waist slab — swept across its width),
 * railings, furniture, curtain walls and rooms (IfcSpace, a core as a void) follow. Materials go through
 * IfcRelAssociatesMaterial, quantities through IfcElementQuantity.
 * Units: millimetre, m², m³, radian. GlobalIds are stable per element id (hash), so re-exports diff cleanly; a key
 * used twice (two elements of one id) gets a counted variant, so no GlobalId repeats in a file.
 */
import { levelOf, typeOf, wallArea, wallHeight, wallVolume, type BimModel, type P2 } from './model'
import { polyArea } from './geometry'
import { stairFlight, stairProfile, wedge } from './scene'
import { roofFrame, roofQuantities } from './roof'

const B64 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$'

/** 22-character IFC GlobalId from a string (FNV-1a based 128-bit hash, base-64 IFC alphabet). */
export function ifcGuid(seed: string): string {
  const bytes = new Uint8Array(16)
  for (let lane = 0; lane < 4; lane++) {
    let h = 0x811c9dc5 ^ (lane * 0x9e3779b9)
    for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 0x01000193) >>> 0
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0
    for (let k = 0; k < 4; k++) bytes[lane * 4 + k] = (h >>> (k * 8)) & 255
  }
  // 128 bits → 22 chars of 6 bits; the first one holds the top 2 bits (0–3)
  let n = BigInt(0)
  for (const b of bytes) n = (n << BigInt(8)) | BigInt(b)
  let out = ''
  for (let i = 21; i >= 0; i--) out += B64[Number((n >> BigInt(6 * i)) & BigInt(63))]
  return out
}

/** STEP string: ISO 10303-21 escapes (\X2\…\X0\ for non-ASCII). */
export function stepString(s: string | undefined | null): string {
  if (s === undefined || s === null) return '$'
  let out = ''
  for (const ch of s) {
    const c = ch.codePointAt(0)!
    if (ch === "'") out += "''"
    else if (ch === '\\') out += '\\\\'
    else if (c >= 32 && c < 127) out += ch
    else if (c <= 0xffff) out += `\\X2\\${c.toString(16).toUpperCase().padStart(4, '0')}\\X0\\`
    else out += '?'
  }
  return `'${out}'`
}

const num = (v: number) => {
  const r = Math.round(v * 1e6) / 1e6
  return Number.isInteger(r) ? `${r}.` : String(r)
}

class Writer {
  lines: string[] = []
  n = 0
  add(entity: string): string {
    this.n++
    this.lines.push(`#${this.n}=${entity};`)
    return `#${this.n}`
  }
}

export interface IfcResult {
  text: string
  counts: Record<string, number>
}

export function toIfc(m: BimModel, name = 'Villa Riverside', author = ''): IfcResult {
  const w = new Writer()
  const counts: Record<string, number> = {}
  // GlobalIds unique in the file even when two elements share an id (models read from several drawings): the n-th
  // use of a key gets "#n" — still stable from one export to the next
  const keyUses = new Map<string, number>()
  const guid = (key: string) => {
    const n = (keyUses.get(key) ?? 0) + 1
    keyUses.set(key, n)
    return ifcGuid(n === 1 ? key : `${key}#${n}`)
  }
  const count = (k: string) => (counts[k] = (counts[k] ?? 0) + 1)
  const pt3 = (x: number, y: number, z: number) => w.add(`IFCCARTESIANPOINT((${num(x)},${num(y)},${num(z)}))`)
  const pt2 = (x: number, y: number) => w.add(`IFCCARTESIANPOINT((${num(x)},${num(y)}))`)
  const dir3 = (x: number, y: number, z: number) => w.add(`IFCDIRECTION((${num(x)},${num(y)},${num(z)}))`)
  const dir2 = (x: number, y: number) => w.add(`IFCDIRECTION((${num(x)},${num(y)}))`)
  const ax3 = (o: [number, number, number], z?: [number, number, number], x?: [number, number, number]) => w.add(`IFCAXIS2PLACEMENT3D(${pt3(...o)},${z ? dir3(...z) : '$'},${x ? dir3(...x) : '$'})`)
  const ax2 = (x: number, y: number, rx = 1, ry = 0) => w.add(`IFCAXIS2PLACEMENT2D(${pt2(x, y)},${dir2(rx, ry)})`)
  const place = (rel: string | null, o: [number, number, number], angleDeg = 0) => {
    const a = (angleDeg * Math.PI) / 180
    return w.add(`IFCLOCALPLACEMENT(${rel ?? '$'},${ax3(o, [0, 0, 1], [Math.cos(a), Math.sin(a), 0])})`)
  }
  const up = dir3(0, 0, 1)

  // context and units
  const origin = ax3([0, 0, 0], [0, 0, 1], [1, 0, 0])
  const ctx = w.add(`IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,${origin},$)`)
  const body = w.add(`IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,*,*,${ctx},$,.MODEL_VIEW.,$)`)
  const units = w.add(`IFCUNITASSIGNMENT((${[
    w.add('IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.)'),
    w.add('IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.)'),
    w.add('IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.)'),
    w.add('IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.)'),
  ].join(',')}))`)
  const project = w.add(`IFCPROJECT('${guid('project:' + name)}',$,${stepString(name)},$,$,$,$,(${ctx}),${units})`)

  const sitePl = place(null, [0, 0, 0])
  const site = w.add(`IFCSITE('${guid('site')}',$,'Site',$,$,${sitePl},$,$,.ELEMENT.,$,$,$,$,$)`)
  const bldPl = place(sitePl, [0, 0, 0])
  const building = w.add(`IFCBUILDING('${guid('building')}',$,${stepString(name)},$,$,${bldPl},$,$,.ELEMENT.,$,$,$)`)
  w.add(`IFCRELAGGREGATES('${guid('agg:project')}',$,$,$,${project},(${site}))`)
  w.add(`IFCRELAGGREGATES('${guid('agg:site')}',$,$,$,${site},(${building}))`)

  const levels = [...m.levels].sort((a, b) => a.elevation - b.elevation)
  const storey: Record<string, { ref: string; pl: string; items: string[]; spaces: string[] }> = {}
  for (const l of levels) {
    const pl = place(bldPl, [0, 0, l.elevation])
    storey[l.id] = { ref: w.add(`IFCBUILDINGSTOREY('${guid('level:' + l.id)}',$,${stepString(l.name)},$,$,${pl},$,$,.ELEMENT.,${num(l.elevation)})`), pl, items: [], spaces: [] }
    count('IfcBuildingStorey')
  }
  w.add(`IFCRELAGGREGATES('${guid('agg:building')}',$,$,$,${building},(${levels.map((l) => storey[l.id].ref).join(',')}))`)
  const st = (id: string) => storey[id] ?? storey[levels[0].id]
  const elev = (id: string) => levelOf(m, id)?.elevation ?? 0

  const shape = (items: string[], kind = 'SweptSolid') => w.add(`IFCPRODUCTDEFINITIONSHAPE($,$,(${w.add(`IFCSHAPEREPRESENTATION(${body},'Body','${kind}',(${items.join(',')}))`)}))`)
  const rect = (cx: number, cy: number, x: number, y: number) => w.add(`IFCRECTANGLEPROFILEDEF(.AREA.,$,${ax2(cx, cy)},${num(x)},${num(y)})`)
  const poly = (pts: P2[]) => w.add(`IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,$,${w.add(`IFCPOLYLINE((${[...pts, pts[0]].map(([x, y]) => pt2(x, y)).join(',')}))`)})`)
  const pline = (pts: P2[]) => w.add(`IFCPOLYLINE((${[...pts, pts[0]].map(([x, y]) => pt2(x, y)).join(',')}))`)
  const polyWithVoids = (pts: P2[], holes: P2[][]) => w.add(`IFCARBITRARYPROFILEDEFWITHVOIDS(.AREA.,$,${pline(pts)},(${holes.map(pline).join(',')}))`)
  const extrude = (profile: string, depth: number, at: [number, number, number] = [0, 0, 0], z?: [number, number, number], x?: [number, number, number]) => w.add(`IFCEXTRUDEDAREASOLID(${profile},${ax3(at, z, x)},${up},${num(depth)})`)

  const materials: Record<string, string> = {}
  const matRel: Record<string, string[]> = {}
  const material = (nm: string, el: string) => {
    materials[nm] ??= w.add(`IFCMATERIAL(${stepString(nm)},$,$)`)
    ;(matRel[nm] ??= []).push(el)
  }
  const quantities = (el: string, id: string, qs: [string, 'Length' | 'Area' | 'Volume', number][]) => {
    const q = qs.map(([n, k, v]) => w.add(`IFCQUANTITY${k.toUpperCase()}(${stepString(n)},$,$,${num(v)},$)`))
    const eq = w.add(`IFCELEMENTQUANTITY('${guid('qto:' + id)}',$,'BaseQuantities',$,$,(${q.join(',')}))`)
    w.add(`IFCRELDEFINESBYPROPERTIES('${guid('qrel:' + id)}',$,$,$,(${el}),${eq})`)
  }

  // walls (+ curtain walls), with their openings, doors and windows
  for (const wall of m.walls) {
    const ty = typeOf(m, wall)
    const t = ty?.thickness ?? 200
    const h = wallHeight(m, wall)
    if (h <= 0 || wall.length <= 0) continue
    const S = st(wall.baseLevel)
    const pl = place(S.pl, [wall.x ?? 0, wall.y ?? 0, wall.baseOffset], wall.angle ?? 0)
    const solid = extrude(rect(wall.length / 2, 0, wall.length, t), h)
    const curtain = ty?.family === 'Curtain Wall'
    const el = w.add(`${curtain ? 'IFCCURTAINWALL' : 'IFCWALL'}('${guid('wall:' + wall.id)}',$,${stepString(`${ty?.name ?? 'Wall'}:${wall.mark}`)},${stepString(wall.description ?? ty?.description)},${stepString(ty?.name)},${pl},${shape([solid])},${stepString(wall.mark)},${curtain ? '.NOTDEFINED.' : '.STANDARD.'})`)
    count(curtain ? 'IfcCurtainWall' : 'IfcWall')
    S.items.push(el)
    material(ty?.structure ?? 'Concrete', el)
    quantities(el, wall.id, [['Length', 'Length', wall.length], ['Height', 'Length', h], ['Width', 'Length', t], ['NetSideArea', 'Area', wallArea(m, wall)], ['NetVolume', 'Volume', wallVolume(m, wall)]])
    if (curtain) continue
    for (const o of [...m.doors, ...m.windows].filter((x) => x.hostWall === wall.id)) {
      const opl = place(pl, [o.offset + o.width / 2, 0, o.sill])
      const op = w.add(`IFCOPENINGELEMENT('${guid('opening:' + o.id)}',$,${stepString('Opening ' + (o.mark || o.id))},$,$,${opl},${shape([extrude(rect(0, 0, o.width, t + 40), o.height)])},$,.OPENING.)`)
      w.add(`IFCRELVOIDSELEMENT('${guid('void:' + o.id)}',$,$,$,${el},${op})`)
      count('IfcOpeningElement')
      const fpl = place(opl, [0, 0, 0])
      const leaf = extrude(rect(0, 0, o.width, o.category === 'door' ? 50 : 30), o.height)
      const fill =
        o.category === 'door'
          ? w.add(`IFCDOOR('${guid('door:' + o.id)}',$,${stepString(`${o.family}:${o.type}:${o.mark}`)},$,${stepString(o.type)},${fpl},${shape([leaf])},${stepString(o.mark)},${num(o.height)},${num(o.width)},.DOOR.,.SINGLE_SWING_LEFT.,$)`)
          : w.add(`IFCWINDOW('${guid('window:' + o.id)}',$,${stepString(`${o.family}:${o.type}:${o.mark}`)},$,${stepString(o.type)},${fpl},${shape([leaf])},${stepString(o.mark)},${num(o.height)},${num(o.width)},.WINDOW.,.SINGLE_PANEL.,$)`)
      w.add(`IFCRELFILLSELEMENT('${guid('fill:' + o.id)}',$,$,$,${op},${fill})`)
      count(o.category === 'door' ? 'IfcDoor' : 'IfcWindow')
      S.items.push(fill)
    }
  }

  for (const s of m.slabs) {
    if (s.outline.length < 3) continue
    const S = st(s.level)
    const z0 = s.kind === 'floor' ? s.offset - s.thickness : s.offset
    const pl = place(S.pl, [0, 0, z0])
    const holes = (s.openings ?? []).filter((o) => o.length >= 3)
    const shp = shape([extrude(holes.length ? polyWithVoids(s.outline, holes) : poly(s.outline), s.thickness)])
    const el =
      s.kind === 'ceiling'
        ? w.add(`IFCCOVERING('${guid('slab:' + s.id)}',$,${stepString('Ceiling:' + s.mark)},$,$,${pl},${shp},${stepString(s.mark)},.CEILING.)`)
        : w.add(`IFCSLAB('${guid('slab:' + s.id)}',$,${stepString((s.kind === 'roof' ? 'Roof:' : 'Floor:') + s.mark)},$,$,${pl},${shp},${stepString(s.mark)},${s.kind === 'roof' ? '.ROOF.' : s.landing ? '.LANDING.' : '.FLOOR.'})`)
    count(s.kind === 'ceiling' ? 'IfcCovering' : 'IfcSlab')
    S.items.push(el)
    material(s.kind === 'ceiling' ? 'Gypsum board' : 'Concrete - C30', el)
    const A = (polyArea(s.outline) - holes.reduce((a, o) => a + polyArea(o), 0)) / 1e6
    quantities(el, s.id, [['Depth', 'Length', s.thickness], ['GrossArea', 'Area', A], ['GrossVolume', 'Volume', (A * s.thickness) / 1000]])
  }

  for (const b of m.beams ?? []) {
    const S = st(b.level)
    // the section hangs from the beam's top: profile centred on the axis, extruded along it
    const t = (b.angle * Math.PI) / 180
    const el = w.add(`IFCBEAM('${guid('beam:' + b.id)}',$,${stepString((b.tie ? 'Tie beam:' : 'Beam:') + b.mark)},$,$,${place(S.pl, [b.x, b.y, b.topOffset - b.h / 2])},${shape([extrude(rect(0, 0, b.h, b.b), b.length, [0, 0, 0], [Math.cos(t), Math.sin(t), 0], [0, 0, 1])])},${stepString(b.mark)},.BEAM.)`)
    count('IfcBeam')
    S.items.push(el)
    material('Concrete - C30', el)
    quantities(el, b.id, [['Length', 'Length', b.length], ['GrossVolume', 'Volume', (b.length * b.b * b.h) / 1e9]])
  }
  for (const r of m.roofs ?? []) {
    const S = st(r.level)
    const f = roofFrame(r)
    const u: [number, number, number] = [f.u[0], f.u[1], 0], v: [number, number, number] = [f.v[0], f.v[1], 0]
    // the gable mass; a hip roof clipped at both ends by the half-space over the slope from the end eaves
    let solid = extrude(poly([[0, 0], [f.W, 0], [f.W / 2, f.h]]), f.L, [f.o[0], f.o[1], 0], u, v)
    if (r.kind === 'hip') {
      const k = Math.hypot(f.tan, 1)
      for (const [along, sg] of [[0, 1], [f.L, -1]] as const) {
        const nrm: [number, number, number] = [(-sg * f.tan * u[0]) / k, (-sg * f.tan * u[1]) / k, 1 / k]
        const plane = w.add(`IFCPLANE(${ax3([f.o[0] + u[0] * along, f.o[1] + u[1] * along, 0], nrm, v)})`)
        solid = w.add(`IFCBOOLEANCLIPPINGRESULT(.DIFFERENCE.,${solid},${w.add(`IFCHALFSPACESOLID(${plane},.F.)`)})`)
      }
    }
    const el = w.add(`IFCROOF('${guid('roof:' + r.id)}',$,${stepString('Roof:' + r.mark)},$,$,${place(S.pl, [0, 0, 0])},${shape([solid], r.kind === 'hip' ? 'Clipping' : 'SweptSolid')},${stepString(r.mark)},${r.kind === 'hip' ? '.HIP_ROOF.' : '.GABLE_ROOF.'})`)
    count('IfcRoof')
    S.items.push(el)
    material('Roof tiles', el)
    quantities(el, r.id, [['GrossArea', 'Area', roofQuantities(r).area]])
  }
  for (const f of m.footings ?? []) {
    const S = st(f.level)
    const el = w.add(`IFCFOOTING('${guid('footing:' + f.id)}',$,${stepString('Pile cap:' + f.mark)},$,$,${place(S.pl, [f.x, f.y, f.bottom])},${shape([extrude(rect(0, 0, f.w, f.d), f.top - f.bottom)])},${stepString(f.mark)},.PILE_CAP.)`)
    count('IfcFooting')
    S.items.push(el)
    material('Concrete - C30', el)
    quantities(el, f.id, [['GrossVolume', 'Volume', (f.w * f.d * (f.top - f.bottom)) / 1e9]])
  }

  for (const c of m.columns) {
    const h = elev(c.topLevel) - elev(c.level)
    if (h <= 0) continue
    const S = st(c.level)
    const prof = c.round ? w.add(`IFCCIRCLEPROFILEDEF(.AREA.,$,${ax2(0, 0)},${num(c.w / 2)})`) : rect(0, 0, c.w, c.d)
    const el = w.add(`IFCCOLUMN('${guid('column:' + c.id)}',$,${stepString('Column:' + c.mark)},$,$,${place(S.pl, [c.x, c.y, 0])},${shape([extrude(prof, h)])},${stepString(c.mark)},.COLUMN.)`)
    count('IfcColumn')
    S.items.push(el)
    material('Concrete - C30', el)
  }

  for (const s of m.stairs) {
    const { n, riser } = stairFlight(m, s)
    const S = st(s.baseLevel)
    if (s.spiral) {
      const sp = s.spiral, a0 = (sp.a0 * Math.PI) / 180, da = (sp.sweep * Math.PI) / 180 / n
      const steps = Array.from({ length: n }, (_, i) => extrude(poly(wedge(s.x, s.y, sp.r0, sp.r1, a0 + i * da, a0 + (i + 1) * da)), 60, [0, 0, (i + 1) * riser - 60 + (s.baseOffset ?? 0)]))
      const el = w.add(`IFCSTAIR('${guid('stair:' + s.id)}',$,${stepString('Stair:' + s.mark)},$,$,${place(S.pl, [0, 0, 0])},${shape(steps)},${stepString(s.mark)},.SPIRAL_STAIR.)`)
      count('IfcStair')
      S.items.push(el)
      material('Concrete - C30', el)
      continue
    }
    // the flight's section (steps on the waist slab, src/bim/scene.ts stairProfile) in the vertical plane of the run,
    // swept across its width: profile x along the run, y up (position: z = −y across, x = the run)
    const solid = extrude(poly(stairProfile(s, n, riser)), s.width, [0, s.width / 2, 0], [0, -1, 0], [1, 0, 0])
    const el = w.add(`IFCSTAIR('${guid('stair:' + s.id)}',$,${stepString('Stair:' + s.mark)},$,$,${place(S.pl, [s.x, s.y, s.baseOffset ?? 0], s.angle)},${shape([solid])},${stepString(s.mark)},.STRAIGHT_RUN_STAIR.)`)
    count('IfcStair')
    S.items.push(el)
    material('Concrete - C30', el)
  }

  for (const r of m.railings) {
    if (r.pts.length < 2) continue
    const S = st(r.level)
    const items: string[] = []
    for (let i = 0; i + 1 < r.pts.length; i++) {
      const [a, b] = [r.pts[i], r.pts[i + 1]]
      const za = r.z?.[i] ?? 0, zb = r.z?.[i + 1] ?? 0
      const L = Math.hypot(b[0] - a[0], b[1] - a[1])
      if (L < 1) continue
      const L3 = Math.hypot(L, zb - za)
      const d: [number, number, number] = [(b[0] - a[0]) / L3, (b[1] - a[1]) / L3, (zb - za) / L3]
      // top rail: a 50 × 50 section swept along the segment (sloping with a stair); profile x horizontal
      items.push(extrude(rect(0, 0, 50, 50), L3, [a[0], a[1], za + r.height - 25], d, [-(b[1] - a[1]) / L, (b[0] - a[0]) / L, 0]))
      const k = Math.max(1, Math.ceil(L / 1200))
      for (let j = i === 0 ? 0 : 1; j <= k; j++) items.push(extrude(w.add(`IFCCIRCLEPROFILEDEF(.AREA.,$,${ax2(0, 0)},20.)`), r.height - 50, [a[0] + ((b[0] - a[0]) * j) / k, a[1] + ((b[1] - a[1]) * j) / k, za + ((zb - za) * j) / k]))
    }
    const el = w.add(`IFCRAILING('${guid('railing:' + r.id)}',$,${stepString('Railing:' + r.mark)},$,$,${place(S.pl, [0, 0, 0])},${shape(items)},${stepString(r.mark)},.GUARDRAIL.)`)
    count('IfcRailing')
    S.items.push(el)
    material('Steel', el)
  }

  for (const c of m.components) {
    const S = st(c.level)
    const el = w.add(`IFCFURNITURE('${guid('component:' + c.id)}',$,${stepString(c.name + ':' + c.mark)},$,${stepString(c.name)},${place(S.pl, [c.x, c.y, 0], c.rot)},${shape([extrude(rect(0, 0, c.w, c.d), c.h)])},${stepString(c.mark)},.NOTDEFINED.)`)
    count('IfcFurniture')
    S.items.push(el)
  }

  for (const r of m.rooms) {
    const S = st(r.level)
    const next = levels.find((l) => l.elevation > elev(r.level))
    const h = next ? next.elevation - elev(r.level) : 3000
    // a room round a core: the core is a void of its space
    const holes = (r.holes ?? []).filter((o) => o.length >= 3)
    const shp = r.outline && r.outline.length > 2 ? shape([extrude(holes.length ? polyWithVoids(r.outline, holes) : poly(r.outline), h)]) : '$'
    const el = w.add(`IFCSPACE('${guid('room:' + r.id)}',$,${stepString(r.number)},$,$,${place(S.pl, [0, 0, 0])},${shp},${stepString(r.name)},.ELEMENT.,.INTERNAL.,$)`)
    count('IfcSpace')
    S.spaces.push(el)
    quantities(el, r.id, [['NetFloorArea', 'Area', r.area]])
  }

  for (const l of levels) {
    const S = storey[l.id]
    if (S.items.length) w.add(`IFCRELCONTAINEDINSPATIALSTRUCTURE('${guid('contain:' + l.id)}',$,$,$,(${S.items.join(',')}),${S.ref})`)
    if (S.spaces.length) w.add(`IFCRELAGGREGATES('${guid('spaces:' + l.id)}',$,$,$,${S.ref},(${S.spaces.join(',')}))`)
  }
  for (const [nm, els] of Object.entries(matRel)) w.add(`IFCRELASSOCIATESMATERIAL('${guid('mat:' + nm)}',$,$,$,(${els.join(',')}),${materials[nm]})`)

  const now = new Date().toISOString().slice(0, 19)
  const text = [
    'ISO-10303-21;',
    'HEADER;',
    "FILE_DESCRIPTION(('ViewDefinition [ReferenceView_V1.2]'),'2;1');",
    `FILE_NAME(${stepString(name + '.ifc')},'${now}',(${stepString(author)}),(''),'MD CAD AI STUDIO','MD CAD AI STUDIO','');`,
    "FILE_SCHEMA(('IFC4'));",
    'ENDSEC;',
    'DATA;',
    ...w.lines,
    'ENDSEC;',
    'END-ISO-10303-21;',
    '',
  ].join('\n')
  return { text, counts }
}
