import { useEffect, type RefObject } from 'react'
import { getHost } from '../services/host'

/**
 * Option A: reports where a viewport slot is on screen so the desktop host can place its native
 * viewer (OCCT) exactly over it. No-op in a plain browser.
 */
export function useNativeSlot(ref: RefObject<HTMLElement | null>, kind: string, active = true) {
  useEffect(() => {
    let disposed = false
    let host: Awaited<ReturnType<typeof getHost>> = null
    const report = () => {
      const el = ref.current
      if (!host || !host.nativeViewport || !el) return
      const r = el.getBoundingClientRect()
      host.setViewportSlot(kind, r.left, r.top, r.width, r.height, active && !disposed)
    }
    const ro = new ResizeObserver(report)
    getHost().then((h) => {
      host = h
      if (!h?.nativeViewport || disposed) return
      if (ref.current) ro.observe(ref.current)
      window.addEventListener('resize', report)
      report()
    })
    return () => {
      disposed = true
      ro.disconnect()
      window.removeEventListener('resize', report)
      if (host?.nativeViewport) host.setViewportSlot(kind, 0, 0, 0, 0, false)
    }
  }, [ref, kind, active])
}
