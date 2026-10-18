/**
 * Reading drawings from files (shared by CAD 2D "Open" and the Dashboard batch job) and the batch
 * conversion itself: every DWG / DXF → PDF (vector, fitted on the chosen paper), DXF, DWG and/or PNG.
 * Desktop: written into one folder the user picked (HostBridge::pickFolder → *To methods).
 * Browser: each output is downloaded; DWG in or out needs the desktop app (LibreDWG helper).
 */
import type { CadDocument, Entity, Layout } from './types'
import { decodeDxf, importDxf } from './dxfImport'
import { createBlankDocument } from './seed'
import { toDxf2000 } from './dxf2000'
import { toDwgAdd } from './dwgWrite'
import { pagePng, plotPage, type Paper } from './plot'
import { convertDwg, dwgReader, toBase64 } from '../services/dwg'
import type { HostApi } from '../services/host'

export interface ReadDrawing {
  doc: CadDocument
  skipped: Record<string, number>
  approximated: Record<string, number>
  /** DWG only: conversion time and warnings of the LibreDWG helper. */
  dwg?: { reader: string; ms: number; warnings: number }
  /** The drawing's units and the factor its geometry was scaled by to millimetres (the app's unit). */
  units: DrawingUnits
}

/** Drawing units: from the header ($INSUNITS), guessed (unset / unitless header), or assumed millimetres. */
export interface DrawingUnits {
  /** $INSUNITS as written (null: no header value) */
  insunits: number | null
  /** the unit the geometry was read in ("mm", "m", "cm", "in"…) */
  unit: string
  /** × factor applied to reach millimetres (1 = unchanged) */
  factor: number
  source: 'header' | 'guess' | 'assumed'
  /** why it was guessed / what to check (code: 'guessM' | 'maybeCm' | 'unknownCode' | 'noHeader') */
  note?: 'guessM' | 'maybeCm' | 'unknownCode' | 'noHeader'
}

/** $INSUNITS code → [unit, millimetres per unit] (AutoCAD's table; 0 = unitless). */
export const INSUNITS: Record<number, [string, number]> = {
  1: ['in', 25.4], 2: ['ft', 304.8], 3: ['mi', 1609344], 4: ['mm', 1], 5: ['cm', 10], 6: ['m', 1000], 7: ['km', 1e6], 8: ['µin', 25.4e-6], 9: ['mil', 0.0254],
  10: ['yd', 914.4], 11: ['Å', 1e-7], 12: ['nm', 1e-6], 13: ['µm', 1e-3], 14: ['dm', 100], 15: ['dam', 1e4], 16: ['hm', 1e5],
}

const quantile = (v: number[], q: number) => { if (!v.length) return 0; const s = [...v].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))] }

/**
 * The units of a drawing: $INSUNITS when the header has a known one; with none (0 / unset — common in Vietnamese
 * DWGs drawn in mm) a guess from the extents and the text heights: a building drawn in metres is a few tens of units
 * across with texts a fraction of a unit high → metres. Anything else stays millimetres, with a note when it looks like
 * centimetres (not scaled — said so in the review).
 */
export function detectUnits(insunits: number | null, entities: Entity[]): DrawingUnits {
  if (insunits !== null && INSUNITS[insunits]) { const [unit, factor] = INSUNITS[insunits]; return { insunits, unit, factor, source: 'header' } }
  if (insunits !== null && insunits !== 0) return { insunits, unit: 'mm', factor: 1, source: 'assumed', note: 'unknownCode' }
  // robust extents: the 2nd–98th percentile of the entity positions (a stray point far away does not count)
  const xs: number[] = [], ys: number[] = [], th: number[] = []
  for (const e of entities) {
    const p = e.kind === 'line' || e.kind === 'dimension' ? e.a : e.kind === 'polyline' ? e.pts[0] : e.kind === 'text' ? e.p : e.c
    if (!p) continue
    xs.push(p.x); ys.push(p.y)
    if (e.kind === 'text' && e.height > 0) th.push(e.height)
  }
  const ext = Math.max(quantile(xs, 0.98) - quantile(xs, 0.02), quantile(ys, 0.98) - quantile(ys, 0.02))
  const h = quantile(th, 0.5)
  if (th.length >= 3 && h > 0 && h < 1.2 && ext > 2 && ext < 3000) return { insunits, unit: 'm', factor: 1000, source: 'guess', note: 'guessM' }
  if (th.length >= 3 && h >= 8 && h <= 40 && ext >= 800 && ext <= 6000) return { insunits, unit: 'mm', factor: 1, source: 'assumed', note: 'maybeCm' }
  return { insunits, unit: 'mm', factor: 1, source: 'assumed', note: 'noHeader' }
}

/** Scales the geometry (positions, radii, text heights, dimension offsets) by k, and the layouts' viewport scales. */
export function scaleDrawing(entities: Entity[], layouts: Layout[] | undefined, k: number): { entities: Entity[]; layouts?: Layout[] } {
  if (k === 1) return { entities, layouts }
  const v = (p: { x: number; y: number }) => ({ x: p.x * k, y: p.y * k })
  const out = entities.map((e): Entity => {
    switch (e.kind) {
      case 'line': return { ...e, a: v(e.a), b: v(e.b) }
      case 'polyline': return { ...e, pts: e.pts.map(v) }
      case 'circle': return { ...e, c: v(e.c), r: e.r * k }
      case 'arc': return { ...e, c: v(e.c), r: e.r * k }
      case 'text': return { ...e, p: v(e.p), height: e.height * k }
      case 'dimension': return { ...e, a: v(e.a), b: v(e.b), offset: e.offset * k, textHeight: e.textHeight * k }
    }
  })
  // a viewport showing model units at 1 : s shows millimetres at 1 : s·k
  return { entities: out, layouts: layouts?.map((l) => ({ ...l, scale: l.scale ? Number((l.scale * k).toFixed(3)) : l.scale })) }
}

/** Parses a DWG (desktop) or DXF file into a drawing; throws with a readable reason. */
export async function readDrawing(f: File): Promise<ReadDrawing> {
  const ext = f.name.split('.').pop()?.toLowerCase()
  let bytes: Uint8Array
  let dwg: ReadDrawing['dwg']
  if (ext === 'dwg') {
    const reader = await dwgReader()
    if (!reader) throw new Error('no-dwg-reader')
    const r = await convertDwg(new Uint8Array(await f.arrayBuffer()), f.name)
    bytes = r.dxf
    dwg = { reader, ms: r.ms, warnings: r.warnings }
  } else if (ext === 'dxf') {
    bytes = new Uint8Array(await f.arrayBuffer())
  } else throw new Error(`unsupported .${ext}`)
  const read = importDxf(decodeDxf(bytes).text)
  const { layers, skipped, approximated } = read
  // the app works in millimetres: a drawing in metres / centimetres / inches is scaled when it is read
  const units = detectUnits(read.insunits, read.entities)
  const { entities, layouts } = scaleDrawing(read.entities, read.layouts, units.factor)
  const doc = createBlankDocument(f.name)
  const known = new Set(doc.layers.map((l) => l.name))
  doc.layers = [...doc.layers, ...layers.filter((l) => !known.has(l.name)).map(({ name, visible }) => ({ name, color: '#1f2937', visible, locked: false, linetype: 'Continuous' as const, lineweight: 0.25 }))]
  doc.entities = entities
  doc.source = 'dxf-import'
  if (layouts) doc.layouts = layouts
  return { doc, skipped, approximated, dwg, units }
}

export type BatchOutput = 'pdf' | 'dxf' | 'dwg' | 'png'

export interface BatchResult {
  file: string
  ok: boolean
  /** Written files (name + size), or the reason it failed. */
  outputs: { name: string; bytes?: number; error?: string }[]
  entities?: number
  error?: string
}

/**
 * Converts each file to the chosen outputs. `dir` = folder picked through the host (desktop) — without a
 * host every output is downloaded instead. Calls `progress` after each file.
 */
export async function runBatch(
  files: File[],
  outputs: BatchOutput[],
  paper: Paper,
  host: HostApi | null,
  dir: string | null,
  progress: (done: number, r: BatchResult) => void,
): Promise<BatchResult[]> {
  const results: BatchResult[] = []
  const download = (name: string, bytes: Uint8Array, type: string) => {
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }))
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const written = (name: string, r: { ok: boolean; path?: string; bytes?: number; error?: string }) =>
    r.ok ? { name: r.path?.split(/[\\/]/).pop() ?? name, bytes: r.bytes } : { name, error: r.error }
  const write = async (name: string, bytes: Uint8Array, type: string) => {
    if (host && dir) {
      return written(name, await host.writeFileTo(dir, name, toBase64(bytes)))
    }
    download(name, bytes, type)
    return { name, bytes: bytes.length }
  }
  for (const f of files) {
    const base = f.name.replace(/\.(dwg|dxf)$/i, '')
    let r: BatchResult
    try {
      const { doc } = await readDrawing(f)
      const outs: BatchResult['outputs'] = []
      for (const o of outputs) {
        if (o === 'dxf') outs.push(await write(`${base}.dxf`, new TextEncoder().encode(toDxf2000(doc)), 'application/dxf'))
        else if (o === 'png') outs.push(await write(`${base}.png`, new Uint8Array(await (await pagePng(plotPage(doc, paper), 200)).arrayBuffer()), 'image/png'))
        else if (o === 'pdf') {
          const page = { ...plotPage(doc, paper), name: base }
          if (host && dir) {
            outs.push(written(`${base}.pdf`, await host.cadExportPdfTo(JSON.stringify(page), dir, `${base}.pdf`)))
          } else outs.push({ name: `${base}.pdf`, error: 'desktop-only' })
        } else if (o === 'dwg') {
          if (host && dir) {
            let d = await host.dwgWriteDxfTo(toDxf2000(doc, { leftText: true }), dir, `${base}.dwg`)
            if (d.error === 'no-writer') d = await host.dwgWriteTo(toDwgAdd(doc).script, dir, `${base}.dwg`)
            outs.push(written(`${base}.dwg`, d))
          } else outs.push({ name: `${base}.dwg`, error: 'desktop-only' })
        }
      }
      r = { file: f.name, ok: outs.every((x) => !x.error), outputs: outs, entities: doc.entities.length }
    } catch (e) {
      r = { file: f.name, ok: false, outputs: [], error: (e as Error).message }
    }
    results.push(r)
    progress(results.length, r)
  }
  return results
}
