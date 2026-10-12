/**
 * Voice CAD (desktop). Preferred: local Whisper (whisper.cpp large-v3-turbo, Vietnamese and English) — the
 * page records the microphone, the host transcribes it with the bundled helper; nothing leaves the computer.
 * Without a Whisper model: the system's on-device recognizer (macOS Speech on-device only / Windows SAPI).
 * The transcript goes into the composer for the user to read and send — speech never triggers an edit by itself.
 */
import { useEffect, useRef, useState } from 'react'
import { getHost, type HostApi } from '../services/host'
import { toBase64 } from '../services/dwg'
import { startRecording, type Recorder } from './recorder'

let attached: HostApi | null = null
const listeners = new Set<(r: { text: string; final: boolean; error?: string }) => void>()
const transcripts = new Map<string, (r: { ok: boolean; text: string; ms: number; error?: string }) => void>()
let seq = 0

/** Quieter than this (RMS) is treated as silence: Whisper is not run on it (it would invent words). */
const SILENCE = 0.004
const MAX_SECONDS = 60

export function useVoice(locale: string, onText: (text: string, final: boolean) => void, onError: (why: string) => void, onFallback?: (used: string, why: string) => void, onState?: (s: 'whisper' | 'transcribing' | 'silence', info?: { ms?: number; model?: string }) => void) {
  const [listening, setListening] = useState(false)
  const [busy, setBusy] = useState(false)
  const rec = useRef<Recorder | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cb = useRef({ onText, onError, onState })
  cb.current = { onText, onError, onState }
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

  const attach = (host: HostApi) => {
    if (attached === host) return
    attached = host
    host.on('voiceText', (p) => listeners.forEach((l) => l(p as { text: string; final: boolean; error?: string })))
    host.on('voiceTranscript', (p) => {
      const r = p as { id: string; ok: boolean; text: string; ms: number; error?: string }
      transcripts.get(r.id)?.(r)
      transcripts.delete(r.id)
    })
  }

  /** Stops the Whisper recording and transcribes it. */
  const finish = async (host: HostApi) => {
    if (timer.current) clearTimeout(timer.current)
    const r = rec.current
    rec.current = null
    setListening(false)
    if (!r) return
    const audio = await r.stop()
    if (audio.rms < SILENCE || audio.seconds < 0.3) return cb.current.onState?.('silence')
    setBusy(true)
    cb.current.onState?.('transcribing')
    const id = `v${Date.now()}-${seq++}`
    const res = await new Promise<{ ok: boolean; text: string; ms: number; error?: string }>((resolve) => {
      transcripts.set(id, resolve)
      void host.voiceTranscribe(id, toBase64(audio.wav), locale.startsWith('vi') ? 'vi' : locale.startsWith('en') ? 'en' : 'auto')
    })
    setBusy(false)
    if (!res.ok) return cb.current.onError(res.error ?? 'whisper')
    if (res.text) cb.current.onText(res.text, true)
    else cb.current.onState?.('silence')
  }

  const toggle = async () => {
    const host = await getHost()
    if (!host) return onError('browser')
    attach(host)
    if (busy) return
    if (rec.current) return finish(host)
    if (listening) {
      await host.voiceStop()
      return
    }
    // 1) local Whisper
    const w = await host.whisperStatus()
    if (w.available) {
      try {
        rec.current = await startRecording()
      } catch (e) {
        return onError((e as Error).message || 'microphone')
      }
      setListening(true)
      void host.voiceWarmup() // GPU kernels compile while the user speaks (first use of a new install)
      cb.current.onState?.('whisper', { model: w.model })
      timer.current = setTimeout(() => void finish(host), MAX_SECONDS * 1000)
      return
    }
    // 2) the system recognizer, on-device only
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
  return { listening, busy, toggle }
}
