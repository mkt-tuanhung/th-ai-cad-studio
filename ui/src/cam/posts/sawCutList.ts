/**
 * Panel (beam) saw "post": a PANEL_SAW profile gets cutting patterns + a cut-sequence list (cam/guillotine.ts),
 * never router NC. Rendering router IR with it writes nothing and blocks, so a saw post on a router profile can
 * never produce a program. UNVERIFIED until a panel saw profile is commissioned.
 */
import { hashOf } from '../../lib/sha256'
import type { Post } from './common'

export const sawCutList: Post = {
  id: 'saw_cutlist',
  version: '1.0.0',
  label: 'Panel saw: cutting patterns + cut list (CSV / SVG)',
  status: 'UNVERIFIED',
  dialect: new Set(),
  tlo: false,
  noNc: true,
  sha256: hashOf({ id: 'saw_cutlist', version: '1.0.0', format: 'MDCAD-SAW-CSV-1' }),
  render: () => ({ programs: [], issues: ['SAW_CUTLIST_POST_WRITES_NO_NC'] }),
}
