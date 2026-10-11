import { create } from 'zustand'
import type { Vec2 } from '../cad/types'
import type { SnapKind } from '../cad/geometry'

/** High-frequency pointer state, kept apart so only the status bar / overlay re-render. */
interface CursorState {
  world: Vec2
  snap: { p: Vec2; kind: SnapKind } | null
  /** Model viewport size in px (for the View section of Properties). */
  viewport: { w: number; h: number }
  set: (world: Vec2, snap: CursorState['snap']) => void
  setViewport: (w: number, h: number) => void
}

// Last pick point from the mockup's status bar.
export const useCursor = create<CursorState>()((set) => ({
  world: { x: 2450.372, y: 1820.691 },
  snap: null,
  viewport: { w: 839, h: 590 },
  set: (world, snap) => set({ world, snap }),
  setViewport: (w, h) => set({ viewport: { w, h } }),
}))
