# QA — Khoá an toàn CNC (v2.4 P0) và gia công theo máy

**Ngày:** 2026-10-18. **Nhánh:** `worktree-agent-a52b3d14a8daf076e` (đã merge `main` có các bản sửa đã duyệt).

**Kết luận ngắn:**
- App **không còn xuất file `.nc` trông như dùng được** từ bất kỳ đâu nếu chưa qua cổng phát hành.
- Mặc định mọi file CNC là **bản xem trước kỹ thuật** (`.NOT_FOR_MACHINE.txt`), có dòng cảnh báo, danh sách lý do bị chặn, `M0` trước chuyển động / trước khi bật trục chính, kèm `manifest.json`.
- Nút **"Xuất NC sản xuất"** chỉ bật khi cổng phát hành không còn lý do chặn. Hiện **không máy nào được nghiệm thu**, nên nút luôn tắt. Đây đúng là yêu cầu.
- **Chưa có máy thật, chưa chạy không tải, chưa cắt mẫu.** Không hạng mục nào ở đây được coi là "sẵn sàng đưa xưởng".

## 1. Đã làm gì (vị trí code)

| Hạng mục | File |
|---|---|
| Hồ sơ máy theo schema v2.3: đầu phay / lưỡi cưa / cụm khoan / dao cắt, offset, dao, ATC, bộ điều khiển + firmware + mã đã kiểm, hậu xử lý, hành trình, kẹp / vùng cấm, độ cao an toàn, trạng thái, nghiệm thu | `ui/src/cam/machine.ts` |
| Cổng phát hành `releaseBlockers(machine, job, commissioning)`: chuyển từng dòng của `reference_release_gate.py` sang TS, cộng thêm các kiểm tra theo lệnh sản xuất | `ui/src/cam/machine.ts` |
| 4 hồ sơ mẫu v2.3 (1 / 2 / 3 đầu phay, 2 lưỡi cưa), trạng thái CHƯA NGHIỆM THU | `SAMPLE_PROFILES` trong `machine.ts` |
| Kho hồ sơ máy có phiên bản: tạo / nhân bản / sửa / nhập / xuất / tạm ngừng / biên bản nghiệm thu | `ui/src/state/machines.ts` |
| Lệnh sản xuất (ManufacturingJob) + chuỗi hash: chi tiết → phôi → máy → dao → xếp tấm → đường dao → hậu xử lý → file NC. Đánh dấu STALE, duyệt, bản phát hành bất biến, tách bản mới | `ui/src/cam/job.ts` |
| Lệnh trung gian trung lập + 4 bộ hậu xử lý (tất cả CHƯA NGHIỆM THU) | `ui/src/cam/ir.ts`, `ui/src/cam/posts/{grbl11,linuxcnc,isoGeneric,ncstudio}.ts` |
| Bộ đọc NC theo trạng thái modal, đọc đúng các byte sẽ ghi; `simulate()` cũ giữ nguyên chữ ký | `ui/src/cam/ncparse.ts`, `ui/src/cam/gcode.ts` |
| Ghi file: bản xem trước có cảnh báo, NC sản xuất (tự kiểm lại cổng) | `ui/src/cam/release.ts` |
| Một đường xử lý chung cho Nội thất và gói 1 lệnh | `ui/src/cam/interiorJob.ts` |
| Giao diện: chọn máy trong hộp "Xếp tấm & CNC", hộp "Máy & Dao", CAM của Part Studio, gói 1 lệnh. Chỉ thêm hộp thoại, không đổi bố cục 12 màn khoá | `ui/src/screens/cnc/*`, `ui/src/screens/interior/NestingDialog.tsx`, `ui/src/screens/mechanical/PartStudio.tsx`, `ui/src/auto/package.ts`, `ui/src/screens/auto/AutoDialog.tsx` |
| Chuỗi chữ EN / VI | `ui/src/i18n/ws/cnc.ts` (+ cập nhật `interior.ts`, `mechanical.ts`, `auto.ts`) |

### Sửa lỗi mức máy

- **G43:**
  - ISO chung và LinuxCNC ghi `G43 H n` sau **mọi** lần `T n M6`.
  - Part Studio (`mech/partCam.ts`) cũng vậy, và kết thúc bằng `G49`.
- **GRBL:**
  - Mỗi dao một chương trình.
  - Đầu mỗi chương trình có `M0 (LOAD Tn …, ZERO Z ON THE BOARD TOP, THEN CYCLE START)`.
  - Không có M6, G43 hay chu trình khoan cố định.
- **Không có ATC:**
  - Không ghi `T` / `M6`.
  - Mỗi dao một chương trình, có `M0` (LinuxCNC thêm `(MSG, …)`) rồi `G43 H n`.
  - Parser chặn mọi `T` / `M6` trên máy không có ATC.
- **Kích thước cắt và kích thước thành phẩm:**
  - `CutPart` có thêm: `id`, `rev`, `grain`, `faceA`, `edges{L1,L2,W1,W2}` (độ dày chỉ từng cạnh), `finished`, `cut`.
  - Các trường cũ vẫn giữ.
  - Cánh dán 4 cạnh: cắt = thành phẩm − 2 × chỉ, mỗi chiều. Ví dụ cánh 847 × 597 cắt 845 × 595.
  - Hông, nóc / đáy, kệ, vách dán cạnh trước (L1): rộng − 1.
  - Xếp tấm theo kích thước **cắt**.
- **Rãnh hậu:**
  - Hông và nóc / đáy có rãnh hậu (rebate) 6,5 × 8 dọc cạnh sau (L2), phay bằng dao biên.
  - Máy không phay rãnh được: báo `UNSUPPORTED_OPERATION:SLOT:GROOVE_NOT_MACHINED_MANUAL` (làm thủ công).
- **Kẹp / vùng cấm:**
  - Khi xếp tấm, chừa vùng kẹp cộng một khe.
  - Lúc chạy nhanh, nếu đường đi cắt qua kẹp thì nâng lên đỉnh kẹp + khoảng an toàn trước.
  - Parser báo `CLAMP_COLLISION` và chặn xuất.
- **Hướng vân theo từng chi tiết** (không xoay chi tiết có khoá vân). Chi tiết xoay được **quay cứng**, không lật gương, nên mặt A và hướng bản lề giữ đúng. Trước đây toạ độ bị hoán đổi X↔Y, tức là lật gương.
- **Chi tiết quá khổ:**
  - Luôn được liệt kê: `PARTS_DO_NOT_FIT_STOCK:n`.
  - Báo cáo của gói 1 lệnh ghi rõ tên và kích thước từng chi tiết.
- **Mã + bản chi tiết** có mặt trong CSV bảng cắt, CSV nhãn, DXF xếp tấm và chú thích NC, ví dụ `[c3.DOOR r3d5d0125]`.
- **Part Studio, chạy nhanh vào vật liệu:** trước đây có chỗ hạ dao nhanh 1 mm vào vật liệu chưa cắt khi phá thô theo lớp. Parser mới phát hiện ra lỗi này và đã sửa: chỉ hạ nhanh tới 1 mm trên lớp đã cắt, phần còn lại xuống bằng tốc độ cắt.

## 2. Lệnh đã chạy và kết quả

Tất cả chạy trong worktree, sau khi merge `main`.

| Lệnh | Kết quả |
|---|---|
| `cd ui && npx tsc --noEmit -p tsconfig.app.json` | Không lỗi |
| `UNIT=cnc node tools/test-cam.mjs run` | **71/71 PASS** (`ALL PASS`) |
| `UNIT=cam node tools/test-cam.mjs run` | **ALL PASS**: 12 kiểm tra, gồm G43 sau mỗi M6, GRBL không M6/G43, M0 trước chuyển động, rãnh hậu, cắt = thành phẩm − chỉ, mã chi tiết trong NC |
| `UNIT=partcam node tools/test-cam.mjs run` | **ALL PASS**: 16 kiểm tra |
| `THCAD_UI=http://127.0.0.1:5263 node tools/smoke-interior.mjs` | 13/13 passed, không lỗi console |
| `… node tools/smoke-auto.mjs` | ALL PASS (9 bước), không lỗi console |
| `… node tools/smoke-part.mjs` | 7/7 passed, không lỗi console |
| `… node tools/smoke.mjs`, `smoke-mechanical.mjs`, `smoke-fromcad.mjs`, `smoke-interior-plan.mjs` (hồi quy) | Đều pass |

**Ghi chú về cách chạy:**
- `tools/test-cam.mjs` nay trả mã thoát 1 khi `{ all: false }`.
- Dev server riêng chạy ở cổng 5263, dùng một file cấu hình Vite tạm có `server.fs.allow` (không commit), vì `node_modules` của worktree là symlink.

**CI:** `.github/workflows/windows.yml` có thêm job `ui-unit` (ubuntu, Node 22): `npm ci` rồi chạy 3 bài unit `cnc` / `cam` / `partcam`. **Chưa chạy trên GitHub** vì workflow chỉ chạy khi bấm tay hoặc khi có tag.

## 3. Nghiệm thu đã tự động hoá (`ui/tools/unit/cnc.test.ts`)

**Đối chứng dương:** có một máy giả lập **TEST** (dữ liệu tổng hợp, tên TEST-…, không phát hành), được nghiệm thu đầy đủ trong bài kiểm tra.
- Với máy này, lệnh sản xuất hoàn chỉnh **không còn lý do chặn** và xuất NC sản xuất được.
- Mục đích: chứng minh cổng *có thể* mở. Nhờ vậy, mỗi ca âm bên dưới chỉ ra đúng lý do đóng cổng.

| Mã nghiệm thu | Nội dung kiểm | Kết quả |
|---|---|---|
| V24-049, CNC-035, CNC-038 | Mã chi tiết duy nhất + rev; cánh: cắt = thành phẩm − chỉ; tủ 1200 với hông 18: nóc / đáy 1164 | PASS |
| V24-050, CNC-037 | Đổi rộng tủ sau khi duyệt → STALE từ bước *chi tiết*, mọi bước sau STALE | PASS |
| V24-051, CNC-017 | Đổi máy sau xếp tấm → STALE từ bước *máy*; xuất sản xuất bị chặn | PASS |
| V24-052, CNC-036 | Độ dày đo 18 → 18,4: đường dao tính lại (sâu 18,7), NC cũ STALE, báo lệch độ dày | PASS |
| V24-053, CNC-010 | Máy 1 đầu (mẫu): chỉ ghi các việc máy làm được (không khoan), không thay dao | PASS |
| V24-054, CNC-073 | Máy 2 đầu chưa đo offset → `HEAD_UNCALIBRATED:HEAD_1/2`, chặn | PASS |
| V24-055, CNC-012, CNC-014 | 3 đầu phay khác 3 lưỡi cưa; máy cưa không nhận đường dao phay, cưa báo `SAW_ADAPTER_NOT_AVAILABLE` | PASS |
| V24-056, CNC-034 | Không ATC: không có T / M6; nếu trong file có `T2 M6` thì `ATC_ABSENT_TOOL_CHANGE` và chặn | PASS |
| V24-057, CNC-048, CNC-056 | Kẹp: xếp tấm tránh kẹp, chạy nhanh vượt kẹp ở Z50; chương trình cắt qua kẹp → `NC_CHECK_FAILED:CLAMP_COLLISION`, chặn | PASS |
| V24-058, CNC-071 | Hậu xử lý chưa duyệt cho bộ điều khiển → chặn | PASS |
| V24-059, CNC-077 | Nghiệm thu thiếu chữ ký kỹ sư → không lên ĐÃ NGHIỆM THU, chặn | PASS |
| V24-060, CNC-075 | Chạy không tải không đạt → `AIR_CUT_FAILED`, chặn | PASS |
| V24-061, CNC-076 | Mẫu đầu không đạt (mức máy và mức lệnh) → chặn | PASS |
| CNC-068, CNC-070 | Hồ sơ CHƯA NGHIỆM THU, hoặc giả mạo trạng thái VERIFIED → vẫn chặn, kể cả khi gọi hàm trực tiếp | PASS |
| Đối chiếu bản Python | Đủ 3 bài của `test_cnc_reference_gate.py` (mẫu bị từ chối, không lách được bằng `production_export_allowed`, kiểm từng đầu) | PASS |
| CNC-078, CNC-079, CNC-031, CNC-021 | Đổi firmware / dao / offset → hạ về CHƯA NGHIỆM THU, sang bản mới, NC STALE; sửa thẳng hồ sơ đã nghiệm thu → `COMMISSIONING_STALE`; lệnh ghim bản + hash của máy | PASS |
| Nhập hồ sơ | Nhập hồ sơ có trạng thái VERIFIED → vào thành CHƯA NGHIỆM THU | PASS |
| CNC-009, 011, 013, 015, 016, 019, 020, 022–028, 030 | Chọn máy, phân biệt loại đầu, ATC, cụm khoan, hành trình, chuyển đầu theo thứ tự, gán đầu theo dao (đầu 2 chưa đo offset, đầu 3 chưa kiểm lệnh kích hoạt), song song cần nghiệm thu | PASS |
| CNC-042, 043, 044–047, 050, 051 | Xoay chi tiết giữ mặt A / chiều bản lề; dữ liệu thiết kế không đổi khi đổi máy; không chồng, trong khổ, mỗi tấm một vật liệu, giữ vân; chi tiết quá khổ; nhãn có mã + rev | PASS |
| CNC-058–063, 065, 067, 072, 074, 080, 082 | Sâu quá phôi đo; G20/G21; G90/G91; chặn chu trình khoan cố định; GRBL không M6/G43; không ghi cú pháp `$` của LinuxCNC; parser đọc đúng byte đã ghi; manifest có id + hash hậu xử lý, checksum, chữ ký; thiếu gốc / độ dày / lô; chưa parse; bản xem trước có cảnh báo | PASS |
| Cổng bản vẽ nguồn | `fabricationAllowed()` của `main`: bản vẽ nguồn chưa hiệu chỉnh tỷ lệ hoặc còn mục cần xem → `SOURCE_DRAWING_NOT_FABRICATION_READY` | PASS |

**Chưa tự động hoá được:**
- CNC-001…008: hồi quy toàn app. Chỉ phần smoke liệt kê ở trên đã chạy.
- CNC-029, CNC-057: va chạm đầu đang nghỉ, chiều dài dao nhô ra so với đầu kẹp dao. Chưa có mô hình hình học đầu máy.
- CNC-040, 041: thư viện phụ kiện. Chưa có catalog.
- CNC-049, 052, 053.
- CNC-064, 069: nằm ở thiết kế. App không có API gửi file sang máy; AI không ghi NC.
- CNC-066: backplot theo offset từng đầu.
- CNC-075…077, 081: cần máy thật và người thật. **BLOCKED** cho tới khi có máy.

## 4. Mẫu đầu file bản xem trước

Máy mẫu 1 đầu, tủ bếp, tấm Oak #1. Tên file: `TEST - MFC_18_Oak #1 T1.NOT_FOR_MACHINE.txt`. Đi kèm `manifest.json`.

```
(ENGINEERING PREVIEW - NOT FOR MACHINE USE)
(machine=DEMO_1_HEADS_NOT_FOR_MACHINE status=UNVERIFIED post=iso_generic 1.0.0 UNVERIFIED)
(job=TEST-JOB r1)
(blockers 1/4: MACHINE_PROFILE_NOT_VERIFIED, CONTROLLER_ID_OR_MANUAL_MISSING, WORK_ENVELOPE_UNCALIBRATED, STOCK_ORIGIN_UNCALIBRATED, SAFE_Z_NOT_DEFINED, HEAD_UNCALIBRATED:HEAD_1)
(blockers 2/4: HEAD_OFFSET_INCOMPLETE:HEAD_1, TOOLS_NOT_VERIFIED:HEAD_1, POSTPROCESSOR_NOT_APPROVED, QUALIFICATION_MISSING:parser_pass, QUALIFICATION_MISSING:post_backplot_pass, QUALIFICATION_MISSING:air_cut_pass)
(blockers 3/4: QUALIFICATION_MISSING:first_article_pass, QUALIFICATION_MISSING:operator_signed, QUALIFICATION_MISSING:engineer_signed, QUALIFICATION_EVIDENCE_MISSING, PRODUCTION_EXPORT_DISABLED, CONTROLLER_CODES_NOT_VERIFIED)
(blockers 4/4: POST_NOT_PROFILE_POST, UNSUPPORTED_OPERATION:DRILL_VERTICAL:NO_HEAD_FOR_OPERATION, NC_CHECK_FAILED:CODE_NOT_IN_PROFILE, JOB_NOT_REVIEWED, JOB_SIGNOFF_MISSING)
(TEST - MFC_18_Oak #1)
(MD CAD AI STUDIO CAM · sheet MFC 18 - Oak 2440 × 1830 × 18 mm #1)
(Zero: sheet lower-left corner, Z0 = top of the board; depth 18.3 mm in 2 pass[es])
G21 G90 G17 G94 G40 G49 G80
G54
M0 (LOAD T1 End mill Ø8 [profile] ON HEAD_1, SET TOOL LENGTH H1, THEN CYCLE START)
M0 (ENGINEERING PREVIEW - NOT FOR MACHINE USE - STOP)
S18000 M3
G0 G43 H1 Z15
(Back-panel rebates: 2)
(Kitchen Base Cabinet · Top / bottom 1/2 [c2.TB] rebate 6.5 x 8)
G0 X10 Y606.5
…
```

## 5. Lý do bị chặn của từng hồ sơ mẫu

Điều kiện: lệnh đã đo độ dày, có số lô, đã xác nhận chỉ dán cạnh; tủ bếp mẫu.

**Phần chung của cả 4 mẫu (19 lý do):**
- `MACHINE_PROFILE_NOT_VERIFIED`, `CONTROLLER_ID_OR_MANUAL_MISSING`, `WORK_ENVELOPE_UNCALIBRATED`, `STOCK_ORIGIN_UNCALIBRATED`, `SAFE_Z_NOT_DEFINED`
- `POSTPROCESSOR_NOT_APPROVED`
- `QUALIFICATION_MISSING` × 6 (parser, backplot, air cut, first article, operator, engineer)
- `QUALIFICATION_EVIDENCE_MISSING`, `PRODUCTION_EXPORT_DISABLED`, `CONTROLLER_CODES_NOT_VERIFIED`
- `POST_NOT_PROFILE_POST` (hồ sơ chưa ghi bộ hậu xử lý)
- `UNSUPPORTED_OPERATION:DRILL_VERTICAL:NO_HEAD_FOR_OPERATION` (mẫu không khai báo khoan)
- `JOB_NOT_REVIEWED`, `JOB_SIGNOFF_MISSING`

**Riêng từng mẫu:**

| Hồ sơ | Tổng | Thêm |
|---|---|---|
| `DEMO_1_HEADS_NOT_FOR_MACHINE` | 23 | `HEAD_UNCALIBRATED`, `HEAD_OFFSET_INCOMPLETE`, `TOOLS_NOT_VERIFIED` cho HEAD_1; `NC_CHECK_FAILED:CODE_NOT_IN_PROFILE` |
| `DEMO_2_HEADS_NOT_FOR_MACHINE` | 26 | Như trên cho HEAD_1 và HEAD_2; `NC_CHECK_FAILED:CODE_NOT_IN_PROFILE` |
| `DEMO_3_HEADS_NOT_FOR_MACHINE` | 29 | Như trên cho HEAD_1, HEAD_2 và HEAD_3; `NC_CHECK_FAILED:CODE_NOT_IN_PROFILE` |
| `DEMO_2_SAW_BLADES_NOT_FOR_MACHINE` | 28 | Như trên cho HEAD_1 và HEAD_2; `UNSUPPORTED_OPERATION:PROFILE:NO_HEAD_FOR_OPERATION`; `UNSUPPORTED_OPERATION:SLOT:GROOVE_NOT_MACHINED_MANUAL/NO_HEAD_FOR_OPERATION`; `NC_NOT_PARSED` (máy cưa không nhận đường dao phay nên không có NC nào) |

*Ghi chú:* file mẫu `machine_2_saw_blades_UNVERIFIED.json` dùng trùng mã `DEMO_2_HEADS_NOT_FOR_MACHINE` với mẫu 2 đầu phay. Trong app đổi thành `DEMO_2_SAW_BLADES_NOT_FOR_MACHINE`. Trạng thái `DRAFT` trong file mẫu được nạp thành CHƯA NGHIỆM THU, theo yêu cầu.

## 6. Còn thiếu / cần chủ dự án

1. **Máy thật:** cần hãng, model, controller, firmware, bộ mã đã kiểm, offset đo, dao đo, file NC mẫu đã chạy được. Sau đó mới chạy không tải, cắt mẫu và ký nghiệm thu.
2. **Bộ hậu xử lý cưa / dao cắt:** chưa có. `SAW_CUT` / `KNIFE_CUT` luôn báo "không hỗ trợ".
3. **Liên kết bản vẽ nguồn ↔ tủ nội thất:** hộp Xếp tấm & CNC chưa biết tủ đến từ bản vẽ nào, nên cổng `fabricationAllowed` mới áp cho gói 1 lệnh. Cần liên kết GUID (giai đoạn M1).
4. **Nhập hồ sơ máy:** còn là kiểm tra hình dạng tối thiểu, chưa phải kiểm tra JSON-Schema đầy đủ.
