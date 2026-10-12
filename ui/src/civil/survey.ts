/**
 * Survey / GIS import for the Civil workspace. Everything is parsed locally (no service, no AI):
 *
 * - Point files (CSV / TXT / PNEZD …): delimiter and column order detected from the header or the
 *   values, overridable in the import dialog.
 * - LandXML 1.x: CgPoints, Surface (Pnts + Faces = the surveyor's TIN), Alignment (lines, arcs; spirals
 *   approximated by their chord). LandXML coordinates are Northing Easting [Elevation].
 * - GeoJSON (RFC 7946): Point / MultiPoint with z or an elevation property, 3D lines as terrain
 *   vertices, a 2D LineString as the alignment. Lon/lat (WGS84) is projected to UTM (zone from the data).
 * - ESRI Shapefile (.shp + .dbf + .prj): PointZ / MultiPointZ / PolyLineZ, or 2D geometry with an
 *   elevation attribute; a 2D polyline without elevation becomes the alignment; geographic .prj → UTM.
 * - DXF (ASCII): POINT, INSERT (survey point blocks), 3D POLYLINE vertices, LWPOLYLINE with elevation
 *   (contours), 3DFACE, LINE with z. A 2D polyline on an alignment / centre-line layer becomes the alignment.
 *
 * Plan coordinates are metres (x = Easting, y = Northing); elevations are metres.
 */

export type SurveyFormat = 'csv' | 'landxml' | 'geojson' | 'dxf' | 'shp'

export interface Survey {
  name: string
  format: SurveyFormat
  /** Human description of the coordinate system, e.g. "WGS84 → UTM 48N" or "projected (file units: m)". */
  crs: string
  x: number[]
  y: number[]
  z: number[]
  codes?: string[]
  /** Triangles from the file (vertex index triples); otherwise the TIN is triangulated on import. */
  faces?: number[]
  /** Alignment centre line in plan [x, y]. */
  alignment?: [number, number][]
  alignmentName?: string
  imported: number
  warnings: string[]
}

export type ColumnOrder = 'PNEZD' | 'PENZD' | 'PNEZ' | 'PENZ' | 'NEZD' | 'ENZD' | 'NEZ' | 'ENZ'
export const ORDERS: ColumnOrder[] = ['PNEZD', 'PENZD', 'PNEZ', 'PENZ', 'NEZD', 'ENZD', 'NEZ', 'ENZ']

export interface CsvOptions {
  order?: ColumnOrder
  delimiter?: ',' | ';' | '\t' | ' '
  /** Multiply coordinates and elevations (e.g. 0.3048 for international feet). */
  scale?: number
}

export const detectFormat = (name: string, text: string): SurveyFormat => {
  const n = name.toLowerCase()
  const head = text.slice(0, 2000).trimStart()
  if (n.endsWith('.xml') || n.endsWith('.landxml') || /<LandXML/i.test(head)) return 'landxml'
  if (n.endsWith('.geojson') || (n.endsWith('.json') && /"type"\s*:/.test(head))) return 'geojson'
  if (n.endsWith('.dxf') || /^0\s*\r?\n\s*SECTION/.test(head)) return 'dxf'
  return 'csv'
}

const num = (s: string | undefined) => {
  if (s === undefined) return NaN
  let t = s.trim().replace(/^"|"$/g, '')
  if (/^-?\d+,\d+$/.test(t)) t = t.replace(',', '.') // decimal comma (VN / EU exports)
  return t === '' ? NaN : Number(t)
}

/* ------------------------------------------------------------------ CSV / TXT */

export function detectDelimiter(text: string): ',' | ';' | '\t' | ' ' {
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 20)
  const score = (d: string) => {
    const counts = lines.map((l) => l.split(d === ' ' ? /\s+/ : d).length)
    const same = counts.every((c) => c === counts[0])
    return same && counts[0] >= 3 ? counts[0] : 0
  }
  const cands: (',' | ';' | '\t' | ' ')[] = ['\t', ';', ',', ' ']
  return cands.reduce((best, d) => (score(d) > score(best) ? d : best), ',' as ',' | ';' | '\t' | ' ')
}

const split = (l: string, d: string) => (d === ' ' ? l.trim().split(/\s+/) : l.split(d)).map((c) => c.trim())

/** Column order from a header row (Point, Northing/N/Y, Easting/E/X, Elevation/Z/H, Description/Code). */
function orderFromHeader(cells: string[]): ColumnOrder | null {
  const kind = (c: string) => {
    const s = c.toLowerCase().replace(/[^a-z]/g, '')
    if (/^(p|pt|pnt|point|pointno|pointnumber|id|name|stt|so|sohieu|ten)$/.test(s)) return 'P'
    if (/^(n|y|north|northing|x?coordy)$/.test(s)) return 'N'
    if (/^(e|x|east|easting)$/.test(s)) return 'E'
    if (/^(z|h|elev|elevation|height|level|rl|caodo)$/.test(s)) return 'Z'
    if (/^(d|desc|description|code|ma|ghichu|note)$/.test(s)) return 'D'
    return '?'
  }
  const k = cells.map(kind).join('')
  return (ORDERS as string[]).includes(k) ? (k as ColumnOrder) : null
}

/**
 * Guesses the column order from values: a leading integer-like column is the point number; of the
 * coordinates, the elevation is the column with the smallest magnitude; in VN-2000 / UTM the northing
 * is the larger of the two plan coordinates north of ~1000 km.
 */
export function guessOrder(rows: string[][]): ColumnOrder {
  const numeric = (i: number) => rows.every((r) => Number.isFinite(num(r[i])))
  const n = Math.max(...rows.map((r) => r.length))
  const cols = Array.from({ length: n }, (_, i) => i)
  const numCols = cols.filter(numeric)
  const hasText = cols.some((i) => !numeric(i) && i > 0)
  const firstIsId = numCols[0] === 0 && rows.every((r) => Number.isInteger(num(r[0]))) && numCols.length >= 4
  const coord = firstIsId ? numCols.slice(1, 4) : numCols.slice(0, 3)
  if (coord.length < 3) return firstIsId ? 'PNEZD' : 'NEZ'
  const mag = (i: number) => rows.reduce((a, r) => a + Math.abs(num(r[i])), 0) / rows.length
  const [a, b] = [mag(coord[0]), mag(coord[1])]
  const nFirst = a >= b
  const d = hasText || n > coord[2] + 1 ? 'D' : ''
  if (firstIsId) return ((nFirst ? 'PNEZ' : 'PENZ') + d) as ColumnOrder
  return ((nFirst ? 'NEZ' : 'ENZ') + d) as ColumnOrder
}

export interface CsvPreview {
  delimiter: ',' | ';' | '\t' | ' '
  order: ColumnOrder
  header: boolean
  rows: string[][]
  /** Northing / Easting were swapped from the header (geodetic X = north, Y = east as in VN-2000). */
  swapped?: boolean
}

/** If the values show the plan columns are the wrong way round (N > 1000 km, E within a UTM band), swap them. */
function fixNorthEast(order: ColumnOrder, rows: string[][]): ColumnOrder | null {
  const iN = order.indexOf('N'), iE = order.indexOf('E')
  const mean = (i: number) => rows.reduce((a, r) => a + Math.abs(num(r[i])), 0) / Math.max(1, rows.length)
  const n = mean(iN), e = mean(iE)
  if (e > 1e6 && n >= 1e5 && n < 1e6) return order.replace('N', '#').replace('E', 'N').replace('#', 'E') as ColumnOrder
  return null
}

export function previewCsv(text: string, opts: CsvOptions = {}): CsvPreview {
  const delimiter = opts.delimiter ?? detectDelimiter(text)
  const lines = text.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith('#'))
  const first = split(lines[0] ?? '', delimiter)
  const hdr = orderFromHeader(first)
  const header = !!hdr || first.slice(0, 3).some((c) => !Number.isFinite(num(c)) && c.length > 0 && /[a-z]/i.test(c) && !Number.isFinite(num(first[1])))
  const body = (header ? lines.slice(1) : lines).slice(0, 200).map((l) => split(l, delimiter))
  let order = opts.order ?? hdr ?? guessOrder(body.slice(0, 50))
  const swap = opts.order ? null : fixNorthEast(order, body.slice(0, 50))
  if (swap) order = swap
  return { delimiter, order, header, rows: body.slice(0, 8), swapped: !!swap }
}

export function parseCsv(name: string, text: string, opts: CsvOptions = {}): Survey {
  const pv = previewCsv(text, opts)
  const k = opts.scale ?? 1
  const idx = (c: string) => pv.order.indexOf(c)
  const [iN, iE, iZ, iD, iP] = [idx('N'), idx('E'), idx('Z'), idx('D'), idx('P')]
  const lines = text.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith('#'))
  const s = blank(name, 'csv', 'projected (file units' + (k === 1 ? ': m)' : ` × ${k} → m)`))
  let bad = 0
  if (pv.swapped) s.warnings.push('header X/Y read as geodetic (X = Northing, Y = Easting), as the values show')
  for (const l of pv.header ? lines.slice(1) : lines) {
    const c = split(l, pv.delimiter)
    const e = num(c[iE]), nn = num(c[iN]), z = num(c[iZ])
    if (![e, nn, z].every(Number.isFinite)) {
      bad++
      continue
    }
    push(s, e * k, nn * k, z * k, [iP >= 0 ? c[iP] : '', iD >= 0 ? c.slice(iD).join(' ') : ''].filter(Boolean).join(' '))
  }
  if (bad) s.warnings.push(`${bad} line(s) without three numeric coordinates were skipped`)
  return finish(s)
}

/* ------------------------------------------------------------------ LandXML */

const UNIT: Record<string, number> = { meter: 1, millimeter: 0.001, centimeter: 0.01, kilometer: 1000, foot: 0.3048, USSurveyFoot: 1200 / 3937 }

export function parseLandXml(name: string, text: string): Survey {
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length) throw new Error('not a valid XML file')
  const all = (tag: string) => Array.from(doc.getElementsByTagNameNS('*', tag))
  const units = all('Metric')[0] ?? all('Imperial')[0]
  const lin = units?.getAttribute('linearUnit') ?? 'meter'
  const k = UNIT[lin] ?? 1
  const s = blank(name, 'landxml', `projected (LandXML ${lin}${k === 1 ? '' : ' → m'})`)
  const nez = (t: string | null) => (t ?? '').trim().split(/\s+/).map(Number)

  // a surveyed TIN: keep its triangles
  const surf = all('Surface')[0]
  if (surf) {
    const ids = new Map<string, number>()
    for (const p of Array.from(surf.getElementsByTagNameNS('*', 'P'))) {
      const [n, e, z] = nez(p.textContent)
      if (![n, e, z].every(Number.isFinite)) continue
      ids.set(p.getAttribute('id') ?? String(ids.size + 1), s.x.length)
      push(s, e * k, n * k, z * k, '')
    }
    const faces: number[] = []
    for (const f of Array.from(surf.getElementsByTagNameNS('*', 'F'))) {
      if (f.getAttribute('i') === '1') continue // invisible face
      const v = (f.textContent ?? '').trim().split(/\s+/).map((id) => ids.get(id))
      if (v.length === 3 && v.every((i) => i !== undefined)) faces.push(...(v as number[]))
    }
    if (faces.length) s.faces = faces
    if (surf.getAttribute('name')) s.warnings.push(`surface "${surf.getAttribute('name')}" (${faces.length / 3} faces)`)
  }
  // loose survey points (only when there is no surface, so TIN indices stay valid)
  if (!s.faces)
    for (const p of all('CgPoint')) {
      const [n, e, z] = nez(p.textContent)
      if ([n, e, z].every(Number.isFinite)) push(s, e * k, n * k, z * k, [p.getAttribute('name'), p.getAttribute('code') ?? p.getAttribute('desc')].filter(Boolean).join(' '))
    }
  // first alignment: lines and arcs, in order
  const al = all('Alignment')[0]
  if (al) {
    const pts: [number, number][] = []
    const add = (q: [number, number]) => {
      const last = pts[pts.length - 1]
      if (!last || Math.hypot(last[0] - q[0], last[1] - q[1]) > 1e-6) pts.push(q)
    }
    const pt = (el: Element | null): [number, number] | null => {
      if (!el) return null
      const [n, e] = nez(el.textContent)
      return Number.isFinite(n) && Number.isFinite(e) ? [e * k, n * k] : null
    }
    const geom = al.getElementsByTagNameNS('*', 'CoordGeom')[0]
    for (const g of geom ? Array.from(geom.children) : []) {
      const child = (t: string) => Array.from(g.children).find((c) => c.localName === t) ?? null
      const a = pt(child('Start')), b = pt(child('End'))
      if (!a || !b) continue
      if (g.localName === 'Curve') {
        const c = pt(child('Center'))
        if (c) {
          const r = Math.hypot(a[0] - c[0], a[1] - c[1])
          let a0 = Math.atan2(a[1] - c[1], a[0] - c[0]), a1 = Math.atan2(b[1] - c[1], b[0] - c[0])
          const cw = g.getAttribute('rot') === 'cw'
          if (cw && a1 > a0) a1 -= 2 * Math.PI
          if (!cw && a1 < a0) a1 += 2 * Math.PI
          const n = Math.max(4, Math.ceil((Math.abs(a1 - a0) * r) / 5)) // ≤ 5 m chords
          for (let i = 0; i <= n; i++) add([c[0] + r * Math.cos(a0 + ((a1 - a0) * i) / n), c[1] + r * Math.sin(a0 + ((a1 - a0) * i) / n)])
          continue
        }
      }
      if (g.localName === 'Spiral') s.warnings.push('spiral approximated by its chord')
      add(a)
      add(b)
    }
    if (pts.length >= 2) {
      s.alignment = pts
      s.alignmentName = al.getAttribute('name') ?? undefined
    }
  }
  return finish(s)
}

/* ------------------------------------------------------------------ GeoJSON */

/** WGS84 lon/lat → UTM (Transverse Mercator, Krüger series to n³) in metres. */
export function toUtm(lon: number, lat: number, zone: number): [number, number] {
  const a = 6378137, f = 1 / 298.257223563, k0 = 0.9996
  const n = f / (2 - f), A = (a / (1 + n)) * (1 + n * n / 4 + n ** 4 / 64)
  const al = [n / 2 - (2 / 3) * n * n + (5 / 16) * n ** 3, (13 / 48) * n * n - (3 / 5) * n ** 3, (61 / 240) * n ** 3]
  const phi = (lat * Math.PI) / 180, lam = ((lon - (zone * 6 - 183)) * Math.PI) / 180
  const e2 = (2 * Math.sqrt(n)) / (1 + n)
  const t = Math.sinh(Math.atanh(Math.sin(phi)) - e2 * Math.atanh(e2 * Math.sin(phi)))
  const xi = Math.atan2(t, Math.cos(lam)), eta = Math.atanh(Math.sin(lam) / Math.sqrt(1 + t * t))
  let E = eta, N = xi
  for (let j = 1; j <= 3; j++) {
    E += al[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta)
    N += al[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta)
  }
  return [500000 + k0 * A * E, (lat < 0 ? 10000000 : 0) + k0 * A * N]
}

type Geo = { type: string; coordinates?: unknown; geometries?: Geo[] }
type Feature = { type: 'Feature'; geometry: Geo | null; properties?: Record<string, unknown> | null }

export function parseGeoJson(name: string, text: string): Survey {
  const g = JSON.parse(text) as { type: string; features?: Feature[]; crs?: { properties?: { name?: string } } } & Geo
  const features: Feature[] = g.type === 'FeatureCollection' ? g.features ?? [] : g.type === 'Feature' ? [g as unknown as Feature] : [{ type: 'Feature', geometry: g, properties: {} }]
  const coords: number[][] = []
  const walk = (geo: Geo | null, f: (c: number[]) => void) => {
    if (!geo) return
    const deep = (c: unknown) => (Array.isArray(c) && typeof c[0] === 'number' ? f(c as number[]) : Array.isArray(c) && c.forEach(deep))
    if (geo.type === 'GeometryCollection') geo.geometries?.forEach((x) => walk(x, f))
    else deep(geo.coordinates)
  }
  for (const f of features) walk(f.geometry, (c) => coords.push(c))
  const lonlat = coords.length > 0 && coords.every((c) => Math.abs(c[0]) <= 180 && Math.abs(c[1]) <= 90) && !/EPSG::?(3405|3406|4756|9210|32[67]\d\d)/.test(g.crs?.properties?.name ?? '')
  const lon0 = lonlat ? coords.reduce((a, c) => a + c[0], 0) / coords.length : 0
  const zone = Math.floor((lon0 + 180) / 6) + 1
  const lat0 = lonlat ? coords.reduce((a, c) => a + c[1], 0) / coords.length : 0
  const xy = (c: number[]): [number, number] => (lonlat ? toUtm(c[0], c[1], zone) : [c[0], c[1]])
  const s = blank(name, 'geojson', lonlat ? `WGS84 → UTM ${zone}${lat0 < 0 ? 'S' : 'N'}` : `projected (${g.crs?.properties?.name ?? 'file units: m'})`)
  const elevProp = (p: Record<string, unknown> | null | undefined) => {
    for (const k of ['elevation', 'elev', 'z', 'Z', 'ELEV', 'Elevation', 'height', 'h', 'H', 'cao_do', 'caodo'])
      if (p && Number.isFinite(Number(p[k])) && p[k] !== null && p[k] !== '') return Number(p[k])
    return NaN
  }
  for (const f of features) {
    const geo = f.geometry
    if (!geo) continue
    const pz = elevProp(f.properties)
    const label = String(f.properties?.name ?? f.properties?.code ?? f.properties?.desc ?? '')
    if (geo.type === 'Point' || geo.type === 'MultiPoint') {
      walk(geo, (c) => {
        const z = c.length > 2 && Number.isFinite(c[2]) ? c[2] : pz
        if (Number.isFinite(z)) push(s, ...xy(c), z, label)
      })
    } else if (geo.type === 'LineString' || geo.type === 'MultiLineString') {
      const cs: number[][] = []
      walk(geo, (c) => cs.push(c))
      const is3d = cs.every((c) => c.length > 2 && Number.isFinite(c[2])) || Number.isFinite(pz)
      const named = /align|canal|centre|center|tim|tuyen|kenh|cl\b/i.test(`${label} ${JSON.stringify(f.properties ?? {})}`)
      if ((!is3d || named) && !s.alignment) {
        s.alignment = cs.map(xy)
        s.alignmentName = label || undefined
      } else if (is3d) for (const c of cs) push(s, ...xy(c), c.length > 2 && Number.isFinite(c[2]) ? c[2] : pz, label)
    }
  }
  return finish(s)
}

/* ------------------------------------------------------------------ DXF (survey content) */

export function parseSurveyDxf(name: string, text: string): Survey {
  const raw = text.split(/\r?\n/)
  const pairs: [number, string][] = []
  for (let i = 0; i + 1 < raw.length; i += 2) pairs.push([parseInt(raw[i], 10), raw[i + 1].trim()])
  const start = pairs.findIndex((p, i) => p[0] === 2 && p[1] === 'ENTITIES' && pairs[i - 1]?.[1] === 'SECTION')
  if (start < 0) throw new Error('no ENTITIES section')
  const s = blank(name, 'dxf', 'projected (drawing units: m)')
  const lines2d: { layer: string; pts: [number, number][] }[] = []
  const counts: Record<string, number> = {}
  let i = start + 1
  const ents: { type: string; p: [number, string][] }[] = []
  while (i < pairs.length && !(pairs[i][0] === 0 && pairs[i][1] === 'ENDSEC')) {
    if (pairs[i][0] === 0) {
      const e = { type: pairs[i][1], p: [] as [number, string][] }
      i++
      while (i < pairs.length && pairs[i][0] !== 0) e.p.push(pairs[i++])
      ents.push(e)
    } else i++
  }
  const g = (e: { p: [number, string][] }, code: number, d = NaN) => {
    const f = e.p.find((q) => q[0] === code)
    return f ? Number(f[1]) : d
  }
  const layer = (e: { p: [number, string][] }) => e.p.find((q) => q[0] === 8)?.[1] ?? '0'
  const isAlignLayer = (l: string) => /align|centre|center|tim|tuyen|\bcl\b|c-road-cntr/i.test(l)
  for (let k = 0; k < ents.length; k++) {
    const e = ents[k]
    counts[e.type] = (counts[e.type] ?? 0) + 1
    if (e.type === 'POINT' || e.type === 'INSERT') {
      const z = g(e, 30, 0)
      if (e.type === 'POINT' || z !== 0) push(s, g(e, 10), g(e, 20), z, layer(e))
    } else if (e.type === '3DFACE') {
      for (const c of [0, 1, 2, 3]) if (Number.isFinite(g(e, 10 + c))) push(s, g(e, 10 + c), g(e, 20 + c), g(e, 30 + c, 0), '')
    } else if (e.type === 'LINE') {
      if (g(e, 30, 0) !== 0 || g(e, 31, 0) !== 0) {
        push(s, g(e, 10), g(e, 20), g(e, 30, 0), layer(e))
        push(s, g(e, 11), g(e, 21), g(e, 31, 0), layer(e))
      }
    } else if (e.type === 'LWPOLYLINE') {
      const elev = g(e, 38, 0)
      const xs = e.p.filter((q) => q[0] === 10).map((q) => Number(q[1])), ys = e.p.filter((q) => q[0] === 20).map((q) => Number(q[1]))
      if (elev !== 0) xs.forEach((x, j) => push(s, x, ys[j], elev, layer(e)))
      else lines2d.push({ layer: layer(e), pts: xs.map((x, j) => [x, ys[j]]) })
    } else if (e.type === 'POLYLINE') {
      const flags = g(e, 70, 0)
      const verts: [number, number, number][] = []
      while (ents[k + 1] && ents[k + 1].type === 'VERTEX') {
        const v = ents[++k]
        verts.push([g(v, 10), g(v, 20), g(v, 30, 0)])
      }
      if (ents[k + 1]?.type === 'SEQEND') k++
      const elev = g(e, 30, 0)
      if (flags & 8 || verts.some((v) => v[2] !== 0) || elev !== 0) verts.forEach((v) => push(s, v[0], v[1], v[2] || elev, layer(e)))
      else lines2d.push({ layer: layer(e), pts: verts.map((v) => [v[0], v[1]]) })
    }
  }
  const al = lines2d.find((l) => isAlignLayer(l.layer) && l.pts.length >= 2)
  if (al) {
    s.alignment = al.pts
    s.alignmentName = al.layer
  }
  const texts = (counts.TEXT ?? 0) + (counts.MTEXT ?? 0)
  if (texts && s.x.length < 3) s.warnings.push(`${texts} text labels found — elevations written only as text are not read; export points with Z from the survey software`)
  return finish(s)
}

/* ------------------------------------------------------------------ common */

function blank(name: string, format: SurveyFormat, crs: string): Survey {
  return { name, format, crs, x: [], y: [], z: [], codes: [], imported: Date.now(), warnings: [] }
}

function push(s: Survey, x: number, y: number, z: number, code: string) {
  if (![x, y, z].every(Number.isFinite)) return
  s.x.push(x)
  s.y.push(y)
  s.z.push(z)
  s.codes!.push(code)
}

/** Drops duplicate plan positions (≤ 1 mm apart; the last one wins) unless the file carries its own faces. */
function finish(s: Survey): Survey {
  if (!s.faces) {
    const seen = new Map<string, number>()
    for (let i = 0; i < s.x.length; i++) seen.set(`${Math.round(s.x[i] * 1000)}:${Math.round(s.y[i] * 1000)}`, i)
    if (seen.size < s.x.length) {
      const keep = [...seen.values()].sort((a, b) => a - b)
      s.warnings.push(`${s.x.length - keep.length} duplicate point(s) merged`)
      s.x = keep.map((i) => s.x[i])
      s.y = keep.map((i) => s.y[i])
      s.z = keep.map((i) => s.z[i])
      s.codes = keep.map((i) => s.codes![i])
    }
  }
  if (s.codes?.every((c) => !c)) delete s.codes
  if (s.x.length < 3 && !s.alignment) throw new Error(`only ${s.x.length} point(s) with elevation found — a surface needs at least 3`)
  return s
}

export function parseSurvey(name: string, text: string, csv: CsvOptions = {}): Survey {
  const f = detectFormat(name, text)
  return f === 'landxml' ? parseLandXml(name, text) : f === 'geojson' ? parseGeoJson(name, text) : f === 'dxf' ? parseSurveyDxf(name, text) : parseCsv(name, text, csv)
}

/* ------------------------------------------------------------------ ESRI Shapefile (.shp + .dbf + .prj) */

/** dBASE III table: field names and the rows as strings. */
export function readDbf(buf: ArrayBuffer): { fields: string[]; rows: string[][] } {
  const v = new DataView(buf)
  const n = v.getUint32(4, true), headerLen = v.getUint16(8, true), recLen = v.getUint16(10, true)
  const dec = new TextDecoder('utf-8')
  const fields: { name: string; len: number }[] = []
  for (let o = 32; o < headerLen - 1 && v.getUint8(o) !== 0x0d; o += 32) {
    const name = dec.decode(new Uint8Array(buf, o, 11)).replace(/\0.*$/, '').trim()
    fields.push({ name, len: v.getUint8(o + 16) })
  }
  const rows: string[][] = []
  for (let r = 0; r < n; r++) {
    let o = headerLen + r * recLen + 1 // deletion flag
    const row: string[] = []
    for (const f of fields) {
      row.push(dec.decode(new Uint8Array(buf, o, f.len)).trim())
      o += f.len
    }
    rows.push(row)
  }
  return { fields: fields.map((f) => f.name), rows }
}

export function parseShapefile(name: string, shp: ArrayBuffer, dbf?: ArrayBuffer, prj?: string): Survey {
  const v = new DataView(shp)
  if (v.getInt32(0, false) !== 9994) throw new Error('not an ESRI shapefile (.shp)')
  const geographic = !!prj && /^\s*GEOGCS\[/i.test(prj)
  const table = dbf ? readDbf(dbf) : null
  const ez = table ? table.fields.findIndex((f) => /^(z|elev|elevation|elev_m|h|height|cao_?do|caodo|rl|level|contour|cont)$/i.test(f)) : -1
  const nameCol = table ? table.fields.findIndex((f) => /^(name|ten|code|ma|id|desc)$/i.test(f)) : -1
  // records first (to know the extent for the UTM zone), then project
  type Rec = { pts: [number, number, number][]; line: boolean; attrZ: number; label: string }
  const recs: Rec[] = []
  const end = v.getInt32(24, false) * 2
  let o = 100, idx = 0
  while (o + 8 <= end && o + 8 <= shp.byteLength) {
    const len = v.getInt32(o + 4, false) * 2
    const c = o + 8
    const type = v.getInt32(c, true)
    const attrZ = table && ez >= 0 ? Number(table.rows[idx]?.[ez]) : NaN
    const label = table && nameCol >= 0 ? table.rows[idx]?.[nameCol] ?? '' : ''
    const d = (k: number) => v.getFloat64(k, true)
    if (type === 1 || type === 11 || type === 21) recs.push({ pts: [[d(c + 4), d(c + 12), type === 11 ? d(c + 20) : NaN]], line: false, attrZ, label })
    else if (type === 8 || type === 18 || type === 28) {
      const np = v.getInt32(c + 36, true)
      const pts: [number, number, number][] = []
      const zBase = c + 40 + np * 16 + 16
      for (let i = 0; i < np; i++) pts.push([d(c + 40 + i * 16), d(c + 48 + i * 16), type === 18 ? d(zBase + i * 8) : NaN])
      recs.push({ pts, line: false, attrZ, label })
    } else if (type === 3 || type === 13 || type === 23 || type === 5 || type === 15) {
      const nParts = v.getInt32(c + 36, true), np = v.getInt32(c + 40, true)
      const p0 = c + 44 + nParts * 4
      const zBase = p0 + np * 16 + 16
      const pts: [number, number, number][] = []
      for (let i = 0; i < np; i++) pts.push([d(p0 + i * 16), d(p0 + 8 + i * 16), type === 13 || type === 15 ? d(zBase + i * 8) : NaN])
      recs.push({ pts, line: type === 3 || type === 13 || type === 23, attrZ, label })
    }
    o += 8 + len
    idx++
  }
  const all = recs.flatMap((r) => r.pts)
  const lon0 = geographic ? all.reduce((a, p) => a + p[0], 0) / Math.max(1, all.length) : 0
  const lat0 = geographic ? all.reduce((a, p) => a + p[1], 0) / Math.max(1, all.length) : 0
  const zone = Math.floor((lon0 + 180) / 6) + 1
  const xy = (p: [number, number, number]): [number, number] => (geographic ? toUtm(p[0], p[1], zone) : [p[0], p[1]])
  const crsName = prj?.match(/^\s*\w+\["([^"]+)"/)?.[1]
  const s = blank(name, 'shp', geographic ? `${crsName ?? 'geographic'} → UTM ${zone}${lat0 < 0 ? 'S' : 'N'}` : `projected (${crsName ?? 'no .prj: file units = m'})`)
  if (!dbf) s.warnings.push('no .dbf — elevations only from Z geometry')
  for (const r of recs) {
    const hasZ = r.pts.every((p) => Number.isFinite(p[2]) && p[2] !== 0) || Number.isFinite(r.attrZ)
    if (r.line && !hasZ) {
      if (!s.alignment) {
        s.alignment = r.pts.map(xy)
        s.alignmentName = r.label || undefined
      }
      continue
    }
    for (const p of r.pts) push(s, ...xy(p), Number.isFinite(p[2]) && p[2] !== 0 ? p[2] : r.attrZ, r.label)
  }
  return finish(s)
}
