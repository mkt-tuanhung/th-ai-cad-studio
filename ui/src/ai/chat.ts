/**
 * AI Studio conversation with the local model (desktop): each message is first routed — a request to change
 * the open drawing goes to the CAD edit pipeline (validated proposal → approve → undo); anything else gets a
 * free-text answer grounded in short facts about the open project. Nothing here edits a model.
 */
import type { HostApi } from '../services/host'
import { task } from './discipline'
import { useCad } from '../state/cad'
import { useBim } from '../state/bim'
import type { ChatTurn } from './sampleSession'

export type Route = 'edit' | 'answer'

/** One-word decision under a grammar (cheap: the prompt prefix stays cached). */
export async function route(host: HostApi, text: string): Promise<Route | 'no-model'> {
  const sys =
    'You route messages for a CAD application. Reply "edit" when the message asks to change the open 2D drawing ' +
    '(draw, add, insert, move, copy, delete, erase, resize, rotate, scale, offset, fix, align, dimension something). ' +
    'Reply "answer" for questions, explanations, advice, calculations or anything that does not change the drawing.'
  const r = await task(host, sys, `Examples: "draw a circle r 500 at 0,0" → edit · "move the door 200 mm left" → edit · "how thick is wall W1?" → answer · "vẽ đường thẳng từ 0,0 đến 1000,0" → edit · "tính diện tích phòng" → answer\nMessage: ${text}\nRoute:`, 'root ::= "edit" | "answer"', 3)
  if (r.error === 'no-model') return 'no-model'
  return r.text.trim().startsWith('edit') ? 'edit' : 'answer'
}

/** Short facts about what is open, so answers can refer to the user's own project. */
export function projectFacts(): string {
  const facts: string[] = []
  const doc = useCad.getState().activeDoc()
  if (doc) {
    const kinds: Record<string, number> = {}
    for (const e of doc.entities) kinds[e.kind] = (kinds[e.kind] ?? 0) + 1
    facts.push(`Open drawing "${doc.name}": ${doc.entities.length} entities (${Object.entries(kinds).map(([k, n]) => `${n} ${k}`).join(', ')}); layers ${doc.layers.map((l) => l.name).join(', ')}.`)
  }
  const m = useBim.getState().model
  facts.push(`BIM model Villa Riverside: ${m.levels.length} levels (${m.levels.map((l) => `${l.name} ${l.elevation} mm`).join(', ')}), ${m.walls.length} walls, ${m.doors.length} doors, ${m.windows.length} windows, ${m.rooms.length} rooms.`)
  return facts.join('\n')
}

export interface Answer {
  ok: boolean
  text: string
  seconds: number
  model?: string
  tokensPerSecond?: number
  error?: string
}

/** Free-text answer (deterministic, ≤ 450 tokens), in the language of the question. */
export async function answer(host: HostApi, text: string, history: ChatTurn[]): Promise<Answer> {
  const sys = [
    'You are the assistant inside MD CAD AI STUDIO, an offline CAD / BIM / MEP / civil / mechanical design application running on this computer.',
    'Answer concisely (at most 8 sentences or a short list), in the same language as the question (Vietnamese or English).',
    'Use the project facts below when they are relevant. If something is not in the facts and you are not sure, say so — never invent project data, codes or numbers.',
    'You cannot change drawings in this answer; to change the open drawing the user can ask for the edit directly (it will be shown as a proposal to approve).',
    'Never compute numbers in your head: write every calculation as an arithmetic expression in double brackets, in the units you want, e.g. "the volume is [[4 * 3 * 0.2]] m³" (convert mm to m inside the expression: 200 mm → 0.2). The application evaluates the brackets exactly.',
    '',
    'Project facts:',
    projectFacts(),
  ].join('\n')
  const recent = history
    .filter((t) => t.role === 'user' || (t.role === 'assistant' && t.tone === 'live' && !t.pending))
    .slice(-4)
    .map((t) => `${t.role === 'user' ? 'User' : 'Assistant'}: ${t.text}`)
    .join('\n')
  // the system prompt is English; a Vietnamese question gets an explicit reply-language line
  const vi = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i.test(text)
  const prompt = `${recent ? recent + '\n' : ''}User: ${text}${vi ? '\n(Trả lời bằng tiếng Việt.)' : ''}\nAssistant:`
  const r = await task(host, sys, prompt, undefined, 450)
  return { ok: r.ok && !!r.text.trim(), text: evaluateBrackets(r.text.trim().replace(/^Assistant:\s*/, '')), seconds: r.seconds, model: r.model, tokensPerSecond: r.tokensPerSecond, error: r.error }
}

/** Safe arithmetic (+ − × ÷ ^, parentheses, decimals, sqrt / pi) — no eval. */
export function calc(expr: string): number | null {
  const src = expr.replace(/×/g, '*').replace(/÷/g, '/').replace(/,(?=\d{3}\b)/g, '').replace(/(\d),(\d)/g, '$1.$2').replace(/\s+/g, '')
  let i = 0
  const peek = () => src[i]
  const num = (): number => {
    if (src.startsWith('sqrt(', i)) {
      i += 4
      return Math.sqrt(atom())
    }
    if (src.startsWith('pi', i)) {
      i += 2
      return Math.PI
    }
    const m = /^\d+(\.\d+)?/.exec(src.slice(i))
    if (!m) throw new Error('number')
    i += m[0].length
    return Number(m[0])
  }
  const atom = (): number => {
    if (peek() === '(') {
      i++
      const v = sum()
      if (peek() !== ')') throw new Error(')')
      i++
      return v
    }
    if (peek() === '-') {
      i++
      return -atom()
    }
    return num()
  }
  const pow = (): number => {
    const b = atom()
    if (peek() === '^') {
      i++
      return Math.pow(b, pow())
    }
    return b
  }
  const prod = (): number => {
    let v = pow()
    while (peek() === '*' || peek() === '/') v = src[i++] === '*' ? v * pow() : v / pow()
    return v
  }
  const sum = (): number => {
    let v = prod()
    while (peek() === '+' || peek() === '-') v = src[i++] === '+' ? v + prod() : v - prod()
    return v
  }
  try {
    const v = sum()
    return i === src.length && Number.isFinite(v) ? v : null
  } catch {
    return null
  }
}

/** Replaces [[expr]] by its value (up to 4 significant decimals); leaves unparsable brackets visible. */
export function evaluateBrackets(text: string): string {
  return text.replace(/\[\[([^\]]+)\]\]/g, (all, expr: string) => {
    const v = calc(expr)
    if (v === null) return all
    const r = Math.round(v * 1e4) / 1e4
    return r.toLocaleString('en-US', { maximumFractionDigits: 4 })
  })
}
