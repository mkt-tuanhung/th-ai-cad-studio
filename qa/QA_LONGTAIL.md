# QA — Hoàn thiện các chức năng còn dở (2026-10-12)

Build: macOS arm64, Qt 6 + OCCT, UI dev server và bản đóng gói (`thcad://`).

## Đã làm

### Dashboard
- **Xử lý hàng loạt** (Batch Process Files): đọc nhiều DWG / DXF và ghi ra PDF (vector, vừa khổ giấy), DXF, DWG (AutoCAD 2000) và PNG (200 dpi).
  - Trên desktop, tệp được ghi vào thư mục người dùng tự chọn.
  - Native chỉ ghi được vào thư mục đã chọn trong phiên làm việc, và **không bao giờ ghi đè**: trùng tên thì thêm hậu tố “tên (2).ext”.
  - Trên trình duyệt, các tệp được tải về; PDF / DWG báo rõ là cần ứng dụng desktop.
- **Open File**: DWG / DXF mở thẳng trong CAD 2D. IFC / STEP / … được ghi vào Tệp gần đây, kèm thông báo rõ rằng bản này chưa mở được định dạng đó.
- **Xem tất cả**: hộp thoại liệt kê 10 thao tác.
- **Học tập**: hướng dẫn bắt đầu chạy offline, mỗi bước mở đúng màn hình.

### CAD 2D
- **Bắt điểm (Snap settings)**: Endpoint, Midpoint, Center, Quadrant, Intersection, Perpendicular, Nearest.
  - Có ký hiệu riêng cho từng loại; lựa chọn được lưu lại.
  - Nearest chỉ dùng khi không có điểm bắt nào khác trong tầm.
- **Cài đặt dòng lệnh**: cỡ chữ 12 / 13 / 15 px, phím cách = Enter, xoá lịch sử.
- **Detected**: bấm vào một lỗi thì chọn đối tượng và zoom tới nó.
- **AI Assist** (Gợi ý / Tạo mới / Chỉnh sửa theo vùng chọn): gửi yêu cầu sang chat của AI Studio.
  - Mô hình cục bộ trả lời ở đó; mọi thay đổi bản vẽ vẫn đi qua xem trước → duyệt → hoàn tác.
  - Không có mô hình thì chat nói rõ là không có.
- Menu bật lên dùng portal (`AnchoredMenu`) nên không bị khung cắt mất.

### BIM
- **Project Browser**:
  - Mặt đứng Đông / Tây / Bắc / Nam: camera trực giao đặt ở đúng phía công trình.
  - Mặt cắt 1 / 2: mặt phẳng cắt đi qua tâm công trình, lấy theo bounds chính xác từ OCCT, có tô phần bị cắt.
  - Sheet A101 / A201 / A301: mở đúng view đặt trên sheet.
  - Floor plans lấy theo các cao độ thật của mô hình.
- **Coordination settings**: bật / tắt từng loại kiểm tra (hiện “Off”), và tuỳ chọn tự kiểm tra sau mỗi lần sửa.

### Các browser khác
- **Cơ khí**: XY / YZ / ZX Plane cho view vuông góc với mặt phẳng; Origin / GCS về view home.
- **MEP**:
  - Các hệ thống mở bảng thống kê tương ứng.
  - Họ Tray / Fixture: chỉ hiện nhóm đó, menu Hiển thị khôi phục lại các nhóm khác.
  - Conduit / Support: báo rõ là mô hình không có.
- **Hạ tầng**:
  - Sheet C001–C003 mở view tương ứng.
  - Access Road: báo rõ là chưa được dựng, chỉ có CANAL-01.
  - Công cụ mặt bằng khi chưa có số liệu khảo sát: yêu cầu nhập khảo sát trước, vì ảnh đang hiện là ảnh DEMO.

### AI Studio — Scan to CAD
- **PDF vector** (xuất từ CAD / Revit…) → hình học CAD thật bằng pdf.js 4.10.38 (Apache-2.0, chạy offline):
  - đường thẳng, đa tuyến, đường cong (chia nhỏ), hình chữ nhật, vùng tô và chữ;
  - mỗi màu nét thành một layer `PDF-RRGGBB`;
  - kích thước chính xác theo tỉ lệ đã chọn.
- **Ảnh raster**, hoặc PDF là bản quét → mở làm **ảnh nền** đúng tỉ lệ (theo dpi × tỉ lệ) để vẽ lại.
  - Hộp thoại nói thẳng: tự động vector hoá ảnh cần mô hình thị giác (vision), bản này chưa có.

### Thư viện cấu kiện
- **Chèn vào BIM**: cấu kiện có kích thước 3D được nạp vào công cụ Component của BIM với đúng kích thước thật.
- **Auto-align**: đặt trên sàn của cao độ và xoay song song với bức tường gần nhất trong phạm vi 1 m.

### Cơ khí và các nội dung khác
- **Exploded view** ở panel Display: bật / tắt thật trên desktop.
- **Câu chữ**: bỏ hết cụm “UI prototype / chưa kết nối” đã lỗi thời.
  - Các thông báo còn lại chỉ xuất hiện trên trình duyệt hoặc ở chế độ Realistic, và nói đúng điều kiện cần.
  - Chia sẻ: “cần máy chủ dự án (PWA, làm sau)”.

## Bằng chứng

| Kiểm thử | Kết quả |
|---|---|
| 19 bộ smoke Playwright (`ui/tools/smoke*.mjs`) | **257 / 257 PASS**. Mới: Batch, See all, Guide, Snap, cài đặt dòng lệnh, AI Assist → AI Studio, Coordination, Chèn vào BIM (sofa 2400×950×780, xoay 90° theo W9), Scan (`smoke-scan.mjs`) |
| Unit (`tools/unit/*.test.ts`) | đạt, gồm cả hình học bắt điểm (góc phần tư, Nearest, chân đường vuông góc) |
| Native ctest | 100 % |
| e2e desktop `e2e_batch.js` | 4/4: DWG thật (328 đối tượng) + DXF → 8 tệp; lần chạy thứ hai ra “(2)”, không ghi đè. PDF A3 (`pdfinfo`), DWG đọc lại bằng LibreDWG, PNG 3307×2339 |
| e2e `e2e_bimviews.js` | 8/8: hướng camera của 4 mặt đứng, mặt cắt 1 / 2, sheet A201 |
| e2e `e2e_scan.js` (UI đóng gói, `thcad://`) | 4/4: worker của pdf.js chạy được; hình chữ nhật 100 pt → 3 527,8 mm ở 1:100; chữ “ROOM 101”; layer PDF-0000FF |
| e2e `e2e_layouts.js` | 4/4 (PDF nhiều trang A3 / A1 / A4) |
| Các e2e cũ (cad, view3d, part, bim3d, bimdraw, mepdraw, civil3d, interiorcut, aichat, comprank, panovideo, rendersai) | tất cả PASS |

## Giới hạn (nói thẳng)
- Chuyển ảnh raster sang vector cần mô hình vision: chưa có, và tải về cần bạn đồng ý.
- Layout chưa ghi vào paper space của DXF / DWG.
- Mặt đứng / mặt cắt BIM là view 3D trực giao, chưa phải bản vẽ 2D có ghi chú.
- Access Road và các mục ống luồn / giá đỡ là mục của mockup, chưa có trong mô hình — app báo đúng như vậy.
