/**
 * DXF R2000 (AC1015) export with the drawing's paper-space layouts.
 *
 * Model space holds the drawing. Each layout becomes a real AutoCAD layout (LAYOUT object + its own
 * *Paper_Space block) with the paper size and plot settings, the title block / frame drawn in paper mm,
 * and a VIEWPORT showing model space at the layout's scale — the same geometry as the PDF plot
 * (plot.ts sheetLayout). The first layout is the active paper space (its entities are in ENTITIES, the
 * others in their *Paper_SpaceN blocks), as AutoCAD writes it. Non-ASCII text is written as \U+XXXX.
 * Structure, handles and owners follow the DXF reference; checked with ezdxf's auditor and by LibreDWG
 * turning it into a DWG that reads back with the same layouts (qa/QA_LAYOUT_DXF_BIM2D.md).
 */
import { triangulate } from './edit'
import { DEFAULT_LAYOUTS, type CadDocument, type Entity, type Layer, type Layout } from './types'
import { dimensionGeometry, formatLength, measured } from './geometry'
import { PAPERS, sheetLayout } from './plot'

const ACI: Record<string, number> = { '#111827': 7, '#1f2937': 7, '#0f766e': 4, '#2563eb': 5, '#6b7280': 8, '#9aa1ab': 9, '#3f4654': 8, '#9ca3af': 9 }
const num = (n: number) => (Number.isInteger(n) ? String(n) : Number(n.toFixed(8)).toString())
/** DXF R2000 text: ASCII; anything else as \U+XXXX (AutoCAD's escape). */
export const dxfStr = (s: string) => [...s].map((ch) => (ch.charCodeAt(0) < 128 ? ch : `\\U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`)).join('')

type G = (code: number, value: string | number) => void

export function toDxf2000(doc: CadDocument): string {
  const o: string[] = []
  const g: G = (code, value) => o.push(String(code).padStart(3, ' '), typeof value === 'number' ? num(value) : value)
  let next = 0x20
  const h = () => (next++).toString(16).toUpperCase()
  const layouts: Layout[] = doc.layouts?.length ? doc.layouts : DEFAULT_LAYOUTS

  // ---- handles, decided up front (owners point at each other)
  const H = {
    root: h(), groups: h(), layoutDict: h(), plotStyles: h(), normal: h(),
    tVport: h(), tLtype: h(), tLayer: h(), tStyle: h(), tView: h(), tUcs: h(), tAppid: h(), tDimstyle: h(), tBr: h(),
    vpActive: h(), ltByBlock: h(), ltByLayer: h(), ltCont: h(), ltDashed: h(), ltDashDot: h(), style: h(), appid: h(), dimstyle: h(),
    brModel: h(), layModel: h(), blkModel: h(), endModel: h(),
  }
  const extraLayers = ['TITLE', 'VIEWPORTS'].filter((n) => !doc.layers.some((l) => l.name === n))
  const layerH = [...doc.layers.map((l) => l.name), ...extraLayers].map(() => h())
  const sheets = layouts.map((l, i) => ({ l, i, br: h(), lay: h(), blk: h(), end: h(), name: i === 0 ? '*Paper_Space' : `*Paper_Space${i - 1}`, geo: sheetLayout(doc, l.paper, l.scale ?? undefined) }))

  // ---- entities
  const entity = (e: Entity, owner: string, paper: boolean) => {
    const head = (type: string, sub: string) => {
      g(0, type); g(5, h()); g(330, owner); g(100, 'AcDbEntity'); if (paper) g(67, 1); g(8, e.layer); g(100, sub)
    }
    const line = (ax: number, ay: number, bx: number, by: number) => {
      head('LINE', 'AcDbLine'); g(10, ax); g(20, ay); g(30, 0); g(11, bx); g(21, by); g(31, 0)
    }
    const text = (x: number, y: number, hgt: number, value: string, rot: number, center: boolean) => {
      head('TEXT', 'AcDbText'); g(10, x); g(20, y); g(30, 0); g(40, hgt); g(1, dxfStr(value)); g(50, rot)
      if (center) { g(72, 1); g(11, x); g(21, y); g(31, 0) }
      g(100, 'AcDbText')
    }
    switch (e.kind) {
      case 'line':
        line(e.a.x, e.a.y, e.b.x, e.b.y)
        break
      case 'polyline':
        head('LWPOLYLINE', 'AcDbPolyline'); g(90, e.pts.length); g(70, e.closed ? 1 : 0); g(43, 0)
        for (const p of e.pts) { g(10, p.x); g(20, p.y) }
        if (e.filled && e.closed)
          for (const [a, b, c] of triangulate(e.pts)) {
            head('SOLID', 'AcDbTrace'); g(10, a.x); g(20, a.y); g(30, 0); g(11, b.x); g(21, b.y); g(31, 0); g(12, c.x); g(22, c.y); g(32, 0); g(13, c.x); g(23, c.y); g(33, 0)
          }
        break
      case 'circle':
        head('CIRCLE', 'AcDbCircle'); g(10, e.c.x); g(20, e.c.y); g(30, 0); g(40, e.r)
        break
      case 'arc':
        head('ARC', 'AcDbCircle'); g(10, e.c.x); g(20, e.c.y); g(30, 0); g(40, e.r); g(100, 'AcDbArc'); g(50, (e.start * 180) / Math.PI); g(51, (e.end * 180) / Math.PI)
        break
      case 'text':
        text(e.p.x, e.p.y, e.height, e.value, (e.rotation * 180) / Math.PI, e.align === 'center')
        break
      case 'dimension': {
        // written exploded (lines + text), as in the R12 export
        const d = dimensionGeometry(e.a, e.b, e.offset)
        for (const [a, b] of [[e.a, d.da], [e.b, d.db], [d.da, d.db]] as const) line(a.x, a.y, b.x, b.y)
        text(d.textAt.x, d.textAt.y, e.textHeight, e.override ?? formatLength(measured(e.a, e.b)), (d.angle * 180) / Math.PI, true)
        break
      }
    }
  }
  /** Paper-space content of one layout: the overall paper viewport (id 1), the model viewport (id 2), frame and title block. */
  const sheetEntities = (s: (typeof sheets)[number]) => {
    const { W, H: Hp, viewport: vp, view, lines, texts } = s.geo
    const viewportEnt = (id: number, cx: number, cy: number, w: number, hh: number, vcx: number, vcy: number, vh: number) => {
      g(0, 'VIEWPORT'); g(5, h()); g(330, s.br); g(100, 'AcDbEntity'); g(67, 1); g(8, 'VIEWPORTS'); g(100, 'AcDbViewport')
      g(10, cx); g(20, cy); g(30, 0); g(40, w); g(41, hh); g(68, id); g(69, id)
      g(12, vcx); g(22, vcy); g(13, 0); g(23, 0); g(14, 10); g(24, 10); g(15, 10); g(25, 10)
      g(16, 0); g(26, 0); g(36, 1); g(17, 0); g(27, 0); g(37, 0); g(42, 50); g(43, 0); g(44, 0); g(45, vh)
      g(50, 0); g(51, 0); g(72, 100); g(90, id === 1 ? 557088 : 32864); g(281, 0); g(71, 1); g(74, 0)
      g(110, 0); g(120, 0); g(130, 0); g(111, 1); g(121, 0); g(131, 0); g(112, 0); g(122, 1); g(132, 0); g(79, 0); g(146, 0)
    }
    viewportEnt(1, W / 2, Hp / 2, W * 1.1, Hp * 1.1, W / 2, Hp / 2, Hp * 1.1)
    viewportEnt(2, vp.cx, vp.cy, vp.w, vp.h, view.cx, view.cy, view.height)
    const base = { id: '', color: 'ByLayer', linetype: 'ByLayer', lineweight: 'ByLayer', transparency: 0, layer: 'TITLE' } as const
    for (const [ax, ay, bx, by] of lines) entity({ ...base, kind: 'line', a: { x: ax, y: ay }, b: { x: bx, y: by } }, s.br, true)
    for (const t of texts) entity({ ...base, kind: 'text', p: { x: t.x, y: t.y }, height: t.h, value: t.value, rotation: 0, align: 'left' }, s.br, true)
  }

  // ---- write
  g(999, `TH AI CAD Studio — ${dxfStr(doc.name)}${doc.underlay ? ' (raster underlay not included)' : ''}`)
  const headerAt = o.length
  g(0, 'SECTION'); g(2, 'HEADER')
  g(9, '$ACADVER'); g(1, 'AC1015'); g(9, '$DWGCODEPAGE'); g(3, 'ANSI_1252'); g(9, '$INSUNITS'); g(70, 4); g(9, '$MEASUREMENT'); g(70, 1)
  g(9, '$TILEMODE'); g(70, 1); g(9, '$HANDSEED'); g(5, 'FFFFF') // patched below
  g(0, 'ENDSEC')
  // class-based objects used below (AutoCAD and LibreDWG need them declared)
  g(0, 'SECTION'); g(2, 'CLASSES')
  for (const [dxf, cpp] of [['ACDBDICTIONARYWDFLT', 'AcDbDictionaryWithDefault'], ['ACDBPLACEHOLDER', 'AcDbPlaceHolder'], ['LAYOUT', 'AcDbLayout']]) {
    g(0, 'CLASS'); g(1, dxf); g(2, cpp); g(3, 'ObjectDBX Classes'); g(90, 0); g(280, 0); g(281, 0)
  }
  g(0, 'ENDSEC')
  g(0, 'SECTION'); g(2, 'TABLES')
  const table = (name: string, handle: string, count: number, body: () => void, sub = 'AcDbSymbolTable') => {
    g(0, 'TABLE'); g(2, name); g(5, handle); g(330, '0'); g(100, sub); g(70, count)
    if (name === 'DIMSTYLE') { g(100, 'AcDbDimStyleTable'); g(71, 0) }
    body(); g(0, 'ENDTAB')
  }
  const rec = (type: string, handle: string, owner: string, sub: string, name: string, flags = 0) => {
    g(0, type); g(type === 'DIMSTYLE' ? 105 : 5, handle); g(330, owner); g(100, 'AcDbSymbolTableRecord'); g(100, sub); g(2, name); g(70, flags)
  }
  table('VPORT', H.tVport, 1, () => {
    rec('VPORT', H.vpActive, H.tVport, 'AcDbViewportTableRecord', '*Active')
    const v = sheets[0]?.geo.view ?? { cx: 0, cy: 0, height: 1000 }
    g(10, 0); g(20, 0); g(11, 1); g(21, 1); g(12, v.cx); g(22, v.cy); g(13, 0); g(23, 0); g(14, 10); g(24, 10); g(15, 10); g(25, 10)
    g(16, 0); g(26, 0); g(36, 1); g(17, 0); g(27, 0); g(37, 0); g(40, v.height); g(41, 1.6); g(42, 50); g(43, 0); g(44, 0); g(50, 0); g(51, 0)
    g(71, 0); g(72, 100); g(73, 1); g(74, 3); g(75, 0); g(76, 0); g(77, 0); g(78, 0)
  })
  table('LTYPE', H.tLtype, 5, () => {
    const lt = (handle: string, name: string, desc: string, pattern: number[]) => {
      rec('LTYPE', handle, H.tLtype, 'AcDbLinetypeTableRecord', name); g(3, desc); g(72, 65); g(73, pattern.length); g(40, pattern.reduce((a, x) => a + Math.abs(x), 0))
      for (const x of pattern) { g(49, x); g(74, 0) }
    }
    lt(H.ltByBlock, 'ByBlock', '', []); lt(H.ltByLayer, 'ByLayer', '', []); lt(H.ltCont, 'Continuous', 'Solid line', [])
    lt(H.ltDashed, 'DASHED', '__ __ __', [12, -6]); lt(H.ltDashDot, 'DASHDOT', '__ . __', [12, -3, 0, -3])
  })
  const allLayers: Layer[] = [...doc.layers, ...extraLayers.map((name) => ({ name, color: name === 'VIEWPORTS' ? '#6b7280' : '#111827', visible: true, locked: false, linetype: 'Continuous' as const, lineweight: name === 'TITLE' ? 0.35 : 0.25 }))]
  table('LAYER', H.tLayer, allLayers.length, () => {
    allLayers.forEach((l, i) => {
      rec('LAYER', layerH[i], H.tLayer, 'AcDbLayerTableRecord', l.name, l.locked ? 4 : 0)
      g(62, (ACI[l.color] ?? 7) * (l.visible ? 1 : -1)); g(6, l.linetype === 'Continuous' ? 'Continuous' : l.linetype === 'Dashed' ? 'DASHED' : 'DASHDOT')
      if (l.name === 'VIEWPORTS') g(290, 0) // viewport borders do not plot
      g(370, Math.round((l.lineweight ?? 0.25) * 100)); g(390, H.normal)
    })
  })
  table('STYLE', H.tStyle, 1, () => {
    rec('STYLE', H.style, H.tStyle, 'AcDbTextStyleTableRecord', 'Standard'); g(40, 0); g(41, 1); g(50, 0); g(71, 0); g(42, 2.5); g(3, 'txt'); g(4, '')
  })
  table('VIEW', H.tView, 0, () => undefined)
  table('UCS', H.tUcs, 0, () => undefined)
  table('APPID', H.tAppid, 1, () => rec('APPID', H.appid, H.tAppid, 'AcDbRegAppTableRecord', 'ACAD'))
  table('DIMSTYLE', H.tDimstyle, 1, () => rec('DIMSTYLE', H.dimstyle, H.tDimstyle, 'AcDbDimStyleTableRecord', 'Standard'))
  table('BLOCK_RECORD', H.tBr, 1 + sheets.length, () => {
    rec('BLOCK_RECORD', H.brModel, H.tBr, 'AcDbBlockTableRecord', '*Model_Space'); g(340, H.layModel)
    for (const s of sheets) { rec('BLOCK_RECORD', s.br, H.tBr, 'AcDbBlockTableRecord', s.name); g(340, s.lay) }
  })
  g(0, 'ENDSEC')

  g(0, 'SECTION'); g(2, 'BLOCKS')
  const block = (br: string, blk: string, end: string, name: string, paper: boolean, body?: () => void) => {
    g(0, 'BLOCK'); g(5, blk); g(330, br); g(100, 'AcDbEntity'); if (paper) g(67, 1); g(8, '0'); g(100, 'AcDbBlockBegin'); g(2, name); g(70, 0); g(10, 0); g(20, 0); g(30, 0); g(3, name); g(1, '')
    body?.()
    g(0, 'ENDBLK'); g(5, end); g(330, br); g(100, 'AcDbEntity'); if (paper) g(67, 1); g(8, '0'); g(100, 'AcDbBlockEnd')
  }
  block(H.brModel, H.blkModel, H.endModel, '*Model_Space', false)
  for (const s of sheets) block(s.br, s.blk, s.end, s.name, true, s.i === 0 ? undefined : () => sheetEntities(s))
  g(0, 'ENDSEC')

  g(0, 'SECTION'); g(2, 'ENTITIES')
  for (const e of doc.entities) entity(e, H.brModel, false)
  if (sheets[0]) sheetEntities(sheets[0])
  g(0, 'ENDSEC')

  g(0, 'SECTION'); g(2, 'OBJECTS')
  const dict = (handle: string, owner: string, entries: [string, string][]) => {
    g(0, 'DICTIONARY'); g(5, handle); g(330, owner); g(100, 'AcDbDictionary'); g(281, 1)
    for (const [k, v] of entries) { g(3, dxfStr(k)); g(350, v) }
  }
  dict(H.root, '0', [['ACAD_GROUP', H.groups], ['ACAD_LAYOUT', H.layoutDict], ['ACAD_PLOTSTYLENAME', H.plotStyles]])
  dict(H.groups, H.root, [])
  dict(H.layoutDict, H.root, [['Model', H.layModel], ...sheets.map((s) => [s.l.name, s.lay] as [string, string])])
  g(0, 'ACDBDICTIONARYWDFLT'); g(5, H.plotStyles); g(330, H.root); g(100, 'AcDbDictionary'); g(281, 1); g(3, 'Normal'); g(350, H.normal); g(100, 'AcDbDictionaryWithDefault'); g(340, H.normal)
  g(0, 'ACDBPLACEHOLDER'); g(5, H.normal); g(330, H.plotStyles)
  const layout = (handle: string, name: string, tab: number, br: string, W: number, Hp: number, paperName: string) => {
    g(0, 'LAYOUT'); g(5, handle); g(330, H.layoutDict)
    g(100, 'AcDbPlotSettings'); g(1, ''); g(4, paperName); g(6, ''); g(40, 0); g(41, 0); g(42, 0); g(43, 0); g(44, W); g(45, Hp)
    g(46, 0); g(47, 0); g(48, 0); g(49, 0); g(140, 0); g(141, 0); g(142, 1); g(143, 1)
    g(70, tab === 0 ? 1024 : 688); g(72, 1); g(73, 0); g(74, 5); g(7, ''); g(75, 16); g(147, 1); g(148, 0); g(149, 0)
    g(100, 'AcDbLayout'); g(1, dxfStr(name)); g(70, 1); g(71, tab)
    g(10, 0); g(20, 0); g(11, W); g(21, Hp); g(12, 0); g(22, 0); g(32, 0); g(14, 0); g(24, 0); g(34, 0); g(15, W); g(25, Hp); g(35, 0); g(146, 0)
    g(13, 0); g(23, 0); g(33, 0); g(16, 1); g(26, 0); g(36, 0); g(17, 0); g(27, 1); g(37, 0); g(76, 0); g(330, br)
  }
  layout(H.layModel, 'Model', 0, H.brModel, 420, 297, '')
  for (const s of sheets) {
    const [W, Hp] = PAPERS[s.l.paper]
    layout(s.lay, s.l.name, s.i + 1, s.br, W, Hp, `ISO_${s.l.paper}_(${W.toFixed(2)}_x_${Hp.toFixed(2)}_MM)`)
  }
  g(0, 'ENDSEC'); g(0, 'EOF')
  // handle seed: one past the last handle given out
  o[o.indexOf('$HANDSEED', headerAt) + 2] = next.toString(16).toUpperCase()
  return o.join('\r\n') + '\r\n'
}
