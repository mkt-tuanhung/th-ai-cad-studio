// Run inside the desktop app against the dev server (THCAD_UI_URL=http://127.0.0.1:5173/ THCAD_SCRIPT=this file):
// evaluates the discipline assistants (ui/src/ai/eval.ts) with the real local model; prints EVAL lines.
setTimeout(async () => {
  try {
    const h = await window.thcadHostReady
    const D = await import(location.origin + '/src/ai/discipline.ts')
    const E = await import(location.origin + '/src/ai/eval.ts')
    const only = new URLSearchParams(location.search).get('only')
    const totals = {}
    for (const [label, sets] of [['A', E.EVAL], ['B', E.EVAL_B], ['C', E.EVAL_C]]) for (const set of sets) {
      if (only && set.d.key !== only) continue
      let pass = 0
      for (const c of set.cases) {
        const r = await D.ask(h, set.d, set.base(), c.request)
        const ok = E.score(set, c, r.preview)
        if (ok) pass++
        console.log('SELFTEST EVAL ' + JSON.stringify({ set: label, d: set.d.key, ok, q: c.request, s: Math.round(r.seconds * 10) / 10, retried: r.retried, ops: r.preview?.ops, err: r.error ?? r.preview?.error }))
      }
      totals[`${label}:${set.d.key}`] = `${pass}/${set.cases.length}`
    }
    console.log('SELFTEST EVAL TOTAL ' + JSON.stringify(totals))
  } catch (e) {
    console.log('SELFTEST EVAL ERROR ' + e + ' ' + (e && e.stack))
  }
}, 3000)
