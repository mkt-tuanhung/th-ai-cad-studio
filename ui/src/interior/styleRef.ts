/**
 * "Ảnh mẫu → phong cách nội thất" (v2.4): what a set of reference photos says about an interior style, as data the
 * app can apply — style, palette, a finish per surface (app finishes, each served by a library PBR texture),
 * furniture categories with hints, lighting mood, confidence, a short Vietnamese description.
 *
 * Two readers fill the same StyleAnalysis:
 *   - the local vision-language model (Qwen2.5-VL via the llama-mtmd-cli helper): its answer is constrained by the
 *     GBNF grammar below to the ids that exist here, then validated again (parseModelAnswer) — nothing it says is
 *     trusted without the check;
 *   - the basic reader (no model installed): palette + colour / texture statistics only, clearly labelled
 *     "phân tích cơ bản (chưa cài mô hình AI đọc ảnh)".
 * In both cases the palette is measured by code (interior/palette.ts), never by the model.
 *
 * Presentation-level only: the analysis never touches dimensions, cut lists or CNC. Applying it (styleApply.ts)
 * changes room finishes and furniture appearance; cabinet boards only when the user ticks that option.
 */
import { MATERIALS } from './model'
import { STARTER_MATERIALS } from '../library/polyhaven'
import type { LibCategory } from '../library/assets'
import { chroma, deltaE, labOfHex, lightOf, PALETTE_ROLES, type PaletteRole, type RoleSwatch } from './palette'

export const STYLE_KEYS = ['modern', 'scandinavian', 'japandi', 'indochine', 'luxury', 'industrial', 'minimal', 'classic'] as const
export type StyleKey = (typeof STYLE_KEYS)[number]
export const SURFACES = ['floor', 'walls', 'ceiling', 'joinery', 'upholstery', 'metal', 'stone'] as const
export type Surface = (typeof SURFACES)[number]
/** Furniture categories a style lists (library categories, so models can be matched). */
export const FURN_CATS = ['sofa', 'armchair', 'coffeeTable', 'sideTable', 'tvCabinet', 'sideboard', 'shelf', 'diningTable', 'chair', 'stool', 'bed', 'nightstand', 'wardrobe', 'desk', 'rug', 'pendant', 'lamp', 'plant', 'decor', 'curtain'] as const satisfies readonly LibCategory[]
export type FurnCat = (typeof FURN_CATS)[number]
export type Tone = 'warm' | 'neutral'
export type TimeOfDay = 'day' | 'evening'

/* ------------------------------------------------------------------ the finish vocabulary */

export interface StyleFinish {
  /** Short id the reader answers with. */
  id: string
  /** Interior finish (MATERIALS name) it applies. */
  app: string
  surfaces: Surface[]
  /** For the model's prompt: what it looks like. */
  look: string
}

/** Every finish the reader may choose, per surface. Each maps to one app finish; the library texture comes from the
 *  curated Poly Haven mapping (libIdOf). */
export const FINISHES: StyleFinish[] = [
  // wood (floors use the plank / parquet textures of the same finish)
  { id: 'oak', app: 'Wood - Oak', surfaces: ['floor', 'walls', 'ceiling', 'joinery'], look: 'mid oak planks / oak veneer' },
  { id: 'ash', app: 'Wood - Ash Light', surfaces: ['floor', 'joinery'], look: 'pale light wood (ash, birch, maple)' },
  { id: 'white_oak', app: 'Wood - White Oak', surfaces: ['walls', 'joinery'], look: 'whitewashed / natural white oak' },
  { id: 'walnut', app: 'Wood - Walnut', surfaces: ['floor', 'walls', 'ceiling', 'joinery'], look: 'warm brown walnut' },
  { id: 'dark_wood', app: 'Wood - Dark Stained', surfaces: ['floor', 'walls', 'ceiling', 'joinery'], look: 'very dark stained wood, wenge' },
  { id: 'herringbone_oak', app: 'Parquet - Herringbone Oak', surfaces: ['floor'], look: 'oak herringbone / chevron parquet' },
  { id: 'rattan', app: 'Rattan - Natural', surfaces: ['joinery'], look: 'rattan, cane, wicker' },
  { id: 'white_lacquer', app: 'Lacquer - White', surfaces: ['joinery'], look: 'white painted / lacquered fronts' },
  { id: 'black_lacquer', app: 'Lacquer - Black', surfaces: ['joinery'], look: 'black painted / lacquered fronts' },
  // tiles and stone
  { id: 'porcelain_beige', app: 'Porcelain Tile - Beige', surfaces: ['floor'], look: 'beige porcelain tiles 600 x 600' },
  { id: 'large_grey_tile', app: 'Tile - Large Grey', surfaces: ['floor'], look: 'large grey tiles 1200 x 600' },
  { id: 'terracotta_tile', app: 'Tile - Terracotta', surfaces: ['floor'], look: 'terracotta / encaustic cement tiles' },
  { id: 'terrazzo', app: 'Terrazzo', surfaces: ['floor', 'stone'], look: 'terrazzo with stone chips' },
  { id: 'white_marble', app: 'Marble - White', surfaces: ['floor', 'walls', 'stone'], look: 'white marble with grey veins' },
  { id: 'beige_marble', app: 'Marble - Beige', surfaces: ['floor', 'walls', 'stone'], look: 'beige / travertine marble' },
  { id: 'dark_granite', app: 'Granite - Dark', surfaces: ['floor', 'stone'], look: 'dark granite / black stone' },
  { id: 'concrete', app: 'Concrete - Grey', surfaces: ['floor', 'walls', 'ceiling', 'stone'], look: 'grey concrete / microcement' },
  // walls and ceilings
  { id: 'warm_white', app: 'Paint - Warm White', surfaces: ['walls', 'ceiling'], look: 'warm white paint' },
  { id: 'pure_white', app: 'Paint - Pure White', surfaces: ['walls', 'ceiling'], look: 'cool pure white paint' },
  { id: 'greige', app: 'Paint - Greige', surfaces: ['walls'], look: 'greige / beige paint' },
  { id: 'light_grey', app: 'Paint - Light Grey', surfaces: ['walls'], look: 'light grey paint' },
  { id: 'sage', app: 'Paint - Sage Green', surfaces: ['walls'], look: 'sage green paint' },
  { id: 'ochre', app: 'Paint - Ochre', surfaces: ['walls'], look: 'ochre / mustard yellow paint' },
  { id: 'charcoal', app: 'Paint - Charcoal', surfaces: ['walls', 'ceiling'], look: 'dark charcoal paint' },
  { id: 'plaster', app: 'Plaster - White', surfaces: ['walls', 'ceiling'], look: 'white lime plaster with texture' },
  { id: 'brick', app: 'Brick - Red', surfaces: ['walls'], look: 'exposed red brick' },
  { id: 'gypsum', app: 'Gypsum - White', surfaces: ['ceiling'], look: 'flat white gypsum ceiling' },
  // upholstery
  { id: 'fabric_beige', app: 'Fabric - Beige', surfaces: ['upholstery'], look: 'beige fabric' },
  { id: 'fabric_taupe', app: 'Fabric - Taupe', surfaces: ['upholstery'], look: 'taupe / brown-grey fabric' },
  { id: 'fabric_linen', app: 'Fabric - Linen', surfaces: ['upholstery'], look: 'off-white linen' },
  { id: 'fabric_olive', app: 'Fabric - Olive', surfaces: ['upholstery'], look: 'olive / dark green fabric' },
  { id: 'fabric_grey', app: 'Fabric - Grey', surfaces: ['upholstery'], look: 'grey fabric' },
  { id: 'fabric_blue', app: 'Fabric - Blue', surfaces: ['upholstery'], look: 'blue velvet / fabric' },
  { id: 'boucle', app: 'Fabric - Bouclé White', surfaces: ['upholstery'], look: 'white boucle' },
  { id: 'leather_cognac', app: 'Leather - Cognac', surfaces: ['upholstery'], look: 'brown / cognac leather' },
  { id: 'leather_white', app: 'Leather - White', surfaces: ['upholstery'], look: 'white leather' },
  // metal
  { id: 'brass', app: 'Metal - Brass', surfaces: ['metal'], look: 'brass / gold' },
  { id: 'black_metal', app: 'Metal - Black', surfaces: ['metal'], look: 'black metal / iron' },
  { id: 'chrome', app: 'Metal - Chrome', surfaces: ['metal'], look: 'chrome / brushed steel' },
]

export const finishById = (id: string | null | undefined) => (id ? FINISHES.find((f) => f.id === id) : undefined)
export const finishesFor = (s: Surface) => FINISHES.filter((f) => f.surfaces.includes(s))
/** The finish of an app material name (first one listing it). */
export const finishOfApp = (app: string, s?: Surface) => FINISHES.find((f) => f.app === app && (!s || f.surfaces.includes(s)))
/** The Poly Haven texture id serving a finish on a surface (floors take a floor texture when there is one). */
export function libIdOf(f: StyleFinish, s: Surface): string | null {
  const named = STARTER_MATERIALS.filter((m) => m.app.includes(f.app))
  const pick = s === 'floor' ? named.find((m) => m.floor) ?? named[0] : named.find((m) => !m.floor) ?? named[0]
  return pick?.id ?? null
}

/* ------------------------------------------------------------------ style defaults */

export interface StyleDefaults {
  materials: Record<Surface, string | null>
  furniture: FurnCat[]
  lighting: { tone: Tone; time: TimeOfDay }
  /** Library model words this style likes / avoids (matched against the model's id, name, tags, style). */
  like: string[]
  avoid: string[]
}

export const STYLE_DEFAULTS: Record<StyleKey, StyleDefaults> = {
  modern: { materials: { floor: 'large_grey_tile', walls: 'warm_white', ceiling: 'gypsum', joinery: 'walnut', upholstery: 'fabric_grey', metal: 'black_metal', stone: 'white_marble' }, furniture: ['sofa', 'coffeeTable', 'tvCabinet', 'armchair', 'rug', 'pendant', 'plant'], lighting: { tone: 'neutral', time: 'day' }, like: ['modern', 'contemporary', 'sleek', 'mid_century', 'mid-century'], avoid: ['gothic', 'classic', 'antique', 'victorian', 'painted', 'rustic'] },
  scandinavian: { materials: { floor: 'ash', walls: 'pure_white', ceiling: 'gypsum', joinery: 'white_oak', upholstery: 'fabric_grey', metal: 'black_metal', stone: null }, furniture: ['sofa', 'coffeeTable', 'armchair', 'tvCabinet', 'rug', 'plant', 'lamp'], lighting: { tone: 'neutral', time: 'day' }, like: ['modern', 'scandi', 'wood', 'wooden', 'minimal', 'mid_century', 'ceramic'], avoid: ['gothic', 'classic', 'chesterfield', 'chandelier', 'industrial'] },
  japandi: { materials: { floor: 'oak', walls: 'greige', ceiling: 'oak', joinery: 'oak', upholstery: 'fabric_linen', metal: 'black_metal', stone: null }, furniture: ['sofa', 'coffeeTable', 'sideTable', 'rug', 'plant', 'lamp', 'decor'], lighting: { tone: 'warm', time: 'day' }, like: ['wood', 'wooden', 'minimal', 'gallinera', 'wicker', 'ceramic', 'low'], avoid: ['industrial', 'gothic', 'chandelier', 'chesterfield', 'metal', 'steel'] },
  indochine: { materials: { floor: 'terracotta_tile', walls: 'ochre', ceiling: 'dark_wood', joinery: 'dark_wood', upholstery: 'fabric_linen', metal: 'brass', stone: null }, furniture: ['sofa', 'armchair', 'coffeeTable', 'sideboard', 'rug', 'plant', 'pendant'], lighting: { tone: 'warm', time: 'day' }, like: ['rattan', 'wicker', 'gallinera', 'wooden', 'painted', 'classic', 'ceramic'], avoid: ['industrial', 'steel', 'modern_coffee', 'metal_office'] },
  luxury: { materials: { floor: 'white_marble', walls: 'greige', ceiling: 'gypsum', joinery: 'walnut', upholstery: 'fabric_blue', metal: 'brass', stone: 'white_marble' }, furniture: ['sofa', 'armchair', 'coffeeTable', 'sideboard', 'rug', 'pendant', 'decor'], lighting: { tone: 'warm', time: 'evening' }, like: ['classic', 'chesterfield', 'leather', 'chandelier', 'marble', 'velvet', 'modern'], avoid: ['industrial', 'rustic', 'painted_wooden', 'metal_office', 'pipe'] },
  industrial: { materials: { floor: 'concrete', walls: 'brick', ceiling: 'concrete', joinery: 'dark_wood', upholstery: 'leather_cognac', metal: 'black_metal', stone: 'concrete' }, furniture: ['sofa', 'armchair', 'coffeeTable', 'shelf', 'rug', 'pendant', 'lamp'], lighting: { tone: 'warm', time: 'evening' }, like: ['industrial', 'metal', 'steel', 'pipe', 'leather', 'iron', 'frame'], avoid: ['gothic', 'classic', 'painted', 'chandelier', 'gallinera'] },
  minimal: { materials: { floor: 'concrete', walls: 'pure_white', ceiling: 'gypsum', joinery: 'white_lacquer', upholstery: 'boucle', metal: 'chrome', stone: 'white_marble' }, furniture: ['sofa', 'coffeeTable', 'tvCabinet', 'rug', 'plant'], lighting: { tone: 'neutral', time: 'day' }, like: ['modern', 'minimal', 'sleek', 'white'], avoid: ['gothic', 'classic', 'ornate', 'chandelier', 'painted', 'rustic', 'industrial'] },
  classic: { materials: { floor: 'herringbone_oak', walls: 'warm_white', ceiling: 'gypsum', joinery: 'walnut', upholstery: 'fabric_beige', metal: 'brass', stone: 'beige_marble' }, furniture: ['sofa', 'armchair', 'coffeeTable', 'sideboard', 'rug', 'pendant', 'lamp', 'decor'], lighting: { tone: 'warm', time: 'day' }, like: ['classic', 'chesterfield', 'chandelier', 'painted', 'wooden', 'leather'], avoid: ['industrial', 'pipe', 'steel', 'metal_office'] },
}

/* ------------------------------------------------------------------ the analysis */

export interface PaletteEntry {
  hex: string
  role: PaletteRole
  /** Share of the photos' pixels (0…1). */
  share: number
}

export interface StyleAnalysis {
  version: 1
  /** Who read the photos: the local vision model, or the basic colour statistics. */
  source: 'model' | 'basic'
  model?: string
  /** Time the reader took (ms), measured. */
  ms?: number
  style: StyleKey
  palette: PaletteEntry[]
  /** Finish id per surface (null = none, e.g. no stone). */
  materials: Record<Surface, string | null>
  furniture: { category: FurnCat; hint: string }[]
  lighting: { tone: Tone; time: TimeOfDay }
  confidence: number
  /** Short Vietnamese description. */
  description: string
  /** English description (basic reader; the model writes Vietnamese only). */
  descriptionEn?: string
  images?: number
}

const isHex = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)
const oneOf = <T extends string>(v: unknown, list: readonly T[]): v is T => typeof v === 'string' && (list as readonly string[]).includes(v)
const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max) : '')

/**
 * Validates an analysis (from the model, the basic reader, a saved JSON or the user's edits). Anything outside the
 * vocabulary is an error, never silently kept. Returns the cleaned value or the list of problems.
 */
export function validateAnalysis(raw: unknown): { ok: true; value: StyleAnalysis } | { ok: false; errors: string[] } {
  const e: string[] = []
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  if (!oneOf(o.style, STYLE_KEYS)) e.push('style')
  const src = o.source === 'model' || o.source === 'basic' ? o.source : null
  if (!src) e.push('source')
  const pal = Array.isArray(o.palette) ? o.palette : null
  if (!pal || pal.length < 1 || pal.length > 8) e.push('palette')
  const palette: PaletteEntry[] = []
  for (const p of pal ?? []) {
    const q = (p ?? {}) as Record<string, unknown>
    if (!isHex(q.hex) || !oneOf(q.role, PALETTE_ROLES)) {
      e.push('palette.entry')
      continue
    }
    const share = typeof q.share === 'number' && q.share >= 0 && q.share <= 1 ? q.share : 0
    palette.push({ hex: q.hex.toLowerCase(), role: q.role, share })
  }
  const m = (o.materials && typeof o.materials === 'object' ? o.materials : null) as Record<string, unknown> | null
  if (!m) e.push('materials')
  const materials = {} as Record<Surface, string | null>
  for (const s of SURFACES) {
    const v = m?.[s]
    if (v === null || v === undefined || v === 'none') {
      if (s !== 'stone') e.push(`materials.${s}`)
      materials[s] = null
      continue
    }
    const f = typeof v === 'string' ? finishById(v) : undefined
    if (!f || !f.surfaces.includes(s)) e.push(`materials.${s}`)
    materials[s] = f ? f.id : null
  }
  const fl = Array.isArray(o.furniture) ? o.furniture : null
  if (!fl || fl.length > 12) e.push('furniture')
  const furniture: StyleAnalysis['furniture'] = []
  for (const x of fl ?? []) {
    const q = (x ?? {}) as Record<string, unknown>
    if (!oneOf(q.category, FURN_CATS)) {
      e.push('furniture.category')
      continue
    }
    if (!furniture.some((f) => f.category === q.category)) furniture.push({ category: q.category, hint: clean(q.hint, 80) })
  }
  const li = (o.lighting ?? {}) as Record<string, unknown>
  if (!oneOf(li.tone, ['warm', 'neutral'] as const) || !oneOf(li.time, ['day', 'evening'] as const)) e.push('lighting')
  const conf = typeof o.confidence === 'number' ? o.confidence : typeof o.confidence === 'string' ? Number(o.confidence) : NaN
  if (!(conf >= 0 && conf <= 1)) e.push('confidence')
  const description = clean(o.description, 400)
  if (description.length < 8) e.push('description')
  if (e.length) return { ok: false, errors: [...new Set(e)] }
  return {
    ok: true,
    value: {
      version: 1,
      source: src!,
      ...(typeof o.model === 'string' ? { model: clean(o.model, 120) } : {}),
      ...(typeof o.ms === 'number' && o.ms >= 0 ? { ms: Math.round(o.ms) } : {}),
      style: o.style as StyleKey,
      palette,
      materials,
      furniture,
      lighting: { tone: li.tone as Tone, time: li.time as TimeOfDay },
      confidence: Math.round(conf * 100) / 100,
      description,
      ...(typeof o.descriptionEn === 'string' && o.descriptionEn ? { descriptionEn: clean(o.descriptionEn, 400) } : {}),
      ...(typeof o.images === 'number' ? { images: o.images } : {}),
    },
  }
}

/* ------------------------------------------------------------------ the model's question */

const lit = (s: string) => JSON.stringify(JSON.stringify(s))
const alts = (xs: readonly string[]) => xs.map(lit).join(' | ')

/**
 * GBNF of the model's answer: one JSON object, keys in a fixed order, every id from the vocabulary (per surface only
 * the finishes that surface can take), 1–8 furniture categories with a short hint, a description of 20–320
 * characters. The palette is not asked: code measures it.
 */
export function styleGrammar(): string {
  const surf = SURFACES.map((s) => `m-${s} ::= ${alts(s === 'stone' ? ['none', ...finishesFor(s).map((f) => f.id)] : finishesFor(s).map((f) => f.id))}`)
  return [
    `root ::= "{\\"style\\":" style ",\\"materials\\":{" ${SURFACES.map((s, i) => `"${i ? ',' : ''}\\"${s}\\":" m-${s}`).join(' ')} "},\\"furniture\\":[" item ("," item){0,7} "],\\"lighting\\":{\\"tone\\":" tone ",\\"time\\":" time "},\\"confidence\\":" conf ",\\"description\\":\\"" desc "\\"}"`,
    `style ::= ${alts(STYLE_KEYS)}`,
    ...surf,
    `item ::= "{\\"category\\":" cat ",\\"hint\\":\\"" hint "\\"}"`,
    `cat ::= ${alts(FURN_CATS)}`,
    `hint ::= [^"\\\\\\n]{0,60}`,
    `tone ::= ${alts(['warm', 'neutral'])}`,
    `time ::= ${alts(['day', 'evening'])}`,
    `conf ::= "0." [0-9] [0-9] | "1.00"`,
    `desc ::= [^"\\\\\\n]{20,320}`,
  ].join('\n')
}

export const STYLE_SYSTEM =
  'You are an interior designer\'s assistant. You look at reference photos of interiors and describe their style so that it can be recreated in another room with the finishes listed. Judge only what the photos show. Answer only with the JSON object.'

/** The question for the photos (English instructions; the description and hints in Vietnamese). */
export function stylePrompt(palette: PaletteEntry[], images: number): string {
  const pal = palette.map((p) => `${p.hex} ${p.role} ${Math.round(p.share * 100)}%`).join(', ')
  const list = SURFACES.map((s) => `  ${s}: ${(s === 'stone' ? [{ id: 'none', look: 'no stone visible' }, ...finishesFor(s)] : finishesFor(s)).map((f) => `${f.id} (${f.look})`).join('; ')}`).join('\n')
  return [
    `${images} reference photo${images > 1 ? 's' : ''} of an interior. Colours measured from the photo${images > 1 ? 's' : ''} by the app (colour, probable role, share of the image): ${pal}.`,
    `Answer with:`,
    `- style: one of ${STYLE_KEYS.join(', ')}.`,
    `- materials: for each surface the closest finish id from these lists:`,
    list,
    `- furniture: the furniture types the photos show or the style needs (categories: ${FURN_CATS.join(', ')}), most important first, each with a short hint in Vietnamese (shape, colour, material).`,
    `- lighting: tone warm or neutral, time day or evening, as in the photos.`,
    `- confidence: 0.00 to 1.00, how clearly the photos show one style.`,
    `- description: one or two sentences in Vietnamese about the style, colours and materials.`,
  ].join('\n')
}

/** The model's answer → analysis (with the measured palette), or the problems found. */
export function parseModelAnswer(text: string, palette: PaletteEntry[], meta: { model?: string; ms?: number; images?: number } = {}) {
  let j: unknown
  try {
    const a = text.indexOf('{'), b = text.lastIndexOf('}')
    j = JSON.parse(a >= 0 && b > a ? text.slice(a, b + 1) : text)
  } catch {
    return { ok: false as const, errors: ['json'] }
  }
  const o = (j ?? {}) as Record<string, unknown>
  const mats = (o.materials ?? {}) as Record<string, unknown>
  return validateAnalysis({ ...o, materials: { ...mats, stone: mats.stone === 'none' ? null : mats.stone }, source: 'model', palette, ...meta })
}

/* ------------------------------------------------------------------ the basic reader (no model) */

const appColor = (app: string) => MATERIALS.find((m) => m.name === app)?.color ?? '#888888'
/** The finish of a surface nearest a colour (ΔE), among `ids` (default: every finish of the surface). */
export function nearestFinish(hex: string, s: Surface, ids?: string[]): StyleFinish {
  const lab = labOfHex(hex)
  const list = finishesFor(s).filter((f) => !ids || ids.includes(f.id))
  return list.reduce((best, f) => (deltaE(labOfHex(appColor(f.app)), lab) < deltaE(labOfHex(appColor(best.app)), lab) ? f : best), list[0])
}

const WOOD = ['ash', 'oak', 'walnut', 'dark_wood']
const woodByL = (L: number) => (L > 66 ? 'ash' : L > 50 ? 'oak' : L > 34 ? 'walnut' : 'dark_wood')

/**
 * Palette + texture statistics → a style guess, labelled as such: brick-like walls → industrial, dark wood → classic,
 * pale wood + white → scandinavian, near-white and flat → minimal, else modern. Confidence stays ≤ 0.4.
 */
export function basicAnalysis(sw: RoleSwatch[], images = 1): StyleAnalysis {
  const by = (r: PaletteRole) => sw.find((s) => s.role === r)
  const wall = by('wall') ?? sw[0]
  const floor = by('floor') ?? sw[sw.length - 1] ?? wall
  const wood = by('wood')
  const accent = by('accent')
  const textiles = sw.filter((s) => s.role === 'textile')
  const { meanL, warm } = lightOf(sw)
  const wl = wall.lab, fl = floor.lab
  // walls: a red-brown colour filling the upper frame = exposed brick; flat = the nearest paint; light and a little
  // textured = plaster
  const brickish = sw.some((s) => s.top > 0.45 && s.share > 0.12 && s.lab[1] > 14 && s.lab[2] > 12 && s.lab[0] < 62 && s.lab[0] > 20)
  const walls = brickish ? 'brick' : wl[0] > 82 && wall.texture > 6 ? 'plaster' : nearestFinish(wall.hex, 'walls', ['warm_white', 'pure_white', 'greige', 'light_grey', 'sage', 'ochre', 'charcoal']).id
  // floor: warm and textured = wood (by lightness); neutral grey = concrete / tile; reddish = terracotta
  const fc = chroma(fl)
  let fl0: string
  if (fl[1] > 3 && fl[2] > 10 && fl[0] < 78 && (floor.texture > 5 || fc > 14)) fl0 = fl[1] > 14 && fl[2] < 30 && fl[0] < 55 ? 'terracotta_tile' : woodByL(fl[0])
  else if (fc < 8) fl0 = fl[0] > 80 ? (floor.texture > 6 ? 'white_marble' : 'large_grey_tile') : fl[0] > 45 ? 'concrete' : 'dark_granite'
  else fl0 = nearestFinish(floor.hex, 'floor', ['porcelain_beige', 'beige_marble', 'terrazzo', 'large_grey_tile']).id
  const joinery = wood ? woodByL(wood.lab[0]) : sw.some((s) => s.lab[0] > 88 && s.share > 0.08) ? 'white_lacquer' : WOOD.includes(fl0) ? fl0 : 'oak'
  const up = accent && accent.share > 0.03 ? accent : textiles.sort((a, b) => b.share - a.share)[0] ?? wall
  const upholstery = nearestFinish(up.hex, 'upholstery').id
  const metal = sw.some((s) => s.role === 'metal') ? 'black_metal' : warm > 14 ? 'brass' : 'black_metal'
  let style: StyleKey = 'modern'
  if (walls === 'brick' || (fl0 === 'concrete' && meanL < 55)) style = 'industrial'
  else if ((joinery === 'dark_wood' || joinery === 'walnut') && warm > 12) style = 'classic'
  else if ((fl0 === 'ash' || joinery === 'ash' || fl0 === 'oak') && wl[0] > 80) style = 'scandinavian'
  else if (wl[0] > 86 && sw.every((s) => chroma(s.lab) < 18)) style = 'minimal'
  const lighting = { tone: (warm > 12 ? 'warm' : 'neutral') as Tone, time: (meanL < 32 ? 'evening' : 'day') as TimeOfDay }
  const ceiling = walls === 'brick' || fl0 === 'concrete' ? (meanL < 45 ? 'concrete' : 'gypsum') : walls === 'plaster' ? 'plaster' : 'gypsum'
  const materials: Record<Surface, string | null> = { floor: fl0, walls, ceiling, joinery, upholstery, metal, stone: null }
  const d = STYLE_DEFAULTS[style]
  const f = (id: string | null) => finishById(id)?.app ?? '—'
  return {
    version: 1,
    source: 'basic',
    style,
    palette: sw.slice(0, 6).map((s) => ({ hex: s.hex, role: s.role, share: Math.round(s.share * 1000) / 1000 })),
    materials,
    furniture: d.furniture.map((c) => ({ category: c, hint: '' })),
    lighting,
    confidence: Math.min(0.4, 0.2 + (sw[0]?.share ?? 0) * 0.3),
    description: `Phân tích cơ bản theo màu và độ nhám bề mặt: tường ${f(walls)}, sàn ${f(fl0)}, gỗ ${f(joinery)}, ánh sáng ${lighting.tone === 'warm' ? 'ấm' : 'trung tính'}. Phong cách đoán: ${style}.`,
    descriptionEn: `Basic analysis from colours and surface texture: walls ${f(walls)}, floor ${f(fl0)}, wood ${f(joinery)}, ${lighting.tone} light. Style guessed: ${style}.`,
    images,
  }
}

/** The finish (app material) of a surface in an analysis, falling back to the style's default. */
export function appFinish(a: StyleAnalysis, s: Surface): string | null {
  const id = a.materials[s] ?? (s === 'stone' ? null : STYLE_DEFAULTS[a.style].materials[s])
  return finishById(id)?.app ?? null
}
