// Offline OCR assets for Scan to CAD (tesseract.js 5.1.1, Apache-2.0): the worker and the WASM core are
// copied from node_modules, the Vietnamese LSTM model (tessdata_best 4.1.0, Apache-2.0 — best keeps the
// diacritics of capitals right) is downloaded once and checked by sha256. Output: public/ocr (not
// committed; bundled into ui/dist by the build).
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
// fileURLToPath: a URL pathname is "/D:/…" on Windows
const root = fileURLToPath(new URL('..', import.meta.url))
const out = join(root, 'public', 'ocr') + '/'
mkdirSync(out + 'lang', { recursive: true })
copyFileSync(join(root, 'node_modules/tesseract.js/dist/worker.min.js'), out + 'worker.min.js')
for (const f of ['tesseract-core-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js']) copyFileSync(join(root, 'node_modules/tesseract.js-core', f), out + f)
const models = {
  vie: 'b6b49293d95d0b6dbd8780174627e82c75be957b6f4ed9862155540d6b00bb45',
}
const sha = (b) => createHash('sha256').update(b).digest('hex')
for (const [lang, sum] of Object.entries(models)) {
  const file = out + `lang/${lang}.traineddata`
  if (existsSync(file) && sha(readFileSync(file)) === sum) continue
  const res = await fetch(`https://github.com/tesseract-ocr/tessdata_best/raw/4.1.0/${lang}.traineddata`)
  if (!res.ok) throw new Error(`${lang}: HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (sha(buf) !== sum) throw new Error(`${lang}.traineddata: sha256 mismatch`)
  writeFileSync(file, buf)
  console.log(`ocr: ${lang}.traineddata ${buf.length} bytes`)
}
console.log('ocr assets ready in public/ocr')
