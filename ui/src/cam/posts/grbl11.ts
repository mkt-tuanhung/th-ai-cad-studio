/**
 * GRBL 1.1 (gnea/grbl). UNVERIFIED. GRBL has no tool changer (M6 is an error), no G43 tool length offset (only
 * the dynamic G43.1) and no canned drill cycles: the post writes one program per tool, each starting with an M0
 * operator stop that says which tool to load and to zero Z on the board top before cycle start (GRBL cannot
 * jog while held, so Z cannot be re-zeroed in the middle of one program).
 */
import { BASE_CODES, cmt, f3, makePost } from './common'

export const grbl11 = makePost({
  id: 'grbl11',
  version: '1.0.0',
  label: 'GRBL 1.1',
  tlo: false,
  dialect: new Set([...BASE_CODES, 'G10', 'G28', 'G28.1', 'G30', 'G30.1', 'G38.2', 'G38.3', 'G38.4', 'G38.5', 'G43.1', 'G53', 'G61', 'G91.1', 'G92', 'G92.1', 'G93', 'M7']),
  perTool: () => true,
  style: () => ({
    modal: 'G21 G90 G17 G94',
    manualLoad: (t, head, clearZ) => [`M0 ${cmt(`LOAD T${t.n} ${t.name}${head ? ` ON ${head}` : ''}, ZERO Z ON THE BOARD TOP, THEN CYCLE START`)}`, `S${t.rpm} M3`, `G0 Z${f3(clearZ)}`],
    atcChange: () => [],
    end: [],
  }),
})
