# QA v2.4 — Nền tảng (M6): phím tắt, phiên bản, migration, bản vẽ, ⌘K, mẫu, i18n, ngoại tuyến, giấy phép

**Ngày:** 2026-10-18 · **Nhánh:** `worktree-agent-adfb7e44dfdb4f355` (đã merge `main` 91b9513) · **Phạm vi:** SP34, SP35, SP39, SP48, SP49, SP50, SP51, SP61, SP62, SP64.

Quy ước trạng thái: **Đã làm** = có code; **Đã kiểm** = có bài kiểm thử tự động đã CHẠY và ĐẠT trong phiên này. Không bài nào được ghi đạt nếu chưa chạy.

## 1. Kết quả tổng hợp (đã chạy)

| Bộ kiểm thử | Lệnh | Kết quả |
|---|---|---|
| Type check | `cd ui && npx tsc --noEmit -p tsconfig.app.json` | Đạt (0 lỗi) |
| Unit nền tảng | `cd ui && UNIT=platform node tools/test-cam.mjs run` | **10/10 nhóm đạt** (`all: true`): profiles, perProject, migrations, projectJson, snapshots, templates, search, plot, hostErrors, i18n |
| Unit có sẵn (hồi quy) | `UNIT=auto …`, `UNIT=fromcad …`, `UNIT=importcal …`, `UNIT=edit`, `UNIT=layouts` | auto 61/61, fromcad 82/82, importcal 33/33; edit, layouts chạy bình thường |
| 23 bộ smoke (máy chủ dev riêng :5247) | `THCAD_UI=http://127.0.0.1:5247 node tools/smoke-*.mjs` | **23/23 bộ, 302 bước ĐẠT, 0 lỗi** (sau khi merge main) |
| Desktop e2e | `qa/tools/rune2e.sh …/e2e_platform.js 120 THCAD_PROFILE=platform-adfb7e44 THCAD_UI_URL=http://127.0.0.1:5247 THCAD_SPLASH=0 THCAD_PDF_OUT=…` | 4/4 ĐẠT (`E2E DONE OK`) |
| Đo PDF thật của host | `python3 qa/tools/check-pdf-ruler.py qa/v2_4/platform/sheet_set_a0_a4.pdf A3,0 A1,0 A0,50 A4,100` | `ok: true` (chi tiết §5) |
| Chạy ngoại tuyến | `qa/tools/offline-run.sh` (3 lần, §9) | Tự kiểm 17/17 ĐẠT, **0 kết nối ra ngoài** |
| Cổng SBOM / giấy phép | `cd ui && node tools/check-sbom.mjs --selftest` | `ok: true`, 0 vấn đề; tự kiểm 4/4 quy tắc đều báo lỗi khi thiếu mục |

## 2. Hồ sơ thao tác (SP61) — V24-038, V24-039

**Đã làm:** `ui/src/platform/keymap.ts` (hồ sơ AutoCAD / SketchUp / 3ds Max / MD Bố trí mặt bằng, chỉ gán phím cho thao tác app đã có), `profileState.ts`, `useKeyActions.ts`, `PlatformHost.tsx` (bộ điều phối phím duy nhất), `Cheatsheet.tsx` (bảng tra phím, ⌘/), Cài đặt → Phím tắt (chọn hồ sơ, phạm vi "Mọi dự án" / "Chỉ dự án này", sửa phím từng thao tác, lý do không hiệu lực). Lưu: `thcad.settings` → `keyProfile`, `keyMaps`, `projectKeyProfiles` (theo id dự án; dự án hiện tại = `workspace.currentId`, đặt khi mở / tạo dự án).

Quy tắc va chạm (kiểm bằng code, không chỉ bằng giao diện):
- Trong CAD 2D, phím không có ⌘/Alt (chữ, số, Space, Shift+chữ) **luôn thuộc dòng lệnh**: binding đó bị đánh dấu "không hiệu lực" kèm danh sách lệnh tắt bị chiếm (VD `L` → L, LA, LINE, LAYER).
- Phím tắt ứng dụng (⌘K, ⌘Z, F3…) thắng trong phạm vi chúng tác động (F3 OSNAP chỉ ở CAD 2D nên F3 "khung dây" của 3ds Max trong BIM vẫn hợp lệ).
- Trùng phím trong cùng phạm vi, phím dành riêng (Esc, Enter, Tab, Delete, Backspace) → không hiệu lực.
- Hoàn tác BIM (trước đây cứng ⌘Z ở `BimScreen.tsx:36`) và `undoKeys` dùng chung của Nội thất / MEP / Hạ tầng / Cơ khí / Kết xuất nay đi theo bảng phím tắt.

Bằng chứng (đã chạy, ĐẠT):
- `profiles`: không hồ sơ nào có phím gõ tác động trong CAD 2D (`leaks: []`), kể cả khi người dùng gán mọi thao tác CAD 2D cho chữ cái; `L`/`PL`/`TR` được liệt kê đúng; MD `W` = tường trong BIM; SketchUp `L` = tường, `Space` = chọn; 3ds Max `F3` = khung dây trong BIM.
- smoke-cad2d **"V24-038: with the SketchUp profile active, typed AutoCAD aliases PL / TR / L still reach the command line"** — gõ P,L,Enter → công cụ polyline; T,R,Enter → trim; L,Enter → line.
- smoke-settings **"interaction profile per project (V24-039)"**: chọn SketchUp chỉ cho Villa Riverside, Lưu, tải lại trang → còn nguyên; mặc định vẫn AutoCAD. **"profile keys act in BIM … switch with the project"**: ở Villa Riverside phím `l` → công cụ tường + mặt bằng, `o` → 3D; chuyển sang TH Office Building → `l` không làm gì.
- unit `perProject`: ghi vào localStorage, rehydrate sau khi xoá trạng thái, đổi dự án hiện tại thì đổi hồ sơ.
- smoke-settings **"cheatsheet (⌘/)"**, **"BIM undo follows Settings → Keyboard Shortcuts"** (đổi Hoàn tác sang ⌘U: ⌘Z không hoàn tác nữa, ⌘U hoàn tác).
- e2e desktop: bảng tra phím mở được trong app thật.

## 3. Lịch sử phiên bản & snapshot (SP50) — V24-062 (một phần), V24-063

**Đã làm:** `ui/src/platform/snapshots.ts`, `VersionHistory.tsx`. Snapshot gồm 7 store mô hình: BIM, Nội thất, bản vẽ CAD 2D (docs/tabs/active), MEP, Hạ tầng, Cơ khí, Kết xuất. Lưu trong IndexedDB **cùng cơ sở dữ liệu của `auto/backup.ts`** (`thcad-backup`/`kv`, khoá riêng `thcad.snapshots`, `thcad.snapshot.<id>`); hộp thoại còn liệt kê và khôi phục được bản sao lưu "trước khi thay mô hình" của `auto/backup.ts`.
- Khi nào chụp: `autoRecover` → mỗi N phút (khoảng tự lưu của dự án hiện tại, mặc định 10) nếu có thay đổi; `backup` → khi Lưu (CAD 2D Lưu, hoặc ⌘S ở màn khác) và trước thao tác rủi ro (khôi phục, nhập JSON, tạo từ mẫu, thay thế lớn: mất ≥ 50 % phần tử một lần). "Lưu phiên bản ngay" luôn chụp. Giữ 20 bản mới nhất, tối đa 10 bản tự động.
- Nguồn gốc: thời gian, nhãn, lý do, phiên bản app `0.1.0`, lược đồ 1, dự án, phiên bản persist của từng store, **mã revision (FNV-1a của nội dung) cho từng store**, số lượng phần tử.
- Diff: so số lượng từng danh sách (VD `BIM walls 4 → 24`) và cờ nội dung khác.
- Khôi phục: qua hàm `edit()` có kiểm tra của từng store (mỗi store một bước hoàn tác; CAD qua `useCad.restoreDoc` mới, đồng bộ engine native bằng erase+add); bản cũ hơn được migrate bằng chính hàm migrate của store; luôn chụp "trước khi khôi phục" trước.

Bằng chứng: unit `snapshots` (lưu, bỏ qua khi không đổi, diff 24→23 tường, autoRecover tắt thì không chụp, khôi phục, bản "before", hoàn tác được, backup tắt thì không chụp, giữ 20/10); smoke-projects **"Version history (project menu): diff in counts, restore the version before the template (undoable)"**.

## 4. Project JSON (SP39)

**Đã làm:** `ui/src/platform/projectJson.ts` — định dạng `md-cad-ai-studio/project`, schema 1, `storeVersions`, `revisions`, `counts`, `stores`. Nhập: kiểm định dạng / schema / có store; migrate phần cũ; snapshot trước; áp qua `edit()`.
Bằng chứng: unit `projectJson` — xuất → JSON → nhập vào mô hình mẫu → xuất lại: **revision và nội dung trùng khớp tuyệt đối** cho cả 7 store; nhập là bước hoàn tác; từ chối JSON hỏng / sai định dạng / schema mới hơn; tệp có Nội thất v1 (phòng chồng lấn) được migrate khi nhập. smoke-projects **"Project JSON: export … and import it back"** (tải tệp `QA Room.mdproj.json` thật, 7 revision, nhập lại).

V24-062: mỗi tệp dự án / snapshot mang mã revision của từng store, nên bản vẽ / render / NC có thể ghi lại "thiết kế đã duyệt" mà chúng sinh ra. **Chưa làm:** gắn mã revision này vào chính tệp PDF / render / NC xuất ra (thuộc phạm vi CAM / Renders) → ghi ở mục nhu cầu liên phạm vi.

## 5. Migration (V24-063)

**Đã sửa lỗi mất dữ liệu:** `state/interior.ts` v1→v2 trước đây thay **toàn bộ** phòng bằng phòng mẫu. Nay `migrateInterior` (`state/migrations.ts`) giữ mọi phòng; chỉ phòng mẫu (cùng id) còn chồng lấn phòng bên cạnh mới nhận đường bao đã sửa, giữ tên / chiều cao / vật liệu của người dùng.
**Thêm migrate có phiên bản** (v1 → v2, chỉ bổ sung cái thiếu): CAD 2D (`thcad.cad`), Hạ tầng, Cơ khí, Kết xuất, Thư viện. BIM và MEP đã có migrate.
Bằng chứng: unit `migrations` nạp **fixture trạng thái persist cũ của 8 store** (có dữ liệu riêng của người dùng: phòng "Phòng làm việc", tường W99, bản vẽ "Nhà phố.dwg", tuyến "Kênh N2", tốc độ bơm 1450, camera "(mine)", thư viện…) và kiểm **không mất giá trị lá nào** (`lost` rỗng cho cả 8; ngoại lệ có chủ đích: 2 đường bao mẫu chồng lấn, và tab/active trỏ tới bản vẽ không còn). Kèm chứng minh migration cũ làm mất phòng của người dùng.

## 6. Bản vẽ: A0, thước kiểm tra, cờ in (SP34/SP35) — V24-035

**Đã làm:** `cad/plot.ts` thêm A0 (1189×841) và A1/A0 khổ đứng; tuỳ chọn **thước kiểm tra** trên layout (100 mm trên giấy, thanh 1 m mô hình = 1000/tỷ lệ mm; 10 m / 100 m ở tỷ lệ nhỏ) ở dải phía trên khung tên, có cả trong DXF paper space; cờ **"In / Chỉ trên màn hình"** cho từng đối tượng (`noPlot`), tách khỏi hiển thị layer (Properties của CAD 2D, chỉ hiện khi có chọn đối tượng).

Bằng chứng:
- unit `plot`: A0 1189×841, SVG `viewBox="0 0 1189 841"`, đoạn thước 100.000 mm và thanh 20.000 mm (1:50), không có thước khi tắt, đối tượng `noPlot` không vào bản in nhưng vẫn trong bản vẽ.
- smoke-cad2d **"Sheets: A0 / A0 portrait, check ruler …, plot flag on a dimension"**.
- **PDF thật do host (Qt QPdfWriter) tạo** (`qa/v2_4/platform/sheet_set_a0_a4.pdf`, 4 trang), đo bằng `qa/tools/check-pdf-ruler.py` (giải nén luồng nội dung, áp ma trận CTM, đo đoạn thẳng):

| Trang | Khổ | MediaBox (pt) | Kích thước (mm) | Sai lệch khổ | Thước 100 mm | Thanh mô hình |
|---|---|---|---|---|---|---|
| 1 | A3 | 1191 × 842 | 420.158 × 297.039 | +0.158 / +0.039 mm | — | — |
| 2 | A1 | 2384 × 1684 | 841.022 × 594.078 | +0.022 / +0.078 mm | — | — |
| 3 | A0 1:50 | 3370 × 2384 | 1188.861 × 841.022 | −0.139 / +0.022 mm | **100.0000 mm** | **20.0000 mm** (1 m) |
| 4 | A4 1:100 | 842 × 595 | 297.039 × 209.903 | +0.039 / −0.097 mm | **100.0000 mm** | **10.0000 mm** (1 m) |

`pdfinfo` xác nhận cùng kích thước trang. Thước trên PDF chính xác tuyệt đối. **Phát hiện:** QPdfWriter làm tròn MediaBox về số nguyên point → khổ giấy lệch tối đa 0.16 mm so với ISO (hình vẽ bên trong không bị ảnh hưởng). Cách sửa nằm ở host native (`HostBridge::writePdf`), ngoài phạm vi agent này.
**Phần thủ công còn lại của V24-035** (in ở 100 % và đo bằng thước thật) **chưa làm** — cần anh in thử.

## 7. ⌘K (SP48)

**Đã làm:** `platform/search.ts` + `SearchBar.tsx`: tìm lệnh CAD 2D theo tên / lệnh tắt (lệnh tắt khớp chính xác như `PL` được xếp đầu), công cụ / chế độ xem của BIM và Nội thất (kèm phím của hồ sơ đang dùng), cấu kiện thư viện, trang Cài đặt, bảng tra phím / lịch sử phiên bản / xuất dự án. Tìm tiếng Việt không dấu ("tuong" → Tường). ⌘K là tổ hợp có ⌘ nên không chiếm phím gõ trong CAD 2D.
Bằng chứng: unit `search`; smoke **"⌘K finds commands (PL → PLINE in CAD 2D), tools (Wall → BIM), settings pages, library and the cheatsheet"**; bước ⌘K cũ ("pump" → dự án) vẫn đạt.

## 8. Mẫu dự án có nội dung (SP49)

**Đã làm:** `platform/templates.ts`, `templateApply.ts`, hộp "Từ mẫu" (6 mẫu nội dung + 4 mẫu thư mục cũ giữ nguyên): Căn hộ, Nhà ở, Một phòng, Tủ bếp, Văn phòng, Hoàn thiện nội thất — dựng từ dữ liệu mẫu có sẵn (biệt thự BIM, căn hộ nội thất) hoặc vỏ tường/cửa cùng kiểu phần tử; mỗi mẫu có bản vẽ mặt bằng CAD 2D thật (tường, cửa, tên phòng + diện tích, kích thước tổng), có `version`. Tạo dự án → thư mục + tệp, nạp mô hình vào BIM / Nội thất (một bước hoàn tác, có snapshot trước), mở bản vẽ ở tab mới.
Bằng chứng: unit `templates` (6 mẫu qua quy tắc mô hình Nội thất và `edit()` BIM, bản vẽ có nội dung, tủ bếp ≥ 3 tủ); smoke-projects **"From Template with content (One room)"**.

## 9. Ngoại tuyến (SP62) — V24-048

Quy trình `qa/tools/offline-run.sh` (không cần quyền admin): proxy HTTP/HTTPS/ALL trỏ vào cổng chết `127.0.0.1:9`, Chromium `--proxy-server=127.0.0.1:9` và tắt mạng nền; loopback vẫn cho phép. Trong lúc chạy, `lsof -nP -i` lấy mẫu mọi socket của app **và các tiến trình con** mỗi 0,5 s. Giới hạn (nói thẳng): chương trình bỏ qua proxy và nối thẳng IP sẽ không bị chặn — nhưng vẫn bị thấy khi lấy mẫu (trừ khi mở và đóng giữa hai lần lấy mẫu).

| Lần chạy | Kết quả | Socket thấy | Ra ngoài |
|---|---|---|---|
| Bản dev `native/build`, UI đóng gói (thcad://), `THCAD_SELFTEST=1` | 17/17 ĐẠT, gồm *aiTask JSON có ngữ pháp từ mô hình cục bộ* và *AI trả đề xuất chờ duyệt*, Qwen2.5-7B Q4_K_M trên Apple M1 Max (Metal) | 0 | **0** |
| **App đóng gói `native/dist` (bản cài)**, `THCAD_SELFTEST=1` | 17/17 ĐẠT (cùng các bài AI) | 0 | **0** |
| Bản dev + UI dev 127.0.0.1:5247, `e2e_platform.js` (in PDF A0/A4) | 4/4 ĐẠT, PDF đo lại `ok: true` | 42 (đều loopback tới :5247) | **0** |

Nhật ký: `qa/v2_4/platform/offline-*/summary.txt`, `connections.txt`, `app.log`. Không cần khoá cloud nào. Lần chạy chưa phủ: tải mô hình (chức năng duy nhất cần mạng, do người dùng bấm), giọng nói Whisper, và Windows.

## 10. Giấy phép & SBOM (SP64) — V24-065

**Đã làm:** `docs/SBOM.json` do `ui/tools/make-sbom.mjs` tạo: 26 gói npm sản xuất (24 thật sự vào bản dựng, xác định bằng một bản build Vite; 2 gói chỉ cho Node đánh dấu "không phân phối"), 27 thành phần native (thư viện, plug-in, chương trình phụ — đối chiếu với `native/dist/…app`), 4 mô hình, 5 nhóm tài sản (114 tệp, có sha256), 9 công cụ build (không phân phối). **Qwen2.5-3B: `commercialUse: false` + cờ cảnh báo** (Qwen Research License); Qwen2.5-7B Apache-2.0; Whisper MIT; tessdata `vie` Apache-2.0. Cài đặt → Tải mô hình hiện nhãn "giấy phép phi thương mại" cạnh bản 3B (chỉ hiện trong app desktop; **chưa chạy e2e cho nhãn này**).
`ui/tools/check-sbom.mjs` thất bại khi: tệp trong `ui/public` / branding không có mục (hoặc sha256 đổi), gói npm thiếu / lệch phiên bản, mô hình tải được thiếu mục, thư viện / plug-in / helper trong app đóng gói thiếu mục, dòng `THIRD_PARTY_NOTICES.md` không có thành phần, giấy phép UNKNOWN, mô hình không ghi quyền thương mại, hoặc có định dạng mô hình 3D / texture / HDRI (.glb, .fbx, .hdr, .exr…). `--selftest` chứng minh từng quy tắc báo lỗi.
**Phát hiện:** app đóng gói chứa nhiều thư viện mà `THIRD_PARTY_NOTICES.md` chưa nêu (GLib, libintl, D-Bus, Graphite2 — LGPL/AFL; ICU, HarfBuzz, OpenSSL, PCRE2, zstd, Brotli, libpng, libjpeg-turbo, libomp, oneTBB…). Đã bổ sung vào notices; **kịch bản đóng gói chưa chép văn bản giấy phép của chúng vào `licenses/`** (việc của packaging).
Tài sản: không có mô hình / texture stock; ảnh đi kèm là ảnh cắt mockup DEMO (`productionUse: false`), branding và dữ liệu OCR.

## 11. i18n (SP51) — V24-040

**Đã làm:** namespace `ui/src/i18n/ws/platform.ts` (EN + VI cho mọi chuỗi mới); unit `i18n` duyệt mọi khoá của `en`/`vi` gồm mọi namespace `ws/*`: 0 khoá thiếu, 0 khoá thừa (trừ bảng tra theo tên EN để trống có chủ đích), 0 chuỗi rỗng; báo chuỗi VI giống hệt EN mà không phải tên riêng / mã / định dạng. Đã dịch 4 chuỗi ở Cài đặt (Theme → "Chủ đề" ×2, "English (EN)" → "Tiếng Anh (EN)", "CAD engine" → "Bộ máy CAD"); vùng của agent này (platform + settings) còn **0**. Còn **25 chuỗi** ở khu vực khác để các nhóm tự xem (dashboard 4, ai 4, bim 4, components 4, cad 2, mep 2, importCal 2, interior 1, mechanical 1, renders 1 — phần lớn là thuật ngữ như "Offset", "Layer", "Family", "Scan to CAD"); danh sách: `UNIT=platform node tools/test-cam.mjs i18nList`.
Lỗi từ host native: `platform/hostErrors.ts` dịch các lỗi thường gặp (thư mục chưa chọn, thiếu bộ ghi DWG, hết dung lượng, sai checksum, không ghi được tệp, hết giờ, bận…), lỗi lạ hiển thị nguyên văn; dùng ở xuất PDF / DWG CAD 2D và tải mô hình / giọng nói trong Cài đặt. Unit `hostErrors` ĐẠT.

## 12. Hồi quy giao diện (V24-064)

23/23 bộ smoke đạt sau khi merge `main`. Không đổi bố cục 12 màn khoá. Phần mới nằm trong: mục Cài đặt → Phím tắt và Cài đặt → Tệp (không phải trang General đã khoá), hộp thoại (bảng tra phím, lịch sử phiên bản, từ mẫu), menu thẻ dự án, thanh layout CAD 2D (ô "Thước kiểm tra"), và một dòng "In" trong Properties CAD 2D **chỉ khi có đối tượng được chọn** (bảng khi chưa chọn giữ nguyên như mockup).

## 13. Chưa làm / cần quyết

- In thật ở 100 % và đo bằng thước (phần thủ công V24-035).
- Đưa mã revision vào PDF / render / NC xuất ra (V24-062 đầy đủ).
- MediaBox làm tròn của QPdfWriter (native), văn bản giấy phép các thư viện mới vào `licenses/` (packaging), cờ `noPlot` trong DXF (R12 không có; R2000 có thể dùng layer không in).
- Chạy ngoại tuyến trên Windows.
