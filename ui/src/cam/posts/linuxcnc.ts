/**
 * LinuxCNC (RS274NGC). UNVERIFIED. With a verified ATC: `T n M6` then `G43 H n` after every tool change.
 * Without one: one program per tool, `(MSG, …)` + M0 asks the operator to load the tool, then `G43 H n` picks
 * its length from the tool table. Multi-spindle `$n` syntax is never written (it needs a verified firmware).
 */
import { BASE_CODES, cmt, f3, makePost } from './common'

export const linuxcnc = makePost({
  id: 'linuxcnc',
  version: '1.0.0',
  label: 'LinuxCNC',
  tlo: true,
  dialect: new Set([...BASE_CODES, 'G10', 'G28', 'G30', 'G41', 'G42', 'G43', 'G43.1', 'G53', 'G61', 'G64', 'G81', 'G82', 'G83', 'G85', 'G89', 'G91.1', 'G92', 'M6', 'M7', 'H']),
  perTool: (o) => !o.atc,
  style: (o) => ({
    modal: 'G21 G90 G17 G94 G40 G49 G80',
    manualLoad: (t, head, clearZ) =>
      o.atc
        ? [`T${t.n} M6 ${cmt(t.name)}`, `G43 H${t.n}`, `S${t.rpm} M3`, `G0 Z${f3(clearZ)}`]
        : [cmt(`MSG, LOAD T${t.n} ${t.name}${head ? ` ON ${head}` : ''}, CHECK TOOL LENGTH H${t.n}, THEN CYCLE START`), 'M0', `G43 H${t.n}`, `S${t.rpm} M3`, `G0 Z${f3(clearZ)}`],
    atcChange: (t, clearZ) => [`T${t.n} M6 ${cmt(t.name)}`, `G43 H${t.n}`, `S${t.rpm} M3`, `G0 Z${f3(clearZ)}`],
    end: ['G49'],
  }),
})
