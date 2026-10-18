/**
 * NcStudio-style (Weihong and similar OEM controllers). UNVERIFIED. OEM controllers differ per build: the post
 * may only use codes that the machine profile lists in controller.supported_codes (verified on that controller).
 * Any other code it would need is reported and blocks the export. T… M6 only with an ATC AND M6 in the profile;
 * G43 only when the profile lists it. Head activation codes are never guessed.
 */
import { BASE_CODES, cmt, f3, makePost, type PostOptions } from './common'

const has = (o: PostOptions, c: string) => !!o.supportedCodes?.includes(c)

export const ncstudio = makePost({
  id: 'ncstudio',
  version: '1.0.0',
  label: 'NcStudio-style (OEM codes from the profile)',
  tlo: true,
  profileStrict: true,
  dialect: new Set([...BASE_CODES, 'G28', 'G43', 'M6', 'H']),
  perTool: (o) => !(o.atc && has(o, 'M6')),
  style: (o) => {
    const tlo = (n: number, z: number) => (has(o, 'G43') ? `G0 G43 H${n} Z${f3(z)}` : `G0 Z${f3(z)}`)
    return {
      modal: 'G21 G90 G17',
      manualLoad: (t, head, clearZ) =>
        o.atc && has(o, 'M6') ? [`T${t.n} M6 ${cmt(t.name)}`, `S${t.rpm} M3`, tlo(t.n, clearZ)] : [`M0 ${cmt(`LOAD T${t.n} ${t.name}${head ? ` ON ${head}` : ''}, SET Z ZERO / TOOL LENGTH, THEN START`)}`, `S${t.rpm} M3`, tlo(t.n, clearZ)],
      atcChange: (t, clearZ) => [`T${t.n} M6 ${cmt(t.name)}`, `S${t.rpm} M3`, tlo(t.n, clearZ)],
      end: has(o, 'G49') ? ['G49'] : [],
    }
  },
})
