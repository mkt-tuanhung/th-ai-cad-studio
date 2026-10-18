# QA — v2.4 M2: Bố trí không gian Nội thất (Space Planning)

**Ngày:** 2026-10-18 · **Phạm vi:** SP23–SP29, SP33, SP36 (một phần) · **Nghiệm thu:** V24-024…V24-031, V24-037
**Nguyên tắc:** chỉ ghi "Đạt" cho bài đã chạy thật. Ảnh chụp và log nằm trong `qa/v2_4/spaceplan/`.

## 1. Đã làm gì (cập nhật tại chỗ, không đổi bố cục màn hình)

| Hạng mục | Vị trí trên giao diện | Code |
|---|---|---|
| Tab **Bố trí không gian** trong thẻ dưới của workspace Nội thất hiện có (cạnh Nội thất & Vật dụng / Vật liệu / Bảng cắt / Khối lượng phòng). Chế độ xem: Mặt bằng 2D, 3D trực tiếp, Đi xuyên, Kết xuất, Sản xuất. Mỗi chế độ mở **khung nhìn sẵn có** (mặt bằng, InteriorViewport, walkthrough, màn Renders, hộp thoại Xếp tấm & CNC) | thẻ dưới | `screens/interior/SpacePlanning.tsx` |
| Thư viện nội thất thống nhất: lấy từ `library/catalog.ts` (kích thước thật R×S×C mm), tìm kiếm, lọc theo loại và phong cách, bấm Đặt hoặc kéo thả vào mặt bằng; thả cách tường dưới 600 mm thì tự áp lưng vào tường. Thêm "Dining Chair 480×520×900" và vài món tham số (Base Cabinet Run, Wardrobe tham số, Wall Shelf treo tường, Area Rug, tủ chậu, tủ bếp nấu, tủ lạnh, tab đầu giường) — thêm vào **cuối** danh mục nên id cũ không đổi | Thư viện | `interior/catalog.ts`, `library/catalog.ts` |
| **Quy ước gốc:** tâm mặt bằng R×S, ở **đáy** (z = cao độ); trước khi xoay mặt trước hướng −Y; góc xoay ngược chiều kim đồng hồ quanh +Z. Tủ tham số: thân R×S, cánh phủ 18 mm phía trước | — | `interior/catalog.ts` (chú thích đầu file), có kiểm thử |
| Dời (kéo trên mặt bằng), xoay 90°/tự do, áp tường, nhân bản, nhóm, khoá, gắn tường (đồ treo chỉ trượt dọc tường của nó), cao độ, đổi kích thước trong giới hạn tham số, **thay thế tại chỗ** | Thuộc tính → Vị trí / Thay thế tại chỗ | `interior/layout.ts`, `screens/interior/SpaceInspector.tsx` |
| Vật liệu PBR (màu, độ nhám, kim loại), **ô vân theo mm**, hướng vân; hoàn thiện **từng phần** (thân/cánh/mặt/chân/nệm…); xuất `material {id, color, roughness, metallic, tileMm, grainDeg}` vào từng scene item cho đường GLB/Blender; mặt bằng hoàn thiện vẽ ô vân đúng kích thước mm | Thuộc tính → Hoàn thiện từng phần; Mặt bằng hoàn thiện | `interior/materials.ts`, `interior/scene.ts` |
| Kiểm tra khoảng trống & va chạm (ghi rõ **"khuyến nghị, không phải kiểm tra tuân thủ pháp lý"**): chồng lấn, vùng trước tủ 500, hai bên/cuối giường 600, vùng cửa, lối đi 800 (tìm đường trên lưới 50 mm), đồ treo lệch tường, ra ngoài phòng. Bảng thông số sửa được theo dự án. Mỗi lỗi có số đo; cách sửa (dời/xoay/áp tường) được tính và kiểm lại, có số sau khi sửa, xem trước rồi áp dụng (một bước hoàn tác) | Kiểm tra | `interior/clearance.ts` |
| **3 phương án bố trí** theo luật (phòng khách / phòng ngủ / bếp có tam giác bếp khuyến nghị), mỗi phương án là một bộ thay đổi riêng, đã kiểm tra hình học trước khi hiện, điểm minh bạch (sàn đi tới được, thể tích lưu trữ, khoảng trống trước cửa, chi phí — "chưa có giá" vì thư viện không có giá, không bịa). Xem trước 2D + 3D / Áp dụng (một bước hoàn tác) / Từ chối (không đổi gì). Thiếu cửa hoặc bề rộng cửa → **"Cần nhập"**, không đoán. AI cục bộ chỉ được xếp hạng/giải thích (grammar chỉ cho chọn id phương án) | Phương án; AI Assistant → Generate → "Mở các phương án bố trí" | `interior/options.ts` |
| Cửa của phòng (tường, vị trí, bề rộng, kiểu mở) nhập tay hoặc **lấy từ mô hình BIM** khi phòng dựng từ bản vẽ CAD | Thuộc tính phòng → Cửa | `interior/bimDoors.ts` |
| **Mặt đứng tủ theo tường** (bản vẽ lắp đặt): khung tường, tủ đúng rộng/cao/cao độ, chia cánh, chuỗi kích thước ngang + chuỗi cao độ, khổ A3, mở trong CAD 2D (từ đó xuất DXF/DWG/PDF theo đường sẵn có); PDF trực tiếp (desktop) / SVG (trình duyệt) | Mặt đứng tường | `interior/elevation.ts` |
| **Bảng thống kê theo phòng**: số lượng = số đối tượng trong cảnh, kích thước đo từ hình học 3D; xuất CSV (cả trong menu Xuất) | Thống kê | `interior/production.ts` |
| **Cổng sản xuất** (V24-024): tủ/món có kích thước từ ý tưởng AI hoặc dò từ ảnh (`src.kind = ai/image` hoặc `reviewRequired`) không được vào sản xuất; nút "Xác nhận kích thước đã đo". Ước tính xếp tấm trong Bảng cắt chỉ lấy tủ hợp lệ và ghi rõ tủ bị chặn. API cho phía CNC: `manufacturable(item, doc)`, `manufacturableCabinet(c, doc)`, `productionGate(doc)` | Thuộc tính → Sản xuất; Bảng cắt | `interior/production.ts` |
| Preset AI "Bố trí phòng tự động" và "3 phương án nội thất" chuyển từ "Đang phát triển" sang "Dùng được", mở thẳng Nội thất → Bố trí không gian → Phương án | AI Studio → Tác vụ AI mẫu | `ai/presets.ts`, `screens/ai/TaskPresets.tsx` |

Mẫu "3 phương án" ghi sẵn (DEMO) trong AI Studio (`ai/sampleSession.ts`) vẫn giữ nhãn DEMO như cũ; trong Nội thất, ghi chú "Generate" cũ (nói rằng tạo bố trí chạy trên AI) đã được sửa cho đúng: bố trí do bộ sinh theo luật tạo ra.

## 2. Kết quả kiểm thử (đã chạy)

| Bài | Lệnh | Kết quả |
|---|---|---|
| Unit Space Planning | `cd ui && UNIT=spaceplan node tools/test-cam.mjs run` | **all: true**, 0 failed (~0,5 s) — `spaceplan/unit-spaceplan.json` |
| Smoke mặt bằng + Space Planning | `THCAD_UI=… node tools/smoke-interior-plan.mjs` | **17/17**, không lỗi console — `spaceplan/smoke-interior-plan.log` |
| Smoke Nội thất (hồi quy) | `node tools/smoke-interior.mjs` | **13/13** — `spaceplan/smoke-interior.log` |
| Smoke Components (hồi quy) | `node tools/smoke-components.mjs` | **18/18** — `spaceplan/smoke-components.log` |
| Smoke AI Studio (preset bật) | `node tools/smoke-ai.mjs` | **21 PASS**, 0 FAIL, không lỗi console — `spaceplan/smoke-ai.log` |
| Hồi quy khác | smoke-renders 11/11, smoke-fromcad ALL PASS, smoke-auto ALL PASS, unit auto ALL PASS | Đạt |
| Kiểm tra kiểu | `npx tsc --noEmit -p tsconfig.app.json` | Sạch |
| E2E desktop (InteriorViewport bounds) | — | **Chưa chạy** (không build native trong worktree này) |

Dev server riêng: `npx vite --config vite.sp.config.mts --port 5241` (file cấu hình tạm cho `server.fs.allow`, không commit).

## 3. Đối chiếu nghiệm thu

| ID | Yêu cầu | Bằng chứng | Trạng thái |
|---|---|---|---|
| V24-024 | Tủ không có kích thước thật thì không vào sản xuất | unit `V24_024_blocked`, `V24_024_sampleOk`, `V24_024_confirm` | Đạt (tự động) |
| V24-025 | Ghế 480×520×900: bao trong cảnh = danh mục | unit `V24_025_bounds`, `V24_025_sceneItem`, `allCatalogBounds` (mọi sản phẩm), `rotate90SwapsBounds`; smoke bước V24-025; ảnh `01-library-place.png` | Đạt (tự động); OCCT desktop chưa chạy |
| V24-026 | Thay tại chỗ: cùng biến đổi, kích thước mới, kiểm tra lại khoảng trống | unit `V24_026_*` (va chạm đo 300 mm sau khi thay); smoke bước V24-026; ảnh `02-inspector.png` | Đạt |
| V24-027 | Hoàn thiện từng phần: đổi hình thức, hình học giữ nguyên | unit `V24_027_geometrySame`, `V24_027_appearanceChanges`, `V24_027_cabinetBoards` (kích thước bảng cắt không đổi); smoke | Đạt |
| V24-028 | Vân/UV theo chu kỳ mm | unit `V24_028_tileMm` (tấm 1200 với ô 600 → 2 lần; gỗ sồi xoay 90°), `V24_028_sceneExport`; smoke: pattern `600x600`, `1800x180`; ảnh `09-finish-tiles.png` | Đạt (dữ liệu + 2D); hiển thị texture trong render là việc của nhánh render (đã có `tileMm`, `grainDeg` trong scene item) |
| V24-029 | 3 phương án, mỗi cái là bộ thay đổi riêng | unit `V24_029_threeOptions`, `…distinctChangeSets`, `…geometryValid`, `…deterministic`, `…applyOneUndo`; smoke; ảnh `05`, `06` | Đạt |
| V24-030 | Từ chối → bản vẽ nguyên vẹn | unit `V24_030_rejectIntact`; smoke so sánh JSON trước/sau | Đạt |
| V24-031 | Thiếu bề rộng cửa → hỏi / đánh dấu cần nhập | unit `V24_031_needsInput`, `doorWidthNeedsInput`; smoke; ảnh `04-needs-input.png`; smoke-ai bước V24-031 | Đạt |
| V24-037 | Thống kê theo phòng khớp cảnh | unit `V24_037_schedule`, `scheduleChairs`; smoke (6 ghế, kích thước đo từ 3D, CSV); ảnh `08-schedule.png` | Đạt |
| SP29 | Va chạm/khoảng trống có số đo + cách sửa | unit `clearanceZone`, `fixResolves`, `fixOneUndo`, `doorBlocked`; smoke; ảnh `03-checks-fixes.png` | Đạt |
| SP33 | Mặt đứng tủ ổn định | unit `SP33_elevation`, `SP33_stable`; smoke (mở CAD 2D, ≥ 4 kích thước, lớp I-ELEV-CASE); ảnh `07-wall-elevation.png` | Đạt |

## 4. Giới hạn đã biết (nói thẳng)

- Kiểm tra lối đi dùng lưới 50 mm và khoảng cách chamfer 3-4 (sai số vài phần trăm); vùng mở cửa lấy hình vuông bề rộng cánh × bề rộng cánh (bao ngoài cung mở).
- Va chạm tính theo các khối hộp/trụ của mô hình tham số (đúng hình 3D đang dựng), không theo mesh chi tiết.
- Bộ sinh phương án dùng mẫu cố định cho phòng khách / phòng ngủ / bếp; phòng không chữ nhật vẫn được kiểm tra đúng nhưng mẫu đặt theo từng cạnh tường. Bếp mẫu thử 3,6×3,0 m: các phương án hợp lệ về hình học nhưng tam giác bếp **ngoài khuyến nghị** — được hiển thị như vậy, không che.
- Thư viện chưa có giá → điểm chi phí luôn "chưa có giá".
- Chưa chạy e2e desktop; OCCT không được kiểm trong lần này (bao hình học kiểm bằng cùng primitive gửi cho OCCT).
- Màn AI Studio (mẫu DEMO 3 phương án của mockup 03) giữ nguyên nhãn DEMO; chưa nối phương án thật của Nội thất vào khung "Proposal" của AI Studio (cần màn đó, ngoài phạm vi).

## 5. UI_CHANGE_REQUEST

Không có. Mọi phần mới nằm trong tab/ô có sẵn (thẻ dưới, bảng Thuộc tính, hộp thoại Modal).
