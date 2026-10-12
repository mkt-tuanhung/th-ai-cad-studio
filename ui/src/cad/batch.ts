/**
 * Reading drawings from files (shared by CAD 2D "Open" and the Dashboard batch job) and the batch
 * conversion itself: every DWG / DXF → PDF (vector, fitted on the chosen paper), DXF, DWG and/or PNG.
 * Desktop: written into one folder the user picked (HostBridge::pickFolder → *To methods).
 * Browser: each output is downloaded; DWG in or out needs the desktop app (LibreDWG helper).
 */
import type { CadDocument } from './types'
import { decodeDxf, importDxf } from './dxfImport'
import { createBlankDocument } from './seed'
import { toDxf } from './dxf'
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
  const { entities, layers, skipped, approximated } = importDxf(decodeDxf(bytes).text)
  const doc = createBlankDocument(f.name)
  const known = new Set(doc.layers.map((l) => l.name))
  doc.layers = [...doc.layers, ...layers.filter((l) => !known.has(l.name)).map(({ name, visible }) => ({ name, color: '#1f2937', visible, locked: false, linetype: 'Continuous' as const, lineweight: 0.25 }))]
  doc.entities = entities
  doc.source = 'dxf-import'
  return { doc, skipped, approximated, dwg }
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
        if (o === 'dxf') outs.push(await write(`${base}.dxf`, new TextEncoder().encode(toDxf(doc)), 'application/dxf'))
        else if (o === 'png') outs.push(await write(`${base}.png`, new Uint8Array(await (await pagePng(plotPage(doc, paper), 200)).arrayBuffer()), 'image/png'))
        else if (o === 'pdf') {
          const page = { ...plotPage(doc, paper), name: base }
          if (host && dir) {
            outs.push(written(`${base}.pdf`, await host.cadExportPdfTo(JSON.stringify(page), dir, `${base}.pdf`)))
          } else outs.push({ name: `${base}.pdf`, error: 'desktop-only' })
        } else if (o === 'dwg') {
          if (host && dir) {
            outs.push(written(`${base}.dwg`, await host.dwgWriteTo(toDwgAdd(doc).script, dir, `${base}.dwg`)))
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
