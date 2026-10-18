/**
 * Strings of the v2.4 linked model (BIM direct editing, Smart Room, live 3D view modes, bookmarks) in EN and VI.
 * Kept in this namespace file (not en.ts / vi.ts); `useLinkedT()` follows the app language.
 */
import { useSettings } from '../../state/settings'

export const linkedEn = {
  rule: {
    noHost: '{mark}: its host wall is missing',
    beyond: '{mark} would reach past the end of its host wall',
    nearEnd: '{mark} would come closer than {c} mm to the end of its host wall',
    tooTall: '{mark} would reach above the top of its host wall',
    bad: '{mark}: width and height must be positive, the sill not below the floor',
    arc: '{mark}: the radius must be at least half the wall length',
    slope: '{mark}: the end height must be positive',
  },
  props: {
    identity: 'Model identity', guid: 'GUID', rev: 'Revision', src: 'Source',
    srcKind: { drawn: 'Drawn', imported: 'Imported', ai: 'AI (approved)', survey: 'Survey', image: 'Image (review)' },
    review: 'review required',
    length: 'Length', angle: 'Angle', startX: 'Start X', startY: 'Start Y', baseLevel: 'Base Constraint', baseOffset: 'Base Offset', topOffset: 'Top Offset', height: 'Unconnected Height', heightEnd: 'Height at end',
    thickness: 'Thickness', radius: 'Arc radius', arcLength: 'Arc length', faceLeft: 'Face length (left)', faceRight: 'Face length (right)', centre: 'Centre-line length',
    width: 'Width', sill: 'Sill Height', offset: 'Offset from wall start', hinge: 'Hinge side', swing: 'Opens to', hingeL: 'Left', hingeR: 'Right', swingIn: 'Left side (in)', swingOut: 'Right side (out)',
    elevation: 'Elevation', name: 'Name', number: 'Number',
    net: 'Net area (inside faces)', gross: 'Gross area (to wall centres)', perimeter: 'Net perimeter', liveArea: 'computed from the bounding walls', storedArea: 'stored (no bounding walls)',
    focus3d: 'Focus in 3D', doorOpen: 'Show doors open in 3D', doorClosed: 'Show doors closed in 3D',
    straight: 'Straight', arc: 'Arc',
  },
  plan: {
    typed: 'Type a length (4200), @dx,dy, x,y, 4200<90 or R2500 · Enter',
    wallHint: 'Click the start, then each corner — or type a length (4200, @4200<90, @dx,dy) · Shift = 15° angle lock · Alt = no snap · Esc / double-click ends',
    typedBad: 'Not understood: {v}', typedRadius: 'Next wall: arc of radius {r} mm',
    arcMode: 'Wall shape', arcHint: 'Click the start, the end, then a point the arc passes through · or type R2500',
    snap: { end: 'Endpoint', mid: 'Midpoint', int: 'Intersection', perp: 'Perpendicular', near: 'Nearest', grid: 'Grid', none: '' },
    angleLock: 'Shift: angle locked to 15°',
    grip: 'Drag a grip: an end stretches the wall (joined walls follow, Alt detaches), the middle moves it',
    gripMoved: '{mark}: {what}', faces: 'centre {c} · left face {l} · right face {r}',
    smartHint: 'Click where the room goes ({shape}, {w} × {d} mm) · Esc cancels',
    smartAdded: 'Smart Room {number}: {walls} walls drawn, {reused} shared with existing walls, {area} m² net',
    roofAdded: 'Roof {mark} over {n} walls ({kind}, {slope}°) — walls unchanged',
    noWalls: 'No walls on this level to put a roof over',
    stairAdded: '{kind} stair {mark}: {n} risers of {r} mm',
  },
  smart: {
    title: 'Smart Room', menu: 'Smart Room…', shape: 'Template',
    shapes: { rect: 'Rectangle', L: 'L-shape', U: 'U-shape', polygon: 'Polygon', round: 'Round', corridor: 'Corridor' },
    w: 'Width X (mm)', d: 'Depth Y (mm)', cutW: 'Cut width (mm)', cutD: 'Cut depth (mm)', r: 'Radius (mm)', segments: 'Segments', arcWalls: 'Arc walls (4 arcs)',
    pts: 'Corners x,y; x,y; … (mm)', thickness: 'Wall thickness (mm)', height: 'Wall height (mm)', dims: 'Sizes are', inner: 'clear inside', centre: 'to wall centres',
    name: 'Room name', angle: 'Rotation (°)', place: 'Place in plan', origin: 'Origin x,y (mm)', create: 'Create here',
    errors: { level: 'No such level', thickness: 'Thickness 50–1000 mm', height: 'Height at least 300 mm', size: 'Sizes at least 300 mm', cut: 'The cut must leave at least 300 mm of each side', closure: 'The walls do not close a room' },
  },
  roof: { menu: 'Roof from perimeter…', title: 'Roof from perimeter', kind: 'Roof', hip: 'Hip (4 slopes)', gable: 'Gable (2 slopes)', slope: 'Slope (°)', overhang: 'Overhang (mm)', create: 'Create roof' },
  stair: { menu: 'L / U stair…', title: 'L / U stair', kind: 'Kind', L: 'L (quarter turn)', U: 'U (half turn)', turn: 'Turn', left: 'Left', right: 'Right', width: 'Width (mm)', length1: 'Flight 1 run (mm)', length2: 'Flight 2 run (mm)', landing: 'Landing depth (mm)', gap: 'Gap between flights (mm)', origin: 'Start x,y (mm)', angle: 'Direction (°)', create: 'Create stair' },
  view3d: {
    modes: { section: '3D - Section View', exterior: '3D - Exterior', lowWalls: '3D - Low Walls', xray: '3D - See-through', walk: '3D - Walkthrough' },
    lowWalls: 'Low walls: cut at {h} mm (view only)', xray: 'Walls facing you at {p} % (view only)', walk: 'Walkthrough · W A S D / arrows · drag to look',
    collideOn: 'Collision on', collideOff: 'Collision off', doorsOpen: 'Doors open', doorsClosed: 'Doors closed', off: 'Off',
    blocked: 'Blocked by {what}', focus: 'Room {name}: camera to the room, level {level}',
    bookmarks: 'Saved views', save: 'Save current 3D view', saved: 'Saved view “{name}” (revision {rev})', restored: 'View “{name}” restored', stale: 'View “{name}” was saved at revision {rev}; the model is now at {now}', delete: 'Delete', name: 'View {n}',
    patch: '3D updated in place: {n} solids rebuilt in {ms} ms',
  },
}

export type LinkedMessages = typeof linkedEn

export const linkedVi: LinkedMessages = {
  rule: {
    noHost: '{mark}: không còn tường chủ',
    beyond: '{mark} sẽ vượt ra ngoài đầu tường chủ',
    nearEnd: '{mark} sẽ cách đầu tường chủ dưới {c} mm',
    tooTall: '{mark} sẽ cao quá đỉnh tường chủ',
    bad: '{mark}: rộng và cao phải dương, bậu không thấp hơn sàn',
    arc: '{mark}: bán kính phải ít nhất bằng nửa chiều dài tường',
    slope: '{mark}: chiều cao ở cuối tường phải dương',
  },
  props: {
    identity: 'Định danh mô hình', guid: 'GUID', rev: 'Phiên bản', src: 'Nguồn',
    srcKind: { drawn: 'Vẽ tay', imported: 'Nhập từ file', ai: 'AI (đã duyệt)', survey: 'Khảo sát', image: 'Từ ảnh (cần xem lại)' },
    review: 'cần xem lại',
    length: 'Chiều dài', angle: 'Góc', startX: 'Điểm đầu X', startY: 'Điểm đầu Y', baseLevel: 'Cao độ chân', baseOffset: 'Lệch chân', topOffset: 'Lệch đỉnh', height: 'Chiều cao', heightEnd: 'Chiều cao ở cuối',
    thickness: 'Chiều dày', radius: 'Bán kính cong', arcLength: 'Chiều dài cung', faceLeft: 'Chiều dài mặt trái', faceRight: 'Chiều dài mặt phải', centre: 'Chiều dài tim tường',
    width: 'Rộng', sill: 'Cao bậu', offset: 'Cách đầu tường', hinge: 'Bản lề', swing: 'Mở về', hingeL: 'Trái', hingeR: 'Phải', swingIn: 'Bên trái (vào)', swingOut: 'Bên phải (ra)',
    elevation: 'Cao độ', name: 'Tên', number: 'Số',
    net: 'Diện tích thông thủy', gross: 'Diện tích tim tường', perimeter: 'Chu vi thông thủy', liveArea: 'tính từ các tường bao', storedArea: 'giá trị lưu (không có tường bao)',
    focus3d: 'Xem phòng trong 3D', doorOpen: 'Hiện cửa mở trong 3D', doorClosed: 'Hiện cửa đóng trong 3D',
    straight: 'Thẳng', arc: 'Cong',
  },
  plan: {
    typed: 'Gõ chiều dài (4200), @dx,dy, x,y, 4200<90 hoặc R2500 · Enter',
    wallHint: 'Bấm điểm đầu rồi từng góc — hoặc gõ chiều dài (4200, @4200<90, @dx,dy) · Shift = khoá góc 15° · Alt = tắt bắt điểm · Esc / bấm đúp để kết thúc',
    typedBad: 'Không hiểu: {v}', typedRadius: 'Tường tiếp theo: cung bán kính {r} mm',
    arcMode: 'Dạng tường', arcHint: 'Bấm điểm đầu, điểm cuối, rồi một điểm cung đi qua · hoặc gõ R2500',
    snap: { end: 'Điểm đầu mút', mid: 'Trung điểm', int: 'Giao điểm', perp: 'Vuông góc', near: 'Gần nhất', grid: 'Lưới', none: '' },
    angleLock: 'Shift: khoá góc theo bước 15°',
    grip: 'Kéo tay nắm: đầu tường kéo dài tường (tường nối theo cùng, Alt để tách), giữa tường để dời',
    gripMoved: '{mark}: {what}', faces: 'tim {c} · mặt trái {l} · mặt phải {r}',
    smartHint: 'Bấm vào chỗ đặt phòng ({shape}, {w} × {d} mm) · Esc để huỷ',
    smartAdded: 'Phòng {number}: vẽ {walls} tường, dùng chung {reused} tường có sẵn, {area} m² thông thủy',
    roofAdded: 'Mái {mark} phủ {n} tường ({kind}, {slope}°) — tường không đổi',
    noWalls: 'Tầng này không có tường để lợp mái',
    stairAdded: 'Thang {kind} {mark}: {n} bậc cao {r} mm',
  },
  smart: {
    title: 'Phòng thông minh', menu: 'Phòng thông minh…', shape: 'Mẫu',
    shapes: { rect: 'Chữ nhật', L: 'Chữ L', U: 'Chữ U', polygon: 'Đa giác', round: 'Tròn', corridor: 'Hành lang' },
    w: 'Rộng X (mm)', d: 'Sâu Y (mm)', cutW: 'Rộng phần cắt (mm)', cutD: 'Sâu phần cắt (mm)', r: 'Bán kính (mm)', segments: 'Số đoạn', arcWalls: 'Tường cong (4 cung)',
    pts: 'Các góc x,y; x,y; … (mm)', thickness: 'Dày tường (mm)', height: 'Cao tường (mm)', dims: 'Kích thước là', inner: 'thông thủy', centre: 'tim tường',
    name: 'Tên phòng', angle: 'Xoay (°)', place: 'Đặt trên mặt bằng', origin: 'Gốc x,y (mm)', create: 'Tạo tại đây',
    errors: { level: 'Không có tầng này', thickness: 'Dày tường 50–1000 mm', height: 'Cao ít nhất 300 mm', size: 'Kích thước ít nhất 300 mm', cut: 'Phần cắt phải chừa mỗi cạnh ít nhất 300 mm', closure: 'Các tường không khép kín phòng' },
  },
  roof: { menu: 'Mái theo chu vi…', title: 'Mái theo chu vi tường', kind: 'Kiểu mái', hip: 'Mái 4 mái', gable: 'Mái 2 mái', slope: 'Độ dốc (°)', overhang: 'Vươn mái (mm)', create: 'Tạo mái' },
  stair: { menu: 'Thang L / U…', title: 'Cầu thang L / U', kind: 'Kiểu', L: 'Chữ L (rẽ 90°)', U: 'Chữ U (quay 180°)', turn: 'Rẽ', left: 'Trái', right: 'Phải', width: 'Rộng vế (mm)', length1: 'Dài vế 1 (mm)', length2: 'Dài vế 2 (mm)', landing: 'Sâu chiếu nghỉ (mm)', gap: 'Khe giữa hai vế (mm)', origin: 'Điểm đầu x,y (mm)', angle: 'Hướng (°)', create: 'Tạo thang' },
  view3d: {
    modes: { section: '3D - Mặt cắt tầng', exterior: '3D - Bên ngoài', lowWalls: '3D - Tường thấp', xray: '3D - Xuyên tường', walk: '3D - Đi bộ' },
    lowWalls: 'Tường thấp: cắt ở {h} mm (chỉ hiển thị)', xray: 'Tường phía trước còn {p} % (chỉ hiển thị)', walk: 'Đi bộ · W A S D / phím mũi tên · kéo để nhìn',
    collideOn: 'Va chạm: bật', collideOff: 'Va chạm: tắt', doorsOpen: 'Cửa mở', doorsClosed: 'Cửa đóng', off: 'Tắt',
    blocked: 'Bị chặn bởi {what}', focus: 'Phòng {name}: camera tới phòng, tầng {level}',
    bookmarks: 'Góc nhìn đã lưu', save: 'Lưu góc nhìn 3D hiện tại', saved: 'Đã lưu góc nhìn “{name}” (phiên bản {rev})', restored: 'Đã mở góc nhìn “{name}”', stale: 'Góc nhìn “{name}” lưu ở phiên bản {rev}; mô hình nay ở {now}', delete: 'Xoá', name: 'Góc nhìn {n}',
    patch: '3D cập nhật tại chỗ: dựng lại {n} khối trong {ms} ms',
  },
}

const lang = () => useSettings.getState().language
/** The linked-model strings in the current language (outside React). */
export const linkedT = (): LinkedMessages => (lang() === 'vi' ? linkedVi : linkedEn)
/** Hook: the linked-model strings, re-rendering on a language change. */
export function useLinkedT(): LinkedMessages {
  const l = useSettings((s) => s.language)
  return l === 'vi' ? linkedVi : linkedEn
}

/** The message of a broken model rule. */
export function ruleText(mark: string, code: keyof LinkedMessages['rule']): string {
  return linkedT().rule[code].replace('{mark}', mark).replace('{c}', '50')
}
