// v2.4 M1 — one semantic model + live linked 3D: the pure model logic of V24-001…V24-011 (dims in mm, areas, guid
// stability, dependency sets, one undo step, the v2 → v3 migration). Run: UNIT=linked node tools/test-cam.mjs run
import { WALL_TYPES, createVillaBim, typeOf, wallArea, wallHeight, type BimModel, type Opening, type Wall } from '../../src/bim/model'
import { ensureIdentity, ifcGlobalId, isUuid, stampEdit, entities } from '../../src/bim/identity'
import { smartRoom, type SmartRoomSpec } from '../../src/bim/smartRoom'
import { roomShape, roomEdgesAt, deriveRooms } from '../../src/bim/rooms'
import { arcOf, ends, faceLengths, moveWall, moveWallEnd, openingProblem, parseTyped, snapWalls, stretchWall, wallRun, radiusThrough } from '../../src/bim/walls'
import { deriveModel, editRule } from '../../src/bim/derive'
import { dirtyOf } from '../../src/model/deps'
import { bimExtras, nativeBuildingModel, stairFlight, stairGeometry } from '../../src/bim/scene'
import { roofFromPerimeter } from '../../src/bim/roofTool'
import { toIfc } from '../../src/bim/ifc'
import { lensFromFov, fovFromLens } from '../../src/model/bookmark'
import { BIM_STORE_VERSION, migrateBimState, useBim } from '../../src/state/bim'

type Check = { name: string; ok: boolean; got?: unknown }
const near = (a: number, b: number, tol = 0.01) => Math.abs(a - b) <= tol

/** A blank two-storey model (L2 at 3300 mm), the standard wall types, no elements. */
function blank(l2 = 3300): BimModel {
  return ensureIdentity({
    levels: [{ id: 'L1', name: 'Level 1', elevation: 0 }, { id: 'L2', name: 'Level 2', elevation: l2 }, { id: 'L3', name: 'Level 3', elevation: l2 + 3000 }],
    wallTypes: WALL_TYPES,
    walls: [], doors: [], windows: [], rooms: [], columns: [], slabs: [], stairs: [], railings: [], components: [], grids: [], annotations: [],
  } as BimModel)
}
const rect = (o: [number, number], w: number, d: number, dims: 'inner' | 'centre' = 'inner', t = 200, height = 3300): SmartRoomSpec => ({ shape: 'rect', level: 'L1', origin: o, w, d, thickness: t, height, dims })
function room(m: BimModel, s: SmartRoomSpec) {
  const r = smartRoom(m, s)
  if ('error' in r && r.error) throw new Error('smartRoom: ' + r.error)
  return r as Exclude<ReturnType<typeof smartRoom>, { error: string }>
}
/** Walls overlapping each other in line (a duplicated shared wall). */
function overlaps(m: BimModel): string[] {
  const out: string[] = []
  for (let i = 0; i < m.walls.length; i++)
    for (let j = i + 1; j < m.walls.length; j++) {
      const a = ends(m.walls[i]), b = ends(m.walls[j])
      if (Math.abs(a.dir[0] * b.dir[1] - a.dir[1] * b.dir[0]) > 1e-6) continue
      if (Math.abs((b.a[0] - a.a[0]) * a.dir[1] - (b.a[1] - a.a[1]) * a.dir[0]) > 1) continue
      const u0 = (b.a[0] - a.a[0]) * a.dir[0] + (b.a[1] - a.a[1]) * a.dir[1], u1 = (b.b[0] - a.a[0]) * a.dir[0] + (b.b[1] - a.a[1]) * a.dir[1]
      const ov = Math.min(m.walls[i].length, Math.max(u0, u1)) - Math.max(0, Math.min(u0, u1))
      if (ov > 1) out.push(`${m.walls[i].id}/${m.walls[j].id}`)
    }
  return out
}
const strip = (m: BimModel) => JSON.parse(JSON.stringify(m, (k, v) => (k === 'guid' || k === 'rev' || k === 'src' || k === 'schema' ? undefined : v)))

export function run() {
  const c: Check[] = []
  const check = (name: string, ok: boolean, got?: unknown) => c.push({ name, ok, ...(got !== undefined ? { got } : {}) })

  // ── V24-001 single room from numeric dims ────────────────────────────────────────────────────────────
  {
    const r = room(blank(), rect([0, 0], 4200, 3600))
    const rm = r.model.rooms.find((x) => x.id === r.room)!
    check('V24-001 4 walls drawn, room bounded by them', r.created.length === 4 && rm.edges?.length === 4, r.created)
    check('V24-001 clear 4200 × 3600 → net 15.12 m²', near(rm.area, 15.12, 1e-4), rm.area)
    check('V24-001 gross (wall centres) 4400 × 3800 = 16.72 m²', near(rm.areaGross!, 16.72, 1e-4), rm.areaGross)
    check('V24-001 net perimeter 15 600 mm', near(rm.perimeter!, 15600, 0.1), rm.perimeter)
    const lens = r.created.map((id) => r.model.walls.find((w) => w.id === id)!.length).sort((a, b) => a - b)
    check('V24-001 centre-line wall lengths 3800, 3800, 4400, 4400 mm', JSON.stringify(lens) === '[3800,3800,4400,4400]', lens)
    check('V24-001 walls 200 mm, 3300 mm high, to Level 2', r.created.every((id) => { const w = r.model.walls.find((x) => x.id === id)!; return typeOf(r.model, w).thickness === 200 && wallHeight(r.model, w) === 3300 && w.topLevel === 'L2' }))
    const rc = room(blank(), rect([0, 0], 4200, 3600, 'centre'))
    check('V24-001 sizes to wall centres → net 4000 × 3400 = 13.6 m²', near(rc.model.rooms[0].area, 13.6, 1e-4), rc.model.rooms[0].area)
    // saved as semantic objects: survives a JSON round trip with the same numbers
    const back = JSON.parse(JSON.stringify(r.model)) as BimModel
    check('V24-001 saved and reloaded: same area from the walls', near(roomShape(back, back.rooms[0])!.netArea, 15.12, 1e-6))
  }

  // ── V24-002 L-shaped room sharing a wall with an existing room ───────────────────────────────────────
  {
    const a = room(blank(), rect([0, 0], 4000, 3000, 'centre'))
    const areaA = a.model.rooms[0].area
    const b = room(a.model, { shape: 'L', level: 'L1', origin: [4000, 0], w: 5000, d: 4000, cutW: 2000, cutD: 1500, thickness: 200, height: 3300, dims: 'centre' })
    const rb = b.model.rooms.find((x) => x.id === b.room)!
    check('V24-002 the shared side reuses the existing wall (1 reused, 6 new)', b.reused.length === 1 && b.created.length === 6, { reused: b.reused, created: b.created })
    check('V24-002 no duplicated / overlapping walls', overlaps(b.model).length === 0, overlaps(b.model))
    check('V24-002 L room net area 15.24 m² (analytic)', near(rb.area, 15.24, 1e-4), rb.area)
    check('V24-002 the first room unchanged (net 10.64 m²)', near(b.model.rooms[0].area, areaA, 1e-9) && near(areaA, 3.8 * 2.8, 1e-4), b.model.rooms[0].area)
    check('V24-002 topology: the shared wall bounds both rooms', b.model.rooms.every((r) => r.edges!.some((e) => e.wall === b.reused[0])))
    // U and round templates close too
    const u = room(blank(), { shape: 'U', level: 'L1', origin: [0, 0], w: 7200, d: 5000, cutW: 2400, cutD: 2000, thickness: 200, height: 3300, dims: 'inner' })
    check('V24-002 U room (clear) = 7.2×5 − 2.4×2 = 31.2 m²', near(u.model.rooms[0].area, 31.2, 1e-3), u.model.rooms[0].area)
    const rd = room(blank(), { shape: 'round', level: 'L1', origin: [0, 0], r: 2500, segments: 16, thickness: 200, height: 3300 })
    const exp = 16 * 2500 * 2500 * Math.tan(Math.PI / 16) / 1e6
    check('V24-002 round (16 sides, apothem 2500) area', near(rd.model.rooms[0].area, exp, 1e-3), [rd.model.rooms[0].area, exp])
  }

  // ── V24-003 curved wall 2500 mm radius ────────────────────────────────────────────────────────────────
  {
    const m0 = blank()
    const w: Wall = { id: 'A1', category: 'wall', mark: 'A1', typeId: 'C200', baseLevel: 'L1', baseOffset: 0, topLevel: 'L2', topOffset: 0, length: 3000, x: 0, y: 0, angle: 0, arc: { radius: 2500 } }
    const m1 = stampEdit(m0, { ...m0, walls: [w] }).model
    const back = JSON.parse(JSON.stringify(m1)) as BimModel
    const arc = arcOf(back.walls[0])!
    check('V24-003 radius persists exactly (2500)', back.walls[0].arc!.radius === 2500 && near(arc.r, 2500, 1e-9), arc.r)
    const item = bimExtras(back).items.find((i) => i.id === 'A1')!
    const rev = item.parts[0]
    const radii = rev.pts!.map((p) => p[0])
    check('V24-003 3D: an OCCT revolve about the arc centre, faces at 2500 ± 100', rev.k === 'revolve' && near(Math.min(...radii), 2400, 1e-9) && near(Math.max(...radii), 2600, 1e-9), { k: rev.k, radii })
    check('V24-003 3D: arc centre 2000 below the chord (sagitta 500)', near(rev.o[0], 1500, 1e-6) && near(rev.o[1], -2000, 1e-6), rev.o)
    check('V24-003 the native builder leaves the arc wall to the UI scene', !nativeBuildingModel(back).walls.some((x) => x.id === 'A1'))
    const L = 2500 * 2 * Math.asin(0.6)
    check('V24-003 quantities: arc length × height', near(wallRun(back.walls[0]), L, 1e-6) && near(wallArea(back, back.walls[0]), (L * 3300) / 1e6, 1e-9), [wallRun(back.walls[0]), wallArea(back, back.walls[0])])
    check('V24-003 radius through 3 points (0,0)(3000,0)(1500,500) = 2500', near(radiusThrough([0, 0], [3000, 0], [1500, 500])!, 2500, 0.01), radiusThrough([0, 0], [3000, 0], [1500, 500]))
    const ifc = toIfc(back).text
    check('V24-003 IFC: IfcRevolvedAreaSolid for the arc wall', /IFCREVOLVEDAREASOLID/.test(ifc))
    const ar = room(blank(), { shape: 'round', level: 'L1', origin: [0, 0], r: 2500, arcWalls: true, thickness: 200, height: 3300 })
    check('V24-003 round room of 4 arc walls: net area π·2500²', near(ar.model.rooms[0].area, (Math.PI * 2500 * 2500) / 1e6, 0.02), ar.model.rooms[0].area)
  }

  // ── V24-004 wall thickness 200 → 250: faces and room area update ─────────────────────────────────────
  {
    const r = room(blank(), rect([0, 0], 4000, 3000, 'centre'))
    const south = r.model.walls.find((w) => w.y === 0 && w.angle === 0)!
    const f0 = faceLengths(r.model, south)
    const after = deriveModel(r.model, { ...r.model, walls: r.model.walls.map((w) => ({ ...w, typeId: 'I250' })) })
    const f1 = faceLengths(after, after.walls.find((w) => w.id === south.id)!)
    check('V24-004 net area 3800×2800 → 3750×2750 (10.64 → 10.3125 m²)', near(r.model.rooms[0].area, 10.64, 1e-4) && near(after.rooms[0].area, 10.3125, 1e-4), [r.model.rooms[0].area, after.rooms[0].area])
    check('V24-004 inner face 3800 → 3750, outer 4200 → 4250 mm', near(f0.left, 3800) && near(f0.right, 4200) && near(f1.left, 3750) && near(f1.right, 4250), { f0, f1 })
    check('V24-004 gross area (wall centres) stays 12 m²', near(after.rooms[0].areaGross!, 12, 1e-4))
  }

  // ── V24-005 / 006 wall length 4200 → 4500: same GUID, dependents only, one undo ─────────────────────
  {
    let m = room(blank(), rect([0, 0], 4200, 3600, 'centre')).model
    const south = m.walls.find((w) => w.y === 0 && w.angle === 0)!
    const door: Opening = { id: 'door-t', category: 'door', mark: 'D1', family: 'Single-Flush', type: '800 x 2100mm', hostWall: south.id, offset: 1000, width: 800, height: 2100, sill: 0 }
    m = stampEdit(m, { ...m, doors: [door] }).model
    const other = m.walls.find((w) => w.x === 0 && w.angle === 90 || (w.x === 0 && w.angle === -90) || (w.x === 0 && w.angle === 270))
    const after0 = stretchWall(m, south.id, 4500)
    const after = stampEdit(m, deriveModel(m, after0)).model
    const s1 = after.walls.find((w) => w.id === south.id)!
    check('V24-005 length 4200 → 4500, same GUID, rev + 1', s1.length === 4500 && s1.guid === south.guid && s1.rev === (south.rev ?? 1) + 1, { len: s1.length, guid: s1.guid === south.guid, rev: [south.rev, s1.rev] })
    check('V24-005 the room follows: 4000×3400 → 4300×3400 net (13.6 → 14.62 m²)', near(m.rooms[0].area, 13.6, 1e-4) && near(after.rooms[0].area, 14.62, 1e-4), [m.rooms[0].area, after.rooms[0].area])
    const d = dirtyOf(m, after)
    const w = [...d.native.walls].sort()
    check('V24-005 dirty walls: the edited wall, the east wall it carries, the north wall that stretches (3, not 4)', w.length === 3 && !w.includes(other?.id ?? '?') && w.includes(south.id), w)
    check('V24-005 dirty: the hosted door and the room', d.ids.doors?.has('door-t') === true && d.ids.rooms?.size === 1)
    check('V24-005 views to refresh: 3D, elevation, section, schedule, quantities', ['3d', 'elevation', 'section', 'schedule', 'quantities'].every((v) => d.views.has(v as never)))
    // through the store: ONE undo step restores everything (V24-006)
    useBim.setState({ model: m, undoStack: [], redoStack: [] })
    const err = useBim.getState().edit('Length', (x) => stretchWall(x, south.id, 4500))
    const st = useBim.getState()
    check('V24-006 the edit is one undo step', err === null && st.undoStack.length === 1, { err, n: st.undoStack.length })
    check('V24-006 after the edit: 4500 and 14.62 m² in the store', st.model.walls.find((x) => x.id === south.id)!.length === 4500 && near(st.model.rooms[0].area, 14.62, 1e-4))
    st.undo()
    const u = useBim.getState().model
    check('V24-006 undo: lengths, positions, room area, door, guids and revisions all back', JSON.stringify(u) === JSON.stringify(m), { len: u.walls.find((x) => x.id === south.id)!.length, area: u.rooms[0].area })
    // the door stays put on the wall
    check('V24-005 the door keeps its offset (its wall start did not move)', after.doors[0].offset === 1000)
  }

  // ── V24-007 wall height change: model data + dependents ─────────────────────────────────────────────
  {
    const m = room(blank(), rect([0, 0], 4200, 3600, 'centre')).model
    const w = m.walls[0]
    const after = stampEdit(m, deriveModel(m, { ...m, walls: m.walls.map((x) => (x.id === w.id ? { ...x, topOffset: 300 } : x)) })).model
    const w1 = after.walls.find((x) => x.id === w.id)!
    check('V24-007 height 3300 → 3600 (top offset 300), same GUID', wallHeight(after, w1) === 3600 && w1.guid === w.guid)
    const d = dirtyOf(m, after)
    check('V24-007 only that wall dirty (+ its room, the level slabs)', d.native.walls.size === 1 && d.native.walls.has(w.id), [...d.native.walls])
  }

  // ── V24-008 door width 800 → 900: the opening follows on its host wall ──────────────────────────────
  {
    let m = room(blank(), rect([0, 0], 4200, 3600, 'centre')).model
    const host = m.walls[0]
    m = stampEdit(m, { ...m, doors: [{ id: 'd8', category: 'door', mark: 'D8', family: 'Single-Flush', type: '800 x 2100mm', hostWall: host.id, offset: 1000, width: 800, height: 2100, sill: 0 }] }).model
    const after = stampEdit(m, { ...m, doors: m.doors.map((o) => ({ ...o, width: 900, offset: o.offset - 50 })) }).model
    check('V24-008 width 900, centre kept (offset 950), same GUID', after.doors[0].width === 900 && after.doors[0].offset === 950 && after.doors[0].guid === m.doors[0].guid)
    const d = dirtyOf(m, after)
    check('V24-008 the host wall is rebuilt (its cut)', d.native.walls.size === 1 && d.native.walls.has(host.id), [...d.native.walls])
    check('V24-008 rule passes', editRule(m, after) === null)
  }

  // ── V24-009 door near a wall end: the constraint blocks the cut ─────────────────────────────────────
  {
    const m = room(blank(), rect([0, 0], 4200, 3600, 'centre')).model
    const host = m.walls[0]
    const mk = (offset: number, width = 900): BimModel => ({ ...m, doors: [{ id: 'd9', category: 'door', mark: 'D9', family: 'Single-Flush', type: '', hostWall: host.id, offset, width, height: 2100, sill: 0 }] })
    check('V24-009 20 mm from the start: nearEnd', editRule(m, mk(20))?.code === 'nearEnd', editRule(m, mk(20)))
    check('V24-009 past the end: beyond', editRule(m, mk(host.length - 500))?.code === 'beyond')
    check('V24-009 50 mm clearance is allowed', editRule(m, mk(50)) === null)
    useBim.setState({ model: m, undoStack: [], redoStack: [] })
    const err = useBim.getState().edit('Add door', () => mk(20))
    check('V24-009 the store rejects it, nothing committed', !!err && err.startsWith('rule:') && useBim.getState().undoStack.length === 0 && useBim.getState().model === m, err)
    // a wall shortened under its door is rejected too
    const withDoor = stampEdit(m, mk(3000)).model
    check('V24-009 shortening the host under its door is blocked', editRule(withDoor, stretchWall(withDoor, host.id, 3500))?.code !== undefined)
    // the sample model's deliberate violations do not block unrelated edits
    const villa = createVillaBim()
    const v2 = { ...villa, walls: villa.walls.map((w) => (w.id === 'W20' ? { ...w, mark: 'W20b' } : w)) }
    check('V24-009 existing D12 (past W20) does not block renaming W20', editRule(villa, v2) === null)
  }

  // ── V24-010 level 3300 → 3500: stairs and dependents recomputed ─────────────────────────────────────
  {
    let m = room(blank(3300), rect([0, 0], 4200, 3600, 'centre')).model
    m = stampEdit(m, { ...m, stairs: [
      { id: 'st1', category: 'stair', mark: 'ST1', baseLevel: 'L1', topLevel: 'L2', x: 500, y: 500, angle: 0, length: 3000, width: 1000 },
      { id: 'st2', category: 'stair', mark: 'ST2', baseLevel: 'L1', topLevel: 'L2', x: 500, y: 2000, angle: 0, length: 2400, width: 1000, run: { kind: 'U', turn: 'left', landing: 1200, length2: 2400, gap: 100 } },
      { id: 'st3', category: 'stair', mark: 'ST3', baseLevel: 'L1', topLevel: 'L2', x: 6000, y: 0, angle: 90, length: 1800, width: 900, baseOffset: 0, rise: 1650, risers: 10 },
    ] }).model
    const s0 = stairFlight(m, m.stairs[0])
    const after = stampEdit(m, deriveModel(m, { ...m, levels: m.levels.map((l) => (l.id === 'L2' ? { ...l, elevation: 3500 } : l)) })).model
    const s1 = stairFlight(after, after.stairs[0])
    check('V24-010 straight stair: 19 × 173.7 → 20 × 175 mm', s0.n === 19 && near(s0.riser, 3300 / 19) && s1.n === 20 && near(s1.riser, 175), [s0, s1])
    const g = stairGeometry(after, after.stairs[1])
    const topZ = g.flights[1].z + g.flights[1].n * g.flights[1].riser
    check('V24-010 U stair: flight 2 ends at the new Level 2 (3500), landing at its split', near(topZ, 3500, 1e-6) && near(g.landings[0].z, g.flights[0].z + g.flights[0].n * g.flights[0].riser, 1e-6), { topZ, landing: g.landings[0].z })
    check('V24-010 imported flight (fixed rise 1650) rescaled to 1750', near(after.stairs[2].rise!, 1750, 0.1), after.stairs[2].rise)
    check('V24-010 walls Level 1 → 2 now 3500 high', after.walls.every((w) => wallHeight(after, w) === 3500))
    const d = dirtyOf(m, after)
    check('V24-010 dirty: every wall on the level, the 3 stairs, the level slabs, the room', d.native.walls.size === 4 && d.ids.stairs?.size === 3 && d.native.levelSlabs.has('L2') && d.ids.rooms?.size === 1, { walls: d.native.walls.size, stairs: d.ids.stairs?.size })
  }

  // ── V24-011 roof from perimeter: covers the walls, does not modify them ─────────────────────────────
  {
    const m = room(blank(), rect([0, 0], 8000, 6000, 'centre')).model
    const r = roofFromPerimeter(m, { level: 'L1', kind: 'hip', slope: 30, overhang: 500 })
    if ('error' in r) check('V24-011 roof built', false, r.error)
    else {
      const roof = r.model.roofs!.find((x) => x.id === r.roof)!
      const xs = roof.outline.map((p) => p[0]), ys = roof.outline.map((p) => p[1])
      check('V24-011 eaves on the level the walls reach (Level 2)', roof.level === 'L2')
      check('V24-011 outline covers the outside faces + 500 mm (−600…8600 × −600…6600)', Math.min(...xs) === -600 && Math.max(...xs) === 8600 && Math.min(...ys) === -600 && Math.max(...ys) === 6600, roof.outline)
      check('V24-011 the walls are unchanged (same objects)', r.model.walls === m.walls && r.walls.length === 4)
    }
  }

  // ── identity: guid stability, copies, migration v2 → v3, IFC GlobalIds ──────────────────────────────
  {
    const villa = createVillaBim()
    const all = [...entities(villa)]
    check('ID every element of the sample has a UUID v4, rev 1, src drawn', all.every(([, e]) => isUuid(e.guid) && e.rev === 1 && e.src?.kind === 'drawn'), all.length)
    check('ID guids are unique', new Set(all.map(([, e]) => e.guid)).size === all.length)
    check('ID the sample keeps the same guids on a reset', createVillaBim().walls[0].guid === villa.walls[0].guid)
    const moved = stampEdit(villa, moveWall(villa, 'W10', [0, 300])).model
    check('ID moving a wall keeps its guid, bumps its rev', moved.walls.find((w) => w.id === 'W10')!.guid === villa.walls.find((w) => w.id === 'W10')!.guid && moved.walls.find((w) => w.id === 'W10')!.rev === 2)
    const copy = { ...villa.walls[0], id: 'W99', mark: 'W99' }
    const cp = stampEdit(villa, { ...villa, walls: [...villa.walls, copy] }).model
    check('ID a copy gets a new guid, the original keeps its own', cp.walls.find((w) => w.id === 'W99')!.guid !== villa.walls[0].guid && cp.walls[0].guid === villa.walls[0].guid)
    check('ID the model revision goes up per edit', (moved.rev ?? 0) === (villa.rev ?? 0) + 1)
    // IFC GlobalId from the guid, stable across edits and exports
    const g0 = ifcGlobalId(villa.walls.find((w) => w.id === 'W10')!.guid!)
    const ifc1 = toIfc(villa).text, ifc2 = toIfc(moved).text
    check('ID IFC: W10 keeps its GlobalId after a move and on re-export', g0.length === 22 && ifc1.includes(`IFCWALL('${g0}'`) && ifc2.includes(`IFCWALL('${g0}'`), g0)
    // migration of a persisted v2 store (no identities) — no data lost
    const v2 = JSON.parse(JSON.stringify(strip(villa))) as BimModel
    v2.rooms[0] = { ...v2.rooms[0], name: 'Phòng khách (đã sửa)', area: 31.4 }
    v2.walls[3] = { ...v2.walls[3], length: 9900 }
    const persisted = { model: v2, view: 'plan', level: 'L2', comments: [{ id: 'c1', elementId: 'W1', text: 'kiểm tra', at: 1 }] }
    const mig = migrateBimState(persisted, 2) as unknown as { model: BimModel; level: string; comments: unknown[] }
    const ok = [...entities(mig.model)].every(([, e]) => isUuid(e.guid) && e.rev === 1 && e.src?.kind === 'drawn')
    check('MIG v2 → v3: every element gets a guid / rev / src', ok && BIM_STORE_VERSION === 3, BIM_STORE_VERSION)
    check('MIG v2 → v3: user data unchanged (edited room, edited wall, comments, view state)', JSON.stringify(strip(mig.model)) === JSON.stringify(v2) && mig.level === 'L2' && mig.comments.length === 1)
    check('MIG idempotent: migrating again keeps the guids', JSON.stringify(ensureIdentity(mig.model)) === JSON.stringify(mig.model))
  }

  // ── direct editing helpers: grips, typed input, snaps ───────────────────────────────────────────────
  {
    const m = room(blank(), rect([0, 0], 4000, 3000, 'centre')).model
    const s = m.walls.find((w) => w.y === 0 && w.angle === 0)!
    const ge = moveWallEnd(m, s.id, 'b', [4500, 0])
    const east = ge.walls.filter((w) => w.id !== s.id && ends(w).a[0] === 4500 || ends(w).b[0] === 4500)
    check('GRIP end drag 4000 → 4500: the joined wall follows', ge.walls.find((w) => w.id === s.id)!.length === 4500 && east.length >= 1)
    const mv = moveWall(m, s.id, [0, -500])
    check('GRIP move south wall 500 down: side walls stretch to 3500', mv.walls.filter((w) => Math.abs((w.angle ?? 0) % 180) === 90).every((w) => w.length === 3500), mv.walls.map((w) => [w.id, w.length]))
    check('TYPED "4200" along the cursor', JSON.stringify(parseTyped('4200', [0, 0], [10, 0])) === JSON.stringify({ kind: 'point', p: [4200, 0] }))
    const p90 = parseTyped('@4200<90', [100, 100], null)
    check('TYPED "@4200<90"', p90.kind === 'point' && near(p90.p[0], 100) && near(p90.p[1], 4300), p90)
    check('TYPED "@1200,-300" relative, "R2500" radius', JSON.stringify(parseTyped('@1200,-300', [100, 100], null)) === JSON.stringify({ kind: 'point', p: [1300, -200] }) && JSON.stringify(parseTyped('R2500', null, null)) === JSON.stringify({ kind: 'radius', r: 2500 }))
    const walls = m.walls
    check('SNAP endpoint', snapWalls(m, walls, [10, 5], 50)?.kind === 'end')
    check('SNAP midpoint', snapWalls(m, walls, [2010, 5], 50)?.kind === 'mid')
    check('SNAP nearest on a face / centre line', snapWalls(m, walls, [1000, 95], 50)?.kind === 'near', snapWalls(m, walls, [1000, 95], 50))
    check('SNAP perpendicular from the last point', snapWalls(m, walls, [3998, 1003], 30, [1000, 1000])?.kind === 'perp', snapWalls(m, walls, [3998, 1003], 30, [1000, 1000]))
    check('RULE opening fits / nearEnd / beyond', openingProblem({ ...m, doors: [] }, { id: 'x', category: 'door', mark: 'X', family: '', type: '', hostWall: s.id, offset: 1000, width: 900, height: 2100, sill: 0 }) === null)
    // the Room tool's rooms follow their walls too
    const edges = roomEdgesAt(m, 'L1', [2000, 1500])
    check('ROOM tool: 4 bounding walls found round a point', edges?.length === 4)
    const withRoom = deriveRooms(null, { ...m, rooms: [{ id: 'r2', category: 'room', number: '2', name: 'R', level: 'L1', area: 0, edges: edges! }] })
    check('ROOM tool room: net 3800 × 2800 = 10.64 m²', near(withRoom.rooms[0].area, 10.64, 1e-4), withRoom.rooms[0].area)
  }

  // ── bookmark lens ↔ fov ─────────────────────────────────────────────────────────────────────────────
  check('BOOKMARK 55° vertical fov ≈ 23 mm lens and back', near(fovFromLens(lensFromFov(55)), 55, 0.15), lensFromFov(55))

  const failed = c.filter((x) => !x.ok)
  return { all: failed.length === 0, passed: c.length - failed.length, total: c.length, failed, checks: c.map((x) => `${x.ok ? 'PASS' : 'FAIL'} ${x.name}`) }
}
