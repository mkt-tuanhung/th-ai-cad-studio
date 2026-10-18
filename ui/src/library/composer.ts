/**
 * "Tự vẽ" — a simple parametric composer of furniture pieces from parts (box, rounded box, cylinder) with a size,
 * a position and a finish. Item-local mm, the interior convention: origin = footprint centre at the bottom, front
 * −Y, back +Y. The live 3D preview uses the OCCT scene primitives; renders (Blender) build the same parts with
 * bevelled edges and the mapped PBR materials.
 *
 * Presets are parametric: `make(w, d, h)` returns parts that fill exactly that W × D × H, so a preset placed for a
 * plan item (or used by the renderer for an item no library model fits) has the item's real size.
 */
import { boxAt, vcyl, type Prim } from '../engine3d/scene'
import { composedDims, type ComposedPart, type LibAsset, type LibCategory } from './assets'

const P = (shape: ComposedPart['shape'], x: number, y: number, z: number, w: number, d: number, h: number, material: string, name: string, r?: number): ComposedPart => ({
  shape, x: Math.round(x), y: Math.round(y), z: Math.round(z), w: Math.round(w), d: Math.round(d), h: Math.round(h), material, name, ...(r !== undefined ? { r: Math.round(r) } : {}),
})

export interface Preset {
  key: string
  vi: string
  en: string
  category: LibCategory
  size: { w: number; d: number; h: number }
  make: (w: number, d: number, h: number) => ComposedPart[]
}

const FAB = 'Fabric - Beige', LIN = 'Fabric - Linen', TAUPE = 'Fabric - Taupe', OAK = 'Wood - Oak', WAL = 'Wood - Walnut', BLK = 'Metal - Black', MAR = 'Marble - White'

export const PRESETS: Preset[] = [
  {
    key: 'sofa', vi: 'Sofa văng', en: 'Sofa', category: 'sofa', size: { w: 2200, d: 900, h: 800 },
    make: (w, d, h) => {
      const leg = 70, arm = Math.min(200, w * 0.09), seatH = 420, back = Math.min(220, d * 0.25)
      const inner = w - 2 * arm, n = inner > 1800 ? 3 : 2
      const parts = [
        P('rbox', 0, 0, leg, w, d, seatH - 120 - leg, FAB, 'base', 30),
        P('rbox', 0, d / 2 - back / 2, leg, w, back, h - leg, FAB, 'back', 60),
        P('rbox', -w / 2 + arm / 2, 0, leg, arm, d, Math.min(h - 140, 620) - leg, FAB, 'arm L', 60),
        P('rbox', w / 2 - arm / 2, 0, leg, arm, d, Math.min(h - 140, 620) - leg, FAB, 'arm R', 60),
      ]
      for (let k = 0; k < n; k++) parts.push(P('rbox', -inner / 2 + (inner / n) * (k + 0.5), -back / 2, seatH - 120, inner / n - 10, d - back - 10, 130, FAB, `seat ${k + 1}`, 55))
      for (let k = 0; k < n; k++) parts.push(P('rbox', -inner / 2 + (inner / n) * (k + 0.5), d / 2 - back - 90, seatH, inner / n - 30, 170, Math.min(h - seatH - 30, 420), FAB, `cushion ${k + 1}`, 70))
      for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) parts.push(P('cyl', sx * (w / 2 - 80), sy * (d / 2 - 80), 0, 40, 40, leg, BLK, 'leg'))
      return parts
    },
  },
  {
    key: 'armchair', vi: 'Ghế bành', en: 'Armchair', category: 'armchair', size: { w: 850, d: 850, h: 800 },
    make: (w, d, h) => {
      const leg = 120, arm = Math.min(150, w * 0.16), back = Math.min(180, d * 0.22)
      return [
        P('rbox', 0, 0, leg, w, d, 300, TAUPE, 'base', 40),
        P('rbox', 0, d / 2 - back / 2, leg, w, back, h - leg, TAUPE, 'back', 60),
        P('rbox', -w / 2 + arm / 2, -back / 2, leg, arm, d - back, Math.min(h - 160, 600) - leg, TAUPE, 'arm L', 55),
        P('rbox', w / 2 - arm / 2, -back / 2, leg, arm, d - back, Math.min(h - 160, 600) - leg, TAUPE, 'arm R', 55),
        P('rbox', 0, -back / 2, leg + 300, w - 2 * arm - 10, d - back - 10, 120, TAUPE, 'seat', 50),
        ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sy]) => P('cyl', sx * (w / 2 - 60), sy * (d / 2 - 60), 0, 36, 36, leg, OAK, 'leg')),
      ]
    },
  },
  {
    key: 'chair', vi: 'Ghế ăn', en: 'Dining chair', category: 'chair', size: { w: 480, d: 540, h: 820 },
    make: (w, d, h) => [
      ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sy]) => P('box', sx * (w / 2 - 30), sy * (d / 2 - 30), 0, 34, 34, 440, OAK, 'leg')),
      P('rbox', 0, 0, 440, w, d, 60, TAUPE, 'seat', 20),
      P('rbox', 0, d / 2 - 25, 500, w - 20, 40, h - 500, OAK, 'back', 15),
    ],
  },
  {
    key: 'coffeeTable', vi: 'Bàn trà', en: 'Coffee table', category: 'coffeeTable', size: { w: 1200, d: 650, h: 400 },
    make: (w, d, h) => [
      P('rbox', 0, 0, h - 40, w, d, 40, MAR, 'top', 12),
      P('box', 0, 0, 0, w - 160, d - 160, h - 40, WAL, 'body'),
    ],
  },
  {
    key: 'diningTable', vi: 'Bàn ăn', en: 'Dining table', category: 'diningTable', size: { w: 1800, d: 900, h: 750 },
    make: (w, d, h) => [
      P('rbox', 0, 0, h - 40, w, d, 40, OAK, 'top', 10),
      ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sy]) => P('box', sx * (w / 2 - 90), sy * (d / 2 - 90), 0, 60, 60, h - 40, OAK, 'leg')),
    ],
  },
  {
    key: 'bed', vi: 'Giường bọc nệm', en: 'Upholstered bed', category: 'bed', size: { w: 1600, d: 2000, h: 1000 },
    make: (w, d, h) => {
      const base = 300, mat = 220, head = Math.max(h, 950)
      const md = d - 100
      return [
        P('rbox', 0, -50, 0, w, d - 100, base, TAUPE, 'frame', 25),
        P('rbox', 0, d / 2 - 50, 0, w + 60, 100, head, TAUPE, 'headboard', 35),
        P('rbox', 0, -50, base, w - 60, md - 40, mat, LIN, 'mattress', 60),
        P('rbox', 0, -d / 2 + 5 + md * 0.31, base + mat - 60, w - 20, md * 0.62, 110, LIN, 'duvet', 50),
        P('rbox', 0, -d / 2 + 5 + 230, base + mat + 40, w + 10, 460, 40, 'Fabric - Olive', 'throw', 18),
        P('rbox', -w / 4 + 10, d / 2 - 100 - 260, base + mat - 10, w / 2 - 150, 380, 150, LIN, 'pillow L', 70),
        P('rbox', w / 4 - 10, d / 2 - 100 - 260, base + mat - 10, w / 2 - 150, 380, 150, LIN, 'pillow R', 70),
      ]
    },
  },
  {
    key: 'nightstand', vi: 'Tab đầu giường', en: 'Nightstand', category: 'nightstand', size: { w: 450, d: 400, h: 550 },
    make: (w, d, h) => [
      P('rbox', 0, 0, 120, w, d, h - 120, WAL, 'body', 8),
      P('box', 0, -d / 2 - 2, 120 + (h - 120) / 2 - 4, w - 40, 4, 8, BLK, 'handle'),
      ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sy]) => P('cyl', sx * (w / 2 - 40), sy * (d / 2 - 40), 0, 24, 24, 120, BLK, 'leg')),
    ],
  },
  {
    key: 'kitchen', vi: 'Đảo bếp', en: 'Kitchen island', category: 'kitchen', size: { w: 2000, d: 900, h: 900 },
    make: (w, d, h) => [
      P('box', 0, 0, 0, w - 40, d - 40, 100, BLK, 'plinth'),
      P('rbox', 0, 0, 100, w - 20, d - 30, h - 140, WAL, 'body', 4),
      P('rbox', 0, 0, h - 40, w, d, 40, MAR, 'top', 6),
    ],
  },
  {
    key: 'shelf', vi: 'Kệ sách', en: 'Bookshelf', category: 'shelf', size: { w: 1000, d: 350, h: 2000 },
    make: (w, d, h) => {
      const t = 25, n = Math.max(2, Math.round(h / 380))
      const parts = [P('box', -w / 2 + t / 2, 0, 0, t, d, h, OAK, 'side L'), P('box', w / 2 - t / 2, 0, 0, t, d, h, OAK, 'side R'), P('box', 0, d / 2 - 6, 0, w - 2 * t, 12, h, OAK, 'back')]
      for (let k = 0; k <= n; k++) parts.push(P('box', 0, 0, Math.min(h - t, (k * (h - t)) / n), w - 2 * t, d, t, OAK, `shelf ${k}`))
      return parts
    },
  },
  {
    key: 'tv', vi: 'Tivi treo tường', en: 'Wall TV', category: 'decor', size: { w: 1450, d: 60, h: 830 },
    make: (w, d, h) => [P('rbox', 0, 0, 0, w, d, h, BLK, 'screen', 6)],
  },
  {
    key: 'rug', vi: 'Thảm', en: 'Rug', category: 'rug', size: { w: 2400, d: 1700, h: 12 },
    make: (w, d, h) => [P('rbox', 0, 0, 0, w, d, Math.max(6, h), FAB, 'rug', 4)],
  },
  {
    key: 'pendant', vi: 'Đèn thả', en: 'Pendant lamp', category: 'pendant', size: { w: 400, d: 400, h: 300 },
    make: (w, d, h) => [P('cyl', 0, 0, 0, w, d, h * 0.6, 'Metal - Brass', 'shade'), P('cyl', 0, 0, h * 0.6, 10, 10, h * 0.4, BLK, 'cord')],
  },
]

export const presetByKey = (k: string | undefined) => PRESETS.find((p) => p.key === k)

/** Built-in presets as library entries (not on disk): the renderer's fallback for items no model fits. */
export function presetAssets(): LibAsset[] {
  return PRESETS.filter((p) => p.key !== 'tv').map((p) => ({
    id: `preset-${p.key}`, kind: 'model', name: p.en, nameVi: p.vi, category: p.category, tags: ['preset', 'modern'], dims: p.size, files: {}, dir: 'presets',
    source: { site: 'MD CAD AI STUDIO' }, license: 'MD CAD AI STUDIO', addedAt: 0, origin: 'builtin-preset', parts: p.make(p.size.w, p.size.d, p.size.h), style: ['modern'],
  }))
}

/** Parts of a composed asset for a W × D × H box: a preset is rebuilt at that size, other compositions scale uniformly. */
export function partsFor(a: LibAsset, w: number, d: number, h: number): ComposedPart[] {
  const pre = a.origin === 'builtin-preset' ? presetByKey(a.id.replace(/^preset-/, '')) : undefined
  if (pre) return pre.make(w, d, h)
  const parts = a.parts ?? []
  const m = composedDims(parts)
  if (!(m.w > 0 && m.d > 0 && m.h > 0)) return parts
  const s = Math.min(w / m.w, d / m.d, h / m.h)
  return parts.map((p) => ({ ...p, x: p.x * s, y: p.y * s, z: p.z * s, w: p.w * s, d: p.d * s, h: p.h * s, ...(p.r !== undefined ? { r: p.r * s } : {}) }))
}

/** OCCT primitives of composed parts placed at (x, y, rot) on the floor (+ elevation) — the live 3D preview. */
export function composedPrims(parts: ComposedPart[], at: { x: number; y: number; rot: number }, elev = 0): Prim[] {
  const a = (at.rot * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a)
  return parts.map((p) => {
    const cx = at.x + p.x * c - p.y * s, cy = at.y + p.x * s + p.y * c
    return p.shape === 'cyl' ? vcyl(cx, cy, elev + p.z, Math.max(p.w, p.d) / 2, p.h) : boxAt(cx, cy, elev + p.z, p.w, p.d, p.h, at.rot)
  })
}

/** Validation of a composition before it is saved (sizes, at least one part, nothing below the floor). */
export function validateParts(parts: ComposedPart[]): string | null {
  if (!parts.length) return 'parts'
  for (const p of parts) if (!(p.w > 0 && p.d > 0 && p.h > 0) || p.z < 0 || p.w > 10000 || p.d > 10000 || p.h > 6000) return 'size'
  const d = composedDims(parts)
  return d.w > 10000 || d.d > 10000 || d.h > 6000 ? 'size' : null
}
