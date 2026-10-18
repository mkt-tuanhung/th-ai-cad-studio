import { useEffect, useMemo, useRef, useState } from 'react'
import { Boxes, FileText, FolderClosed, Keyboard, Search, Settings as Gear, SquareTerminal, Wrench, Zap } from 'lucide-react'
import { fmt, useT } from '../../i18n'
import { useRouter } from '../../state/router'
import { matchesShortcut, useSettings } from '../../state/settings'
import { useWorkspace } from '../../state/workspace'
import { AiSparkIcon } from '../icons'
import { routeForDiscipline } from '../../lib/routes'
import { useAutoRun } from '../../state/auto'
import { norm } from '../../bim/fromCad'
import { useCadSession } from '../../state/cadSession'
import { useLibrary, allComponents } from '../../state/library'
import { searchAll, type Hit } from '../../platform/search'
import { actionHandler, ACTIONS } from '../../platform/keymap'
import { currentKeys } from '../../platform/profileState'
import { componentsInbox, openCheatsheet, openHistory, settingsInbox } from '../../platform/ui'
import { exportProject, projectFileName } from '../../platform/projectJson'
import { downloadFile } from '../workspace/Workspace'
import { toast } from '../../state/toast'
import { shortcutLabel } from '../../state/settings'
import s from './SearchBar.module.css'

const ROUTE_OF = { bim: 'bim', interior: 'interior', cad2d: 'cad2d', global: null } as const
/** Runs a workspace action once its screen has mounted and registered it (up to ~1 s after navigating). */
function runAction(id: string, tries = 20) {
  const fn = actionHandler(id)
  if (fn) return fn()
  if (tries > 0) window.setTimeout(() => runAction(id, tries - 1), 50)
}

interface Result {
  id: string
  kind: 'project' | 'file' | 'ai' | 'auto' | Hit['kind']
  label: string
  sub?: string
  run: () => void
}

/** The one-command keywords in both languages (a Vietnamese user may type English words and the reverse). */
const T_EN_KEYWORDS = 'one command build everything auto all drawing dwg dxf 1 mot lenh lam het tu dong dung tat ca ban ve'

export function SearchBar() {
  const t = useT()
  const navigate = useRouter((st) => st.navigate)
  const { projects, files, touchProject } = useWorkspace()
  const uploads = useLibrary((st) => st.uploads)
  const [q, setQ] = useState('')
  const [focused, setFocused] = useState(false)
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  // ⌘K / Ctrl+K focuses global search from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (matchesShortcut(e, useSettings.getState().shortcuts.commandSearch)) {
        e.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const results = useMemo<Result[]>(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return []
    const out: Result[] = []
    // "1 lệnh / làm hết / dựng / dwg…": the one-command run comes first
    const words = norm(t.auto.keywords + ' ' + T_EN_KEYWORDS).split(' ')
    if (norm(needle).split(' ').some((w) => w.length >= 2 && words.some((k) => k.startsWith(w)))) out.push({ id: 'auto', kind: 'auto', label: t.auto.command, run: () => useAutoRun.getState().show() })
    for (const p of projects) {
      if (p.name.toLowerCase().includes(needle))
        out.push({
          id: `p-${p.id}`,
          kind: 'project',
          label: p.name,
          sub: p.format,
          run: () => {
            touchProject(p.id)
            navigate(routeForDiscipline(p.discipline))
          },
        })
    }
    for (const f of files) {
      if (f.name.toLowerCase().includes(needle))
        out.push({
          id: `f-${f.id}`,
          kind: 'file',
          label: f.name,
          sub: f.format,
          run: () => navigate(f.format === 'RVT' || f.format === 'IFC' ? 'bim' : 'cad2d'),
        })
    }
    out.splice(4)
    // commands, tools, library, settings — the key shown is the one the active interaction profile gives it
    const P = t.platform
    const keys = currentKeys()
    const activeKey = new Map([...keys.active].map(([k, id]) => [id, k.split(':')[1]]))
    const hits = searchAll(q, {
      actionLabel: (id) => `${P.actions[id] ?? id} — ${P.profiles.workspaces[ACTIONS.find((a) => a.id === id)!.scope]}`,
      actionKey: (id) => activeKey.get(id),
      components: allComponents(uploads).map((c) => ({ id: c.id, name: c.name, sub: c.sizeLabel ?? '' })),
      settings: (Object.keys(t.settings.menu) as (keyof typeof t.settings.menu)[]).map((k) => ({ section: k, label: `${t.settings.menu[k][0]} — ${t.settings.menu[k][1]}` })),
      platform: [
        { what: 'cheatsheet', label: P.cheat.open },
        { what: 'history', label: P.history.title },
        { what: 'export', label: P.history.export },
      ],
    }, 9 - out.length)
    for (const h of hits) {
      if (h.kind === 'command')
        out.push({ id: `c-${h.name}`, kind: 'command', label: h.name, sub: [P.search.command, h.aliases.join(' · ')].filter(Boolean).join(' · '), run: () => {
          if (useRouter.getState().route !== 'cad2d') navigate('cad2d')
          window.setTimeout(() => { useCadSession.getState().cancel(); useCadSession.getState().input(h.name) }, 0)
        } })
      else if (h.kind === 'action')
        out.push({ id: `a-${h.id}`, kind: 'action', label: h.label, sub: [P.search.tool, h.key && shortcutLabel(h.key)].filter(Boolean).join(' · '), run: () => {
          const r = ROUTE_OF[h.scope]
          if (r && useRouter.getState().route !== r) navigate(r)
          runAction(h.id)
        } })
      else if (h.kind === 'library')
        out.push({ id: `l-${h.id}`, kind: 'library', label: h.name, sub: `${P.search.library} · ${h.sub}`, run: () => { componentsInbox.id = h.id; navigate('components') } })
      else if (h.kind === 'setting')
        out.push({ id: `s-${h.section}`, kind: 'setting', label: h.label, sub: P.search.setting, run: () => { settingsInbox.section = h.section; navigate('settings') } })
      else
        out.push({ id: `p-${h.what}`, kind: 'platform', label: h.label, sub: P.search.action, run: () => {
          if (h.what === 'cheatsheet') openCheatsheet()
          else if (h.what === 'history') openHistory()
          else { const f = exportProject(); const name = projectFileName(f); downloadFile(name, JSON.stringify(f), 'application/json'); toast(fmt(P.history.exported, { file: name }), 'success') }
        } })
    }
    out.push({ id: 'ai', kind: 'ai', label: fmt(t.topbar.searchAskAi, { query: q.trim() }), run: () => navigate('ai-studio') })
    return out
  }, [q, projects, files, t, navigate, touchProject, uploads])

  const open = focused && q.trim().length > 0

  const choose = (r: Result | undefined) => {
    if (!r) return
    r.run()
    setQ('')
    inputRef.current?.blur()
  }

  return (
    <div className={s.wrap}>
      <div className={`${s.box} ${focused ? s.focused : ''}`}>
        <Search size={20} strokeWidth={1.6} className={s.icon} />
        <input
          ref={inputRef}
          className={s.input}
          value={q}
          placeholder={t.topbar.searchPlaceholder}
          aria-label={t.topbar.searchPlaceholder}
          onChange={(e) => {
            setQ(e.target.value)
            setCursor(0)
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => window.setTimeout(() => setFocused(false), 120)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setCursor((c) => Math.min(c + 1, results.length - 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setCursor((c) => Math.max(c - 1, 0))
            } else if (e.key === 'Enter') {
              choose(results[cursor])
            } else if (e.key === 'Escape') {
              setQ('')
              inputRef.current?.blur()
            }
          }}
        />
        <kbd className={s.kbd}>
          <span>⌘</span>
          <span>K</span>
        </kbd>
      </div>
      {open && (
        <div className={s.results} role="listbox">
          {results.length === 1 && <div className={s.empty}>{t.topbar.searchNoResults}</div>}
          {results.map((r, i) => (
            <button
              key={r.id}
              type="button"
              role="option"
              aria-selected={i === cursor}
              className={`${s.result} ${i === cursor ? s.cur : ''}`}
              onMouseEnter={() => setCursor(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(r)}
            >
              {r.kind === 'project' ? <FolderClosed size={16} /> : r.kind === 'file' ? <FileText size={16} /> : r.kind === 'auto' ? <Zap size={16} /> : r.kind === 'command' ? <SquareTerminal size={16} /> : r.kind === 'action' ? <Wrench size={16} /> : r.kind === 'library' ? <Boxes size={16} /> : r.kind === 'setting' ? <Gear size={16} /> : r.kind === 'platform' ? <Keyboard size={16} /> : <AiSparkIcon size={16} />}
              <span className={s.rLabel}>{r.label}</span>
              {r.sub && <span className={s.rSub}>{r.sub}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
