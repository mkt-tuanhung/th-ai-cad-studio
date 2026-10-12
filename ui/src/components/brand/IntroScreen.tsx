import { useEffect, useRef } from 'react'
import { BRAND, BRAND_ASSETS, MONOGRAM_SIZE } from './brand'
import s from './IntroScreen.module.css'

/**
 * The opening animation (≈4.4 s, CSS + SVG + a light canvas; the logo pixels are the approved artwork):
 *  1  0.0–0.9 s  dark graphite / blue-black background, blueprint grid, a soft light streak
 *  2  0.4–2.4 s  construction lines draw (SVG stroke), the MD monogram assembles (two halves slide in,
 *                de-blur) and a light sweep crosses it; the drawn lines hand over to the logo's own
 *  3  2.2–3.0 s  the MD CAD AI STUDIO wordmark is revealed left → right behind a scan line
 *  4  2.9–3.5 s  the credit line fades up
 *  5  3.3 s →    progress line (driven by the real start-up steps) and the status text
 * `leaving` fades the whole screen out into the app.
 */
export function IntroScreen({ status, progress, leaving, still }: { status: string; progress: number; leaving?: boolean; still?: boolean }) {
  return (
    <div className={`${s.intro} ${leaving ? s.leaving : ''} ${still ? s.still : ''}`} data-testid="intro-screen" aria-label={BRAND.name}>
      <div className={s.bg} />
      <div className={s.grid} />
      <div className={s.streak} />
      {!still && <Particles />}
      <div className={s.stage}>
        <div className={s.mono} style={{ aspectRatio: `${MONOGRAM_SIZE.w} / ${MONOGRAM_SIZE.h}` }}>
          <Construction />
          <img className={`${s.half} ${s.left}`} src={BRAND_ASSETS.monogramDark} alt="" draggable={false} />
          <img className={`${s.half} ${s.right}`} src={BRAND_ASSETS.monogramDark} alt="" draggable={false} />
          <div className={s.sweep} style={{ maskImage: `url(${BRAND_ASSETS.monogramDark})`, WebkitMaskImage: `url(${BRAND_ASSETS.monogramDark})` }} />
        </div>
        <div className={s.word}>
          <img src={BRAND_ASSETS.wordmarkDark} alt={BRAND.name} draggable={false} />
          <span className={s.scan} />
        </div>
        <p className={s.credit}>{BRAND.credit}</p>
        <div className={s.progress}>
          <span className={s.track}>
            <span className={s.fill} style={{ width: `${Math.round(progress * 100)}%` }} />
          </span>
          <span className={s.status} data-testid="intro-status">{status}</span>
        </div>
      </div>
    </div>
  )
}

/** Blueprint construction lines of the monogram (its own coordinate system), drawn then handed over. */
function Construction() {
  const L = (x1: number, y1: number, x2: number, y2: number, d: number) => <line x1={x1} y1={y1} x2={x2} y2={y2} pathLength={1} style={{ animationDelay: `${d}s` }} />
  return (
    <svg className={s.construct} viewBox={`0 0 ${MONOGRAM_SIZE.w} ${MONOGRAM_SIZE.h}`} aria-hidden="true">
      {L(68, 8, 68, 684, 0.45)}
      {L(4, 95, 214, 95, 0.55)}
      {L(8, 395, 290, 395, 0.62)}
      {L(48, 667, 330, 667, 0.7)}
      {L(488, 667, 1048, 667, 0.78)}
      {L(781, 46, 781, 238, 0.66)}
      {L(968, 92, 968, 680, 0.74)}
      {L(978, 395, 1148, 395, 0.82)}
      <circle cx={185} cy={383} r={84} pathLength={1} className={s.dash} style={{ animationDelay: '0.8s' }} />
      <path d="M 820 86 A 330 330 0 0 1 1110 560" pathLength={1} className={s.dash} style={{ animationDelay: '0.9s' }} />
      {[[68, 95], [68, 395], [1078, 395]].map(([x, y], i) => (
        <g key={i} className={s.node} style={{ animationDelay: `${1 + i * 0.08}s` }}>
          <circle cx={x} cy={y} r={11} />
          <circle cx={x} cy={y} r={4} className={s.nodeDot} />
        </g>
      ))}
    </svg>
  )
}

/** A few slow particles drifting up (canvas), very low contrast. */
function Particles() {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current!
    const g = c.getContext('2d')!
    let raf = 0
    const dpr = window.devicePixelRatio || 1
    const fit = () => {
      c.width = c.clientWidth * dpr
      c.height = c.clientHeight * dpr
    }
    fit()
    window.addEventListener('resize', fit)
    const ps = Array.from({ length: 46 }, () => ({ x: Math.random(), y: Math.random(), r: 0.6 + Math.random() * 1.4, v: 0.00012 + Math.random() * 0.00035, a: 0.08 + Math.random() * 0.22 }))
    const t0 = performance.now()
    const draw = (t: number) => {
      const k = Math.min(1, (t - t0) / 900)
      g.clearRect(0, 0, c.width, c.height)
      for (const p of ps) {
        p.y -= p.v
        if (p.y < -0.02) (p.y = 1.02), (p.x = Math.random())
        g.beginPath()
        g.fillStyle = `rgba(110, 214, 214, ${p.a * k})`
        g.arc(p.x * c.width, p.y * c.height, p.r * dpr, 0, Math.PI * 2)
        g.fill()
      }
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', fit)
    }
  }, [])
  return <canvas ref={ref} className={s.particles} aria-hidden="true" />
}
