/**
 * ISO 6983 generic (Fanuc-style). UNVERIFIED. With a verified ATC: `T n M6`, then `G0 G43 H n Z…` after EVERY
 * tool change (the tool length offset is never left to the previous tool). Without an ATC: one program per tool,
 * an M0 operator stop to load it, then `G43 H n`. No canned cycles (drilling is written as explicit moves).
 */
import { BASE_CODES, cmt, f3, makePost } from './common'

export const isoGeneric = makePost({
  id: 'iso_generic',
  version: '1.0.0',
  label: 'ISO generic (Fanuc-style)',
  tlo: true,
  dialect: new Set([...BASE_CODES, 'G28', 'G41', 'G42', 'G43', 'M6', 'H']),
  perTool: (o) => !o.atc,
  style: (o) => ({
    modal: 'G21 G90 G17 G94 G40 G49 G80',
    manualLoad: (t, head, clearZ) =>
      o.atc
        ? [`T${t.n} M6 ${cmt(t.name)}`, `S${t.rpm} M3`, `G0 G43 H${t.n} Z${f3(clearZ)}`]
        : [`M0 ${cmt(`LOAD T${t.n} ${t.name}${head ? ` ON ${head}` : ''}, SET TOOL LENGTH H${t.n}, THEN CYCLE START`)}`, `S${t.rpm} M3`, `G0 G43 H${t.n} Z${f3(clearZ)}`],
    atcChange: (t, clearZ) => [`T${t.n} M6 ${cmt(t.name)}`, `S${t.rpm} M3`, `G0 G43 H${t.n} Z${f3(clearZ)}`],
    end: ['G49'],
  }),
})
