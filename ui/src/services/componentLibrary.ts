import { libraryStats, useLibrary } from '../state/library'

/** Component library stats — computed from the real built-in library plus your uploads. */
export interface LibraryStats {
  source: 'demo' | 'native'
  total: number
  addedRecently: number
}

export async function getLibraryStats(): Promise<LibraryStats> {
  const s = libraryStats(useLibrary.getState().uploads)
  return { source: 'native', ...s }
}
