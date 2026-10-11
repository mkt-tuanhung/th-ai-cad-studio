import type { ReactNode } from 'react'
import s from './AppWindow.module.css'

/**
 * macOS window frame.
 * - `framed` (browser preview): desktop backdrop + rounded window + traffic lights, as in the mockups.
 * - `native` (embedded in the desktop host, `?shell=native`): fills the viewport; the OS draws the
 *   traffic lights in the same inset title-bar position, so we only reserve the space.
 */
export function AppWindow({ children, mode }: { children: ReactNode; mode: 'framed' | 'native' }) {
  return (
    <div className={`${s.desktop} ${s[mode]}`}>
      <div className={s.window}>
        {mode === 'framed' && (
          <div className={s.lights} aria-hidden="true">
            <span className={s.close} />
            <span className={s.min} />
            <span className={s.max} />
          </div>
        )}
        {children}
      </div>
    </div>
  )
}
