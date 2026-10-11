/**
 * Local AI runtime boundary.
 *
 * The production runtime is native (llama.cpp / MLX, in-process, Metal) and is reached through the
 * desktop host bridge — never a cloud API, never a user-installed Python/Ollama. This UI prototype
 * has no runtime attached, so it uses `demoLocalAi`, whose numbers reproduce the approved mockup.
 * Anything sourced from it is flagged `source: 'demo'` so it can never be mistaken for telemetry.
 */
import { getHost } from './host'

export interface LocalAiStatus {
  source: 'demo' | 'native'
  online: boolean
  ready: boolean
  /** null = no model installed (native only). */
  modelName: string | null
  vramUsedGb: number
  vramTotalGb: number
  /** null = not measured yet (no generation has run). */
  responseSeconds: number | null
}

export interface AiActivityStats {
  source: 'demo' | 'native'
  suggestionsTotal: number
  suggestionsToday: number
}

export interface LocalAiRuntime {
  status(): Promise<LocalAiStatus>
  activity(): Promise<AiActivityStats>
}

export const demoLocalAi: LocalAiRuntime = {
  async status() {
    return {
      source: 'demo',
      online: true,
      ready: true,
      modelName: 'AutoCAD Assistant (Local)',
      vramUsedGb: 6.2,
      vramTotalGb: 16,
      responseSeconds: 0.8,
    }
  },
  async activity() {
    return { source: 'demo', suggestionsTotal: 248, suggestionsToday: 12 }
  },
}

/** Native runtime (measured values) inside the desktop app; demo values in a plain browser. */
const nativeOrDemo: LocalAiRuntime = {
  async status() {
    const host = await getHost()
    if (!host) return demoLocalAi.status()
    const s = await host.localAiStatus()
    return {
      source: 'native',
      online: s.online,
      ready: s.ready,
      modelName: s.modelName,
      vramUsedGb: Math.round(s.vramUsedGb * 10) / 10,
      vramTotalGb: Math.round(s.vramTotalGb),
      responseSeconds: s.responseSeconds === null ? null : Math.round(s.responseSeconds * 10) / 10,
    }
  },
  // Suggestion counters are not tracked by the native runtime yet → still demo data.
  activity: () => demoLocalAi.activity(),
}

export function getLocalAi(): LocalAiRuntime {
  return nativeOrDemo
}
