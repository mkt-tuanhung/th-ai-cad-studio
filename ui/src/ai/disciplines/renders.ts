import type { Discipline, Op, OpSpec } from '../discipline'
import type { RenderDoc } from '../../state/renders'
import { validateRender } from '../../state/renders'
import type { CustomVariation } from '../../renders/model'

/**
 * Render look variations: the local model proposes lighting / post-processing variants (sky, sun position and
 * strength, exposure, contrast, saturation, colour temperature). Approved variants join the Variations strip;
 * applying one changes the render settings (undoable) and a desktop preview render gives it a real thumbnail.
 */
export const rendersAi: Discipline<RenderDoc> = {
  key: 'renders',
  role: 'architectural visualisation (render lighting and look)',
  ops: (): OpSpec[] => [
    {
      op: 'addVariation',
      desc: 'add one lighting / look variation of the current render',
      args: {
        name: { kind: 'string', desc: 'short name, e.g. "Golden hour"' },
        sky: { kind: 'enum', values: ['clear', 'overcast', 'studio', 'night'] },
        sunAzimuth: { kind: 'number', min: 0, max: 360, unit: '°', desc: 'compass direction the sun comes from (90 east, 180 south, 270 west)' },
        sunElevation: { kind: 'number', min: 2, max: 85, unit: '°', desc: 'sun height; 5–15 for golden hour, 40–70 for midday' },
        sunIntensity: { kind: 'number', min: 0, max: 5, desc: '0 = no sun' },
        exposure: { kind: 'number', min: -2, max: 2, unit: 'EV' },
        contrast: { kind: 'number', min: 50, max: 150, unit: '%' },
        saturation: { kind: 'number', min: 0, max: 200, unit: '%' },
        temperature: { kind: 'number', min: -100, max: 100, desc: 'negative cool / blue, positive warm / orange' },
      },
    },
  ],
  context: (d) =>
    [
      `Current: sky ${d.settings.hdri}, sun ${d.settings.sunSky ? 'on' : 'off'} intensity ${d.settings.sunIntensity}, sun direction ${d.settings.sunDirection}°, elevation ${d.settings.sunElevation ?? 40}°`,
      `Post: exposure ${d.fx.exposure} EV, contrast ${d.fx.contrast} %, saturation ${d.fx.saturation} %, temperature ${d.fx.temperature}`,
      `Cameras: ${d.cameras.map((c) => `${c.name} (${c.kind})`).join(', ')}`,
      `Existing custom variations: ${(d.custom ?? []).map((v) => v.name).join(', ') || 'none'}`,
    ].join('\n'),
  apply: (d, op: Op) => {
    if (op.op !== 'addVariation') return { error: 'unknown operation' }
    const a = op as unknown as Omit<CustomVariation, 'id' | 'preview'>
    const name = String(a.name ?? '').trim().slice(0, 40)
    if (!name) return { error: 'a variation needs a name' }
    if ((d.custom ?? []).some((v) => v.name.toLowerCase() === name.toLowerCase())) return { error: `“${name}” already exists` }
    const v: CustomVariation = { id: `var-${Date.now().toString(36)}-${(d.custom ?? []).length}`, name, sky: a.sky, sunAzimuth: a.sunAzimuth, sunElevation: a.sunElevation, sunIntensity: a.sunIntensity, exposure: a.exposure, contrast: a.contrast, saturation: a.saturation, temperature: a.temperature }
    return { model: { ...d, custom: [...(d.custom ?? []), v] }, change: `${name}: ${a.sky} sky, sun ${Math.round(a.sunAzimuth)}° / ${Math.round(a.sunElevation)}° × ${a.sunIntensity}, ${a.exposure >= 0 ? '+' : ''}${a.exposure} EV, temperature ${a.temperature}` }
  },
  validate: (d) => validateRender(d),
  examples: [
    { request: 'Give me a golden hour and a blue hour version', reply: { title: 'Golden hour and blue hour', ops: [
      { op: 'addVariation', name: 'Golden hour', sky: 'clear', sunAzimuth: 255, sunElevation: 8, sunIntensity: 1.6, exposure: 0.3, contrast: 110, saturation: 115, temperature: 45 },
      { op: 'addVariation', name: 'Blue hour', sky: 'night', sunAzimuth: 270, sunElevation: 2, sunIntensity: 0, exposure: 0.8, contrast: 105, saturation: 90, temperature: -45 },
    ] } },
    { request: 'Một phương án trời nhiều mây dịu', reply: { title: 'Trời nhiều mây dịu', ops: [{ op: 'addVariation', name: 'Soft overcast', sky: 'overcast', sunAzimuth: 180, sunElevation: 45, sunIntensity: 0, exposure: 0.4, contrast: 90, saturation: 95, temperature: -10 }] } },
    { request: 'Make the building blue', reply: { title: 'Changing the building colour is not a lighting variation — only sky, sun and post-processing can be varied', ops: [] } },
  ],
}
