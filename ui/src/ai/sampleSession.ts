import type { CadDocument, Entity, Vec2 } from '../cad/types'
import { LAYERS } from '../cad/seed'

/**
 * SAMPLE SESSION (source: 'demo').
 *
 * The conversation, task plan and three proposals shown in mockup 03 are a recorded demo
 * transcript. They were NOT produced by a model on this machine — the local runtime
 * (llama.cpp / MLX) is not integrated yet. New user messages never receive fabricated answers.
 */
export const SAMPLE_SOURCE = 'demo' as const

export interface ChatTurnUser {
  role: 'user'
  id: string
  text: string
  translation?: string
  time: string
}

export interface ChatTurnAssistant {
  role: 'assistant'
  id: string
  text: string
  steps?: string[]
  done?: { seconds: number; label: string; unit: string }
  /** Heading above the proposal list, in the conversation's language. */
  proposalsHeading?: string
  time?: string
  proposals?: boolean
  tone?: 'notice' | 'tool' | 'live'
  lines?: string[]
  /** Live (native model) turns. */
  pending?: boolean
  proposal?: import('../services/host').NativeProposal
  stats?: string
  /** Drawing the live proposal targets. */
  docId?: string
}

export type ChatTurn = ChatTurnUser | ChatTurnAssistant

export const SAMPLE_TURNS: ChatTurn[] = [
  {
    role: 'user',
    id: 'u1',
    text: 'Tạo phương án cải tạo  mặt bằng tầng 1 thành văn phòng\nvới 6 phòng làm việc, 1 phòng họp và khu pantry.\nGiữ nguyên kết cấu hiện tại và đề xuất 3 phương án.',
    translation: 'Create a renovation plan for the 1st floor into an office with\n6 offices, 1 meeting room and a pantry. Keep the existing structure\nand suggest 3 design options.',
    time: '10:24 AM',
  },
  {
    role: 'assistant',
    id: 'a1',
    text: 'Tôi sẽ phân tích bản vẽ hiện tại và tạo 3 phương án mặt bằng\nphù hợp với yêu cầu cầu bạn.',
    steps: [
      'Phân tích bản vẽ hiện tại (villa_riverside.dwg)',
      'Giữ nguyên kết cấu, xác định khu vực khả dụng',
      'Tạo 3 phương án bố trí mặt bằng',
      'Kiểm tra kích thước, lối đi, quy chuẩn văn phòng',
      'Chuẩn bị bản vẽ đề xuất và so sánh',
    ],
    done: { seconds: 24, label: 'Hoàn thành', unit: 'giây' },
    proposalsHeading: 'Đề xuất phương án:',
    time: '10:25 AM',
    proposals: true,
  },
]

export interface Proposal {
  n: 1 | 2 | 3
  /** Name shown in the chat list (language of the conversation). */
  chatTitle: string
  chatDesc: string
  /** Short name for the option selector / preview label (UI language independent sample data). */
  name: string
  /** Drawing title shown on the preview label. */
  planName: string
  icon: 'focus' | 'open' | 'balance'
  hasPreview: boolean
  details: { totalArea: string; offices: string; meeting: string; pantry: string; structure: string; compliance: string }
  improvements: string[]
  actions: { op: string; label: string; count: number }[]
  /** Vietnamese rendering of the same sample output. */
  vi: { name: string; planName: string; details: Proposal['details']; improvements: string[]; actions: string[] }
}

export const PROPOSALS: Proposal[] = [
  {
    n: 1,
    chatTitle: 'Tối ưu không gian',
    chatDesc: '6 phòng làm việc + 1 phòng họp + pantry (120 m²)',
    name: 'Optimized Layout',
    planName: 'Office Layout Plan',
    icon: 'focus',
    hasPreview: true,
    details: { totalArea: '120 m²', offices: '6 rooms', meeting: '1 room (24 m²)', pantry: '1 area (10.8 m²)', structure: 'Unchanged', compliance: 'Office standard' },
    improvements: ['Efficient space utilization', 'Clear circulation', 'Natural light for all offices', 'Keeps existing structure', 'Ready for implementation'],
    actions: [
      { op: 'ERASE', label: 'Non-structural partitions (bedrooms, bath)', count: 7 },
      { op: 'WALL', label: 'Partition 100 mm, layer A-Wall', count: 14 },
      { op: 'DOOR', label: 'Single door 900 mm, layer A-Door', count: 9 },
      { op: 'INSERT', label: 'Office furniture blocks', count: 32 },
      { op: 'ROOMTAG', label: 'Room name + area tags', count: 9 },
      { op: 'DIMLINEAR', label: 'Room dimensions', count: 8 },
    ],
    vi: {
      name: 'Tối ưu bố trí',
      planName: 'Mặt bằng văn phòng',
      details: { totalArea: '120 m²', offices: '6 phòng', meeting: '1 phòng (24 m²)', pantry: '1 khu (10,8 m²)', structure: 'Giữ nguyên', compliance: 'Đạt chuẩn văn phòng' },
      improvements: ['Sử dụng không gian hiệu quả', 'Lối đi rõ ràng', 'Mọi phòng đều có ánh sáng tự nhiên', 'Giữ nguyên kết cấu', 'Sẵn sàng triển khai'],
      actions: ['Vách ngăn không chịu lực (phòng ngủ, WC)', 'Vách ngăn 100 mm, lớp A-Wall', 'Cửa đơn 900 mm, lớp A-Door', 'Block nội thất văn phòng', 'Nhãn tên phòng + diện tích', 'Kích thước phòng'],
    },
  },
  {
    n: 2,
    chatTitle: 'Không gian mở',
    chatDesc: '6 phòng làm việc + họp + pantry (110 m²)',
    name: 'Open Workspace',
    planName: 'Office Layout Plan',
    icon: 'open',
    hasPreview: false,
    details: { totalArea: '110 m²', offices: '6 desks zones', meeting: '1 room (20 m²)', pantry: '1 area (9.6 m²)', structure: 'Unchanged', compliance: 'Office standard' },
    improvements: ['Open collaboration area', 'Fewer partitions', 'Flexible desk zones', 'Keeps existing structure'],
    actions: [
      { op: 'ERASE', label: 'Non-structural partitions', count: 9 },
      { op: 'WALL', label: 'Glass partition 80 mm', count: 6 },
      { op: 'INSERT', label: 'Bench desks + meeting table', count: 22 },
      { op: 'ROOMTAG', label: 'Zone tags', count: 4 },
    ],
    vi: {
      name: 'Không gian mở',
      planName: 'Mặt bằng văn phòng',
      details: { totalArea: '110 m²', offices: '6 khu bàn làm việc', meeting: '1 phòng (20 m²)', pantry: '1 khu (9,6 m²)', structure: 'Giữ nguyên', compliance: 'Đạt chuẩn văn phòng' },
      improvements: ['Không gian cộng tác mở', 'Ít vách ngăn hơn', 'Khu bàn linh hoạt', 'Giữ nguyên kết cấu'],
      actions: ['Vách ngăn không chịu lực', 'Vách kính 80 mm', 'Bàn dài + bàn họp', 'Nhãn khu vực'],
    },
  },
  {
    n: 3,
    chatTitle: 'Cân bằng',
    chatDesc: '6 phòng làm việc + họp + pantry (118 m²)',
    name: 'Balanced Plan',
    planName: 'Office Layout Plan',
    icon: 'balance',
    hasPreview: false,
    details: { totalArea: '118 m²', offices: '6 rooms', meeting: '1 room (22 m²)', pantry: '1 area (10.2 m²)', structure: 'Unchanged', compliance: 'Office standard' },
    improvements: ['Mix of private and open space', 'Short circulation', 'Keeps existing structure'],
    actions: [
      { op: 'ERASE', label: 'Non-structural partitions', count: 7 },
      { op: 'WALL', label: 'Partition 100 mm', count: 10 },
      { op: 'DOOR', label: 'Single door 900 mm', count: 7 },
      { op: 'ROOMTAG', label: 'Room name + area tags', count: 8 },
    ],
    vi: {
      name: 'Cân bằng',
      planName: 'Mặt bằng văn phòng',
      details: { totalArea: '118 m²', offices: '6 phòng', meeting: '1 phòng (22 m²)', pantry: '1 khu (10,2 m²)', structure: 'Giữ nguyên', compliance: 'Đạt chuẩn văn phòng' },
      improvements: ['Kết hợp phòng riêng và không gian mở', 'Lối đi ngắn', 'Giữ nguyên kết cấu'],
      actions: ['Vách ngăn không chịu lực', 'Vách ngăn 100 mm', 'Cửa đơn 900 mm', 'Nhãn tên phòng + diện tích'],
    },
  },
]

/* ---------- Option 1 preview document (raster proposal + vector annotation) ---------- */

/** Mockup px → mm, origin at the plan's bottom-left wall corner (x 819, y 829). 18600 mm = 421 px. */
export const PREVIEW_MM_PER_PX = 18600 / (1240 - 819)
const mp = (X: number, Y: number): Vec2 => ({ x: (X - 819) * PREVIEW_MM_PER_PX, y: (829 - Y) * PREVIEW_MM_PER_PX })
const px = (n: number) => n * PREVIEW_MM_PER_PX
/** Preview panel centre on the mockup (panel 760–1292 × 503–890). */
export const PREVIEW_VIEW = { center: mp(1026, 696.5), mmPerPx: PREVIEW_MM_PER_PX }

let k = 0
const base = (layer: string) => ({ id: `p1-${++k}`, layer, color: 'ByLayer', linetype: 'ByLayer' as const, lineweight: 'ByLayer' as const, transparency: 0 })
const line = (x1: number, y1: number, x2: number, y2: number, layer = 'A-Dims'): Entity => ({ ...base(layer), kind: 'line', a: mp(x1, y1), b: mp(x2, y2) })
const dim = (ax: number, ay: number, bx: number, by: number, text: string, textAngle?: number): Entity => ({
  ...base('A-Dims'),
  kind: 'dimension',
  a: mp(ax, ay),
  b: mp(bx, by),
  offset: 0,
  override: text,
  textHeight: px(7.5),
  textAngle,
})

export function createProposalDocument(now = Date.now()): CadDocument {
  k = 0
  const entities: Entity[] = [
    // north arrow
    { ...base('A-Anno'), kind: 'circle', c: mp(1267, 574), r: px(11) },
    { ...base('A-Anno'), kind: 'polyline', pts: [mp(1267, 562), mp(1271.5, 584), mp(1267, 580)], closed: true, filled: true },
    { ...base('A-Anno'), kind: 'polyline', pts: [mp(1267, 562), mp(1262.5, 584), mp(1267, 580)], closed: true },
    { ...base('A-Anno'), kind: 'text', p: mp(1267, 560), height: px(8), value: 'N', rotation: 0, align: 'center' },
    // right dimension (reads top-down as drafted)
    dim(1263, 626, 1263, 727, '4200', -Math.PI / 2),
    // pantry step at the right edge
    { ...base('A-Wall'), kind: 'polyline', pts: [mp(1253, 788), mp(1263, 788), mp(1263, 817), mp(1253, 817)], closed: true },
    { ...base('A-Wall'), kind: 'line', a: mp(1258, 791), b: mp(1258, 817) },
    // bottom chain + overall dimensions
    line(819.5, 843, 819.5, 868),
    line(1240, 843, 1240, 868),
    ...[921, 924.5, 1020.5, 1120.5, 1122].map((x) => line(x, 843, x, 855)),
    dim(819.5, 850, 921, 850, ''),
    dim(924.5, 850, 1020.5, 850, ''),
    dim(1020.5, 850, 1120.5, 850, ''),
    dim(1240, 863.5, 819.5, 863.5, '18600'),
  ]
  return {
    id: `ai-proposal-1-${now.toString(36)}`,
    name: 'Office Layout - Option 1.dwg',
    entities,
    layers: LAYERS,
    currentLayer: 'A-Wall',
    underlay: {
      name: 'AI proposal — Option 1 (sample raster)',
      src: '/assets/ai_preview_office_floorplan.png',
      natW: 515,
      natH: 329,
      // asset left 19 px / top 28 px are bleed from the panel border and toolbar
      crop: { x: 19, y: 28, w: 496, h: 301 },
      origin: mp(760, 542),
      mmPerPx: PREVIEW_MM_PER_PX,
      drawIndex: entities.length,
    },
    blocks: [],
    dirty: false,
    createdAt: now,
    savedAt: null,
    source: 'seed',
  }
}
