import { BRAND, BRAND_ASSETS } from './brand'
import s from './AppIconPreview.module.css'

/** The MD app icon at the sizes it is used: Dock / Finder / installer (macOS .icns, Windows .ico). */
export function AppIconPreview() {
  return (
    <section className={s.wrap} aria-label="App icon" data-testid="app-icon-preview">
      <div className={s.dock}>
        {[128, 96, 64].map((n) => (
          <figure key={n}>
            <img src={BRAND_ASSETS.appIcon} alt={`${BRAND.name} icon ${n}px`} style={{ width: n, height: n }} draggable={false} />
            <figcaption>{n} pt</figcaption>
          </figure>
        ))}
      </div>
      <div className={s.small}>
        {[48, 32, 16].map((n) => (
          <figure key={n}>
            <img src={BRAND_ASSETS.appIcon} alt="" style={{ width: n, height: n }} draggable={false} />
            <figcaption>{n}</figcaption>
          </figure>
        ))}
        <span className={s.label}>{BRAND.name}</span>
      </div>
    </section>
  )
}
