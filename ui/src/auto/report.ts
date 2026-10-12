/** The report written with the one-command package: what was found, checks, files, every warning (HTML). */
import type { AutoResult } from './pipeline'
import type { Written } from './package'

export interface ReportText {
  title: string
  source: string
  when: string
  time: string
  ai: string
  building: string
  route: string
  files: string
  warnings: string
  checks: string
  note: string
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

export function reportHtml(r: AutoResult, t: ReportText, lines: { ai: string; house: string[]; route: string[]; checks: string; warnings: string[]; files: (Written | { name: string })[] }, lang: string): string {
  const row = (k: string, v: string) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`
  const list = (items: string[]) => (items.length ? `<ul>${items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p>—</p>')
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>${esc(t.title)}</title>
<style>body{font:14px/1.5 system-ui,Roboto,sans-serif;margin:32px;color:#1d2530;max-width:960px}h1{font-size:20px;color:#0f6b70}h2{font-size:16px;margin-top:24px;color:#0f6b70}table{border-collapse:collapse}th,td{text-align:left;padding:3px 12px 3px 0;vertical-align:top}th{color:#5a6474;font-weight:500}.note{background:#fff4e5;color:#8a4b00;padding:8px 12px;border-radius:6px}</style></head><body>
<h1>${esc(t.title)}</h1>
<table>${row(t.source, r.file)}${row(t.when, new Date().toLocaleString(lang))}${row(t.time, `${(r.ms / 1000).toFixed(1)} s`)}${row(t.ai, lines.ai)}</table>
${lines.house.length ? `<h2>${esc(t.building)}</h2>${list(lines.house)}<p>${esc(t.checks)}: ${esc(lines.checks)}</p>` : ''}
${lines.route.length ? `<h2>${esc(t.route)}</h2>${list(lines.route)}` : ''}
<h2>${esc(t.warnings)}</h2>${list(lines.warnings)}
<h2>${esc(t.files)}</h2>${list(lines.files.map((f) => ('ok' in f && !f.ok ? `${f.name} — ${f.error ?? ''}` : f.name)))}
<p class="note">${esc(t.note)}</p>
</body></html>`
}
