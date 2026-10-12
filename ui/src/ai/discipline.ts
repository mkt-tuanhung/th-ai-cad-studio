/**
 * Discipline assistants (BIM, Interior, MEP, Civil, Mechanical) on the local model.
 *
 * Same rule as CAD 2D: the AI never edits the model. It answers with typed operations
 * ({"title", "ops": [...]}) restricted by a GBNF grammar to the operations, element ids and values that
 * exist in the open model; the operations are applied by deterministic code to a COPY, the discipline's
 * model rules validate the result, and the user sees every change before "Approve & Apply" commits it
 * as one undoable edit. No calculation is left to the model (regrading, sizing… are done by the ops).
 */
import type { HostApi } from '../services/host'

export type Arg =
  | { kind: 'enum'; values: string[]; desc?: string }
  | { kind: 'number'; min: number; max: number; unit?: string; desc?: string; integer?: boolean }
  | { kind: 'string'; desc?: string }

export interface OpSpec {
  op: string
  desc: string
  args: Record<string, Arg>
}

export type Op = { op: string } & Record<string, unknown>

export interface Proposal {
  title: string
  ops: Op[]
}

export interface Discipline<M> {
  key: 'bim' | 'interior' | 'mep' | 'civil' | 'mechanical'
  /** What the assistant works on, for the system prompt. */
  role: string
  ops: (m: M) => OpSpec[]
  /** Compact facts of the open model (ids, values, check results) given to the model with the request. */
  context: (m: M) => string
  /** Applies one operation to a copy of the model: the new model, or why it cannot be applied. */
  apply: (m: M, op: Op) => { model: M; change: string } | { error: string }
  /** Model rules on the result; `before` lets a discipline reject only problems the change introduced. */
  validate: (m: M, before: M) => string | null
  /** Few-shot examples (request → reply). */
  examples: { request: string; reply: Proposal }[]
}

/* ------------------------------------------------------------------ grammar */

const lit = (s: string) => JSON.stringify(JSON.stringify(s)) // GBNF literal of the JSON string "s"
const ruleName = (s: string) => s.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()

/** GBNF for {"title": string, "ops": [op, …]} with one alternative per operation. */
export function grammar(specs: OpSpec[]): string {
  const rules: string[] = [
    `root ::= "{" ws "\\"title\\"" ws ":" ws string ws "," ws "\\"ops\\"" ws ":" ws "[" ws ( op ( ws "," ws op )* )? ws "]" ws "}"`,
    `op ::= ${specs.map((s) => `op-${ruleName(s.op)}`).join(' | ')}`,
    `ws ::= [ \\t\\n]{0,4}`,
    `string ::= "\\"" ( [^"\\\\\\x00-\\x1f] | "\\\\" ["\\\\/bfnrtu] ){0,160} "\\""`,
    `number ::= "-"? ( "0" | [1-9] [0-9]{0,6} ) ( "." [0-9]{1,6} )?`,
    `integer ::= "-"? ( "0" | [1-9] [0-9]{0,6} )`,
  ]
  for (const s of specs) {
    const parts = [`"{" ws "\\"op\\"" ws ":" ws ${lit(s.op)}`]
    for (const [k, a] of Object.entries(s.args)) {
      const v = a.kind === 'enum' ? `arg-${ruleName(s.op)}-${ruleName(k)}` : a.kind === 'number' ? (a.integer ? 'integer' : 'number') : 'string'
      parts.push(`ws "," ws ${lit(k)} ws ":" ws ${v}`)
      if (a.kind === 'enum') rules.push(`arg-${ruleName(s.op)}-${ruleName(k)} ::= ${a.values.map(lit).join(' | ')}`)
    }
    rules.push(`op-${ruleName(s.op)} ::= ${parts.join(' ')} ws "}"`)
  }
  return rules.join('\n')
}

/* ------------------------------------------------------------------ prompt */

const argDoc = (k: string, a: Arg) =>
  a.kind === 'enum'
    ? `${k}: one of ${a.values.length > 24 ? `${a.values.slice(0, 24).join(', ')}, … (${a.values.length} values, see the model)` : a.values.join(', ')}${a.desc ? ` — ${a.desc}` : ''}`
    : a.kind === 'number'
      ? `${k}: number ${a.min}…${a.max}${a.unit ? ` ${a.unit}` : ''}${a.integer ? ' (integer)' : ''}${a.desc ? ` — ${a.desc}` : ''}`
      : `${k}: text${a.desc ? ` — ${a.desc}` : ''}`

export function systemPrompt<M>(d: Discipline<M>, m: M): string {
  const ops = d.ops(m)
  return [
    `You are the ${d.role} assistant inside TH AI CAD Studio. You do not edit the model yourself: you reply with ONE JSON object {"title": "...", "ops": [...]} listing operations; the user reviews and approves them.`,
    `Rules: use only these operations and only ids / values that exist in the model below. Use the units given. Do not invent elements. Make the smallest set of changes that does what the user asked. If the request asks for something these operations cannot do (creating new elements, levels, equipment or structures that no operation creates), reply {"title": "<short reason>", "ops": []} — never approximate it with other operations. The title is a short summary in the user's language (Vietnamese or English). Reply with JSON only.`,
    'Operations:',
    ...ops.map((o) => `- ${o.op}: ${o.desc}\n    ${Object.entries(o.args).map(([k, a]) => argDoc(k, a)).join('\n    ')}`),
    'Examples:',
    ...d.examples.map((e) => `Request: ${e.request}\nReply: ${JSON.stringify(e.reply)}`),
  ].join('\n')
}

export const userPrompt = <M,>(d: Discipline<M>, m: M, request: string) => `Model:\n${d.context(m)}\n\nRequest: ${request}`

/* ------------------------------------------------------------------ parse + apply */

export function extractJson(text: string): string | null {
  const i = text.indexOf('{')
  if (i < 0) return null
  let depth = 0, inStr = false, esc = false
  for (let k = i; k < text.length; k++) {
    const c = text[k]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
    } else if (c === '"') inStr = true
    else if (c === '{') depth++
    else if (c === '}' && --depth === 0) return text.slice(i, k + 1)
  }
  return null
}

/** Checks an operation against its spec (types, enums, ranges) before it is applied. */
export function checkOp(specs: OpSpec[], op: Op): string | null {
  const s = specs.find((x) => x.op === op.op)
  if (!s) return `unknown operation "${String(op.op)}"`
  for (const [k, a] of Object.entries(s.args)) {
    const v = op[k]
    if (a.kind === 'enum' && !a.values.includes(String(v))) return `${s.op}.${k}: "${String(v)}" is not in the model`
    if (a.kind === 'number' && !(typeof v === 'number' && Number.isFinite(v) && v >= a.min && v <= a.max)) return `${s.op}.${k}: ${String(v)} outside ${a.min}…${a.max}${a.unit ? ' ' + a.unit : ''}`
    if (a.kind === 'number' && a.integer && !Number.isInteger(v)) return `${s.op}.${k}: must be an integer`
    if (a.kind === 'string' && typeof v !== 'string') return `${s.op}.${k}: text expected`
  }
  return null
}

export interface Preview<M> {
  title: string
  ops: Op[]
  changes: string[]
  /** Result model (null if any operation or the model rules failed). */
  model: M | null
  error: string | null
}

export function preview<M>(d: Discipline<M>, m: M, p: Proposal): Preview<M> {
  const specs = d.ops(m)
  let cur = m
  const changes: string[] = []
  for (const op of p.ops) {
    const bad = checkOp(specs, op)
    if (bad) return { title: p.title, ops: p.ops, changes, model: null, error: bad }
    const r = d.apply(cur, op)
    if ('error' in r) return { title: p.title, ops: p.ops, changes, model: null, error: `${op.op}: ${r.error}` }
    cur = r.model
    changes.push(r.change)
  }
  const rule = d.validate(cur, m)
  return { title: p.title, ops: p.ops, changes, model: rule ? null : cur, error: rule ? `model rule: ${rule}` : null }
}

export function parseProposal(text: string): Proposal | null {
  const js = extractJson(text)
  if (!js) return null
  try {
    const o = JSON.parse(js) as Proposal
    return typeof o.title === 'string' && Array.isArray(o.ops) && o.ops.every((x) => x && typeof x.op === 'string') ? o : null
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------ run on the desktop host */

export interface AiRun<M> {
  preview: Preview<M> | null
  raw: string
  seconds: number
  retried: boolean
  model?: string
  tokensPerSecond?: number
  error?: string
}

let seq = 0
const waiting = new Map<string, (r: { ok: boolean; text: string; seconds: number; model?: string; tokensPerSecond?: number; error?: string }) => void>()
let attached: HostApi | null = null

function task(host: HostApi, system: string, prompt: string, grammarText: string | undefined, maxTokens: number) {
  if (attached !== host) {
    attached = host
    host.on('aiTaskResult', (p) => {
      const r = p as { id: string; ok: boolean; text: string; seconds: number; model?: string; tokensPerSecond?: number; error?: string }
      waiting.get(r.id)?.(r)
      waiting.delete(r.id)
    })
  }
  const id = `ai-${Date.now()}-${seq++}`
  return new Promise<{ ok: boolean; text: string; seconds: number; model?: string; tokensPerSecond?: number; error?: string }>((resolve) => {
    waiting.set(id, resolve)
    host.aiTask(JSON.stringify({ id, system, prompt, grammar: grammarText, maxTokens })).then((started) => {
      if (!started) {
        waiting.delete(id)
        resolve({ ok: false, text: '', seconds: 0, error: 'no-model' })
      }
    })
  })
}

/**
 * Asks the local model. Hybrid decoding as in CAD 2D: a fast unconstrained pass; if its reply does not
 * parse or does not apply, one retry under the grammar.
 */
export async function ask<M>(host: HostApi, d: Discipline<M>, m: M, request: string): Promise<AiRun<M>> {
  const sys = systemPrompt(d, m)
  const user = userPrompt(d, m, request)
  let total = 0
  const attempt = async (constrained: boolean) => {
    const r = await task(host, sys, user, constrained ? grammar(d.ops(m)) : undefined, 700)
    total += r.seconds
    const p = r.ok ? parseProposal(r.text) : null
    return { r, pv: p ? preview(d, m, p) : null }
  }
  const first = await attempt(false)
  if (first.r.error === 'no-model') return { preview: null, raw: '', seconds: 0, retried: false, error: 'no-model' }
  if (first.pv && !first.pv.error) return { preview: first.pv, raw: first.r.text, seconds: total, retried: false, model: first.r.model, tokensPerSecond: first.r.tokensPerSecond }
  const second = await attempt(true)
  return {
    preview: second.pv,
    raw: second.r.text,
    seconds: total,
    retried: true,
    model: second.r.model,
    tokensPerSecond: second.r.tokensPerSecond,
    error: second.pv ? undefined : second.r.error ?? 'reply was not a valid proposal',
  }
}

const warmed = new WeakMap<object, Set<string>>()
/** Prefills the model with this assistant's prompt prefix (system + model facts) in the background. */
export async function warm<M>(host: HostApi, d: Discipline<M>, m: M) {
  const k = m as unknown as object
  const set = warmed.get(k) ?? new Set<string>()
  if (set.has(d.key)) return
  set.add(d.key)
  warmed.set(k, set)
  await task(host, systemPrompt(d, m), userPrompt(d, m, ''), undefined, 1)
}
