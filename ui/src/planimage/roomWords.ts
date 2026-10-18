/**
 * Words of room names and plan titles (Vietnamese and English) for the OCR clean-up: a word read without (or with
 * wrong) diacritics is put back to the dictionary form when it is the same word without them ("BÊP" → "BẾP",
 * "ĐÀO" → "ĐẢO", "TÀNG" → "TẦNG"). Nothing is guessed beyond that: other words stay as read.
 */
const WORDS = `PHÒNG P. KHÁCH BẾP ĂN NGỦ MASTER WC VỆ SINH TẮM KHO SẢNH ĐÓN TIỀN THANG MÁY BỘ HỘP KT KỸ THUẬT GIẶT PHƠI SÂN
GIA CÔNG ĐA NĂNG GIÚP VIỆC LÀM THỜ HOẠT CHUNG BAN LÔ THÔNG TẦNG ĐẢO GARA XE ĐỂ CHỨA ĐỒ THAY GYM SỞ THÍCH HÀNH LANG LỐI
ĐI KHU VƯỜN HIÊN MÁI TRƯỚC SAU TRẺ EM ĐỌC SÁCH KARAOKE GIẢI TRÍ XÔNG HƠI BỂ BƠI TIẾP ĐỢI CHỜ BẢO VỆ TRỰC NGHỈ PHỤ
LÊN XUỐNG TRỆT LỬNG HẦM TUM MẶT BẰNG TỶ LỆ TL KIẾN TRÚC CỬA SỔ ĐI ÔNG BÀ CON TRAI GÁI LỚN NHỎ CLOSET WALK-IN
LIVING ROOM KITCHEN BED BEDROOM BATH BATHROOM TOILET DINING STORE STORAGE LAUNDRY LOBBY HALL STAIR STAIRS LIFT
BALCONY TERRACE OFFICE STUDY GARAGE UTILITY ENTRANCE FOYER PANTRY FAMILY GUEST PLAN FLOOR GROUND LEVEL SCALE VOID`
  .split(/\s+/)
  .filter(Boolean)

const key = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toUpperCase()
const BY_KEY = new Map<string, string>()
for (const w of WORDS) if (!BY_KEY.has(key(w))) BY_KEY.set(key(w), w)

/** The dictionary form of a word read by OCR (same letters without diacritics), else null. */
export function lexiconWord(raw: string): string | null {
  const m = /^([^\p{L}\p{N}]*)([\p{L}\p{N}.\-/+]+?)([^\p{L}\p{N}]*)$/u.exec(raw.trim())
  if (!m) return null
  const core = m[2]
  let hit = BY_KEY.get(key(core)) ?? (core.endsWith('.') ? null : BY_KEY.get(key(core) + '.'))
  // one letter off (a dropped / misread letter) for longer words: "KHÁC" → KHÁCH, "TRANG" → THANG
  if (!hit && /^\p{L}{4,}$/u.test(core)) {
    const k = key(core)
    for (const [lk, w] of BY_KEY) if (lk.length >= 4 && Math.abs(lk.length - k.length) <= 1 && edit1(lk, k)) { hit = w; break }
  }
  if (!hit) return null
  return m[1].replace(/[^+/()]/g, '') + hit + m[3].replace(hit.endsWith('.') ? /[^+/()]/g : /[^.+/()]/g, '')
}

export const isLexicon = (raw: string) => lexiconWord(raw) !== null

/** Strings at most one edit apart (substitution, insertion, deletion). */
function edit1(a: string, b: string): boolean {
  if (a === b) return true
  if (Math.abs(a.length - b.length) > 1) return false
  let i = 0, j = 0, d = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue }
    if (++d > 1) return false
    if (a.length > b.length) i++
    else if (b.length > a.length) j++
    else { i++; j++ }
  }
  return d + (a.length - i) + (b.length - j) <= 1
}
