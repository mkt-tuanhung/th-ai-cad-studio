# QA v2.4 M1 — Một mô hình ngữ nghĩa + 3D liên kết trực tiếp

**Ngày:** 2026-10-18. **Nhánh:** `worktree-agent-a4cc2afd4a7a06264` (đã merge `main` 25cc86b).
**Máy:** macOS Apple Silicon, ứng dụng desktop build từ worktree (`native/build`), UI chạy từ Vite riêng `127.0.0.1:5247`, profile QA riêng (`THCAD_PROFILE=agent-linked3d-*`).

Mọi kết quả dưới đây là **đã chạy thật**; số liệu lấy từ log trong `qa/v2_4/linked/`.

## 1. Đã làm gì

| Hạng mục | Nội dung | Vị trí code |
|---|---|---|
| GUID / rev / nguồn | Mọi thực thể BIM (tầng, loại tường, tường, cửa, phòng, sàn, cột, thang, lan can, đồ, lưới, ghi chú, dầm, móng, mái) có `guid` (UUID v4, giữ nguyên khi sửa/dời, sao chép thì cấp mới), `rev` (+1 mỗi lần đổi), `src` (`drawn/imported/ai/survey/image`). Đóng dấu tự động trong `edit()` nên mọi công cụ đều có. Migration store v2→v3 không mất dữ liệu. IFC GlobalId lấy từ guid (vẫn giữ luật duy nhất của `main`). Revision mô hình không bao giờ lặp lại (kể cả sau Undo). | `ui/src/bim/identity.ts`, `ui/src/state/bim.ts`, `ui/src/bim/ifc.ts` |
| Biểu đồ phụ thuộc | `dirtyOf(cũ, mới)`: tường → lỗ cửa, phòng kề, sàn mặc định của tầng, mặt đứng/mặt cắt/khối lượng; loại tường → mọi tường loại đó; cửa → tường chủ; cao độ tầng → mọi thứ trên/treo vào tầng + thang giữa các tầng. | `ui/src/model/deps.ts` |
| 3D cập nhật từng phần | Native `scene3dPatch(key, upserts, removeIds)`: dựng lại riêng từng tường (kèm lỗ cửa, kính), từng item nguyên khối, sàn mặc định chỉ khi đổi kích thước; mọi thứ khác giữ nguyên solid. `addBuilding` tách thành hàm dựng từng tường / từng sàn. UI gửi đúng phần bẩn, lần đầu và khi lỗi thì nạp toàn bộ. | `native/libs/geom_occt/src/scene.cpp`, `native/app/src/host_bridge.cpp`, `ui/src/bim/live3d.ts` |
| Sửa trực tiếp | Tay nắm tường (kéo đầu = kéo dài, tường nối theo; kéo giữa = dời; Alt = tách), gõ số khi vẽ tường (`4200`, `@4200<90`, `@dx,dy`, `x,y`, `R2500`), bắt điểm đầu mút / trung điểm / giao / vuông góc / gần nhất trên mặt và tim tường, Shift khoá góc 15°, hiện chiều dài tim + mặt trái + mặt phải. Properties sửa được: dài, góc, điểm đầu, dày (đổi/tạo loại), cao, lệch chân/đỉnh, cao ở cuối (tường dốc), bán kính cung; cửa: rộng (giữ tâm), cao, bậu, vị trí, bản lề trái/phải, mở vào/ra; cao độ & tên tầng; tên/số phòng. Luật: lỗ cửa phải nằm trong tường chủ, cách đầu tường ≥ 50 mm, không cao quá đỉnh tường. | `ui/src/bim/walls.ts`, `ui/src/bim/derive.ts`, `ui/src/screens/bim/BimPlan.tsx`, `PropertiesPanel.tsx` |
| Phòng | Phòng biết các tường bao (`edges`): đường bao, diện tích thông thủy (mặt trong), diện tích tim tường, chu vi tính lại sau mỗi lần sửa tường (cả tường cong). Công cụ Room cũ cũng gắn tường bao. Smart Room: chữ nhật, L, U, đa giác, tròn (đoạn thẳng hoặc 4 cung), hành lang; nhập kích thước mm (thông thủy hoặc tim tường), dày, cao, xoay; dùng chung tường có sẵn, không vẽ trùng; một bước Undo. Hàm thuần `smartRoom(model, spec)` trả về `roomGuid` cho Nội thất dùng. | `ui/src/bim/rooms.ts`, `ui/src/bim/smartRoom.ts`, `LinkedDialogs.tsx` |
| Tường cong / tường dốc | `arc.radius` (có dấu), `heightEnd`. Mặt bằng vẽ cung; 3D bằng OCCT revolve đúng bán kính (tường dốc trên cung: chia 5°); IFC `IfcRevolvedAreaSolid` / profile dốc; khối lượng = chiều dài cung × chiều cao trung bình. | `walls.ts`, `scene.ts`, `ifc.ts`, `quantities.ts`, `model.ts` |
| Thang / tầng / mái | Thang L/U có chiếu nghỉ trong công cụ (More → L / U stair…); số bậc theo chiều cao tầng nên đổi cao độ tầng là thang tự tính lại; thang nhập từ file (rise cố định), chiếu nghỉ và lan can thang được co giãn theo tầng mới. Mái theo chu vi tường (More → Roof from perimeter…) dùng `bim/roof.ts`, phủ mặt ngoài tường + vươn mái, không sửa tường. | `scene.ts`, `derive.ts`, `roofTool.ts` |
| Chế độ xem 3D (chỉ hiển thị) | Ô chọn chế độ 3D thêm: Tường thấp (cắt từng tường ở độ cao chỉnh được), Xuyên tường (tường phía trước theo camera mờ đi, chỉnh %), Đi bộ (va chạm tường/cửa đóng/đồ, bật/tắt); cửa mở/đóng; xem phòng trong 3D (menu Properties của phòng); lưu/mở góc nhìn (Project Browser → 3D Views → Save current 3D view); tự hạ độ phân giải khi máy chậm. Kiểu `CameraBookmark` dùng chung với nhóm Render ở `ui/src/model/bookmark.ts`. | `Viewer3D.tsx`, `ui/src/bim/view3d.ts`, `NativeScene.tsx`, `ProjectBrowser.tsx` |

Chuỗi giao diện mới có cả EN và VI trong `ui/src/i18n/ws/linked.ts` (không sửa `en.ts`/`vi.ts`). Không đổi bố cục 12 màn khoá: các chức năng nằm trong menu More, ô chọn chế độ 3D có sẵn, menu "…" của Properties, Project Browser, chip nổi trong khung 3D.

## 2. Bằng chứng kiểm thử

### Unit — `ui/tools/unit/linked.test.ts` → **77/77 PASS** (`qa/v2_4/linked/unit_linked.json`)
- V24-001: phòng 4200 × 3600 thông thủy → 15,12 m²; tim tường 16,72 m²; chu vi 15 600 mm; tường 4400/3800 tim; nhập theo tim → 13,60 m²; lưu/đọc lại JSON ra cùng số.
- V24-002: phòng L cạnh phòng có sẵn: 1 tường dùng chung + 6 tường mới, **không tường trùng**, diện tích L 15,24 m² (đúng giải tích), phòng cũ 10,64 m² không đổi; U 31,2 m²; tròn 16 cạnh đúng công thức.
- V24-003: R = 2500 giữ chính xác qua JSON; 3D là revolve với mặt 2400/2600, tâm cách dây cung 2000; IFC có `IFCREVOLVEDAREASOLID`; phòng tròn 4 cung = π·2,5² m².
- V24-004: dày 200 → 250: thông thủy 10,64 → 10,3125 m²; mặt trong 3800 → 3750, mặt ngoài 4200 → 4250 mm.
- V24-005/006: dài 4200 → 4500: cùng guid, rev +1, phòng 13,60 → 14,62 m², tập bẩn = 3 tường (không có tường đối diện), cửa, phòng; một bước Undo trả về mô hình giống hệt (JSON so khớp).
- V24-007…011, migration v2→v3 (dữ liệu người dùng giữ nguyên, chạy lại không đổi guid), GlobalId IFC ổn định sau khi dời tường, sao chép → guid mới, tay nắm / gõ số / bắt điểm, luật cửa (D12 lỗi sẵn của mẫu không chặn sửa khác).

### Desktop e2e — `native/app/resources/e2e_linked3d.js` → **36/36 PASS** (`qa/v2_4/linked/e2e_linked3d.log`)

| Bài | Kết quả đo |
|---|---|
| Nạp lần đầu | toàn bộ cảnh 198 ms |
| Thêm phòng + cửa | **patch**, 7 solid dựng lại trong 13,2 ms |
| **V24-005** dài 4200 → 4500 (Properties, trong mặt bằng) | **patch, 5/63 solid dựng lại** (W25 tường sửa, W26 tường đông mang theo, W27 tường bắc kéo dài, `slab:L1`, `slab:L2` vì nhà dài thêm) trong **14,7 ms** so với nạp toàn bộ 198 ms; **58 solid còn lại giữ nguyên số build và địa chỉ B-rep**; tường native giữ guid; khung hình đổi; diện tích phòng 13,60 → 14,62 m²; cảnh mặt đứng cũng patch, mép nhà x1 24 300 → 24 600 (+300 mm) |
| **V24-006** ⌘Z một lần | tường 4200, phòng 13,60 m², guid và rev như cũ; 3D patch ngược, **khung hình giống hệt trước khi sửa** (so sánh ảnh từng byte); mặt đứng về 24 300 |
| **V24-007** chọn tường trong 3D (pick tia thật) → Properties cao 3600 | mô hình 3600 (lệch đỉnh +600), solid 3D cao 3600, Properties 2D hiện 3600,0 mm, cảnh mặt đứng có tường 3600 |
| **V24-008** cửa 800 → 900 | giữ tâm (offset 950), tên loại "900 x 2100mm"; tường chủ dựng lại, thể tích giảm đúng 0,042 m³ (2,1840 → 2,1420) |
| **V24-009** cửa cách đầu tường 20 mm | bị từ chối, mô hình và ngăn Undo không đổi; Properties dời cửa ra ngoài tường cũng bị từ chối, có thông báo |
| **V24-012** tường thấp | khung hình đổi; thể tích 28 tường và mô hình không đổi |
| **V24-013** xuyên tường | đổi độ mờ 35 % → 50 %: mô hình, thể tích, phần tử đang chọn không đổi |
| **SP22** cửa mở/đóng | chỉ 13/13 cánh cửa dựng lại (13,1 ms), mô hình không đổi |
| **V24-014** va chạm khi đi bộ | bật: dừng cách tường 300 mm (mắt x = 23 800, mặt trong 24 100), bị chặn bởi W26; tắt: đi xuyên (x = 27 500); bấm phím W trong app: dừng, chip "Blocked by W26" |
| **SP20** xem phòng | camera nhìn vào tâm phòng (22 100, 1 800), chọn đúng tầng |
| **V24-015** góc nhìn đã lưu | khôi phục vị trí lệch 0,000 mm, FOV 40°, ống kính 33 mm, tầng, revision mô hình được ghi |
| **V24-016** máy chậm | chất lượng thấp: khung 373 px trên 746 px, mô hình không đổi |

Ảnh chụp: `qa/v2_4/linked/linked_room_3d.png`, `linked_plan_4500.png`, `linked_3d_4500.png`, `linked_elevation_before.png`, `linked_elevation_after.png`, `linked_low_walls.png`, `linked_see_through.png`, `linked_doors_open.png`, `linked_walk_blocked.png`, `linked_room_focus.png`, `linked_smart_room_preview.png`, `linked_smart_room_plan.png`, `linked_u_stair_plan.png`.

### Browser smoke — `ui/tools/smoke-linked.mjs` → **11/11 PASS**
Gõ 4200 + `@3600<90` ra đúng tường; bắt trung điểm có tên; tay nắm kéo W25 → 4700, W26 theo, một bước Undo; Smart Room L (đặt bằng click) 25,2 m², 6 cạnh; dày 200 → 250 làm diện tích giảm; dài 4500 giữ guid, cửa ra ngoài tường bị từ chối, bản lề phải; cao độ tầng; tường cong R2500; thang U; mái theo chu vi (tường không đổi); chuỗi VI.

### Hồi quy (đã chạy, đều PASS)
| Bộ | Kết quả |
|---|---|
| `smoke-bim.mjs` | 19/19 |
| `smoke-bim-draw.mjs` | 12/12 |
| `smoke-fromcad.mjs` | ALL PASS |
| `smoke-renders.mjs` | 11/11 |
| `smoke-interior.mjs` | 13/13 |
| `e2e_bim3d.js` | 9/9 (`qa/v2_4/linked/e2e_bim3d.log`) |
| `e2e_bimviews.js` | 11/11 (cần `THCAD_DWG_OUT` để bỏ hộp thoại lưu) |
| `e2e_view3d.js` | 23/23 |
| Unit `ifc`, `fromcad`, `auto` | chạy, ALL PASS |
| `tsc --noEmit -p tsconfig.app.json` | sạch |

(Các e2e hồi quy được chạy từ bản sao có đường dẫn ảnh chuyển vào scratchpad để không ghi đè ảnh QA của checkout chính.)

## 3. Bài nghiệm thu

| ID | Trạng thái | Bằng chứng |
|---|---|---|
| V24-001 | Tested (unit + e2e + smoke) | linked.test, e2e, smoke |
| V24-002 | Tested (unit + smoke) | không trùng tường, diện tích khớp |
| V24-003 | Tested (unit + smoke) | R2500 giữ nguyên 2D→3D→IFC |
| V24-004 | Tested (unit + smoke) | mặt trong/ngoài, diện tích |
| V24-005 | Tested (e2e native) | 5/63 solid, 14,7 ms, guid giữ |
| V24-006 | Tested (unit + e2e) | khung hình giống hệt |
| V24-007 | Tested (e2e) | pick 3D → Properties → 2D/mặt đứng |
| V24-008 | Tested (unit + e2e) | −0,042 m³ |
| V24-009 | Tested (unit + e2e + smoke) | từ chối, không ghi |
| V24-010 | Tested (unit + smoke) | 19×173,7 → 20×175 mm; thang U về đúng 3500; thang nhập 1650 → 1750 |
| V24-011 | Tested (unit + smoke) | mái phủ −600…8600, tường không đổi |
| V24-012 | Tested (e2e) | thể tích không đổi |
| V24-013 | Tested (e2e) | chọn không đổi |
| V24-014 | Tested (e2e) | dừng 300 mm |
| V24-015 | Tested (e2e) | 0,000 mm |
| V24-016 | Tested (e2e, ép chế độ thấp) | khung ½ độ phân giải; chưa thử trên GPU chậm thật |
| V24-033 | Một phần: mặt đứng cập nhật sau khi sửa tường/cửa (cảnh `bim2d` patch); chưa có bài riêng "dời cửa → mặt đứng" | e2e V24-005 phần mặt đứng |
| V24-034 | Không chạy riêng; mặt cắt hai tầng dùng lại cảnh `bim2d` cũ (e2e_bimviews PASS) | — |

## 4. Giới hạn / ghi chú trung thực
- Tường dốc trên **tường cong** được dựng bằng các lát 5° (bậc nhỏ), không phải mặt dốc liên tục; IFC của tường cong dùng chiều cao trung bình.
- `length` của tường cong là **dây cung** (để mối nối, bắt điểm và phòng giữ nguyên); chiều dài cung hiển thị riêng trong Properties và dùng cho khối lượng.
- Phòng tròn bằng cung lấy mẫu 1° khi tính diện tích (sai số < 0,01 %).
- Khi nhập từ CAD (`applyBim`) luật lỗ cửa không chặn việc nhập (để model checks báo), phần tử được gắn `src: imported`.
- Va chạm đi bộ dùng 2 tia ngang (ngang mắt và thấp hơn 1 m), bỏ qua kính và mặt đất.
- V24-016 mới kiểm bằng cờ ép `thcad.view3d.quality = low`; chế độ tự động (khung > 120 ms thì hạ độ phân giải khi kéo) chưa đo trên máy chậm thật.
