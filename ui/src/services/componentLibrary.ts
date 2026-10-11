/** Component (block / family / part) library stats. Demo values until the native library index exists. */
export interface LibraryStats {
  source: 'demo' | 'native'
  total: number
  addedRecently: number
}

export async function getLibraryStats(): Promise<LibraryStats> {
  return { source: 'demo', total: 12580, addedRecently: 420 }
}
