/**
 * Machines & Tools: the persisted, versioned store of CNC machine profiles, their commissioning records and the
 * manufacturing jobs (Interior → Nesting & CNC, Part Studio CAM).
 *
 * - Ships the v2.3 example profiles (1 / 2 / 3 router heads, 2 saw blades) as UNVERIFIED samples.
 * - create / clone / edit: every save is a new revision (the old one kept in `history`); a change to heads,
 *   tools, offsets, controller, post, envelope, origin or fixtures drops VERIFIED to UNVERIFIED.
 * - import never sets VERIFIED (cam/machine.ts importProfile).
 * - VERIFIED only through `commission()` with air cut, first article, operator and engineer sign-off.
 * The rules live in cam/machine.ts (pure functions, unit-tested); this store only keeps the records.
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { SAMPLE_PROFILES, blankProfile, cloneProfile, commission, importProfile, profileContentHash, reviseProfile, unqualify, type CommissioningInput, type CommissioningRecord, type MachineProfile } from '../cam/machine'
import type { ManufacturingJob, ReleaseRecord } from '../cam/job'

export interface MachineRecord {
  profile: MachineProfile
  /** Earlier revisions, oldest first (never edited). */
  history: MachineProfile[]
  commissioning: CommissioningRecord[]
  provenance: { source: 'sample' | 'created' | 'cloned' | 'imported'; from?: string; at: string }
  log: { at: string; what: string }[]
}

interface MachinesState {
  records: MachineRecord[]
  /** Jobs by key: 'interior', 'part:<file>'. */
  jobs: Record<string, ManufacturingJob>
  /** Machine chosen for Part Studio CAM. */
  partMachineId: string | null
  /** Immutable production release records (audit). */
  releases: ReleaseRecord[]
  create: (id: string) => string | null
  clone: (from: string, id: string) => string | null
  save: (p: MachineProfile) => string | null
  importJson: (text: string) => { id?: string; errors: string[] }
  commission: (id: string, input: CommissioningInput) => CommissioningRecord | null
  suspend: (id: string) => void
  remove: (id: string) => string | null
  setJob: (key: string, job: ManufacturingJob) => void
  addRelease: (r: ReleaseRecord) => void
  setPartMachine: (id: string | null) => void
}

const now = () => new Date().toISOString()
const sampleRecords = (): MachineRecord[] => SAMPLE_PROFILES.map((p) => ({ profile: structuredClone(p), history: [], commissioning: [], provenance: { source: 'sample', from: 'docs/requirements/v2_4/baseline_v2_3/…/examples', at: now() }, log: [] }))
const ID = /^[A-Za-z0-9_.-]{2,64}$/

export const useMachines = create<MachinesState>()(
  persist(
    (set, get) => {
      const has = (id: string) => get().records.some((r) => r.profile.profile_id === id)
      const put = (rec: MachineRecord) => set({ records: [...get().records.filter((r) => r.profile.profile_id !== rec.profile.profile_id), rec] })
      return {
        records: sampleRecords(),
        jobs: {},
        partMachineId: null,
        releases: [],
        create: (id) => {
          if (!ID.test(id)) return 'ID'
          if (has(id)) return 'EXISTS'
          put({ profile: blankProfile(id), history: [], commissioning: [], provenance: { source: 'created', at: now() }, log: [{ at: now(), what: 'created (DRAFT)' }] })
          return null
        },
        clone: (from, id) => {
          const src = get().records.find((r) => r.profile.profile_id === from)
          if (!src) return 'MISSING'
          if (!ID.test(id)) return 'ID'
          if (has(id)) return 'EXISTS'
          put({ profile: cloneProfile(src.profile, id), history: [], commissioning: [], provenance: { source: 'cloned', from: `${from} r${src.profile.revision}`, at: now() }, log: [{ at: now(), what: `cloned from ${from} r${src.profile.revision} (DRAFT)` }] })
          return null
        },
        save: (p) => {
          const rec = get().records.find((r) => r.profile.profile_id === p.profile_id)
          if (!rec) return 'MISSING'
          const next = reviseProfile(rec.profile, p)
          const downgraded = rec.profile.status === 'VERIFIED' && next.status !== 'VERIFIED'
          put({ ...rec, profile: next, history: [...rec.history, rec.profile], log: [...rec.log, { at: now(), what: `revision ${next.revision}${downgraded ? ': machine data changed — VERIFIED → UNVERIFIED' : ''}` }] })
          return null
        },
        importJson: (text) => {
          let json: unknown
          try {
            json = JSON.parse(text)
          } catch {
            return { errors: ['JSON'] }
          }
          const { profile, errors } = importProfile(json)
          if (!profile) return { errors }
          let id = profile.profile_id
          for (let k = 2; has(id); k++) id = `${profile.profile_id}_${k}`
          put({ profile: { ...profile, profile_id: id }, history: [], commissioning: [], provenance: { source: 'imported', from: profile.profile_id, at: now() }, log: [{ at: now(), what: `imported as ${profile.status} (an imported status is never trusted)` }] })
          return { id, errors: [] }
        },
        commission: (id, input) => {
          const rec = get().records.find((r) => r.profile.profile_id === id)
          if (!rec) return null
          const { profile, record } = commission(rec.profile, input)
          const changed = profile.status !== rec.profile.status || profile.production_export_allowed !== rec.profile.production_export_allowed
          put({ ...rec, profile: changed ? { ...profile, revision: rec.profile.revision + 1 } : profile, history: changed ? [...rec.history, rec.profile] : rec.history, commissioning: [...rec.commissioning, { ...record, profile_revision: changed ? rec.profile.revision + 1 : rec.profile.revision }], log: [...rec.log, { at: now(), what: `commissioning ${record.result}${record.failures.length ? `: ${record.failures.join(', ')}` : ''}` }] })
          return record
        },
        suspend: (id) => {
          const rec = get().records.find((r) => r.profile.profile_id === id)
          if (!rec) return
          put({ ...rec, profile: { ...unqualify(rec.profile, 'SUSPENDED'), revision: rec.profile.revision + 1 }, history: [...rec.history, rec.profile], log: [...rec.log, { at: now(), what: 'suspended' }] })
        },
        remove: (id) => {
          const rec = get().records.find((r) => r.profile.profile_id === id)
          if (!rec) return 'MISSING'
          if (rec.provenance.source === 'sample') return 'SAMPLE'
          if (rec.commissioning.length || get().releases.some((x) => x.machine_profile_id === id)) return 'HAS_RECORDS'
          set({ records: get().records.filter((r) => r.profile.profile_id !== id) })
          return null
        },
        setJob: (key, job) => {
          const old = get().jobs[key]
          // a released job is immutable: only a new revision (forkJob) may replace it
          if (old?.status === 'PRODUCTION_RELEASED' && job.revision <= old.revision) return
          set({ jobs: { ...get().jobs, [key]: job } })
        },
        addRelease: (r) => set({ releases: [...get().releases, r] }),
        setPartMachine: (id) => set({ partMachineId: id }),
      }
    },
    {
      name: 'thcad.machines',
      version: 1,
      // samples added in later versions appear without touching the user's own profiles
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<MachinesState>
        const records = [...(p.records ?? [])]
        for (const s of current.records) if (!records.some((r) => r.profile.profile_id === s.profile.profile_id)) records.push(s)
        return { ...current, ...p, records }
      },
      partialize: (s) => ({ records: s.records, jobs: s.jobs, partMachineId: s.partMachineId, releases: s.releases }),
    },
  ),
)

export const machineById = (id: string | null | undefined) => (id ? useMachines.getState().records.find((r) => r.profile.profile_id === id) ?? null : null)

/** The commissioning record that verified the CURRENT content of the profile (null if none). */
export function currentCommissioning(rec: MachineRecord | null): CommissioningRecord | null {
  if (!rec) return null
  const h = profileContentHash(rec.profile)
  return [...rec.commissioning].reverse().find((c) => c.result === 'VERIFIED' && c.profile_hash === h) ?? null
}
