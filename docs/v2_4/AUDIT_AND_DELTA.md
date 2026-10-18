# v2.4 — Kiểm kê (M0) và thiết kế phần thay đổi (Architecture Delta)

**Ngày:** 2026-10-18.

**Repo:** `github.com/mkt-tuanhung/th-ai-cad-studio`, nhánh `main`.
- Mốc sao lưu trước v2.4: tag **`baseline-pre-v2.4`** = `f4afb04`.
- Yêu cầu gốc của chủ dự án: `docs/requirements/v2_4/` (gồm cả v2.3 CNC).
- Bảng đối chiếu chi tiết: `qa/v2_4/FEATURE_CROSSWALK_V2_4_AUDITED.csv`. 64 dòng, mỗi dòng có trạng thái, vị trí code, bằng chứng kiểm thử và khoảng cách còn thiếu so với mức nghiệm thu tối thiểu.

## 1. Kiểm kê nền hiện có

| Hạng mục | Hiện trạng (vị trí code) |
|---|---|
| Build | UI: `cd ui && npm run build` (Vite, React/TS). Native: `cd native && cmake --build build` (C++20, Qt 6.11, OCCT 7.9). DMG: `package_macos.sh` + `make_dmg.sh`. Windows: GitHub Actions `windows-installer` |
| CAD kernel | Open CASCADE (B-rep, boolean, HLR, path tracing) — `native/libs/geom_occt` |
| Trình sửa 2D | CAD 2D: `ui/src/cad/*`, có command bus và lệnh kiểu AutoCAD, đồng bộ với `native/libs/core`. Mặt bằng BIM: `ui/src/screens/bim/BimPlan.tsx` |
| Mô hình | Ba store riêng: BIM `state/bim.ts`, Nội thất `state/interior.ts`, CAD `state/cad.ts`. Thêm MEP, Civil, Mechanical, Renders. Hoàn tác giữ trong bộ nhớ, mỗi store một ngăn |
| Nhận dạng ảnh | `cad/vectorize.ts` (vector hoá ảnh raster + OCR tesseract.js tiếng Việt), `cad/pdfImport.ts` (PDF vector), `bim/fromCad.ts` (mặt bằng → BIM) |
| AI cục bộ | llama.cpp trong app (Qwen2.5-7B/3B, Metal/Vulkan), ngữ pháp GBNF, đề xuất → duyệt → hoàn tác; Whisper cho giọng nói |
| Bộ render | OCCT path tracing trong app (chạy trên luồng giao diện, chia lát 25 ms), hàng đợi `renders/runner.ts`, 360°, video MP4 |
| Xuất file | DXF R12/R2000, DWG AC1015 (LibreDWG), PDF vector A4–A1, SVG/PNG, IFC4, STEP, CSV, G-code `.nc`, LandXML, PNG/JPEG/TIFF/MP4. **Chưa có:** GLB, project JSON |
| CNC | `cam/nesting.ts` (MaxRects), `cam/gcode.ts` (GRBL/ISO + mô phỏng), `mech/partCam.ts`. **Chưa có:** hồ sơ máy, cổng phát hành, theo dõi STALE |
| Blender | **Đã cài trên máy này:** `/Applications/Blender.app` 5.2.2. Chưa tích hợp |

## 2. Kết quả đối chiếu (64 tính năng)

Đánh giá theo tiêu chí chặt: chỉ tính "đã kiểm chứng" khi có kiểm thử kiểm đúng mức nghiệm thu tối thiểu.

| Trạng thái | Số tính năng | Tính năng |
|---|---|---|
| Implemented + Verified | **0** | — |
| Implemented, chưa kiểm thử | 2 | SP31 mặt đứng, SP62 AI cục bộ |
| Partial | 45 | (xem CSV) |
| Missing | 15 | SP03, SP14, SP15, SP22, SP24, SP27, SP29, SP30, SP38, SP45, SP50, SP55, SP58, SP59, SP60 |
| Blocked | 1 | SP47: ảnh concept bằng diffusion. Cần chọn mô hình, giấy phép, và anh đồng ý cho tải về |

- SP42 (render như thật bằng Blender) **không còn bị chặn**, vì máy đã có Blender.
- 65 bài nghiệm thu V24 và các bài CNC của v2.3: **chưa chạy bài nào** (NOT_RUN). Bài nào gần với kiểm thử đã có thì CSV ghi rõ tên bài đó.

### Phát hiện an toàn (ưu tiên số 1)

App hiện xuất file G-code `.nc` trông như dùng được ngay, từ 3 chỗ, mà **không có hồ sơ máy, không có cổng phát hành, không có dòng cảnh báo**:
- `screens/interior/NestingDialog.tsx:43-48,130`: vẫn cho xuất khi mô phỏng báo lỗi, và hiện chữ "verified ✓".
- `auto/package.ts:174`: không chạy mô phỏng; chi tiết quá khổ bị bỏ qua mà không báo.
- `screens/mechanical/PartStudio.tsx:496`.

Lỗi ở mức máy:
- Dialect ISO có `T M6` nhưng thiếu `G43 H`.
- GRBL: việc chỉnh lại Z sau khi thay dao chỉ là một dòng chú thích.
- Cánh dán cạnh 4 phía nhưng cắt theo kích thước thành phẩm.
- Không phay rãnh hậu.
- Chạy nhanh ở Z2 qua toàn tấm mà không có mô hình kẹp.

### Rủi ro dữ liệu khác

- Migration Nội thất v1→v2 ghi đè phòng của người dùng bằng phòng mẫu (`state/interior.ts:135`).
- `autoRecover` / `backup` trong Cài đặt được lưu nhưng không có code nào dùng.
- Render xếp hàng dựng cảnh lúc **bắt đầu chạy**, không phải lúc **xếp hàng**, và không ghi revision.

## 3. Architecture Delta: ít điểm chạm nhất, thêm vào chứ không viết lại

### 3.1 Mô hình ngữ nghĩa chung (SP01, SP15, gate 1)

- **Không tạo store mới.** `BimModel` (`state/bim.ts`) là nguồn chuẩn cho công trình. Nội thất liên kết theo `roomGuid`.
- Thêm vào mỗi thực thể:
  - `guid`: UUID v4, cấp một lần, không đổi khi sửa.
  - `rev`: tăng mỗi khi thực thể thay đổi.
  - `src`: `{kind: drawn|imported|ai|survey|image, confidence?, reviewRequired?}`.
- `upgradeModel` (v2→v3) gán guid cho mô hình cũ, không mất dữ liệu. Có kiểm thử migration.
- **Biểu đồ phụ thuộc** `ui/src/model/deps.ts`:
  - sửa tường → làm bẩn 3D của tường đó, các lỗ cửa gắn trên tường, phòng kề, mặt đứng/mặt cắt, khối lượng;
  - sửa tủ → làm bẩn bảng cắt, xếp tấm, CAM, NC (gắn với STALE ở mục 3.5).
- Sửa từ mặt bằng, Properties, 3D và AI **đi cùng một hàm `edit()`**: mỗi thao tác là một bước hoàn tác nhóm.
- CAD 2D tự do vẫn là tài liệu riêng (bản vẽ tay). Mặt bằng BIM là "2D của mô hình".

### 3.2 3D cập nhật từng phần (SP15)

- Native thêm `scene3dPatch(key, upsertsJson, removeIds)`:
  - chỉ thay các đối tượng AIS có guid thay đổi;
  - tường được dựng lại cùng các lỗ của nó, nhờ biểu đồ phụ thuộc.
- UI so sánh hash từng phần tử rồi chỉ gửi phần thay đổi.
- Giữ `scene3dLoadBim` cho lần nạp đầu và để khôi phục khi có sự cố.

### 3.3 Space Planning (SP02–SP10, SP23–SP29)

Đặt trong tab con mới của **Nội thất hiện có** (theo bản đồ UX, không vẽ lại màn):
- **Smart Room:** chữ nhật / L / U / đa giác / tròn, nhập kích thước bằng bàn phím, mm.
- Sửa chiều dài và vị trí tường bằng tay nắm (grips) và số gõ; lỗ cửa bám theo tường chủ; diện tích phòng tính lại.
- **Thư viện:** gộp `library/catalog.ts` vào Nội thất. Thêm thay thế giữ nguyên vị trí, khoá, cao độ, vật liệu từng phần, kích thước vân bằng mm.
- **Khoảng trống / va chạm:** đường bao an toàn có số đo, kiểm tra bằng code.
- **3 phương án bố trí:** sinh bằng luật tất định, chấm điểm minh bạch; mỗi phương án là một bộ thay đổi riêng để xem trước / áp dụng / từ chối. AI chỉ chọn và giải thích.

### 3.4 Render cục bộ (SP40–SP46, SP63)

- **Xuất GLB** từ chính hình học OCCT (`RWGltf_CafWriter`, có màu và vật liệu). Dùng chung cho SP38.
- **Blender worker:**
  - `QProcess` chạy `blender -b -P md_render.py`, là một **tiến trình riêng** nên giao diện không bị đứng; Huỷ = kết thúc tiến trình.
  - Cycles chạy trên Metal; preset Ngày / Hoàng hôn / Đêm; nhận camera bookmark.
  - Nếu không có Blender thì dùng bộ render OCCT hiện có.
- Job chụp lại **revision của cảnh lúc xếp hàng**.
- **Camera bookmark** gồm: vị trí và hướng nhìn, FOV, lens, tầng, trạng thái hiển thị, mặt cắt, revision, thiết lập render.
- **Thanh so sánh trước/sau:** khung 3D trực tiếp so với ảnh render, cùng một camera.
- Ảnh render và ảnh AI luôn mang nhãn "Chỉ để trình bày", không bao giờ đi vào BOM hay CNC.

### 3.5 CNC: khoá an toàn trước (SP52–SP60, v2.3)

- **Thêm mới:**
  - `cam/machine.ts`: MachineProfile đúng schema v2.3. Phân biệt đầu phay / lưỡi cưa / ATC / cụm khoan; controller + firmware + post; trạng thái DRAFT / UNVERIFIED / VERIFIED.
  - `cam/job.ts`: ManufacturingJob, có chuỗi hash nội dung để phát hiện STALE.
  - `cam/ir.ts`: lệnh trung gian trung lập.
  - `cam/posts/*`: GRBL 1.1, LinuxCNC, ISO chung (có G43), kiểu NcStudio. **Tất cả UNVERIFIED.**
  - `cam/ncparse.ts`: đọc lại đúng file vừa xuất, theo dõi trạng thái modal, chỉ nhận mã có trong danh sách cho phép.
  - Cổng phát hành chuyển từ `reference_release_gate.py`.
- **Ba chỗ đang xuất `.nc` chuyển sang "Bản xem trước kỹ thuật":**
  - đuôi `.NOT_FOR_MACHINE.txt`;
  - đầu file ghi `(ENGINEERING PREVIEW - NOT FOR MACHINE USE)`, máy, trạng thái và các lý do bị chặn, kèm `M0` trước chuyển động đầu tiên;
  - có `manifest.json`.
  - Nút "Xuất NC sản xuất" chỉ bật khi không còn lý do bị chặn nào. Hiện tại không có máy nào được nghiệm thu, nên nút này luôn tắt, đúng yêu cầu.
- **Sửa lỗi ở mức máy:** thêm G43, Z cho GRBL, kích thước cắt = thành phẩm trừ nẹp, phay rãnh hậu, độ cao chạy nhanh an toàn theo kẹp.
- **Không bao giờ** gửi file sang máy hay tự khởi động máy.

### 3.6 Nền tảng (SP12, SP13, SP14, SP30, SP34, SP48–SP51, SP61, SP64)

- **Nhập ảnh:** hiệu chỉnh tỷ lệ bằng 2 điểm có khoảng cách đã biết. Ảnh không có tỷ lệ thì gắn `REVIEW REQUIRED` và chặn sản xuất. OCR có độ tin cậy thấp thì đưa vào danh sách cần xem lại, thay vì bỏ đi.
- **Hồ sơ phím tắt:** AutoCAD / SketchUp / 3ds Max / MD, lưu theo dự án, có kiểm tra trùng cả với alias lệnh CAD, kèm bảng tra phím.
- **Lịch sử phiên bản:** snapshot lưu trên máy cho từng store, có khôi phục. Đây là chỗ dùng tới `autoRecover` và `backup`.
- Khổ A0; thước in trên bản PDF để đo kiểm.
- ⌘K tìm cả lệnh, công cụ và thư viện.
- Mẫu dự án có bản vẽ thật.
- SBOM (danh sách thành phần) dạng JSON và kiểm tra giấy phép.
- Hàng việc AI có checkpoint, tiếp tục được khi bị gián đoạn.

## 4. Cờ tính năng, migration, rollback, hồi quy

- **Cờ** (Cài đặt → Thử nghiệm, lưu cục bộ): `v24.spacePlanning`, `v24.incremental3d`, `v24.blenderRender`, `v24.keyProfiles`. Riêng `cnc.productionRelease` luôn tắt và **không có công tắc trên giao diện**; chỉ bật được qua hồ sơ máy đã VERIFIED.
- **Migration:**
  - BIM v2→v3 (guid / rev / src);
  - Nội thất v2→v3, đồng thời sửa lỗi ghi đè phòng;
  - Interior CamPrefs thêm `machineProfileId` (mặc định LEGACY_UNASSIGNED).
  - Mỗi migration có kiểm thử chứng minh mở được dự án cũ mà không mất dữ liệu.
- **Rollback:** tag `baseline-pre-v2.4`, mỗi giai đoạn là một commit riêng. Tắt cờ thì quay về hành vi cũ, trừ khoá CNC (khoá này không tắt được).
- **Hồi quy:** mỗi giai đoạn đều chạy 23 bộ smoke, các bài e2e desktop, unit test và Windows CI. Bài nghiệm thu V24 nào làm xong thì thêm vào tự động.

## 5. Thứ tự làm (theo M1–M6 của gói, CNC an toàn lên đầu)

| Giai đoạn | Nội dung | Bài nghiệm thu chính |
|---|---|---|
| **P0 an toàn** | Khoá CNC: hồ sơ máy, cổng, bản xem trước có cảnh báo, STALE, parser; sửa lỗi G-code | V24-049…061, CNC-* |
| **M1** | GUID/rev + migration; sửa tường bằng tay nắm và số; 3D cập nhật từng phần; Smart Room; diện tích tự tính | V24-001…010 |
| **M2** | Thư viện nội thất thống nhất, thay thế / khoá / cao độ / vật liệu từng phần / kích thước vân; va chạm; 3 phương án | V24-024…031 |
| **M3** | GLB, Blender worker, bookmark, Ngày/Hoàng hôn/Đêm, so sánh trước/sau, hàng đợi khoá revision | V24-036, 041…047 |
| **M4** | Hiệu chỉnh tỷ lệ ảnh/PDF, REVIEW REQUIRED, preset AI, checkpoint | V24-017…020, 029…032 |
| **M5** | Liên kết tủ → bảng cắt → CNC với STALE đầy đủ; mặt đứng lắp tủ | V24-049…052, SP33 |
| **M6** | Phím tắt, phiên bản, mẫu, A0 + thước, ⌘K, SBOM, kiểm thử chạy khi tắt mạng | V24-035, 038…040, 048, 062…065 |

**Lát dọc đầu tiên** (theo hợp đồng): phòng đo kích thước → bày đồ 2D → 3D trực tiếp → vật liệu → 1 camera lưu → render cục bộ → mặt bằng PDF/DXF → bảng cắt tủ mẫu, **CNC tắt cho tới khi nghiệm thu máy**.

## 6. Cần chủ dự án quyết

1. **Blender:** dùng bản anh đã cài (tiến trình riêng, không đóng gói vào bộ cài) để chạy và kiểm thử ngay. Có đóng gói Blender vào bộ cài để phát hành hay không thì cần xem xét giấy phép GPL; tạm thời **không đóng gói**.
2. **Máy CNC thật:** cần hãng, model, controller và firmware, loại và số đầu, ATC, khổ bàn, file NC mẫu đã chạy được. Khi chưa có, xuất NC sản xuất **bị chặn** (đúng yêu cầu).
3. **Ảnh concept bằng diffusion (SP47):** có làm không. Nếu làm thì cần chọn mô hình và đồng ý cho tải về.
4. **Thay đổi bố cục:** tab con Space Planning, các chế độ xem và thanh so sánh render được đặt **trong** màn hiện có (tab, ngăn kéo, popover). Chỗ nào buộc phải đổi bố cục sẽ có UI_CHANGE_REQUEST kèm ảnh trước/sau.
