import { useState } from 'react'
import { useLang } from '../../i18n'
import { BRAND } from '../../components/brand/brand'
import { BrandLogo } from '../../components/brand/BrandLogo'
import { BrandLoader, brandLoading } from '../../components/brand/BrandLoader'
import { InstallerWelcomeScreen } from '../../components/brand/InstallerWelcomeScreen'
import { AppIconPreview } from '../../components/brand/AppIconPreview'
import { SplashScreen } from '../../components/brand/SplashScreen'
import s from './BrandScreen.module.css'

/** Brand kit page: replay the intro, the installer welcome, loaders, logo variants and the app icon. */
export function BrandScreen() {
  const vi = useLang() === 'vi'
  const [intro, setIntro] = useState(false)
  return (
    <div className={`${s.page} scroll-y`} data-testid="brand-screen">
      <header className={s.head}>
        <BrandLogo variant="horizontal" height={40} />
        <div className={s.headActions}>
          <button type="button" onClick={() => setIntro(true)}>{vi ? 'Xem lại intro' : 'Replay intro'}</button>
          <button type="button" onClick={() => { const h = brandLoading.start(vi ? 'Đang nạp mô hình AI cục bộ...' : 'Loading local AI models...'); setTimeout(h.done, 1800) }}>
            {vi ? 'Thử loader' : 'Try the loader'}
          </button>
        </div>
      </header>
      <section className={s.row}>
        <div className={s.dark}><BrandLogo variant="full" tone="dark" height={260} /></div>
        <div className={s.light}><BrandLogo variant="full" tone="light" height={260} /></div>
      </section>
      <h2 className={s.h2}>{vi ? 'Màn chào trình cài đặt' : 'Installer welcome screen'}</h2>
      <div className={s.center}><InstallerWelcomeScreen /></div>
      <h2 className={s.h2}>{vi ? 'Trạng thái đang tải' : 'Brand loading states'}</h2>
      <section className={s.loaders}>
        <BrandLoader text={vi ? 'Đang khởi tạo không gian làm việc...' : 'Initializing workspace...'} progress={0.35} />
        <BrandLoader text={vi ? 'Đang nạp mô hình AI cục bộ...' : 'Loading local AI models...'} />
        <BrandLoader text={vi ? 'Đang mở dự án...' : 'Loading project...'} tone="light" progress={0.7} />
      </section>
      <h2 className={s.h2}>{vi ? 'Biểu tượng ứng dụng' : 'App icon'}</h2>
      <AppIconPreview />
      <p className={s.credit}>{BRAND.credit}</p>
      {intro && <SplashScreen onDone={() => setIntro(false)} />}
    </div>
  )
}

/** Bare renders for exporting installer art (tools/make-installer-art.mjs): ?shot=hero | dmg. */
export function BrandShot({ shot }: { shot: string }) {
  if (shot === 'hero') return <div style={{ position: 'fixed', inset: 0 }}><InstallerWelcomeScreen part="hero" /></div>
  if (shot === 'dmg') return <DmgBackground />
  return null
}

/** macOS DMG window background (660 × 420): the app on the left, Applications on the right (Finder draws
 *  both icons on top at the positions set in make_dmg.sh), the brand and the credit line. */
function DmgBackground() {
  return (
    <div className={s.dmg}>
      <div className={s.dmgGrid} />
      <div className={s.dmgBrand}><BrandLogo variant="horizontal" tone="dark" height={44} /></div>
      <p className={s.dmgTag}>Design Smarter. Build Faster.</p>
      <svg className={s.dmgArrow} viewBox="0 0 200 40" aria-hidden="true">
        <path d="M 6 20 H 180" />
        <path d="M 168 10 L 184 20 L 168 30" />
      </svg>
      {/* name plates under the two icons: Finder draws the labels in the system colour (black in light mode,
          white in dark), so they sit on a mid-tone silver that reads in both */}
      <span className={s.dmgPlate} style={{ left: 165 }} />
      <span className={s.dmgPlate} style={{ left: 495 }} />
      <p className={s.dmgHint}>Kéo MD CAD AI STUDIO vào Applications để cài đặt · Drag to Applications to install</p>
      <p className={s.dmgCredit}>{BRAND.credit}</p>
    </div>
  )
}
