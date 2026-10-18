/**
 * Element identity of the BIM model (schema v3, v2.4 "one semantic model"): every entity carries a `guid` (UUID v4,
 * kept for the life of the element — edits and moves keep it, a copy gets a new one), a `rev` (bumped whenever the
 * element changes) and its provenance `src`. `stampEdit` runs inside the store's `edit()` on every committed change,
 * so every tool (plan, Properties, 3D, AI, import) gets identities without knowing about them. Existing `id` fields
 * stay as they were (they are what the plan, the schedules and the 3D picking use).
 */
import type { BimModel, Identity, Provenance } from './model'

/** Every entity list of the model (the ones that may be absent in older models included). */
export const ENTITY_LISTS = ['levels', 'wallTypes', 'walls', 'doors', 'windows', 'rooms', 'columns', 'slabs', 'stairs', 'railings', 'components', 'grids', 'annotations', 'beams', 'footings', 'roofs'] as const
export type EntityList = (typeof ENTITY_LISTS)[number]
export type Entity = Identity & { id: string }

export const SCHEMA = 3
const HEX = '0123456789abcdef'

/** A random UUID v4. */
export function uuid(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto
  if (c?.randomUUID) return c.randomUUID()
  const b = new Uint8Array(16)
  if (c?.getRandomValues) c.getRandomValues(b)
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256)
  return format(b)
}

/** A UUID v4-shaped id derived from a seed (FNV-1a, 4 × 32 bit): the seeded sample model gets the same guids every
 *  time, so its IFC GlobalIds stay stable across resets. */
export function uuidFrom(seed: string): string {
  const b = new Uint8Array(16)
  for (let k = 0; k < 4; k++) {
    let h = 0x811c9dc5 ^ (k * 0x9e3779b1)
    for (let i = 0; i < seed.length; i++) {
      h ^= seed.charCodeAt(i)
      h = Math.imul(h, 0x01000193)
    }
    h ^= h >>> 15
    h = Math.imul(h, 0x2c1b3c6d)
    h ^= h >>> 12
    for (let j = 0; j < 4; j++) b[k * 4 + j] = (h >>> (j * 8)) & 255
  }
  return format(b)
}

function format(b: Uint8Array): string {
  b[6] = (b[6] & 0x0f) | 0x40 // version 4
  b[8] = (b[8] & 0x3f) | 0x80 // RFC 4122 variant
  let s = ''
  for (let i = 0; i < 16; i++) {
    s += HEX[b[i] >> 4] + HEX[b[i] & 15]
    if (i === 3 || i === 5 || i === 7 || i === 9) s += '-'
  }
  return s
}

export const isUuid = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(s)

const list = (m: BimModel, k: EntityList) => (m[k] as Entity[] | undefined) ?? []

/** All entities of the model with their list. */
export function* entities(m: BimModel): Generator<[EntityList, Entity]> {
  for (const k of ENTITY_LISTS) for (const e of list(m, k)) yield [k, e]
}

/** guid → [list, entity] */
export function guidIndex(m: BimModel): Map<string, [EntityList, Entity]> {
  const out = new Map<string, [EntityList, Entity]>()
  for (const [k, e] of entities(m)) if (e.guid) out.set(e.guid, [k, e])
  return out
}

/** Content of an entity without its revision (what decides "changed"). */
function body(e: Entity): string {
  const { rev: _r, ...rest } = e as Entity & Record<string, unknown>
  void _r
  return JSON.stringify(rest)
}

/**
 * Fills in what an older model lacks: a guid, rev 1 and the provenance on every entity (v2 → v3 migration, data
 * otherwise untouched). `seeded` derives the guids from the element ids (the sample model), else they are random.
 */
export function ensureIdentity(m: BimModel, src: Provenance = { kind: 'drawn' }, seeded = false): BimModel {
  const used = new Set<string>()
  const out = { ...m } as BimModel
  let changed = false
  for (const k of ENTITY_LISTS) {
    const xs = m[k] as Entity[] | undefined
    if (!xs) continue
    let any = false
    const next = xs.map((e) => {
      if (e.guid && isUuid(e.guid) && !used.has(e.guid) && e.rev !== undefined && e.src) {
        used.add(e.guid)
        return e
      }
      any = true
      let guid = e.guid && isUuid(e.guid) && !used.has(e.guid) ? e.guid : seeded ? uuidFrom(`${k}:${e.id}`) : uuid()
      while (used.has(guid)) guid = uuid()
      used.add(guid)
      return { ...e, guid, rev: e.rev ?? 1, src: e.src ?? src }
    })
    if (any) {
      ;(out as unknown as Record<string, unknown>)[k] = next
      changed = true
    }
  }
  if (out.schema !== SCHEMA || out.rev === undefined) {
    out.schema = SCHEMA
    out.rev = out.rev ?? 1
    changed = true
  }
  return changed ? out : m
}

/**
 * Identity bookkeeping of one committed edit (before → after):
 * - a new entity gets a fresh guid, rev 1 and `src` (unless it already carries a unique guid of its own);
 * - an entity whose content changed keeps its guid and gets rev + 1;
 * - a copy (a second entity carrying a guid that is already taken) gets a new guid;
 * - the model revision goes up by one.
 * Returns the stamped model and the guids that changed (added / modified / removed).
 */
export function stampEdit(before: BimModel, after: BimModel, src: Provenance = { kind: 'drawn' }): { model: BimModel; added: string[]; modified: string[]; removed: string[] } {
  const prev = new Map<string, Entity>() // guid → entity before
  for (const [, e] of entities(before)) if (e.guid) prev.set(e.guid, e)
  const added: string[] = [], modified: string[] = []
  const seen = new Set<string>()
  const out = { ...after } as BimModel
  for (const k of ENTITY_LISTS) {
    const xs = after[k] as Entity[] | undefined
    if (!xs) continue
    // who keeps a guid that appears more than once: the entity that had it before under the same id
    const owner = new Map<string, string>()
    for (const e of xs) if (e.guid && prev.get(e.guid)?.id === e.id) owner.set(e.guid, e.id)
    let any = false
    const next = xs.map((e) => {
      const guid = e.guid
      const copy = !!guid && owner.has(guid) && owner.get(guid) !== e.id
      if (!guid || !isUuid(guid) || seen.has(guid) || copy) {
        // a new element, or a copy of one (a copy is a new element of this edit: its own guid and provenance)
        let g = uuid()
        while (seen.has(g) || prev.has(g)) g = uuid()
        seen.add(g)
        added.push(g)
        any = true
        return { ...e, guid: g, rev: 1, src: guid && isUuid(guid) ? src : (e.src ?? src) }
      }
      seen.add(guid)
      const was = prev.get(guid)
      if (!was) {
        added.push(guid)
        if (e.rev === undefined || !e.src) {
          any = true
          return { ...e, rev: e.rev ?? 1, src: e.src ?? src }
        }
        return e
      }
      if (was === e) return e
      if (body(was) === body(e)) {
        // a new object with the same content: keep the revision
        if (e.rev === was.rev) return e
        any = true
        return { ...e, rev: was.rev }
      }
      modified.push(guid)
      any = true
      return { ...e, rev: (was.rev ?? 1) + 1, src: e.src ?? was.src ?? src }
    })
    if (any) (out as unknown as Record<string, unknown>)[k] = next
  }
  const removed = [...prev.keys()].filter((g) => !seen.has(g))
  out.schema = SCHEMA
  out.rev = (before.rev ?? 1) + 1
  return { model: out, added, modified, removed }
}

/**
 * IFC GlobalId (22 characters, the IFC base-64 alphabet) of a UUID: the standard compression of its 128 bits
 * (first character 2 bits, then 21 × 6 bits), so the same element exports with the same GlobalId every time.
 */
export function ifcGlobalId(guid: string): string {
  const A = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$'
  const hex = guid.replace(/-/g, '')
  let n = 0n
  for (const ch of hex) n = (n << 4n) | BigInt(parseInt(ch, 16))
  let s = ''
  for (let i = 0; i < 22; i++) {
    s = A[Number(n & 63n)] + s
    n >>= 6n
  }
  return s
}
