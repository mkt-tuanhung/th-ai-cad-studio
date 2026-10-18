// Licence / SBOM gate (SP64, V24-065). Fails (exit 1) when something that ships has no entry in docs/SBOM.json:
//   1. a file under ui/public or native/app/resources/branding (path + sha256 — a changed file needs a new SBOM);
//   2. a production npm package (the installed version must match);
//   3. a model weight file the app can download (native/app/src/model_downloader.cpp, whisper_runner.cpp);
//   4. a library / plug-in / helper inside the packaged app (THCAD_APP=<.app>, default native/dist/… when present);
//   5. a row of THIRD_PARTY_NOTICES.md;
// and on policy: no UNKNOWN licence, every model says whether commercial use is allowed (non-commercial ones carry
// a flag), no stock 3D model / texture / HDRI formats bundled.
// usage: node tools/check-sbom.mjs [--selftest]   (--selftest also proves the gate fails on a missing entry)
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ui = fileURLToPath(new URL('..', import.meta.url))
const repo = join(ui, '..')
const MAIN = '/Users/mac/Downloads/TH_AI_CAD_Studio_UI_Handoff_v1/th-ai-cad-studio'
const appPath = process.env.THCAD_APP ?? [join(repo, 'native/dist/MD CAD AI STUDIO.app'), join(MAIN, 'native/dist/MD CAD AI STUDIO.app')].find(existsSync)

function walk(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const f of readdirSync(dir)) {
    if (f === '.DS_Store') continue
    const p = join(dir, f)
    if (statSync(p).isDirectory() && !/\.framework$/.test(f)) walk(p, out)
    else out.push(p)
  }
  return out
}

export function check(sbom) {
  const problems = []
  const comps = sbom.components
  // 1. bundled files
  const listed = new Map(comps.filter((c) => c.type === 'asset').flatMap((a) => a.files.map((f) => [f.path, f.sha256])))
  const files = [...walk(join(ui, 'public')), ...walk(join(repo, 'native/app/resources/branding'))].map((p) => relative(repo, p).split('\\').join('/'))
  for (const f of files) {
    if (!listed.has(f)) problems.push(`asset without SBOM entry: ${f}`)
    else if (listed.get(f) !== createHash('sha256').update(readFileSync(join(repo, f))).digest('hex')) problems.push(`asset changed since the SBOM was made: ${f}`)
    if (/\.(hdr|exr|glb|gltf|fbx|obj|skp|3ds|blend|ktx2?|dds|tga)$/i.test(f)) problems.push(`stock 3D model / texture format bundled (needs a licence review): ${f}`)
  }
  // 2. npm
  const pkg = JSON.parse(readFileSync(join(ui, 'package.json'), 'utf8'))
  const npm = new Map(comps.filter((c) => c.type === 'npm').map((c) => [c.name, c]))
  const seen = new Set()
  const visit = (name) => {
    if (seen.has(name)) return
    seen.add(name)
    const p = join(ui, 'node_modules', name, 'package.json')
    if (!existsSync(p)) return
    const j = JSON.parse(readFileSync(p, 'utf8'))
    const c = npm.get(name)
    if (!c) problems.push(`npm package without SBOM entry: ${name}@${j.version}`)
    else if (c.version !== j.version) problems.push(`npm version differs from the SBOM: ${name} ${j.version} (SBOM ${c.version})`)
    for (const d of Object.keys({ ...(j.dependencies ?? {}), ...(j.optionalDependencies ?? {}) })) visit(d)
  }
  Object.keys(pkg.dependencies).forEach(visit)
  // 3. models the app can fetch
  const models = comps.filter((c) => c.type === 'model')
  const glob = (g) => new RegExp('^' + g.split('/').pop().replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$')
  const src = ['native/app/src/model_downloader.cpp', 'native/app/src/whisper_runner.cpp'].map((f) => readFileSync(join(repo, f), 'utf8')).join('\n')
  for (const m of new Set(src.match(/[\w.-]+\.(gguf|bin)\b/g) ?? [])) if (!/^ggml-\w+\.bin$/.test(m) || m.includes('large')) if (!models.some((x) => glob(x.file).test(m))) problems.push(`downloadable model without SBOM entry: ${m}`)
  if (!models.some((x) => x.file.endsWith('vie.traineddata'))) problems.push('OCR model vie.traineddata without SBOM entry')
  for (const x of models) {
    if (typeof x.commercialUse !== 'boolean') problems.push(`model without commercialUse: ${x.name}`)
    if (x.commercialUse === false && !x.flag) problems.push(`non-commercial model without a flag: ${x.name}`)
  }
  // 4. packaged app
  const natives = comps.filter((c) => c.type === 'native')
  if (appPath) {
    const c = join(appPath, 'Contents')
    const shipped = [
      ...readdirSync(join(c, 'Frameworks')).map((f) => f),
      ...walk(join(c, 'PlugIns')).map((p) => 'plugins/' + relative(join(c, 'PlugIns'), p)),
      ...(existsSync(join(c, 'Helpers')) ? readdirSync(join(c, 'Helpers')) : []),
    ]
    for (const f of shipped) {
      const name = f.split('/').pop()
      if (!natives.some((n) => n.match.some((re) => new RegExp(re).test(f) || new RegExp(re).test(name)))) problems.push(`shipped in the app without SBOM entry: ${f}`)
    }
  }
  // 5. THIRD_PARTY_NOTICES rows
  const names = comps.map((x) => x.name.toLowerCase())
  const KEY = { 'qt 6': 'qt', 'open cascade': 'open cascade technology', 'llama.cpp / ggml': 'llama.cpp', 'vulkan loader': 'vulkan loader', libredwg: 'libredwg', 'whisper.cpp': 'whisper.cpp', libiconv: 'gnu libiconv', 'react, react dom': 'react', zustand: 'zustand', 'lucide-react': 'lucide-react', earcut: 'earcut', delaunator: 'delaunator', 'pdf.js': 'pdfjs-dist', 'tesseract.js': 'tesseract.js', 'tesseract model': 'tesseract model vie (tessdata_best 4.1.0)', roboto: '@fontsource-variable/roboto', 'glib, gnu gettext': 'glib', 'icu, harfbuzz': 'icu' }
  for (const row of sbom.thirdPartyNotices ?? []) {
    const k = Object.keys(KEY).find((x) => row.toLowerCase().includes(x))
    if (!k || !names.some((n) => n === KEY[k] || n.startsWith(KEY[k]))) problems.push(`THIRD_PARTY_NOTICES row without SBOM component: ${row}`)
  }
  // policy
  for (const x of comps) if (!x.license || /UNKNOWN/i.test(x.license)) problems.push(`licence unknown: ${x.name}`)
  for (const a of comps.filter((x) => x.type === 'asset')) if (a.productionUse === undefined) problems.push(`asset group without productionUse: ${a.name}`)
  return { problems, files: files.length, npm: npm.size, models: models.length, natives: natives.length, app: appPath ?? null }
}

const sbom = JSON.parse(readFileSync(join(repo, 'docs/SBOM.json'), 'utf8'))
const r = check(sbom)
const out = { ...r, ok: r.problems.length === 0 }
if (process.argv.includes('--selftest')) {
  // the gate must fail when an asset, a package, a model or a shipped library is missing from the SBOM
  const drop = (pred) => ({ ...sbom, components: sbom.components.filter((c) => !pred(c)).map((c) => (c.type === 'asset' ? { ...c, files: c.files.slice(1) } : c)) })
  out.selftest = {
    missingAssetFails: check(drop(() => false)).problems.some((p) => p.startsWith('asset without SBOM entry')),
    missingNpmFails: check(drop((c) => c.name === 'zustand')).problems.some((p) => p.includes('zustand')),
    missingModelFails: check(drop((c) => c.type === 'model' && c.name.startsWith('Qwen2.5-3B'))).problems.some((p) => p.includes('qwen2.5-3b')),
    missingNativeFails: !appPath || check(drop((c) => c.name === 'OpenSSL')).problems.some((p) => p.includes('libssl')),
  }
  out.ok = out.ok && Object.values(out.selftest).every(Boolean)
}
console.log(JSON.stringify(out, null, 1))
process.exitCode = out.ok ? 0 : 1
