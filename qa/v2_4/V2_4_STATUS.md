# v2.4 — Trạng thái sau đợt thực hiện (2026-10-18)

**Mốc rollback:** tag `baseline-pre-v2.4` (`f4afb04`).

**Phần thay đổi:** tất cả commit trên `main` sau mốc này. Gồm 4 nhánh sửa lỗi review và 6 nhánh v2.4: CNC, mô hình chung (M1), Space Planning (M2), render (M3), nhập ảnh/PDF (M4), nền tảng.

**Bằng chứng chi tiết:**
- `qa/v2_4/QA_CNC_GATE.md`, `QA_LINKED_MODEL.md`, `QA_SPACE_PLANNING.md`, `QA_RENDER_LOCAL.md`, `QA_IMPORT_CAL.md`, `QA_PLATFORM.md`;
- kiểm kê ban đầu: `docs/v2_4/AUDIT_AND_DELTA.md`;
- review: `qa/REVIEW_2026-10-18.md`.

**Cách ghi trạng thái:**
- **Đạt** = bài kiểm thử tự động đã **chạy thật** và qua.
- **Một phần** = đã chạy, nhưng chưa phủ hết điều kiện nghiệm thu.
- **Chưa chạy** / **Bị chặn** = ghi rõ lý do.
- Không bài nào được ghi "Đạt" nếu chưa chạy.

## 1. Kiểm thử chạy lại trên `main` sau khi gộp tất cả

| Bộ | Kết quả |
|---|---|
| Kiểm tra kiểu `tsc -p tsconfig.app.json` | sạch |
| C++ `ctest` (bim, occt, core…) | đạt |
| Unit TS: auto, cam, chat, civilroute, cnc, fromcad, importcal, linked, partcam, platform, render, spaceplan, dxfround | tất cả `all: true` |
| Smoke trình duyệt (24 bộ) | 0 FAIL |
| e2e desktop: linked3d 36, bim3d 9, bimviews 11, view3d 23, blender 34, fromcad 12, route 9, auto 8, cad 12, layouts 5, platform 4, aichat 3 | tất cả đạt |
| Tự kiểm tra trong app (bản dev và bản đóng gói DMG) | 19 PASS, `SELFTEST DONE OK` |
| "1 lệnh" với 3 file DWG | 66 file `.NOT_FOR_MACHINE` (xem trước kỹ thuật), **0 file `.nc`** |

Ba bộ unit cũ (`dwg`, `layouts`, `survey`) không có hàm `run`; chúng được chạy theo cách riêng ghi trong QA tương ứng.

## 2. Bài nghiệm thu V24 (65 bài)

| Bài | Trạng thái | Ghi chú |
|---|---|---|
| 001–015 | Đạt | M1: mô hình chung, 3D cập nhật từng phần (sửa 1 tường → dựng lại 5/63 khối, 14,7 ms), một bước hoàn tác, tường cong, cửa, tầng, mái, tường thấp/xuyên thấu, đi bộ có va chạm, lưu khung nhìn |
| 016 | Một phần | Chế độ chất lượng thấp chỉ thử bằng cách ép; chưa đo trên máy yếu thật |
| 017–020 | Đạt | Hiệu chỉnh tỷ lệ 2 điểm (5,0019 mm/px so với 5); ảnh không tỷ lệ → CẦN XEM LẠI và chặn sản xuất; PDF nhiều trang; OCR 3600 so với 3540 bị gắn cờ |
| 021, 022 | Đạt | DXF R12 + R2000 là hình học thật; 1000 mm → 1000 mm; cung R2500 giữ nguyên (`UNIT=dxfround`) |
| 023 | Đạt (liên quan) | Dựng 3D từ bản vẽ DWG: e2e_fromcad 12/12 |
| 024–031 | Đạt | M2: tủ không có kích thước thật không vào sản xuất (cả ở cổng CNC); ghế 480×520×900; thay thế giữ vị trí; vật liệu từng phần; 3 phương án; từ chối không đổi gì; thiếu cửa → "cần nhập". **028:** dữ liệu và bản vẽ 2D đạt; vân vật liệu trong ảnh render chưa áp |
| 032 | Đạt | Hàng việc AI tiếp tục sau khi khởi động lại, không áp dụng trùng (giả lập bằng cách sửa dữ liệu đã lưu) |
| 033 | Một phần | Mặt đứng cập nhật sau khi sửa tường/cửa; chưa có bài riêng "dời cửa → kiểm tra mặt đứng" |
| 034 | Một phần | Mặt cắt có mảng cắt (e2e_bimviews); chưa có bài riêng so cao độ hai tầng |
| 035 | Một phần | PDF từ máy: thước đo 100,0000 mm, thanh 1:50 đúng; **chưa in ra giấy rồi đo**; khổ giấy bị Qt làm tròn tới 0,16 mm |
| 036 | Đạt | GLB: hộp bao trùng OCCT, mã vật liệu khớp |
| 037 | Đạt | Bảng thống kê đồ khớp với cảnh |
| 038–040 | Đạt | Phím tắt theo hồ sơ không chiếm alias CAD; lưu theo dự án; VI/EN đủ khoá, còn 25 chuỗi chưa dịch ở vài khu vực |
| 041–045 | Đạt | Render Blender không mạng; chạy nền không đứng giao diện; huỷ sạch; Ngày/Hoàng hôn/Đêm không đổi hình học; so sánh trước/sau đúng camera và revision |
| 046 | Một phần | Bảo vệ bộ nhớ thử bằng giới hạn giả lập 1200 MB |
| 047 | Bị chặn | Ảnh concept bằng AI (SP47): chờ anh quyết, mặc định là chưa làm |
| 048 | Đạt (macOS) | Chạy khi chặn mạng: 0 kết nối ra ngoài. Windows chưa thử |
| 049–061 | Đạt | CNC: máy chưa nghiệm thu → không xuất NC sản xuất; đổi máy / độ dày / kích thước tủ → STALE; 1/2/3 đầu so với lưỡi cưa; không có ATC → chặn T/M; va chạm kẹp; post chưa duyệt; chưa ký nghiệm thu; chạy thử không phôi / mẫu đầu thất bại → vẫn chặn |
| 062 | Một phần | Revision có trong snapshot và file dự án; chưa đóng vào PDF / ảnh render / NC xuất ra (ảnh render có file sidecar) |
| 063–065 | Đạt | Migration không mất dữ liệu (đã sửa lỗi Nội thất v1→v2 ghi đè phòng); điều hướng các màn không đổi; kiểm tra giấy phép SBOM |

**Bài CNC v2.3:** phần lớn tự động hoá và đạt (xem `QA_CNC_GATE.md`). CNC-075…077 và 081 **bị chặn** vì cần máy thật để chạy thử không phôi, cắt mẫu đầu và có người vận hành ký duyệt.

## 3. Còn mở

1. **Máy CNC thật:** cần hãng, model, controller và firmware, mã G/M đã kiểm chứng, offset và dao đo thực tế. Chưa có thì xuất NC sản xuất **luôn bị chặn**.
2. **SP47 ảnh concept bằng AI:** chờ quyết định.
3. **Có hai kiểu "lưu góc camera":** khung nhìn BIM (M1) và camera render (M3), cả hai đều chạy đúng. Nên gộp thành một danh sách.
4. **Render:**
   - vân / kích thước vân vật liệu (M2) chưa đưa vào GLB / Blender;
   - cảnh nội thất ban ngày hơi cháy sáng vì không có trần;
   - bộ nhớ đệm render chưa tự dọn.
5. **Revision trên file xuất:** chưa đóng revision vào PDF / NC; PDF còn lệch khổ giấy tới 0,16 mm do Qt.
6. **Giấy phép:** cần chép thêm văn bản giấy phép của khoảng 15 thư viện mới liệt kê vào thư mục `licenses/` của bộ cài.
7. **Chưa thử trên máy thật:** máy Windows (render Blender, tải mô hình, chạy không mạng), máy Mac yếu (chế độ chất lượng thấp), và bản vẽ nhà do người thật vẽ.
8. **Lưỡi cưa và dao cắt (knife):** chưa có bộ chuyển đổi; các thao tác này luôn báo "không hỗ trợ".
