/**
 * Local-AI suggestions for the role of CAD layers (plan → BIM import).
 *
 * The AI only classifies layer NAMES (with a few facts about each layer: entity counts, sample texts, block names,
 * how wall-like its lines are). Its reply is constrained by a GBNF grammar to the layer names that exist and the
 * fixed role list; code parses it, and the dialog shows each suggestion marked "AI" for the user to keep or
 * change. No geometry is ever produced by the model.
 */
import type { HostApi } from '../services/host'
import { task } from './discipline'
import { LAYER_ROLES, type LayerRole, type LayerStat } from '../bim/fromCad'

const lit = (s: string) => JSON.stringify(JSON.stringify(s))

/** GBNF for {"layers":[{"name": <layer>, "role": <role>}, …]}. */
export function layerGrammar(names: string[], roles: readonly string[] = LAYER_ROLES): string {
  return [
    `root ::= "{" ws "\\"layers\\"" ws ":" ws "[" ws item ( ws "," ws item )* ws "]" ws "}"`,
    `item ::= "{" ws "\\"name\\"" ws ":" ws name ws "," ws "\\"role\\"" ws ":" ws role ws "}"`,
    `name ::= ${names.map(lit).join(' | ')}`,
    `role ::= ${roles.map(lit).join(' | ')}`,
    `ws ::= [ \\t\\n]{0,4}`,
  ].join('\n')
}

const SYSTEM = `You classify the layers of an architectural floor-plan drawing (AutoCAD, Vietnamese or English office conventions).
Roles: wall (wall outlines / hatches), door (door leaves, swings, door blocks), window (window / glazing symbols), column (column outlines),
room (room names or room boundaries), furniture (furniture, sanitary fixtures, kitchen, equipment blocks), stair, grid (axis lines and bubbles),
level (elevation marks), text (general notes, titles), ignore (dimensions, hatches, title block, viewports, anything else).
Vietnamese hints: TUONG = wall, CUA = door, CUA SO = window, COT = column (or elevation "cốt" when the layer holds only texts like +3.600),
TRUC = grid, NOI THAT / TBVS = furniture, THANG = stair, KICH THUOC / DIM = ignore, CHU / TEXT = text, PHONG = room.
Answer only JSON: {"layers":[{"name":"…","role":"…"}]} with every listed layer exactly once.`

/** Compact facts about each layer for the prompt. */
export function layerFacts(stats: LayerStat[]): string {
  return stats
    .map((s) => {
      const k = Object.entries(s.kinds).map(([a, n]) => `${a} ${n}`).join(', ')
      const extra = [s.texts.length ? `texts: ${s.texts.map((t) => JSON.stringify(t.slice(0, 24))).join(' ')}` : '', s.blocks.length ? `blocks: ${s.blocks.join(' ')}` : '', s.pairRatio >= 0.3 ? `parallel line pairs 60–450 mm apart: ${Math.round(s.pairRatio * 100)} %` : '']
        .filter(Boolean)
        .join('; ')
      return `- ${JSON.stringify(s.name)}: ${k}${extra ? `; ${extra}` : ''}`
    })
    .join('\n')
}

/** Parses the reply into role suggestions for known layers (anything else is ignored). */
export function parseLayerRoles<R extends string = LayerRole>(text: string, names: string[], roles: readonly string[] = LAYER_ROLES): Record<string, R> {
  const i = text.indexOf('{'), j = text.lastIndexOf('}')
  if (i < 0 || j <= i) return {}
  try {
    const v = JSON.parse(text.slice(i, j + 1)) as { layers?: { name?: unknown; role?: unknown }[] }
    const out: Record<string, R> = {}
    for (const x of v.layers ?? [])
      if (typeof x.name === 'string' && names.includes(x.name) && typeof x.role === 'string' && roles.includes(x.role)) out[x.name] = x.role as R
    return out
  } catch {
    return {}
  }
}

export interface LayerAiRun {
  roles: Record<string, LayerRole>
  seconds: number
  model?: string
  error?: string
}

/** Asks the local model (grammar-constrained) about at most 60 layers. */
export async function suggestLayerRoles(host: HostApi, stats: LayerStat[]): Promise<LayerAiRun> {
  const pick = stats.slice(0, 60)
  const names = pick.map((s) => s.name)
  const r = await task(host, SYSTEM, `Layers:\n${layerFacts(pick)}`, layerGrammar(names), Math.min(1800, 40 + 22 * names.length))
  if (!r.ok) return { roles: {}, seconds: r.seconds, model: r.model, error: r.error ?? 'no reply' }
  const roles = parseLayerRoles(r.text, names)
  return { roles, seconds: r.seconds, model: r.model, ...(Object.keys(roles).length ? {} : { error: 'reply was not a valid layer list' }) }
}

const CIVIL_SYSTEM = `You classify the layers of Vietnamese canal / road design drawings (long profile "trắc dọc" and cross sections "trắc ngang").
Roles: ground (the natural / existing ground line of the cross sections: "mặt đất tự nhiên", "hiện trạng", "TN"), design (the design section line:
"thiết kế", "TK", "mặt cắt thiết kế"), ignore (everything else: hatches, dimensions, frames, texts, grid / drop lines "đường dóng", scales, titles,
plans, existing structures, roads "đường hiện trạng").
Answer only JSON: {"layers":[{"name":"…","role":"…"}]} with every listed layer exactly once.`

export interface CivilLayerFacts {
  name: string
  lines: number
  texts: string[]
}

/** Ground / design roles of the line layers of a canal or road drawing (grammar-constrained). */
export async function suggestCivilRoles(host: HostApi, layers: CivilLayerFacts[]): Promise<{ roles: Record<string, 'ground' | 'design' | 'ignore'>; seconds: number; model?: string; error?: string }> {
  const pick = layers.slice(0, 60)
  const names = pick.map((l) => l.name)
  const roles = ['ground', 'design', 'ignore'] as const
  const facts = pick.map((l) => `- ${JSON.stringify(l.name)}: ${l.lines} lines${l.texts.length ? `; texts: ${l.texts.map((t) => JSON.stringify(t.slice(0, 24))).join(' ')}` : ''}`).join('\n')
  const r = await task(host, CIVIL_SYSTEM, `Layers:\n${facts}`, layerGrammar(names, roles), Math.min(1800, 40 + 22 * names.length))
  if (!r.ok) return { roles: {}, seconds: r.seconds, model: r.model, error: r.error ?? 'no reply' }
  const out = parseLayerRoles<'ground' | 'design' | 'ignore'>(r.text, names, roles)
  return { roles: out, seconds: r.seconds, model: r.model, ...(Object.keys(out).length ? {} : { error: 'reply was not a valid layer list' }) }
}
