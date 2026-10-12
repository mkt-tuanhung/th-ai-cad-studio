import { useEffect, useRef, useState } from 'react'
import { useLang } from '../../i18n'
import { useCad } from '../../state/cad'
import { getHost, isDesktopHost } from '../../services/host'
import { IntroScreen } from './IntroScreen'

/** Real start-up steps shown by the splash (status text + progress). */
const STEPS = {
  en: ['Initializing workspace...', 'Loading local AI models...', 'Preparing design environment...'],
  vi: ['Đang khởi tạo không gian làm việc...', 'Đang nạp mô hình AI cục bộ...', 'Đang chuẩn bị môi trường thiết kế...'],
}

const INTRO_MS = 3900 // the intro has reached its last phase (credit shown, progress line running)
const FADE_MS = 550

/** Whether this launch shows the splash: not in automated QA (?splash=0, WebDriver), once per page load. */
export function splashWanted(): boolean {
  const q = new URLSearchParams(window.location.search)
  if (q.get('splash') === '0') return false
  if (q.get('splash') === '1') return true // QA recordings
  if (navigator.webdriver) return false
  return true
}

/**
 * App splash: the intro animation over the app while it starts. The start-up work is real — fonts, the
 * drawings stored in IndexedDB, the desktop host bridge and the local AI status — and the splash leaves
 * (soft fade into the Dashboard) only once the intro has played and the work is done. Click, Esc or Enter
 * skip the rest of the animation (not the work).
 */
export function SplashScreen({ onDone }: { onDone: () => void }) {
  const lang = useLang()
  const steps = STEPS[lang === 'vi' ? 'vi' : 'en']
  const [step, setStep] = useState(0)
  const [progress, setProgress] = useState(0)
  const [leaving, setLeaving] = useState(false)
  const workDone = useRef(false)
  const introDone = useRef(false)
  const still = document.documentElement.classList.contains('no-anim') || window.matchMedia('(prefers-reduced-motion: reduce)').matches

  const finish = () => {
    if (!workDone.current || !introDone.current || leaving) return
    setLeaving(true)
    setTimeout(onDone, FADE_MS)
  }
  const finishRef = useRef(finish)
  finishRef.current = finish

  useEffect(() => {
    document.getElementById('boot')?.remove() // the static first frame from index.html
    let live = true
    const run = async () => {
      // 1 — workspace: fonts and the stored drawings
      setStep(0)
      await Promise.all([
        document.fonts?.ready,
        useCad.persist.hasHydrated() ? null : new Promise<void>((r) => { const off = useCad.persist.onFinishHydration(() => { off(); r() }) }),
      ])
      if (!live) return
      setProgress(0.4)
      // 2 — local AI: the desktop host and the model status (the browser preview has neither)
      setStep(1)
      if (isDesktopHost()) {
        const host = await getHost()
        await host?.localAiStatus().catch(() => null)
      }
      if (!live) return
      setProgress(0.75)
      // 3 — design environment: the images the first screen shows
      setStep(2)
      await Promise.all(['/assets/branding/md-monogram.png', '/assets/branding/md-wordmark.png'].map((src) => new Promise((r) => { const im = new Image(); im.onload = im.onerror = r; im.src = src })))
      if (!live) return
      setProgress(1)
      workDone.current = true
      finishRef.current()
    }
    void run()
    const t = setTimeout(() => { introDone.current = true; finishRef.current() }, still ? 900 : INTRO_MS)
    const skip = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape' && e.key !== 'Enter') return
      introDone.current = true
      finishRef.current()
    }
    window.addEventListener('keydown', skip)
    window.addEventListener('pointerdown', skip)
    return () => {
      live = false
      clearTimeout(t)
      window.removeEventListener('keydown', skip)
      window.removeEventListener('pointerdown', skip)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <IntroScreen status={steps[step]} progress={progress} leaving={leaving} still={still} />
}
