// Bracket calculator of AI Studio answers (run: UNIT=chat node tools/test-cam.mjs run).
import { calc, evaluateBrackets } from '../../src/ai/chat'

export function run() {
  const cases: [string, number | null][] = [['4 * 3 * 0.2', 2.4], ['(7.67*3.73)', 28.6091], ['2^3 + 1', 9], ['sqrt(16) / 2', 2], ['pi * 0.5^2', Math.PI * 0.25], ['1,200 * 2', 2400], ['4 × 0,2', 0.8], ['alert(1)', null], ['3 +', null]]
  const out = cases.map(([e, want]) => {
    const got = calc(e)
    return { e, got, ok: want === null ? got === null : got !== null && Math.abs(got - want) < 1e-9 }
  })
  return { all: out.every((o) => o.ok), out, text: evaluateBrackets('Thể tích là [[4 * 3 * 0.2]] m³, diện tích [[7.67 * 3.73]] m² — [[oops]]') }
}
