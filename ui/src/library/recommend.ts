/**
 * "AI Recommended" components: a transparent relevance score from what the project actually contains (open
 * drawing layers and blocks, BIM door / window families and wall types, interior items, MEP equipment, parts),
 * plus recent use and favourites. In the desktop app the local model can then re-rank the top candidates
 * (rankWithModel) — its order is shown as such, never mixed with the rule-based one.
 */
import type { HostApi } from '../services/host'
import { task } from '../ai/discipline'
import { useCad } from '../state/cad'
import { useBim } from '../state/bim'
import { useInterior } from '../state/interior'
import { useMep } from '../state/mep'
import type { LibComponent } from './catalog'

const words = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter((w) => w.length > 2)

/** Keywords and discipline weights of the open project. */
export function projectProfile() {
  const kw = new Map<string, number>()
  const add = (s: string, w = 1) => words(s).forEach((x) => kw.set(x, (kw.get(x) ?? 0) + w))
  const doc = useCad.getState().activeDoc()
  doc?.layers.forEach((l) => add(l.name))
  const bim = useBim.getState().model
  bim.doors.forEach((d) => add(`door ${d.family}`))
  bim.windows.forEach((d) => add(`window ${d.family}`))
  bim.wallTypes.forEach((t) => add(`wall ${t.name}`))
  bim.components.forEach((c) => add(`furniture ${c.name}`, 2))
  const interior = useInterior.getState().doc
  interior.items.forEach((i) => add(`${i.category} ${i.name} ${i.material}`, 2))
  const mep = useMep.getState().doc
  mep.equipment.forEach((e) => add(e.kind))
  mep.fixtures.forEach((f) => add(f.kind, 2))
  const disc: Record<string, number> = {
    Architecture: bim.walls.length + bim.doors.length + bim.windows.length,
    Interior: interior.items.length * 3,
    MEP: mep.ducts.length + mep.pipes.length,
    Structural: bim.columns.length * 4 + bim.slabs.length * 2,
    Mechanical: 0,
    Civil: 0,
  }
  const total = Object.values(disc).reduce((a, b) => a + b, 0) || 1
  return { kw, disc: Object.fromEntries(Object.entries(disc).map(([k, v]) => [k, v / total])) as Record<string, number> }
}

export interface Rec {
  c: LibComponent
  score: number
  why: string[]
}

export function recommend(all: LibComponent[], recent: { id: string; at: number }[], favorites: string[]): Rec[] {
  const { kw, disc } = projectProfile()
  return all
    .filter((c) => c.kind !== 'Material' || c.discipline === 'Interior')
    .map((c) => {
      const why: string[] = []
      let score = 0
      const hits = [...new Set(words(`${c.name} ${c.tags.join(' ')} ${c.category} ${c.layer}`))].filter((w) => kw.has(w))
      if (hits.length) (score += hits.reduce((a, w) => a + Math.min(3, kw.get(w)!), 0)), why.push(hits.slice(0, 3).join(', '))
      const d = disc[c.discipline] ?? 0
      if (d > 0.05) (score += d * 6), why.push(c.discipline)
      if (recent.some((r) => r.id === c.id)) (score += 2), why.push('recent')
      if (favorites.includes(c.id)) (score += 2), why.push('favourite')
      score += Math.min(1, c.popularity / 1000)
      return { c, score, why }
    })
    .filter((r) => r.score > 1)
    .sort((a, b) => b.score - a.score)
}

/** Lets the local model order the top candidates for the project; null when no model is ready. */
export async function rankWithModel(host: HostApi, cands: Rec[]): Promise<{ ids: string[]; seconds: number; model?: string } | null> {
  const list = cands.slice(0, 16)
  if (list.length < 2) return null
  const { kw } = projectProfile()
  const top = [...kw.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([w]) => w).join(', ')
  const sys = 'You recommend library components for an architecture / interior project. Pick the six most useful components for the project described, most useful first. Reply with their ids only.'
  const prompt = `Project keywords: ${top}\nCandidates (id | name | category | discipline | tags):\n${list.map((r) => `${r.c.id} | ${r.c.name} | ${r.c.category} | ${r.c.discipline} | ${r.c.tags.join(', ')}`).join('\n')}\nSix ids:`
  const id = list.map((r) => JSON.stringify(JSON.stringify(r.c.id))).join(' | ')
  const n = Math.min(6, list.length)
  const grammar = `root ::= "[" id ${Array.from({ length: n - 1 }, () => '"," id').join(' ')} "]"\nid ::= ${id}`
  const r = await task(host, sys, prompt, grammar, 120)
  if (r.error === 'no-model' || !r.ok) return null
  try {
    const ids = [...new Set(JSON.parse(r.text) as string[])].filter((x) => list.some((c) => c.c.id === x))
    return { ids, seconds: r.seconds, model: r.model }
  } catch {
    return null
  }
}
