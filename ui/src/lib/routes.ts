import type { Route } from '../state/router'
import type { Discipline } from '../state/workspace'

/** Which workspace opens a project of a given discipline. */
export function routeForDiscipline(d: Discipline): Route {
  switch (d) {
    case 'bim':
      return 'bim'
    case 'mechanical':
      return 'mechanical'
    case 'interior':
      return 'interior'
    case 'mep':
      return 'mep'
    case 'civil':
      return 'civil'
    default:
      return 'cad2d'
  }
}
