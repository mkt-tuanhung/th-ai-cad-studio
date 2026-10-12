/**
 * Microphone recording for local Whisper: 16 kHz mono PCM (the browser resamples), written as a WAV file.
 * The audio stays in memory and goes only to the desktop host, which deletes its temporary copy after the run.
 */

export interface Recording {
  wav: Uint8Array
  seconds: number
  /** Root-mean-square level 0…1 — near 0 means silence (nothing is sent). */
  rms: number
}

export interface Recorder {
  stop: () => Promise<Recording>
}

const RATE = 16000
const WORKLET = `registerProcessor('thcad-tap', class extends AudioWorkletProcessor {
  process(inputs) { const c = inputs[0] && inputs[0][0]; if (c) this.port.postMessage(c.slice(0)); return true }
})`

export async function startRecording(): Promise<Recorder> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } })
  const ctx = new AudioContext({ sampleRate: RATE })
  const src = ctx.createMediaStreamSource(stream)
  const chunks: Float32Array[] = []
  const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }))
  await ctx.audioWorklet.addModule(url)
  URL.revokeObjectURL(url)
  const tap = new AudioWorkletNode(ctx, 'thcad-tap')
  tap.port.onmessage = (e) => chunks.push(e.data as Float32Array)
  src.connect(tap)
  return {
    stop: async () => {
      src.disconnect()
      tap.disconnect()
      stream.getTracks().forEach((t) => t.stop())
      const rate = ctx.sampleRate
      await ctx.close()
      const n = chunks.reduce((a, c) => a + c.length, 0)
      const pcm = new Float32Array(n)
      let o = 0
      for (const c of chunks) (pcm.set(c, o), (o += c.length))
      let sum = 0
      for (let i = 0; i < n; i++) sum += pcm[i] * pcm[i]
      return { wav: wavOf(pcm, rate), seconds: n / rate, rms: n ? Math.sqrt(sum / n) : 0 }
    },
  }
}

/** PCM16 mono WAV. */
export function wavOf(pcm: Float32Array, rate: number): Uint8Array {
  const buf = new ArrayBuffer(44 + pcm.length * 2)
  const v = new DataView(buf)
  const str = (o: number, s: string) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)))
  str(0, 'RIFF')
  v.setUint32(4, 36 + pcm.length * 2, true)
  str(8, 'WAVE')
  str(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true) // PCM
  v.setUint16(22, 1, true) // mono
  v.setUint32(24, rate, true)
  v.setUint32(28, rate * 2, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  str(36, 'data')
  v.setUint32(40, pcm.length * 2, true)
  for (let i = 0; i < pcm.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i])) * 0x7fff, true)
  return new Uint8Array(buf)
}
