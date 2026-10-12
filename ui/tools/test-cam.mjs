// Unit tests of nesting / toolpaths / FEA (pure TS, run in Node after a Vite bundle).
import { build } from 'vite'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const root = new URL('..', import.meta.url).pathname
const entry = process.env.UNIT ?? 'cam'
const res = await build({ configFile: false, logLevel: 'warn', build: { write: false, minify: false, lib: { entry: root + `tools/unit/${entry}.test.ts`, formats: ['es'], fileName: entry } } })
const dir = mkdtempSync(join(tmpdir(), 'thcad-cam-'))
const f = join(dir, 'cam.mjs')
writeFileSync(f, (Array.isArray(res) ? res[0] : res).output[0].code)
const m = await import(f)
const which = process.argv[2] ?? 'run'
const arg = process.argv[3] ? (await import('node:fs')).readFileSync(process.argv[3], 'latin1') : undefined
console.log(JSON.stringify(m[which](arg), null, 1))
