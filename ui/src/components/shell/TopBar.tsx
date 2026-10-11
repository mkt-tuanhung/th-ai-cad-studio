import { Bell, ChevronDown, Sun } from 'lucide-react'
import { useT } from '../../i18n'
import { useSettings } from '../../state/settings'
import { toast } from '../../state/toast'
import { useDismissable, PopoverPanel, MenuList } from '../ui/Popover'
import { SearchBar } from './SearchBar'
import { LanguageSwitch } from './LanguageSwitch'
import s from './TopBar.module.css'

export function TopBar() {
  const t = useT()
  const setTheme = useSettings((st) => st.setThemePreference)
  const [notifOpen, setNotifOpen, notifRef] = useDismissable<HTMLDivElement>()
  const [userOpen, setUserOpen, userRef] = useDismissable<HTMLDivElement>()

  return (
    <header className={s.bar}>
      <SearchBar />
      <div className={s.right}>
        <button
          type="button"
          className={`${s.iconBtn} ${s.sunBtn}`}
          aria-label={t.topbar.toggleTheme}
          title={t.topbar.toggleTheme}
          onClick={() => {
            // Only the light theme is designed/approved. Keep the preference, do not invent a dark UI.
            setTheme('light')
            toast(t.topbar.themeNotDesigned)
          }}
        >
          <Sun size={22} strokeWidth={1.5} />
        </button>
        <LanguageSwitch />
        <div className={`${s.anchor} ${s.bellAnchor}`} ref={notifRef}>
          <button
            type="button"
            className={s.iconBtn}
            aria-label={t.topbar.notifications}
            aria-expanded={notifOpen}
            onClick={() => setNotifOpen(!notifOpen)}
          >
            <Bell size={22} strokeWidth={1.5} />
            <span className={s.dot} />
          </button>
          {notifOpen && (
            <PopoverPanel width={280}>
              <div className={s.popHead}>{t.topbar.notifications}</div>
              <p className={s.popEmpty}>{t.topbar.noNotifications}</p>
            </PopoverPanel>
          )}
        </div>
        <div className={s.anchor} ref={userRef}>
          <button
            type="button"
            className={s.user}
            aria-label={t.topbar.userMenu}
            aria-expanded={userOpen}
            onClick={() => setUserOpen(!userOpen)}
          >
            <img className={s.avatar} src="/assets/extracted/avatar_user.png" alt="" />
            <span className={s.userText}>
              <span className={s.userName}>Hoàng Trần</span>
              <span className={s.userRole}>{t.topbar.userRole}</span>
            </span>
            <ChevronDown size={18} strokeWidth={1.6} className={s.chev} />
          </button>
          {userOpen && (
            <PopoverPanel width={220}>
              <div className={s.popHead}>{t.topbar.signedInLocal}</div>
              <MenuList
                onClose={() => setUserOpen(false)}
                items={[{ label: t.topbar.preferences, onSelect: () => (window.location.hash = '#/settings') }]}
              />
            </PopoverPanel>
          )}
        </div>
      </div>
    </header>
  )
}
