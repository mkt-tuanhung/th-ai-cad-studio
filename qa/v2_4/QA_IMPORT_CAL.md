# QA v2.4 — Hiệu chỉnh tỷ lệ khi nhập ảnh/PDF, REVIEW REQUIRED, phòng đo thực tế, tác vụ AI mẫu, hàng việc AI có checkpoint

**Ngày:** 2026-10-18. **Nhánh:** `worktree-agent-ad6918d500c0bd3b3`.
**Phạm vi (crosswalk):** SP12, SP13, SP14, SP28 (phần preset), SP30.
**Bài nghiệm thu:** V24-017, V24-018, V24-019, V24-020, V24-031, V24-032.
**Thiết kế:** `docs/v2_4/AUDIT_AND_DELTA.md` §3.6 và giai đoạn M4.

Mọi kết quả dưới đây là kết quả đã **chạy thật** trên máy này: dev server riêng ở cổng 5287, Chromium headless (Playwright). Chưa chạy e2e trên bản desktop: e2e_scan.js nằm trong `native/`, ngoài phạm vi được sửa.

## 1. Đã làm gì

| # | Hạng mục | Trạng thái | Code chính |
|---|---|---|---|
| 1 | Hiệu chỉnh 2 điểm. Dùng chữ kích thước OCR / chữ trong PDF làm tham chiếu. Từ 2 tham chiếu trở lên thì có sai số dư. Chọn trang PDF tường minh, hiệu chỉnh riêng từng trang | Implemented + Tested | `cad/calibration.ts`, `screens/ai/ScanToCad.tsx`, `screens/ai/CalibrationPicker.tsx` |
| 1b | Hiệu chỉnh sau khi đã mở bản vẽ (lệnh `CALIBRATE` trong CAD 2D, một bước hoàn tác) | Implemented + Tested | `screens/cad2d/CalibrateDialog.tsx`, `cad/importReview.ts › recalibrate` |
| 2 | Nguồn gốc (provenance) cho từng đối tượng, `REVIEW REQUIRED` (banner + thuộc tính của tài liệu), `fabricationAllowed(doc)` | Implemented + Tested | `cad/provenance.ts`, `cad/importReview.ts › buildImport`, `screens/cad2d/CanvasCard.tsx`, `ReviewDialog.tsx`, `RightPanel.tsx` |
| 3 | Chữ OCR chưa chắc chắn được giữ lại để xem lại. Đối chiếu chữ kích thước với hình học. Xác nhận / loại từng mục. Sản xuất bị chặn cho tới khi giải quyết hết | Implemented + Tested | `cad/vectorize.ts › classifyWord`, `cad/importReview.ts › mismatchItems`, `ReviewDialog.tsx` |
| 4 | Phòng đo thực tế: cạnh, góc, đường chéo, tường, trần, dung sai, cửa. Hàm thuần + hộp thoại | Implemented + Tested | `cad/survey.ts`, `screens/cad2d/SurveyRoomDialog.tsx` (lệnh `SURVEYROOM`) |
| 5 | 7 tác vụ AI mẫu trong AI Intelligence Studio, trạng thái trung thực | Implemented + Tested | `ai/presets.ts`, `screens/ai/TaskPresets.tsx` (menu ⋯ của khung chat) |
| 6 | Hàng việc AI có checkpoint và khoá idempotency; tiếp tục sau khi khởi động lại; "Cần anh" khi thiếu số đo | Implemented + Tested | `ai/jobs.ts`, `ai/jobActions.ts`, `state/aiStudio.ts`, `screens/auto/AutoDialog.tsx` |
| 7 | Chuỗi EN + VI | Implemented + Tested (smoke có bước VI) | `i18n/ws/importCal.ts` |
| + | Sửa bộ vector hoá: đường đo giữ đúng chiều dài tại chỗ giao, và không bị ô chữ cắt đứt | Implemented + Tested | `cad/vectorize.ts` (`trace`, `eraseBox`) |

## 2. Cách hoạt động (tóm tắt)

**Hiệu chỉnh tỷ lệ**
- Mỗi tham chiếu gồm hai thứ: khoảng đo trên nguồn (px của ảnh, hoặc mm trên giấy của trang PDF) và khoảng cách thật (mm).
- Hệ số tỷ lệ là bình phương tối thiểu đi qua gốc: `k = Σ m·t / Σ m²`.
- Sai số dư là RMS của `(k·m − t)`. Có từ 2 tham chiếu trở lên mới tính; với 1 tham chiếu thì sai số dư = null và giao diện ghi "thêm tham chiếu thứ hai".
- Không có tham chiếu thì **không có hiệu chỉnh**, phần mềm không đoán.

**Chưa hiệu chỉnh**
- Hình học giữ đúng như suy ra từ điểm ảnh, theo dpi × tỷ lệ danh nghĩa mà người dùng chọn. Hành vi cũ được giữ.
- Mỗi đối tượng được gắn `src.unscaled = true`. Nguồn có `status: 'unscaled'` và `calibration: null`.
- Tài liệu có `provenance.reviewRequired = true`. Banner **REVIEW REQUIRED · n** hiện trên hàng tab của vùng vẽ, nằm ngoài khe viewport native.
- `fabricationAllowed(doc)` trả `{ok:false, reasons:[{code:'uncalibrated'}]}`.

**API cho phía CNC / sản xuất**
```ts
import { fabricationAllowed } from 'ui/src/cad/provenance'
fabricationAllowed(doc: CadDocument | null) → { ok: boolean, reasons: { code: 'uncalibrated' | 'open-review', detail, sourceId?, items? }[] }
```
- Trả `false` khi có nguồn ảnh/PDF chưa hiệu chỉnh, hoặc còn mục cần xem lại đang mở (OCR chưa chắc, chữ kích thước lệch, khảo sát vượt dung sai, thiếu số đo).
- Bản vẽ không có provenance (vẽ trong app, mở từ DXF/DWG) **không** bị cổng này chặn. Các cổng khác như hồ sơ máy và cổng phát hành vẫn áp dụng.
- Có hàm phụ: `reviewRequired(doc)`, `openReview(doc)`, `entitySource(doc, entity)`.

**OCR**
- Chữ có độ tin cậy dưới 65 % không còn bị bỏ đi. Nó trở thành text trên layer `SCAN-TEXT-REVIEW`, kèm `src.confidence` và một mục `ocr-low-confidence`.
- Điểm ảnh của chữ chưa chắc không bị xoá khỏi ảnh nét, vì đó có thể là một phần bản vẽ.
- Sau khi hiệu chỉnh, mỗi chữ kích thước được ghép với đoạn thẳng song song gần nhất (trong 3 lần chiều cao chữ). Lệch quá max(10 mm, 1 %) thì tạo mục `ocr-dimension-mismatch`, ghi cả hai giá trị.

**Hàng việc AI**
- Bước gồm ba loại: `compute` (thuần, được chạy lại), `apply` (đổi mô hình; trước khi làm ghi checkpoint `applying`, làm xong ghi `done` + khoá `jobId:stepId:rev`) và `user` (chờ người dùng).
- Khi khởi động lại:
  - bước đang `running` quay về `pending`;
  - bước đang `applying` thành câu hỏi "đã áp dụng chưa?" để không bao giờ áp dụng hai lần;
  - việc đang chạy chuyển sang `queued` và hiện toast báo.
- Thiếu số đo bắt buộc thì việc chuyển sang `needs-user` kèm câu hỏi.

## 3. Bằng chứng kiểm thử

### 3.1 Unit — `ui/tools/unit/importcal.test.ts` (có assert)
```
UNIT=importcal node tools/test-cam.mjs run        → {"all": true, "passed": 33, "total": 33}
UNIT=importcal node tools/test-cam.mjs queue      → {"all": true, "passed": 11, "total": 11}
UNIT=importcal node tools/test-cam.mjs junctions  → {"all": true, long: [160, …]}
```
Kết quả gốc: `qa/v2_4/importcal_unit_run.json`, `importcal_unit_queue.json`, `importcal_unit_junctions.json`.

Các trường hợp chính:
- **Toán hiệu chỉnh:**
  - 2 tham chiếu khớp: k = 5, sai số dư 0.
  - 2 tham chiếu lệch (1400→7000, 700→3540): k = 12.278e6 / 2.45e6, sai số dư = √640 = 25,3 mm, lệch lớn nhất 32 mm. Tính tay và khớp.
  - 3 tham chiếu: có sai số dư.
  - 1 tham chiếu: sai số dư = null.
  - 0 tham chiếu: null.
- **Chưa hiệu chỉnh:** `fabricationAllowed` = false, lý do `uncalibrated`. Thuộc tính `reviewRequired` bật. Mọi đối tượng có cờ `unscaled`. Hình học giữ nguyên theo điểm ảnh. Mục `uncalibrated` không thể "xác nhận" cho qua.
- **OCR lệch:** "3600" cạnh đường dài 3540 mm (sau khi hiệu chỉnh bằng "7000" + "3400") cho mục mismatch ghi `ocrValue 3600`, `measuredMm 3540`. Còn mục mở thì vẫn chặn; giải quyết hết thì `fabricationAllowed` = true.
- **Khảo sát:**
  - Chữ nhật 4000×3000 có 2 đường chéo 5000: khép kín, vuông, 12 m².
  - Đường chéo 5030: lệch vuông, vượt dung sai.
  - Đi cạnh 4000/3000/4010/3000: sai số khép 10 mm, đã phân bổ.
  - Phòng chữ L có góc 270°: khép đúng, 24 m².
  - Tam giác 3-4-5: 6 m².
  - Độ dài không khép được: báo lỗi.
  - Mặt ngoài tường: 4400 × 3400.
  - Cửa thiếu chiều rộng: tạo mục `missing-measurement` (`door1.width`) và chặn sản xuất. Nhập 900 thì cửa được vẽ bằng 2 nét ô cửa và cổng mở.
- **Tiếp tục hàng việc (V24-032):**
  - Sập ngay sau khi bước a2 vừa tác động, trước checkpoint: khởi động lại hỏi "đã áp dụng chưa?"; trả lời "rồi" thì a1, a2, a3 mỗi bước đúng **1 lần**. Chạy lại việc đã xong: không áp dụng thêm gì.
  - Sập trước khi bước a2 tác động, trả lời "chưa": a2 được áp dụng 1 lần, a1 không chạy lại.
  - Sập giữa một bước compute: việc về `queued` và không áp dụng gì hai lần.
- **Thiếu số đo (V24-031):** việc chuyển sang `needs-user` với câu hỏi `door1.width`, chưa trả lời thì vẫn đứng yên; trả lời 900 thì chạy tiếp và áp dụng 1 lần.
- **Vector hoá:**
  - Đường đo 3 px nằm giữa hai vạch cắt đo đúng 160 px. Trước khi sửa chỉ được 156 px, hoặc bị đứt.
  - Ô chữ chồng lên một đường không còn cắt đứt đường đó.

### 3.2 Smoke trên trình duyệt — `ui/tools/smoke-scan.mjs` (13/13 PASS, log: `qa/v2_4/importcal_smoke_scan.log`)
Các bài cũ của Scan to CAD (PDF vector, PNG làm ảnh nền ở 150 dpi 1:100, vector hoá + OCR tiếng Việt, bản kênh 200 dpi) **vẫn PASS**. Các bước mới:

| Bài | Kết quả đo được |
|---|---|
| **V24-018** ảnh không có tỷ lệ | Mở ở 150 dpi × 1:100 danh nghĩa, `calibration: null`, `status: unscaled`, banner "REVIEW REQUIRED · 1", `fabricationAllowed.ok = false` (lý do `uncalibrated`). Hộp xem lại ghi "BLOCKED — plan_dims_SYNTHETIC.png: no scale calibration". Ảnh: `importcal_review_uncalibrated.png` |
| Hiệu chỉnh sau trong CAD 2D (`CALIBRATE`) | Hai điểm cách nhau 1400 px trên ảnh nền, nhập 7000 mm: **5,0000 mm/px** (đúng là 5). Banner tắt, cổng mở. Gõ `U` quay về 16,933 mm/px (150 dpi × 1:100) và REVIEW REQUIRED (một bước hoàn tác) |
| **V24-017** ảnh nền "300 dpi" + 2 tham chiếu | "1 px = 5.002 mm from 2 reference(s) · geometry × 0.5908 … residual 4.2 mm (largest misfit 5.3 mm)". Mở ra: ảnh nền 5,0019 mm/px, `method: two-point`, 2 tham chiếu, sai số dư 4,22 mm, không bị chặn. Ảnh: `importcal_two_point.png` |
| **V24-020** OCR lệch kích thước | OCR đọc "3600", "3460", "7000" trên các đường dài 708 / 692 / 1400 px. Dùng "7000" + "3460": 1 px = 5.000 mm, sai số dư 0,0. Mở ra: một mục `["ocr-dimension-mismatch","3600",3600,3540]`, cổng bị chặn. Hộp xem lại ghi "Text “3600” says 3600 mm, the line measures 3540 mm". Xác nhận + loại hết 14 chữ OCR rác (độ tin cậy 0–48 %) thì cổng mở, banner tắt. Ảnh: `importcal_ocr_mismatch.png` |
| **V24-019** PDF 2 trang | Ghi "This PDF has 2 pages: choose the page" và nút mở bị khoá cho tới khi chọn trang. Chọn trang 2 rồi dùng chữ "4000": "1 mm on the sheet = 20 mm (scale 1:20)". Đổi sang trang 1 thì "NOT CALIBRATED" (hiệu chỉnh theo từng trang), quay lại trang 2 thì hiệu chỉnh vẫn còn. Mở ra: `kind pdf, page 2, method ocr-dimension`, đường 200 mm giấy thành 4000 mm, mục lệch "2100" so với 2000. Ảnh: `importcal_pdf_page2.png` |
| Phòng đo thực tế (`SURVEYROOM`) | 4000×3000, 2 đường chéo 5000: "Area 12.00 m² · built from the diagonal · Δ 0.0 · squareness 0.00° · Within tolerance ±10 mm · Not measured: ceiling height, door 1 width". Sau khi thêm: `kind survey, status measured, tolerance 10`, hai mục thiếu số đo, cổng bị chặn. Nhập 3300 và 900 trong hộp xem lại thì cổng mở và cửa được vẽ (2 nét ô cửa). Ảnh: `importcal_survey_dialog.png`, `importcal_survey_cad.png` |
| Tiếng Việt | "CHƯA HIỆU CHỈNH…", banner "CẦN XEM LẠI" |
| Không lỗi console | PASS |

### 3.3 Smoke trên trình duyệt — `ui/tools/smoke-ai.mjs` (21/21 PASS, log: `qa/v2_4/importcal_smoke_ai.log`)
13 bài cũ của AI Studio vẫn PASS (trạng thái mockup, Duyệt / Hoàn tác / Loại, Geometry Doctor…). Các bước mới:

| Bài | Kết quả |
|---|---|
| 7 tác vụ mẫu | Có đủ 7 thẻ, mỗi thẻ có Các bước / Cần có / Chưa chắc chắn. "Bố trí phòng tự động" và "3 phương án nội thất" ghi **Đang phát triển**, nút bị khoá. "Phối cảnh 4K" ghi Dùng được một phần. Ảnh: `ai_presets.png` |
| Preset Ảnh/PDF → CAD thành một việc | Mở chưa hiệu chỉnh: việc ở `needs-user`, câu hỏi `calibration-required`, bước `open` đã áp dụng 1 lần. Nút "Calibrate…" mở CAD 2D để hiệu chỉnh; xong thì việc tự chuyển `ready-for-review`. Bấm Duyệt: `archived / approved` |
| **V24-031** thiếu chiều rộng cửa | Phòng đo có cửa chưa có chiều rộng. Bản vẽ ghi "D1 ? (width not measured)", không tự điền chiều rộng mặc định. Bấm "Kiểm tra số liệu đầu vào": việc ở `needs-user`, câu hỏi "Room 1: door 1 width is missing — type the measured value (mm)". Trả lời 900: cửa được vẽ, việc ở `ready-for-review` với dòng "…The layout engine itself is in development". Ảnh: `ai_job_needs_user.png` |
| **V24-032** một lệnh thành một việc | house_vn_SYNTHETIC.dxf qua preset CAD → 3D. Có checkpoint cho read / layers / house / build / check; bước `approve` chờ anh duyệt. Duyệt xong: khoá `apply-bim` và `apply-interior` đã ghi |
| **V24-032** sập sau BIM, trước Nội thất | Sửa trạng thái đã lưu đúng như lúc sập, rồi tải lại trang. Toast "1 AI job(s) were interrupted". Việc ở `queued` và ghi "Restored after a restart at its last checkpoint". Bấm Tiếp tục: hộp một lệnh ghi "Resumed: 1 step(s) already applied will be skipped". Duyệt xong: số bước hoàn tác BIM **0 → 0** (bỏ qua, không áp dụng lại), Nội thất **0 → 1**. Bước BIM ghi "already applied — skipped" |
| **V24-032** sập khi đang áp dụng | Bước `apply-interior` ở trạng thái `applying` rồi tải lại trang: việc ở `needs-user`, câu hỏi "Step “Apply Interior data” was interrupted while applying…". Trả lời "Yes, it was applied": khoá được ghi, Nội thất không áp dụng lại (0 bước hoàn tác). Ảnh: `ai_job_interrupted.png` |
| Tiếng Việt | "Ảnh/PDF -> CAD", nút "Đang phát triển" bị khoá |
| Không lỗi console | PASS |

### 3.4 Hồi quy
Chạy trên dev server riêng (cổng 5287):

| Bộ | Kết quả |
|---|---|
| `smoke-cad2d.mjs` | 23 PASS / 0 FAIL |
| `smoke-auto.mjs` | 8 PASS / 0 FAIL |
| `smoke.mjs` | 16 PASS / 0 FAIL |
| `tsc --noEmit -p tsconfig.app.json` | sạch |
| `oxlint` | chỉ còn cảnh báo kiểu `only-export-components`, giống các file sẵn có; không có lỗi |

## 4. Bài nghiệm thu

| ID | Nội dung | Tự động | Trạng thái |
|---|---|---|---|
| V24-017 | Ảnh nền 300 dpi, hiệu chỉnh bằng khoảng cách thật | smoke-scan + unit | **PASS** (5,0019 mm/px so với 5; sai số dư 4,22 mm) |
| V24-018 | Ảnh không tỷ lệ: phải xác nhận, cấm sản xuất | smoke-scan + unit | **PASS** |
| V24-019 | PDF nhiều trang: chọn trang, hiệu chỉnh tường minh | smoke-scan | **PASS** |
| V24-020 | Kích thước OCR lệch: gắn cờ cần xem lại | smoke-scan + unit | **PASS** |
| V24-031 | Mặt bằng AI thiếu chiều rộng cửa: hỏi lại / cần xem lại | smoke-ai + unit | **PASS** cho phần kiểm tra đầu vào. Bộ máy bố trí do nhóm khác làm (Đang phát triển) |
| V24-032 | Autopilot tiếp tục sau lỗi, không lặp | smoke-ai + unit | **PASS** (mô phỏng sập bằng cách sửa trạng thái đã lưu rồi tải lại trang; chưa kill tiến trình desktop thật) |

Phần "manual" của các bài này (chủ dự án tự thử) **chưa làm**.

## 5. Giới hạn đã biết (nói thẳng)
- **Hiệu chỉnh:** chỉ hiệu chỉnh tỷ lệ đều (một hệ số). Chưa khử méo phối cảnh / méo scan, chưa xoay. Méo vẫn nằm trong danh sách "chưa chắc chắn" và hiện ra qua sai số dư.
- **Ghép chữ kích thước với đường:** chỉ ghép với đoạn thẳng song song. Tesseract hầu như không đọc chữ xoay dọc, nên kích thước dọc phải hiệu chỉnh bằng hai điểm.
- **OCR rác:** trên bản vẽ có vạch cắt, OCR đọc ra nhiều "chữ" rác với độ tin cậy 0–48 %. Theo yêu cầu, chúng được giữ lại để xem lại chứ không bỏ. Có nút "Loại tất cả chữ OCR không chắc chắn" (một bước hoàn tác).
- **Bản vẽ chỉ có ảnh nền:** hiệu chỉnh vẫn là một bước hoàn tác, nhờ một thao tác không đổi gì được gửi sang engine. Xác nhận / mở lại một mục là thay đổi thuộc tính, không thành bước hoàn tác; loại một mục thì có hoàn tác.
- **Tiếp tục việc một lệnh:** phần tính toán chạy lại khi tiếp tục (thuần, cho cùng kết quả), vì kết quả không lưu. Nếu việc được chạy từ file trên đĩa (không phải bản vẽ đang mở) thì phải chọn lại file. Hoàn tác / loại một việc chỉ thực hiện khi bước đó vẫn là bước cuối trong ngăn hoàn tác của màn hình tương ứng; nếu không thì báo, không hoàn tác bừa. Ngăn hoàn tác nằm trong bộ nhớ, nên sau khi khởi động lại, bước đã áp dụng trước đó không hoàn tác được từ hàng việc.
- **Bộ hồ sơ của một lệnh:** nếu bản vẽ nguồn đang REVIEW REQUIRED, hộp thoại chỉ cảnh báo rằng không được dùng file sản xuất. Việc chặn thật file NC thuộc phía CNC (xem mục 6).
- **Xuất DXF/DWG:** không mang theo provenance / cờ cần xem lại.

## 6. Việc cần phía khác (cross-scope)
- **CNC (P0, `cam/*`, `screens/interior/NestingDialog.tsx`, `auto/package.ts`, `screens/mechanical/PartStudio.tsx`):** gọi `fabricationAllowed(doc)` của bản vẽ nguồn trước khi phát hành NC sản xuất, và đưa `reasons` vào danh sách lý do bị chặn của cổng phát hành.
- **BIM (`screens/bim/FromCadDialog.tsx`, `bim/fromCad*`):** "Dựng mô hình từ CAD" nên hỏi lại hoặc cảnh báo khi bản vẽ có nguồn `unscaled`, giống preset CAD → 3D (đang chuyển việc sang `needs-user`).
- **Nội thất / Space Planning:** đọc `SourceMeta.survey` (`SurveySummary`: input gồm cạnh / góc / chéo / tường / trần / cửa, sai số khép, độ vuông, dung sai, `missing`) làm đầu vào phòng đo. `checkLayoutInputs()` trong `ai/jobActions.ts` đã có sẵn để nối vào khi bộ máy bố trí xong.
- **Native:** bảng lệnh C++ (`native/libs/core/src/commands.cpp`) chưa có `CALIBRATE` / `SURVEYROOM` / `IMPORTREVIEW`. Đây là các hộp thoại phía UI nên không bắt buộc. `e2e_scan.js` (trong `native/`) chưa được mở rộng.
- **M1 (guid / rev / src):** `EntitySrc` của CAD 2D (`cad/provenance.ts`) cùng ý với `src` của BIM; nên thống nhất tên gọi khi gộp.

## 7. UI_CHANGE_REQUEST
Không có. Mọi phần mới đều nằm trong màn hiện có:
- hộp thoại Modal;
- mục menu ⋯ của khung chat;
- nút banner nhỏ ở cuối hàng tab của vùng vẽ;
- một dòng "Nguồn" trong Properties, chỉ hiện khi đối tượng chọn có provenance;
- các nguồn trong tab References;
- các mục trong tab Detected.

Trạng thái mockup mặc định (bản vẽ Villa) không đổi.
