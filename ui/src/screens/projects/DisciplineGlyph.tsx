import { Armchair, Box, Building2, Settings } from 'lucide-react'
import type { Discipline } from '../../state/workspace'
import { PeaksIcon, PipeIcon } from '../../components/icons'

/** Neutral thumbnail for projects without a cover image (no stock art, no fake renders). */
export function DisciplineGlyph({ discipline }: { discipline: Discipline }) {
  const p = { size: 30, strokeWidth: 1.4 }
  switch (discipline) {
    case 'bim':
      return <Box {...p} />
    case 'mechanical':
      return <Settings {...p} />
    case 'interior':
      return <Armchair {...p} />
    case 'mep':
      return <PipeIcon {...p} />
    case 'civil':
      return <PeaksIcon {...p} />
    default:
      return <Building2 {...p} />
  }
}
