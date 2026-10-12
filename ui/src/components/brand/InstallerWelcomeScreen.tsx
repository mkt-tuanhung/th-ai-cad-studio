import { useRef, useState } from 'react'
import { useLang } from '../../i18n'
import { BRAND, BRAND_ASSETS } from './brand'
import s from './InstallerWelcomeScreen.module.css'

const TEXT = {
  en: {
    welcome: 'Welcome to the setup of',
    tagline: 'Design Smarter. Build Faster.',
    intro: 'This will install MD CAD AI STUDIO on your computer: 2D CAD, BIM, MEP, civil, mechanical, interior and renders, with a local AI that runs entirely on this machine.',
    facts: [
      ['Version', BRAND.version],
      ['Works offline', 'no account, no cloud'],
      ['Local AI', 'models stay on this computer'],
      ['Requires', 'macOS 14+ (Apple silicon) · Windows 10 1809+ x64'],
    ],
    next: 'Install',
    cancel: 'Cancel',
  },
  vi: {
    welcome: 'Chào mừng đến với trình cài đặt',
    tagline: 'Design Smarter. Build Faster.',
    intro: 'Trình cài đặt sẽ cài MD CAD AI STUDIO lên máy: CAD 2D, BIM, MEP, hạ tầng, cơ khí, nội thất và render, cùng AI chạy hoàn toàn trên máy này.',
    facts: [
      ['Phiên bản', BRAND.version],
      ['Ngoại tuyến', 'không tài khoản, không cloud'],
      ['AI cục bộ', 'mô hình nằm trên máy này'],
      ['Yêu cầu', 'macOS 14+ (Apple silicon) · Windows 10 1809+ x64'],
    ],
    next: 'Cài đặt',
    cancel: 'Huỷ',
  },
}

/**
 * Installer welcome screen (the same art is exported for the real installers: the Inno Setup wizard image
 * on Windows and the DMG window background on macOS — tools/make-installer-art.mjs). Hero visual left,
 * setup information right; light motion only: hero fade-in, glow pulse, parallax, a tech trace line.
 * `part="hero"` renders only the hero panel (installer image export).
 */
export function InstallerWelcomeScreen({ part, onInstall, onCancel }: { part?: 'hero'; onInstall?: () => void; onCancel?: () => void }) {
  const lang = useLang()
  const t = TEXT[lang === 'vi' ? 'vi' : 'en']
  const ref = useRef<HTMLDivElement>(null)
  const [tilt, setTilt] = useState({ x: 0, y: 0 })
  const move = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect()
    setTilt({ x: (e.clientX - r.left) / r.width - 0.5, y: (e.clientY - r.top) / r.height - 0.5 })
  }
  const hero = (
    <div className={s.hero} ref={ref} onPointerMove={move} onPointerLeave={() => setTilt({ x: 0, y: 0 })} data-testid="installer-hero">
      <div className={s.heroGrid} style={{ transform: `translate(${tilt.x * -10}px, ${tilt.y * -8}px)` }} />
      <div className={s.glow} />
      <svg className={s.trace} viewBox="0 0 400 600" preserveAspectRatio="none" aria-hidden="true">
        <path d="M 0 470 H 120 L 150 440 H 260 L 290 470 H 400" pathLength={1} />
        <path d="M 40 0 V 120 L 70 150 V 260" pathLength={1} className={s.trace2} />
      </svg>
      {/* parallax on the wrapper, entrance animation on the logo (two transforms that must not fight) */}
      <div className={s.parallax} style={{ transform: `translate(${tilt.x * 8}px, ${tilt.y * 6}px)` }}>
        <div className={s.heroLogo}>
          <img className={s.mono} src={BRAND_ASSETS.monogramDark} alt="" draggable={false} />
          <img className={s.word} src={BRAND_ASSETS.wordmarkDark} alt={BRAND.name} draggable={false} />
        </div>
      </div>
      <p className={s.heroCredit}>{BRAND.credit}</p>
    </div>
  )
  if (part === 'hero') return <div className={s.heroOnly}>{hero}</div>
  return (
    <section className={s.window} aria-label={`${t.welcome} ${BRAND.name}`} data-testid="installer-welcome">
      {hero}
      <div className={s.info}>
        <p className={s.welcome}>{t.welcome}</p>
        <h1 className={s.name}>{BRAND.name}</h1>
        <p className={s.tagline}>{t.tagline}</p>
        <p className={s.intro}>{t.intro}</p>
        <dl className={s.facts}>
          {t.facts.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        <p className={s.credit} data-testid="installer-credit">{BRAND.credit}</p>
        <div className={s.actions}>
          <button type="button" className={s.cancel} onClick={onCancel}>{t.cancel}</button>
          <button type="button" className={s.install} onClick={onInstall}>{t.next}</button>
        </div>
      </div>
    </section>
  )
}
