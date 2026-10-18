// v2.4 platform (run: UNIT=platform node tools/test-cam.mjs run):
//   interaction profiles + collisions with app shortcuts / CAD command aliases (V24-038), per-project profile
//   persisted (V24-039), migrations of old persisted states without data loss (V24-063), project JSON round trip
//   (SP39), snapshot restore / diff / retention (SP50), templates with content (SP49), ⌘K search (SP48),
//   A0 + check ruler + plot flag (SP34/35, V24-035 geometry), i18n EN/VI parity + untranslated (V24-040),
//   host error mapping. `UNIT=platform node tools/test-cam.mjs i18n` prints the full untranslated list.
import './_browserEnv'
import { ACTIONS, PROFILES, PROFILE_KEYS, activeBindings, activeProfile, aliasesStartingWith, collisions, comboOf, isTypingKey, profileBindings, resolveKey } from '../../src/platform/keymap'
import { COMMANDS } from '../../src/cad/commands'
import { DEFAULT_SHORTCUTS, useSettings, type KeyProfileId } from '../../src/state/settings'
import { useBim } from '../../src/state/bim'
import { useInterior, validateInterior } from '../../src/state/interior'
import { useCad } from '../../src/state/cad'
import { useMep } from '../../src/state/mep'
import { useCivil } from '../../src/state/civil'
import { useMech } from '../../src/state/mech'
import { useRenders } from '../../src/state/renders'
import { useLibrary } from '../../src/state/library'
import { useWorkspace } from '../../src/state/workspace'
import { ROOMS, roomOverlap, type Room } from '../../src/interior/model'
import { createVillaBim } from '../../src/bim/model'
import { createVillaDocument } from '../../src/cad/seed'
import { createNorthCanal } from '../../src/civil/model'
import { createPump } from '../../src/mech/model'
import { CAMERAS, DEFAULT_SETTINGS, DEFAULT_FX } from '../../src/renders/model'
import { captureStores, currentInfo, diffSummary, INTERVAL_KEEP, KEEP, listSnapshots, makeSnapshot, memorySnapStorage, restoreSnapshot, retain, revisionOf, saveSnapshot, setSnapStorage, snapshotOn, type SnapshotMeta } from '../../src/platform/snapshots'
import { exportProject, importProject, parseProject, PROJECT_FORMAT } from '../../src/platform/projectJson'
import { TEMPLATES } from '../../src/platform/templates'
import { searchAll, type SearchCtx } from '../../src/platform/search'
import { PAPERS, RULER_MM, modelRuler, pageSvg, plotPage, sheetLayout } from '../../src/cad/plot'
import { hostError } from '../../src/platform/hostErrors'
import { en } from '../../src/i18n/en'
import { vi } from '../../src/i18n/vi'

type R = Record<string, unknown>
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v))

/** Paths of `old` whose value is missing or different in `now` (every leaf of the old state must survive). */
function lost(old: unknown, now: unknown, path = '', out: string[] = []): string[] {
  if (old === null || typeof old !== 'object') { if (old !== now) out.push(path || '(root)'); return out }
  if (now === null || typeof now !== 'object') { out.push(path); return out }
  for (const [k, v] of Object.entries(old as R)) lost(v, (now as R)[k], path ? `${path}.${k}` : k, out)
  return out
}

/* ------------------------------------------------------------------ profiles */

export function profiles() {
  const out: R = {}
  // 1. AutoCAD mode never hijacks typed aliases: in CAD 2D no profile key without ⌘/Alt acts, for any profile
  const aliasKeys = [...new Set(COMMANDS.flatMap((c) => [...c.aliases, c.name]).map((a) => a[0]))]
  const leaks: string[] = []
  for (const p of PROFILES) {
    const map = activeBindings(profileBindings(p, {}))
    for (const k of [...aliasKeys, 'Space', 'Shift+Z', 'Shift+L']) { const a = resolveKey(map, 'cad2d', k); if (a) leaks.push(`${p}:${k}→${a}`) }
  }
  out.noTypedKeyActsInCad2d = leaks.length === 0
  out.leaks = leaks
  // even a user who binds every CAD 2D action to a letter: all inactive, each one names the aliases it would steal
  const custom = Object.fromEntries(ACTIONS.filter((a) => a.scope === 'cad2d').map((a, i) => [a.id, 'LPTRCMOEAHDZ'[i % 12]]))
  const cc = collisions(profileBindings('autocad', { autocad: custom }))
  out.customLettersAllBlocked = ACTIONS.filter((a) => a.scope === 'cad2d').every((a) => cc.some((c) => c.action === a.id && (c.kind === 'alias' || c.kind === 'commandLine')))
  const L = cc.find((c) => c.action === 'cad.select')
  out.lNamesAliases = L?.kind === 'alias' && L.aliases.includes('L') && L.aliases.includes('LINE') && L.aliases.includes('LA')
  out.plTrAliases = aliasesStartingWith('P').includes('PL') && aliasesStartingWith('T').includes('TR')
  // 2. AutoCAD profile: nothing bound; SketchUp / MD single keys act in BIM / Interior
  out.autocadEmpty = Object.keys(profileBindings('autocad', {})).length === 0
  const md = activeBindings(profileBindings('md', {}))
  out.mdWall = resolveKey(md, 'bim', 'W') === 'bim.wall' && resolveKey(md, 'interior', '3') === 'int.view3d' && resolveKey(md, 'cad2d', 'W') === null
  const su = activeBindings(profileBindings('sketchup', {}))
  out.sketchupLine = resolveKey(su, 'bim', 'L') === 'bim.wall' && resolveKey(su, 'bim', 'Space') === 'bim.select' && resolveKey(su, 'cad2d', 'L') === null
  // 3ds Max F3 (wireframe, BIM) does not collide with OSNAP F3 (a CAD 2D toggle); ⌘K would (global)
  const mx = activeBindings(profileBindings('3dsmax', {}))
  out.maxF3InBim = resolveKey(mx, 'bim', 'F3') === 'bim.wireframe'
  const appClash = collisions(profileBindings('md', { md: { 'bim.wall': 'Mod+K' } }))
  out.appShortcutWins = appClash.some((c) => c.kind === 'app' && c.action === 'bim.wall' && c.shortcut === 'commandSearch')
  const dup = collisions(profileBindings('md', { md: { 'bim.door': 'W' } }))
  out.duplicateFlagged = dup.some((c) => c.kind === 'duplicate' && c.action === 'bim.door' && c.other === 'bim.wall')
  out.reservedFlagged = collisions(profileBindings('md', { md: { 'bim.wall': 'Escape' } })).some((c) => c.kind === 'reserved')
  // a key moved by the user from the app shortcuts away frees it for the profile
  out.movedShortcutFrees = collisions(profileBindings('md', { md: { 'bim.wall': 'Mod+K' } }), { ...DEFAULT_SHORTCUTS, commandSearch: 'Mod+P' }).length === 0
  out.unbind = !profileBindings('md', { md: { 'bim.wall': '' } })['bim.wall']
  // every default key of every profile is either active or reported (never silently dropped)
  out.allAccounted = PROFILES.every((p) => {
    const b = profileBindings(p, {}), m = activeBindings(b), c = new Set(collisions(b).map((x) => x.action))
    return Object.keys(b).every((id) => c.has(id) || [...m.values()].includes(id))
  })
  // 4. key events → combos
  const ev = (key: string, code: string, mods: Partial<KeyboardEvent> = {}) => comboOf({ key, code, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...mods } as KeyboardEvent)
  out.combos = ev('l', 'KeyL') === 'L' && ev('L', 'KeyL', { shiftKey: true }) === 'Shift+L' && ev(' ', 'Space') === 'Space' && ev('z', 'KeyZ', { metaKey: true }) === 'Mod+Z' && ev('F3', 'F3') === 'F3' && ev('!', 'Digit1', { shiftKey: true }) === 'Shift+1'
  out.typingKey = isTypingKey('Shift+Z') && isTypingKey('Space') && !isTypingKey('Mod+L') && !isTypingKey('F3')
  out.profilesHaveKeys = (['sketchup', '3dsmax', 'md'] as KeyProfileId[]).every((p) => Object.keys(PROFILE_KEYS[p]).length > 0)
  out.all = Object.entries(out).every(([k, v]) => k === 'leaks' || v === true)
  return out
}

/** V24-039: the profile is per project, persisted (settings store → localStorage) and survives a reload. */
export async function perProject() {
  const out: R = {}
  const st = useSettings.getState()
  st.apply({ keyProfile: 'autocad', projectKeyProfiles: { 'proj-a': 'sketchup', 'proj-b': 'md' }, keyMaps: { md: { 'bim.wall': 'Shift+W' } } })
  out.resolveA = activeProfile(useSettings.getState(), 'proj-a') === 'sketchup'
  out.resolveB = activeProfile(useSettings.getState(), 'proj-b') === 'md'
  out.resolveOther = activeProfile(useSettings.getState(), 'proj-c') === 'autocad' && activeProfile(useSettings.getState(), null) === 'autocad'
  const raw = JSON.parse(localStorage.getItem('thcad.settings') ?? '{}').state ?? {}
  out.persisted = raw.projectKeyProfiles?.['proj-a'] === 'sketchup' && raw.keyMaps?.md?.['bim.wall'] === 'Shift+W'
  // reload: wipe the in-memory state (that write is undone: a reload starts from what was saved), rehydrate
  const saved = localStorage.getItem('thcad.settings')!
  useSettings.setState({ keyProfile: '3dsmax', projectKeyProfiles: {}, keyMaps: {} })
  localStorage.setItem('thcad.settings', saved)
  await useSettings.persist.rehydrate()
  out.rehydrated = useSettings.getState().projectKeyProfiles['proj-b'] === 'md' && profileBindings('md', useSettings.getState().keyMaps)['bim.wall'] === 'Shift+W'
  // switching the current project switches the profile
  useWorkspace.setState({ currentId: 'proj-a' })
  out.currentProject = activeProfile(useSettings.getState(), useWorkspace.getState().currentId) === 'sketchup'
  useSettings.getState().apply({ projectKeyProfiles: {}, keyMaps: {}, keyProfile: 'autocad' })
  useWorkspace.setState({ currentId: null })
  out.all = Object.values(out).every((v) => v === true)
  return out
}

/* ------------------------------------------------------------------ migrations */

const rect = (x: number, y: number, w: number, d: number) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + d }, { x, y: y + d }]

/** Old persisted states (as each store wrote them at its previous version), with the user's own content in them. */
function fixtures() {
  const bimV1 = createVillaBim() as unknown as R
  const walls = (bimV1.walls as R[]).map((w) => { const { x: _x, y: _y, angle: _a, ...rest } = w; void _x; void _y; void _a; return rest })
  const { columns: _c, slabs: _s, stairs: _st, railings: _r, components: _co, grids: _g, annotations: _an, ...bimRest } = bimV1
  void _c; void _s; void _st; void _r; void _co; void _g; void _an
  const userWall = { id: 'W99', category: 'wall', mark: 'W99-user', typeId: 'P150', baseLevel: 'L1', baseOffset: 0, topLevel: 'L2', topOffset: 0, length: 1234, description: 'mine' }
  const rooms: Room[] = ROOMS.map((r) => (r.id === 'bed1' ? { ...r, outline: rect(4500, 3730, 4000, 3400) } : r.id === 'laundry' ? { ...r, outline: rect(6700, 7130, 1800, 1600) } : r.id === 'living' ? { ...r, name: 'Phòng khách', ceilingHeight: 3000 } : r))
  rooms.push({ id: 'study', name: 'Phòng làm việc', outline: rect(-4000, 0, 3000, 3000), ceilingHeight: 2800, floorFinish: 'Wood - Oak', wallFinish: 'Paint - Warm White', ceilingFinish: 'Gypsum - White' })
  const interiorDoc = { rooms, items: [...useInterior.getState().doc.items, { id: 'u1', name: 'Bàn làm việc', category: 'tables', room: 'study', w: 1400, d: 700, h: 750, material: 'Wood - Oak', qty: 1, status: 'placed' }], cabinets: useInterior.getState().doc.cabinets }
  const cadDoc = { ...createVillaDocument(1), id: 'user-doc', name: 'Nhà phố.dwg', source: 'dxf-import', layouts: [{ id: 'l1', name: 'A1 1-50', paper: 'A1', scale: 50 }] }
  const { layers: _l, blocks: _b, ...cadDocOld } = cadDoc as unknown as R
  void _l; void _b
  return {
    bim: { version: 1, state: { model: { ...bimRest, walls: [...walls, userWall] }, view: 'plan', level: 'L1', comments: [{ id: 'c1', elementId: 'W1', text: 'kiểm tra', at: 1 }] } },
    interior: { version: 1, state: { doc: interiorDoc, bottom: 'materials', room: 'study', styles: ['japandi'] } },
    cad: { version: 1, state: { docs: { 'user-doc': cadDocOld }, tabs: ['user-doc', 'gone'], activeId: 'gone', scale: '1:50', spaceEnter: false } },
    mep: { version: 1, state: { doc: { ...(clone(useMep.getState().doc) as R), trays: undefined, fixtures: undefined }, scale: '1 : 50' } },
    civil: { version: 1, state: { doc: { ...createNorthCanal(), params: { ...createNorthCanal().params, bottomWidth: 6.5 }, source: { file: 'tuyen.dxf', route: 'Kênh N2' }, plan: [[0, 0], [100, 5]] }, station: 120, contour: 0.5 } },
    mech: { version: 1, state: { doc: { ...createPump(), params: createPump().params.map((p) => (p.name === 'Speed' ? { ...p, value: 1450 } : p)) }, mode: 'wireframe' } },
    renders: { version: 1, state: { doc: { cameras: CAMERAS.slice(0, 2).map((c) => ({ ...c, name: c.name + ' (mine)' })), settings: { ...DEFAULT_SETTINGS, samples: 512 }, fx: DEFAULT_FX, queue: [] }, history: [{ jobId: 'j1', camera: 'Cam 01', path: '/tmp/a.png', ms: 1000, samples: 64, finished: 1, w: 800, h: 600 }] } },
    library: { version: 1, state: { favorites: ['sofa-1'], recent: [{ id: 'x', at: 1 }], uses: { x: 3 }, uploads: [], insert: { point: 'bottom-left', rotation: 90 }, layerFor: { x: 'A-Furn' } } },
  }
}

type PersistApi = { persist: { getOptions: () => { version?: number; migrate?: (s: unknown, v: number) => unknown } } }
const STORES: Record<string, PersistApi> = { bim: useBim, interior: useInterior, cad: useCad, mep: useMep, civil: useCivil, mech: useMech, renders: useRenders, library: useLibrary }

export function migrations() {
  const out: R = {}
  const fx = fixtures()
  const lostBy: Record<string, string[]> = {}
  for (const [name, api] of Object.entries(STORES)) {
    const o = api.persist.getOptions()
    const f = (fx as unknown as Record<string, { version: number; state: R }>)[name]
    out[`${name}.hasMigrate`] = typeof o.migrate === 'function' && (o.version ?? 0) > f.version
    const migrated = o.migrate!(clone(f.state), f.version) as R
    // the only intended change: the two overlapping sample outlines of the old Interior seed are corrected
    // and CAD's tab / active drawing that pointed at a drawing that no longer exists ('gone')
    const allowed = (p: string) => (name === 'interior' && /^doc\.rooms\.(3|7)\.outline/.test(p)) || (name === 'cad' && (p === 'tabs.1' || p === 'activeId'))
    // MEP v1 had no trays / fixtures… (undefined in the fixture → filled by upgradeMep)
    lostBy[name] = lost(clone(f.state), migrated).filter((p) => !allowed(p))
    out[`${name}.noDataLoss`] = lostBy[name].length === 0
  }
  // Interior specifics: the user's rooms survive (the old migration replaced them by the sample rooms)
  const iv = useInterior.persist.getOptions().migrate!(clone(fx.interior.state), 1) as { doc: { rooms: Room[]; items: { room: string }[]; cabinets: unknown[] } }
  const r = iv.doc.rooms
  out['interior.userRoomsKept'] = r.length === fx.interior.state.doc.rooms.length && r.some((x) => x.id === 'study') && r.find((x) => x.id === 'living')!.name === 'Phòng khách'
  out['interior.overlapFixed'] = !r.some((a, i) => r.some((b, j) => i < j && roomOverlap(a.outline, b.outline) > 0))
  out['interior.valid'] = validateInterior(iv.doc as never) === null
  out['interior.itemsAttached'] = iv.doc.items.every((i) => r.some((x) => x.id === i.room))
  // the previous migration (rooms ← sample) would have lost the study room and the item in it
  const oldWay = { ...fx.interior.state.doc, rooms: ROOMS }
  out['interior.oldMigrationLostData'] = !oldWay.rooms.some((x) => x.id === 'study')
  // BIM: placements filled for the villa walls, the user's wall untouched, lists added
  const bv = useBim.persist.getOptions().migrate!(clone(fx.bim.state), 1) as { model: { walls: { id: string; x?: number }[]; columns: unknown[] } }
  out['bim.upgraded'] = bv.model.walls.find((w) => w.id === 'W1')!.x !== undefined && Array.isArray(bv.model.columns) && bv.model.walls.some((w) => w.id === 'W99')
  // CAD: layers back for a drawing saved without them, dangling tab / active id repaired
  const cv = useCad.persist.getOptions().migrate!(clone(fx.cad.state), 1) as { docs: Record<string, { layers: unknown[]; entities: unknown[] }>; tabs: string[]; activeId: string }
  out['cad.repaired'] = cv.docs['user-doc'].layers.length > 0 && cv.tabs.join() === 'user-doc' && cv.activeId === 'user-doc' && cv.docs['user-doc'].entities.length === fx.cad.state.docs['user-doc'].entities.length
  // a current-version state passes through untouched
  // a state saved at the current version passes through untouched (BIM / MEP always run their idempotent upgrade)
  out.currentUntouched = Object.entries(STORES).filter(([n]) => n !== 'bim' && n !== 'mep').every(([, api]) => { const o = api.persist.getOptions(); const s = { doc: { a: 1 } }; return o.migrate!(s, o.version ?? 0) === s })
  out.lost = lostBy
  out.all = Object.entries(out).every(([k, v]) => k === 'lost' || v === true)
  return out
}

/* ------------------------------------------------------------------ project JSON + snapshots */

function editAll(tag: string) {
  // a wall deleted with its doors / windows (the BIM edit rules refuse an opening left without its host wall)
  useBim.getState().edit(`QA ${tag}`, (m) => ({ ...m, walls: m.walls.filter((w) => w.id !== 'W13'), doors: m.doors.filter((o) => o.hostWall !== 'W13'), windows: m.windows.filter((o) => o.hostWall !== 'W13') }))
  useInterior.getState().edit(`QA ${tag}`, (d) => ({ ...d, items: d.items.map((i) => (i.id === 'i1' ? { ...i, qty: 2 } : i)) }))
  useCivil.getState().edit(`QA ${tag}`, (d) => ({ ...d, params: { ...d.params, bottomWidth: 9 } }))
  useMech.getState().edit(`QA ${tag}`, (d) => ({ ...d, params: d.params.map((p) => (p.name === 'Speed' ? { ...p, value: 1500 } : p)) }))
  useRenders.getState().edit(`QA ${tag}`, (d) => ({ ...d, settings: { ...d.settings, samples: 1024 } }))
  useMep.getState().edit(`QA ${tag}`, (d) => ({ ...d, ducts: d.ducts.slice(1) }))
  const doc = createVillaDocument(2)
  useCad.getState().openDocument({ ...doc, id: `qa-${tag}`, name: `QA ${tag}.dwg`, entities: doc.entities.slice(0, 5) })
}
const resetAll = () => { useBim.getState().reset(); useInterior.getState().reset(); useCivil.getState().reset(); useMech.getState().reset(); useRenders.getState().reset(); useMep.getState().reset() }

export async function projectJson() {
  const out: R = {}
  setSnapStorage(memorySnapStorage())
  resetAll()
  editAll('rt')
  const before = captureStores()
  const f1 = exportProject(null, new Date(0))
  const text = JSON.stringify(f1)
  const parsed = parseProject(text)
  out.parsed = parsed.ok && parsed.file.format === PROJECT_FORMAT && parsed.file.schema === 1
  out.revisionsPerStore = Object.keys(f1.revisions).length === 7 && Object.values(f1.revisions).every((r) => /^rev-[0-9a-f]{8}$/.test(r))
  // back to the sample models, then import
  resetAll()
  useCad.setState({ docs: { [createVillaDocument(0).id]: createVillaDocument(0) }, tabs: [createVillaDocument(0).id], activeId: createVillaDocument(0).id })
  out.changedAfterReset = revisionOf(useBim.getState().model) !== f1.revisions.bim
  const r = await importProject((parsed as { file: typeof f1 }).file, 'QA import')
  out.importErrors = r.errors
  out.appliedAll = r.applied.length === 7 && r.errors.length === 0
  const f2 = exportProject(null, new Date(0))
  out.roundTripRevisions = JSON.stringify(f2.revisions) === JSON.stringify(f1.revisions)
  out.roundTripStores = JSON.stringify(f2.stores) === JSON.stringify(JSON.parse(text).stores)
  out.sameAsBefore = (['bim', 'interior', 'mep', 'civil', 'mech', 'renders'] as const).every((s) => JSON.stringify(before[s]) === JSON.stringify(f2.stores[s]))
  // one undo step per workspace: undo in BIM goes back to the sample model
  useBim.getState().undo()
  out.importUndoable = revisionOf(useBim.getState().model) === revisionOf(createVillaBim()) || useBim.getState().model.walls.length === 24
  // bad files
  out.rejects = !parseProject('{').ok && (parseProject('{"format":"x"}') as { error?: string }).error === 'format' && (parseProject(JSON.stringify({ ...f1, schema: 99 })) as { error?: string }).error === 'schema'
  // an older store version in the file is migrated on import (interior v1 with overlapping sample rooms)
  const old = clone(f1)
  old.storeVersions.interior = 1
  old.stores.interior = { ...(old.stores.interior as R), rooms: ROOMS.map((x) => (x.id === 'bed1' ? { ...x, outline: rect(4500, 3730, 4000, 3400) } : x)) }
  const r2 = await importProject(old, 'QA import v1')
  const rooms = useInterior.getState().doc.rooms
  out.olderVersionMigrated = !r2.errors.length && !rooms.some((a, i) => rooms.some((b, j) => i < j && roomOverlap(a.outline, b.outline) > 0))
  out.all = Object.entries(out).every(([k, v]) => k === 'importErrors' || v === true)
  return out
}

export async function snapshots() {
  const out: R = {}
  setSnapStorage(memorySnapStorage())
  resetAll()
  useSettings.getState().apply({ autoRecover: true, backup: true })
  useWorkspace.setState({ currentId: 'villa-riverside' })
  const m = await saveSnapshot(makeSnapshot('QA manual', 'manual'))
  out.saved = !!m && m.appVersion === '0.1.0' && m.schema === 1 && m.project?.id === 'villa-riverside' && Object.keys(m.revisions).length === 7
  out.countsRecorded = m!.counts.bim.walls === 24 && m!.counts.interior.rooms === 9 && m!.counts.cad.drawings >= 1
  // nothing changed → an interval / save snapshot is skipped
  out.skipUnchanged = (await snapshotOn('interval', 'QA tick')) === null && (await snapshotOn('save', 'QA save')) === null
  editAll('snap')
  const d = diffSummary(m!, currentInfo())
  const bim = d.find((x) => x.store === 'bim')!
  out.diffCounts = bim.changed && bim.rows.some((r) => r.key === 'walls' && r.then === 24 && r.now === 23) && d.find((x) => x.store === 'interior')!.changed && d.find((x) => x.store === 'civil')!.changed
  // with Auto-recover off no interval snapshot is taken
  useSettings.getState().apply({ autoRecover: false })
  out.autoRecoverOff = (await snapshotOn('interval', 'QA tick')) === null
  useSettings.getState().apply({ autoRecover: true })
  out.intervalOn = !!(await snapshotOn('interval', 'QA tick'))
  const nBefore = (await listSnapshots()).length
  const r = await restoreSnapshot(m!.id, 'QA restore')
  out.restored = r !== 'none' && r.errors.length === 0 && r.applied.includes('bim') && useBim.getState().model.walls.length === 24 && useCivil.getState().doc.params.bottomWidth === createNorthCanal().params.bottomWidth
  out.cadRestored = !!useCad.getState().docs['qa-snap'] // drawings opened after the snapshot are kept (restore never closes a drawing)
  out.beforeRestoreSnapshot = (await listSnapshots()).length === nBefore + 1 && (await listSnapshots()).some((x) => x.reason === 'risky')
  // undoable through each store's own history
  useBim.getState().undo()
  out.undoable = useBim.getState().model.walls.length === 23
  useBim.getState().redo()
  // backup off → no snapshot before a risky operation
  useSettings.getState().apply({ backup: false })
  out.backupOff = (await snapshotOn('risky', 'QA risky')) === null
  useSettings.getState().apply({ backup: true })
  // retention: 20 kept, at most 10 interval ones
  const metas: SnapshotMeta[] = Array.from({ length: 30 }, (_, i) => ({ ...m!, id: `s${i}`, at: i, reason: i % 2 ? 'interval' : 'manual' }))
  const kept = retain(metas)
  out.retention = kept.keep.length === KEEP && kept.keep.filter((x) => x.reason === 'interval').length <= INTERVAL_KEEP && kept.keep[0].at === 29
  useWorkspace.setState({ currentId: null })
  out.all = Object.values(out).every((v) => v === true)
  return out
}

/* ------------------------------------------------------------------ templates, search, plot, host errors */

export function templates() {
  const out: R = {}
  for (const t of TEMPLATES) {
    const c = t.build(1_700_000_000_000)
    const ok: string[] = []
    if (c.interior && validateInterior(c.interior) !== null) ok.push('interior: ' + validateInterior(c.interior))
    if (c.bim) {
      const err = useBim.getState().edit('QA template', () => c.bim!)
      if (err) ok.push('bim: ' + err)
      else useBim.getState().undo()
    }
    if (!c.cad.entities.length) ok.push('cad empty')
    if (!c.bim && !c.interior) ok.push('no model')
    out[t.id] = ok.length ? ok : true
  }
  out.versioned = TEMPLATES.every((t) => t.version >= 1)
  out.six = TEMPLATES.map((t) => t.id).join() === 'apartment,house,oneRoom,kitchen,office,fitout'
  out.kitchenCabinets = (TEMPLATES.find((t) => t.id === 'kitchen')!.build().interior?.cabinets.length ?? 0) >= 3
  out.all = Object.values(out).every((v) => v === true)
  return out
}

export function search() {
  const ctx: SearchCtx = {
    actionLabel: (id) => en.platform.actions[id] ?? id,
    actionKey: () => undefined,
    components: [{ id: 'sofa', name: 'Modern Sofa 3-Seater', sub: '' }],
    settings: [{ section: 'units', label: 'Units & Precision' }, { section: 'shortcuts', label: 'Keyboard Shortcuts' }],
    platform: [{ what: 'cheatsheet', label: 'Keyboard cheatsheet' }, { what: 'history', label: 'Version history' }],
  }
  const first = (q: string) => searchAll(q, ctx)[0]
  const out: R = {
    pl: first('PL')?.kind === 'command' && (first('PL') as { name: string }).name === 'PLINE',
    tr: first('tr')?.kind === 'command' && (first('tr') as { name: string }).name === 'TRIM',
    l: (first('L') as { name?: string })?.name === 'LINE',
    wall: searchAll('wall', ctx).some((h) => h.kind === 'action' && h.id === 'bim.wall'),
    sofa: searchAll('sofa', ctx).some((h) => h.kind === 'library'),
    units: searchAll('units', ctx).some((h) => h.kind === 'setting' && h.section === 'units'),
    keyboard: searchAll('keyboard', ctx).filter((h) => h.kind === 'platform' || h.kind === 'setting').length === 2,
    vietnamese: searchAll('tuong', { ...ctx, actionLabel: (id) => vi.platform.actions[id] ?? id }).some((h) => h.kind === 'action' && h.id === 'bim.wall'),
  }
  out.all = Object.values(out).every((v) => v === true)
  return out
}

export function plot() {
  const out: R = {}
  const doc = createVillaDocument(0)
  out.a0 = PAPERS.A0[0] === 1189 && PAPERS.A0[1] === 841 && PAPERS.A0P[0] === 841 && PAPERS.A0P[1] === 1189 && PAPERS.A1P[0] === 594
  const p = plotPage(doc, 'A0', 50, { ruler: true })
  out.page = p.w === 1189 && p.h === 841 && /width="1189mm" height="841mm" viewBox="0 0 1189 841"/.test(pageSvg(p))
  // the ruler: 100.000 mm on paper, and the model bar 1 m at 1:50 = 20.000 mm
  const lines = p.prims.filter((q) => q.t === 'line') as { x1: number; y1: number; x2: number; y2: number }[]
  const len = (q: { x1: number; y1: number; x2: number; y2: number }) => Math.hypot(q.x2 - q.x1, q.y2 - q.y1)
  out.ruler100 = lines.some((q) => Math.abs(len(q) - RULER_MM) < 1e-9 && q.y1 === q.y2)
  out.modelBar = modelRuler(50).paperMm === 20 && lines.some((q) => Math.abs(len(q) - 20) < 1e-9 && q.y1 === q.y2)
  out.modelBarSmallScale = modelRuler(500).metres === 10 && modelRuler(500).paperMm === 20 && modelRuler(5000).metres === 100
  out.noRulerByDefault = plotPage(doc, 'A0', 50).prims.length < p.prims.length
  // the ruler is drawn in the SVG with 3 decimals (exact to 1 µm)
  const svg = pageSvg(p)
  out.svgRuler = /<line x1="10\.000" y1="([\d.]+)" x2="110\.000" y2="\1"/.test(svg)
  // DXF paper space gets the same ruler
  out.dxfRuler = sheetLayout(doc, 'A0', 50, { ruler: true }).ruler.length === lines.filter(() => true).length - plotPage(doc, 'A0', 50).prims.filter((q) => q.t === 'line').length
  // plot flag: a dimension marked "screen only" is left out of the plot, still in the drawing
  const dimId = doc.entities.find((e) => e.kind === 'dimension')!.id
  const d2 = { ...doc, entities: doc.entities.map((e) => (e.id === dimId ? { ...e, noPlot: true } : e)) }
  const texts = (pg: typeof p) => pg.prims.filter((q) => q.t === 'text').length
  out.noPlot = texts(plotPage(d2, 'A3')) === texts(plotPage(doc, 'A3')) - 1 && d2.entities.length === doc.entities.length
  out.all = Object.values(out).every((v) => v === true)
  return out
}

export function hostErrors() {
  const out: R = {
    folder: hostError('folder not chosen in this session', 'vi') === vi.platform.hostErrors.folder,
    writer: hostError('no-writer', 'vi') === vi.platform.hostErrors.noWriter,
    disk: hostError('not enough disk space', 'vi') === vi.platform.hostErrors.disk,
    checksum: hostError('checksum mismatch — file discarded', 'vi') === vi.platform.hostErrors.checksum,
    cannotWrite: hostError('cannot write /tmp/a.pdf', 'vi') === 'Không ghi được /tmp/a.pdf',
    unknownKept: hostError('OpenGL unavailable', 'vi') === 'OpenGL unavailable',
    en: hostError('cancelled', 'en') === 'Cancelled',
  }
  out.all = Object.values(out).every((v) => v === true)
  return out
}

/* ------------------------------------------------------------------ i18n */

function leaves(o: unknown, path = '', out = new Map<string, string>()): Map<string, string> {
  if (typeof o === 'string') out.set(path, o)
  else if (Array.isArray(o)) o.forEach((v, i) => leaves(v, `${path}[${i}]`, out))
  else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) leaves(v, path ? `${path}.${k}` : k, out)
  return out
}

/** Same text in VI as in EN, and not a proper noun / code / unit / format name. */
const PROPER = /^(MD CAD AI STUDIO|AutoCAD|SketchUp|3ds Max|Revit|Rhino|SolidWorks|BIM|MEP|CAD 2D|IFC\d?|DWG|DXF|PDF|PNG|JPE?G|TIFF?|SVG|CSV|STEP|STP|IGES|SKP|GLB|LandXML|OCCT|Qwen.*|Whisper.*|OK|Email|Logo|Layout\d*|Model|Metal|Vulkan|CPU|GPU|VRAM|RAM|AI|ISO.*|GRBL.*|G-code.*|HDRI|DEMO|NC|CNC|MP4|H\.264.*|Open CASCADE.*|LibreDWG.*|Roboto|Tesseract.*|llama\.cpp.*|Hoàng Trần|Linh Nguyễn|Minh Phạm|Villa Riverside.*)$/i
export function untranslated(): { path: string; text: string }[] {
  const E = leaves(en), V = leaves(vi)
  const out: { path: string; text: string }[] = []
  for (const [k, e] of E) {
    const v = V.get(k)
    if (v === undefined || v !== e) continue
    const bare = e.replace(/\{\w+\}/g, '').trim()
    if (!/[A-Za-z]{3,}/.test(bare) || PROPER.test(bare) || /^[A-Z0-9 ._×x:·/+\-–—()%]+$/.test(bare) || bare.length <= 3) continue
    if (/^[\w.-]+\.(dwg|dxf|png|pdf|json|nc|csv|ifc|step|asm)$/i.test(bare)) continue
    // intentional: the brand slogan stays English (owner lock), route ids, generated identifiers
    if (k === 'app.tagline' || /^dashboard\.guide\.steps\[\d+\]\[2\]$/.test(k) || k === 'mechanical.params.newName') continue
    out.push({ path: k, text: e })
  }
  return out
}

export function i18n() {
  const E = leaves(en), V = leaves(vi)
  const missingVi = [...E.keys()].filter((k) => !V.has(k))
  // VI-only keys are allowed under an EN lookup table left empty on purpose (`{} as Record<string, string>`: the EN
  // name is the key, e.g. interior.roomNames["Living Room"])
  const tables: string[] = []
  const walk = (o: unknown, path: string) => { if (o && typeof o === 'object' && !Array.isArray(o)) { if (!Object.keys(o).length) tables.push(path); for (const [k, v] of Object.entries(o)) walk(v, path ? `${path}.${k}` : k) } }
  walk(en, '')
  const emptyEnTable = (k: string) => tables.some((t) => k.startsWith(t + '.'))
  const extraVi = [...V.keys()].filter((k) => !E.has(k) && !emptyEnTable(k))
  const emptyVi = [...V].filter(([k, v]) => !v.trim() && E.get(k)?.trim()).map(([k]) => k)
  const u = untranslated()
  // this agent's areas: the platform namespace and the Settings screen
  const mine = u.filter((x) => /^(platform|settings)\./.test(x.path))
  const byArea: Record<string, number> = {}
  for (const x of u) { const a = x.path.split('.')[0]; byArea[a] = (byArea[a] ?? 0) + 1 }
  const out = {
    keysEn: E.size, keysVi: V.size, missingVi, extraVi, emptyVi,
    namespaces: ['interior', 'mep', 'civil', 'mechanical', 'renders', 'auto', 'platform'].filter((n) => n in en).length,
    untranslatedTotal: u.length, untranslatedByArea: byArea, untranslatedPlatform: mine,
    all: missingVi.length === 0 && extraVi.length === 0 && emptyVi.length === 0 && mine.length === 0,
  }
  return out
}

export function i18nList() { return untranslated() }

export async function run() {
  const r: R = {
    profiles: profiles(),
    perProject: await perProject(),
    migrations: migrations(),
    projectJson: await projectJson(),
    snapshots: await snapshots(),
    templates: templates(),
    search: search(),
    plot: plot(),
    hostErrors: hostErrors(),
    i18n: i18n(),
  }
  r.all = Object.values(r).every((x) => (x as { all?: boolean }).all === true)
  return r
}
