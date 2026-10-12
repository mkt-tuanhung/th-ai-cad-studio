/**
 * Voice CAD (desktop): on-device speech recognition from the host (macOS Speech framework on-device only /
 * Windows SAPI dictation). The transcript goes into the composer for the user to read and send — speech never
 * triggers an edit by itself.
 */
import { useEffect, useRef, useState } from 'react'
import { getHost, type HostApi } from '../services/host'

let attached: HostApi | null = null
const listeners = new Set<(r: { text: string; final: boolean; error?: string }) => void>()

export function useVoice(locale: string, onText: (text: string, final: boolean) => void, onError: (why: string) => void, onFallback?: (used: string, why: string) => void) {
  const [listening, setListening] = useState(false)
  const cb = useRef({ onText, onError })
  cb.current = { onText, onError }
  useEffect(() => {
    const fn = (r: { text: string; final: boolean; error?: string }) => {
      if (r.error) {
        cb.current.onError(r.error)
        setListening(false)
        return
      }
      if (r.text) cb.current.onText(r.text, r.final)
      if (r.final) setListening(false)
    }
    listeners.add(fn)
    return () => {
      listeners.delete(fn)
    }
  }, [])
  const toggle = async () => {
    const host = await getHost()
    if (!host) return onError('browser')
    if (attached !== host) {
      attached = host
      host.on('voiceText', (p) => listeners.forEach((l) => l(p as { text: string; final: boolean; error?: string })))
    }
    if (listening) {
      await host.voiceStop()
      return
    }
    let use = locale
    const a = await host.voiceAvailability(locale)
    if (!a.available || !a.onDevice) {
      // e.g. no on-device Vietnamese model: listen in English instead of sending audio anywhere
      const en = locale === 'en-US' ? a : await host.voiceAvailability('en-US')
      if (!en.available || !en.onDevice) return onError(a.reason)
      use = 'en-US'
      onFallback?.(use, a.reason)
    }
    setListening(true)
    await host.voiceStart(use)
  }
  return { listening, toggle }
}
