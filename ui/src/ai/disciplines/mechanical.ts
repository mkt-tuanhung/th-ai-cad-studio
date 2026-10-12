import type { Discipline, Op, OpSpec } from '../discipline'
import { MATERIALS, designChecks, massOf, type MechModel } from '../../mech/model'
import { validateMech } from '../../state/mech'

export const mechAi: Discipline<MechModel> = {
  key: 'mechanical',
  role: 'mechanical design (centrifugal pump assembly)',
  ops: (m): OpSpec[] => [
    { op: 'setParameter', desc: 'change a driving parameter of the assembly (the 3D model, BOM and checks update)', args: { name: { kind: 'enum', values: m.params.map((p) => p.name) }, value: { kind: 'number', min: 0, max: 100000, desc: 'in the parameter unit, within its range' } } },
    { op: 'setMaterial', desc: 'change the material of a component', args: { component: { kind: 'enum', values: m.components.map((c) => c.id) }, material: { kind: 'enum', values: MATERIALS.map((x) => x.name) } } },
  ],
  context: (m) =>
    [
      'Parameters (name | value | unit | range | description):',
      ...m.params.map((p) => `${p.name} | ${p.value} | ${p.unit} | ${p.min}…${p.max} | ${p.description}`),
      'Components (id | file | material | mass kg):',
      ...m.components.map((c) => `${c.id} | ${c.file} | ${c.material} | ${massOf(c)?.toFixed(2) ?? '-'}`),
      `Materials (name | allowable MPa): ${MATERIALS.map((x) => `${x.name} ${x.allowable}`).join('; ')}`,
      'Design checks:',
      ...designChecks(m).map((c) => `${c.key}: ${c.tone} (${c.detail}) ${Object.entries(c.facts).map(([k, v]) => `${k}=${v}`).join(' ')}`),
    ].join('\n'),
  apply: (m, op: Op) => {
    const a = op as Record<string, unknown>
    if (op.op === 'setParameter') {
      const p = m.params.find((x) => x.name === a.name)!
      const v = a.value as number
      if (v < p.min || v > p.max) return { error: `${p.name} ${v} ${p.unit} outside ${p.min}…${p.max}` }
      return { model: { ...m, params: m.params.map((x) => (x.name === p.name ? { ...x, value: v } : x)) }, change: `${p.name}: ${p.value} → ${v} ${p.unit}` }
    }
    if (op.op === 'setMaterial') {
      const c = m.components.find((x) => x.id === a.component)!
      return { model: { ...m, components: m.components.map((x) => (x.id === c.id ? { ...x, material: a.material as string } : x)) }, change: `${c.file}: ${c.material} → ${a.material}` }
    }
    return { error: 'unknown operation' }
  },
  validate: validateMech,
  examples: [
    { request: 'Increase the shaft diameter to 45 mm', reply: { title: 'Shaft Ø45 mm', ops: [{ op: 'setParameter', name: 'Shaft_Dia', value: 45 }] } },
    { request: 'Add a second impeller stage', reply: { title: 'Adding stages is not possible — only parameters and materials can be changed', ops: [] } },
    { request: 'Đổi vật liệu vỏ bơm sang gang GG25', reply: { title: 'Vỏ bơm bằng gang GG25', ops: [{ op: 'setMaterial', component: 'casing', material: 'Cast Iron - GG25' }] } },
  ],
}
