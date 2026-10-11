import { getHost, type AiResult } from './host'

/** aiResult is a broadcast signal without request ids; requests are serialised, so FIFO is exact. */
const waiting: ((r: AiResult) => void)[] = []
let subscribed = false

import { ensureLoaded } from './nativeSync'
import type { CadDocument } from '../cad/types'

export async function requestNativeEdit(request: string, doc: CadDocument): Promise<AiResult> {
  const host = await getHost()
  if (!host) return { ok: false, message: 'no desktop host' }
  if (!subscribed) {
    host.on('aiResult', (r) => waiting.shift()?.(r as AiResult))
    subscribed = true
  }
  await ensureLoaded(doc) // engine holds exactly the drawing the user sees
  const result = new Promise<AiResult>((resolve) => waiting.push(resolve))
  await host.aiRequest(request)
  return result
}

export async function nativeAiReady(): Promise<boolean> {
  const host = await getHost()
  if (!host) return false
  return (await host.localAiStatus()).ready
}
