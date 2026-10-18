// Minimal browser globals for unit tests that import the zustand stores in Node: an in-memory localStorage (so
// persist really writes and rehydrates) and the bits of `document` the stores touch. Import it FIRST.
const g = globalThis as unknown as Record<string, unknown>
// Node ≥ 22 defines a `localStorage` accessor that yields undefined without --localstorage-file: replace it
if (!g.localStorage) {
  const m = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() { return m.size },
  } })
}
// zustand persist reads window.localStorage; idbStorage listens on window
if (!g.window) g.window = globalThis
if (typeof g.addEventListener !== 'function') g.addEventListener = () => {}
if (!g.document) g.document = { documentElement: { lang: 'en' }, addEventListener: () => {}, visibilityState: 'visible', querySelector: () => null }
if (!g.navigator) g.navigator = { platform: 'MacIntel', language: 'en' }
export {}
