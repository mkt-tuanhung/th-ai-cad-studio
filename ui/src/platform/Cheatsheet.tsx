import { Fragment } from 'react'
import { fmt, useT } from '../i18n'
import { Modal } from '../components/ui/Modal'
import { useRouter } from '../state/router'
import { DEFAULT_SHORTCUTS, SHORTCUT_SCOPE, shortcutLabel, useSettings, type ShortcutId } from '../state/settings'
import { COMMANDS } from '../cad/commands'
import { ACTIONS, scopeOfRoute } from './keymap'
import { collisionText, useCurrentKeys } from './profileState'
import { usePlatformUi } from './ui'
import s from './Platform.module.css'

/** On-screen keyboard cheatsheet of the current workspace and interaction profile (⌘/ or ⌘K → "cheatsheet"). */
export function Cheatsheet() {
  const t = useT()
  const P = t.platform
  const close = () => usePlatformUi.getState().set({ cheatsheet: false })
  const route = useRouter((st) => st.route)
  const scope = scopeOfRoute(route)
  const shortcuts = useSettings((st) => st.shortcuts)
  const keys = useCurrentKeys()
  const why = new Map(keys.collisions.map((c) => [c.action, c]))
  const app = (Object.keys(DEFAULT_SHORTCUTS) as ShortcutId[]).filter((k) => SHORTCUT_SCOPE[k] === 'global' || scope === 'cad2d')
  const mine = ACTIONS.filter((a) => (a.scope === scope || a.scope === 'global') && keys.bindings[a.id])
  return (
    <Modal title={fmt(P.cheat.title, { profile: P.profiles.names[keys.profile] })} onClose={close} width={640}>
      <p className={s.note}>{fmt(P.cheat.workspace, { ws: P.profiles.workspaces[scope] })} · {P.profiles.text[keys.profile]}</p>
      <div className={s.sheet} data-testid="cheatsheet">
        <h3>{P.cheat.app}</h3>
        {app.map((k) => (
          <div key={k} className={s.row}><span>{t.settings.shortcuts.names[k]}</span><kbd>{shortcutLabel(shortcuts[k])}</kbd></div>
        ))}
        <h3>{P.cheat.profile}</h3>
        {mine.length === 0 && <div className={s.wide}>{P.cheat.noKeys}</div>}
        {mine.map((a) => {
          const c = why.get(a.id)
          return (
            <Fragment key={a.id}>
              <div className={`${s.row} ${c ? s.off : ''}`} title={c ? collisionText(c, t) : undefined} data-action={a.id} data-active={c ? 'false' : 'true'}>
                <span>{P.actions[a.id]}{c ? ` (${P.profiles.inactive})` : ''}</span><kbd>{shortcutLabel(keys.bindings[a.id])}</kbd>
              </div>
            </Fragment>
          )
        })}
        {scope === 'cad2d' && (
          <>
            <h3>{P.cheat.typed}</h3>
            {COMMANDS.filter((c) => c.aliases.length).map((c) => (
              <div key={c.name} className={s.row}><span>{c.name}</span><kbd>{c.aliases.join(' · ')}</kbd></div>
            ))}
          </>
        )}
      </div>
    </Modal>
  )
}
