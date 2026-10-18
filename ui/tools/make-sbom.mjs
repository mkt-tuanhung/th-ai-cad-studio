// Writes docs/SBOM.json — the machine-readable bill of materials (SP64, V24-065):
//   - UI runtime packages: every production npm dependency, transitively (they are bundled into ui/dist), with the
//     version and licence read from node_modules;
//   - build / test tools (devDependencies): listed, marked "not distributed";
//   - native libraries and helper programs (tools/sbom-data.mjs NATIVE), versions refreshed from Homebrew when present;
//   - model weights (MODELS) with the commercial-use flag;
//   - assets (ASSETS) with every bundled file listed under its group;
//   - the rows of THIRD_PARTY_NOTICES.md, each mapped to its SBOM component.
// usage: node tools/make-sbom.mjs   (then node tools/check-sbom.mjs)
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ASSETS, MODELS, NATIVE } from './sbom-data.mjs'

const ui = fileURLToPath(new URL('..', import.meta.url))
const repo = join(ui, '..')
const pkg = JSON.parse(readFileSync(join(ui, 'package.json'), 'utf8'))
const nm = join(ui, 'node_modules')

const readPkg = (name) => { const p = join(nm, name, 'package.json'); return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null }
const licenseOf = (p) => (typeof p.license === 'string' ? p.license : p.license?.type ?? (Array.isArray(p.licenses) ? p.licenses.map((l) => l.type).join(' OR ') : 'UNKNOWN'))
const repoOf = (p) => (typeof p.repository === 'string' ? p.repository : p.repository?.url ?? `https://www.npmjs.com/package/${p.name}`).replace(/^git\+/, '')

/** production closure: package.json dependencies and their dependencies (peer / optional ones that are installed too) */
function closure(roots) {
  const seen = new Map()
  const visit = (name, via) => {
    if (seen.has(name)) return
    const p = readPkg(name)
    if (!p) { seen.set(name, { name, version: 'NOT INSTALLED', license: 'UNKNOWN', via }); return }
    seen.set(name, { name, version: p.version, license: licenseOf(p), source: repoOf(p), via })
    for (const d of Object.keys({ ...(p.dependencies ?? {}), ...(p.optionalDependencies ?? {}) })) if (readPkg(d)) visit(d, name)
  }
  for (const r of roots) visit(r, 'package.json')
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** Packages whose code really ends up in the UI bundle: a Vite production build (not written) of the app, its module ids. */
async function bundledPackages() {
  const { build } = await import('vite')
  const ids = new Set()
  await build({
    root: ui, logLevel: 'error', configFile: join(ui, 'vite.config.ts'),
    build: { write: false, rollupOptions: { plugins: [{ name: 'sbom-modules', generateBundle(_, bundle) { for (const c of Object.values(bundle)) if (c.type === 'chunk') for (const id of Object.keys(c.modules)) ids.add(id) } }] } },
  })
  const pk = new Set()
  for (const id of ids) {
    const m = id.split('\\').join('/').match(/node_modules\/((?:@[^/]+\/)?[^/]+)/g)
    if (m) pk.add(m.at(-1).replace('node_modules/', ''))
  }
  return pk
}
const inBundle = await bundledPackages()
// public/ocr copies tesseract.js's worker and the tesseract.js-core WASM next to the bundle (tools/fetch-ocr.mjs)
for (const p of ['tesseract.js', 'tesseract.js-core']) inBundle.add(p)
const all = closure(Object.keys(pkg.dependencies))
// tesseract.js ships a prebuilt worker (public/ocr/worker.min.js) that may contain its own dependencies: counted as
// distributed (conservative — all of them are permissive licences)
const viaTesseract = (name, seen = new Set()) => { const c = all.find((x) => x.name === name); if (!c || seen.has(name)) return false; seen.add(name); return c.via === 'tesseract.js' || viaTesseract(c.via, seen) }
const runtime = all.map((c) => ({
  type: 'npm', ...c,
  bundled: inBundle.has(c.name) || viaTesseract(c.name),
  distribution: !inBundle.has(c.name) && viaTesseract(c.name)
    ? 'possibly inside public/ocr/worker.min.js (prebuilt by tesseract.js) — listed as distributed'
    : inBundle.has(c.name)
    ? (c.via === 'package.json' ? 'bundled into the UI (ui/dist)' : `bundled into the UI (ui/dist), dependency of ${c.via}`)
    : `installed with ${c.via} but not in the UI bundle (Node-only / optional) — not distributed`,
}))
const build = Object.keys(pkg.devDependencies).map((n) => { const p = readPkg(n); return { type: 'npm-dev', name: n, version: p?.version ?? 'NOT INSTALLED', license: p ? licenseOf(p) : 'UNKNOWN', source: p ? repoOf(p) : '', distribution: 'build / test only — not distributed' } })

const brewVersion = (formula, fallback) => {
  const d = `/opt/homebrew/Cellar/${formula}`
  if (!formula || !existsSync(d)) return fallback
  const v = readdirSync(d).filter((x) => !x.startsWith('.')).sort((a, b) => a.localeCompare(b, 'en', { numeric: true })).pop()
  return v ? v.replace(/_\d+$/, '') : fallback
}
const native = NATIVE.map((c) => ({ type: 'native', ...c, version: brewVersion(c.brew, c.version) }))

function walk(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const f of readdirSync(dir)) {
    if (f === '.DS_Store') continue
    const p = join(dir, f)
    if (statSync(p).isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}
const files = [...walk(join(ui, 'public')), ...walk(join(repo, 'native/app/resources/branding'))].map((p) => relative(repo, p).split('\\').join('/'))
const sha = (rel) => createHash('sha256').update(readFileSync(join(repo, rel))).digest('hex')
const assets = ASSETS.map((a) => ({ type: 'asset', ...a, files: files.filter((f) => a.paths.some((p) => f.startsWith(p))).map((f) => ({ path: f, bytes: statSync(join(repo, f)).size, sha256: sha(f) })) }))

// THIRD_PARTY_NOTICES.md rows → component names
const notices = readFileSync(join(repo, 'THIRD_PARTY_NOTICES.md'), 'utf8').split('\n')
  .filter((l) => /^\| [^-|]/.test(l) && !/^\| Component/.test(l))
  .map((l) => l.split('|')[1].replace(/\*\*/g, '').trim())

const sbom = {
  bomFormat: 'MD-CAD-AI-STUDIO-SBOM',
  specNote: 'Fields follow CycloneDX naming (name, version, licenses, externalReferences ≈ source); generated by ui/tools/make-sbom.mjs',
  schema: 1,
  generated: new Date().toISOString().slice(0, 10),
  app: { name: 'MD CAD AI STUDIO', version: '0.1.0', platforms: ['macOS arm64 (DMG)', 'Windows x64 (EXE)'] },
  policy: {
    offline: 'No cloud service or key is needed. The only network use is the optional, user-started download of AI / speech model weights (sha256-verified).',
    models: 'Model weights are never bundled in the installer; each one keeps its own licence (see components of type "model").',
    assets: 'No stock 3D models, textures or HDRIs are bundled. Bundled images are owner-approved mockup crops (DEMO, productionUse=false), branding, and OCR data.',
  },
  thirdPartyNotices: notices,
  components: [...runtime, ...native, ...MODELS.map((m) => ({ type: 'model', ...m })), ...assets],
  buildTools: build,
}
writeFileSync(join(repo, 'docs/SBOM.json'), JSON.stringify(sbom, null, 1) + '\n')
console.log(`docs/SBOM.json: ${runtime.filter((r) => r.bundled).length}/${runtime.length} UI packages bundled, ${native.length} native, ${MODELS.length} models, ${assets.reduce((n, a) => n + a.files.length, 0)} asset files, ${build.length} build tools`)
