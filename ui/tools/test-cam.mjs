// Unit tests of nesting / toolpaths / FEA (pure TS, run in Node after a Vite bundle).
import { build } from 'vite'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const root = new URL('..', import.meta.url).pathname
const res = await build({ configFile: false, logLevel: 'warn', build: { write: false, minify: false, lib: { entry: root + 'tools/unit/cam.test.ts', formats: ['es'], fileName: 'cam' } } })
const dir = mkdtempSync(join(tmpdir(), 'thcad-cam-'))
const f = join(dir, 'cam.mjs')
writeFileSync(f, (Array.isArray(res) ? res[0] : res).output[0].code)
const m = await import(f)
const which = process.argv[2] ?? 'run'
console.log(JSON.stringify(m[which](), null, 1))
