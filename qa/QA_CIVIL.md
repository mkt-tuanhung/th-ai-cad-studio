# QA — Màn 10: Civil (Pixel-Lock v2)

- **Ngày:** 2026-10-11.
- **Chuẩn so sánh:** `../TH_AI_CAD_Studio_UI_LOCK_v2/mockups/10_Civil.png` (1586 × 992).

## Ảnh

Mọi ảnh nằm trong `qa/v2/10_civil/`.

| | Tệp |
|---|---|
| Mockup và app đặt cạnh nhau | `side_by_side.png`, `mockup.png` |
| Overlay, anaglyph, difference | `overlay_50_50.png`, `overlay_anaglyph.png`, `difference_amplified.png` (MAE 13.97) |
| EN / VI | `app_en.png`, `app_vi.png` |
| Kích thước khác | `app_en_1440x900.png`, `app_en_1920x1080.png` |

## Đo bbox 66 phần tử (`ui/tools/regions_civil.json` → `inkbox.txt`)

| Lệch tối đa | Số phần tử |
|---|---|
| 1 px | 14 |
| 2 px | 20 |
| 3–5 px | 32 |

**34/66 phần tử ≤ 2 px; 66/66 ≤ 5 px.**

Phần lớn các phần tử lệch 3–5 px nằm trong cây duyệt: khoảng cách giữa các dòng của mockup không đều, từ 19 đến 22 px. Trắc dọc và mặt cắt là hình vẽ thật từ dữ liệu, nên khác mockup về nội dung, chỉ khớp về khung.

## Nội dung mockup đã sửa cho đúng (giữ bố cục)

| Mockup | App (tính thật) |
|---|---|
| Mặt cắt STA 0+300: rộng đỉnh 12.00, đáy 8.00, mỗi mái 2.00, nhưng ghi "3.00 m" sâu với mái 1:2.0 (mâu thuẫn hình học) | Mặt cắt được vẽ từ thông số: đáy 8.00, mái 2:1, **sâu mặt cắt 1.00 m**, nên đỉnh đúng 12.00 m và mỗi mái 2.00. **Chiều sâu nước 0.50 m** là độ sâu dòng đều Manning với Q = 6.7 m³/s, n = 0.015, S = 0.0015. Chiều đứng được phóng đại, có ghi "V:H = 3.6:1" |
| Trắc dọc: đường đáy kênh không khớp với nhãn "Invert EL. 6.20 / 5.80" của cống | Trắc dọc vẽ từ dữ liệu: mặt đất tự nhiên (khảo sát 20 m), đáy thiết kế có các điểm đổi dốc, đỉnh bờ = đáy + 1.00 m. Cống CL-01 nằm đúng EL 6.20 tại 0+250, CL-02 đúng EL 5.80 tại 0+520 |
| Cảnh báo "2 segments have slope < 0.0005 (0+120–0+160, 0+480–0+500)" (văn bản cố định) | **Tính từ trắc dọc thiết kế** và ra đúng hai đoạn đó. Hai đoạn được tô cam trên trắc dọc |
| "Channel section meets design standards (TCVN 11823:2017)" | TCVN 11823:2017 là tiêu chuẩn thiết kế cầu đường bộ, không áp dụng cho kênh. App ghi kết quả kiểm tra thật: vận tốc 1.49 m/s (trong khoảng 0.6–3.0, không lắng, không xói), Froude 0.71 (< 0.8), độ cao an toàn 0.50 m. Tab Tham chiếu ghi "TCVN 4118 — chờ chủ đầu tư xác nhận" |
| "increasing bottom width to 7.0 m … reduce earthwork by ~12%" | Đáy hiện tại là 8.00, nên 7.0 m là **thu hẹp**, không phải tăng. App tính thật: đáy 7.0 m thì đào đắp giảm **~7 %**, sâu dòng 0.54 m, vận tốc 1.54 m/s. Bấm vào gợi ý là áp dụng, ⌘Z hoàn tác được |
| Khối lượng đào đắp (số cố định) | Tính theo diện tích trung bình, mặt cắt mỗi 20 m. Đào = lăng trụ kênh nằm dưới mặt đất tự nhiên. Đắp = bờ tới đỉnh bờ + 0.30 m (đường quản lý), mặt bờ rộng 3 m. Kết quả 1,528.98 / 1,325.96 / 1,279.23… m³, cùng cỡ số với mockup |

## Chức năng thật

- **Thông số thiết kế sửa được:** độ dốc min/max, bề rộng đáy, mái dốc, loại gia cố, độ cao an toàn; ngoài ra lưu lượng thiết kế và hệ số nhám n nằm ở mục Thuỷ lực. Mỗi lần sửa, mặt cắt, khối lượng và các kiểm tra tính lại. Giá trị sai bị từ chối (ví dụ độ cao an toàn 0). ⌘Z hoàn tác được.
- **Chọn lý trình:** chọn trong cây duyệt, trong ô chọn lý trình, hoặc bấm lên trắc dọc; mặt cắt vẽ lại tại lý trình đó với mặt đất tự nhiên thật.
- **Bảng phía dưới:**
  - Khối lượng đào đắp, mặc định 6 dòng; "View all" hiện thêm đoạn 0+600–0+620.
  - Khối lượng kênh: diện tích gia cố, bê tông, đào.
  - Công trình: cống.
  - Vật liệu: bê tông gia cố 927.93 m³ (chu vi × chiều dài × 0.12 m), đào, đắp, đất thừa, cống.
- **Tab ở header:** Profile và Section mở hình vẽ lớn, Schedule mở bảng khối lượng; 3D báo "chưa kết nối".
- **Tab Lớp:** bật/tắt các lớp. **Tab Tham chiếu:** nguồn dữ liệu và tiêu chuẩn.
- **Xuất CSV:** khối lượng đào đắp, trắc dọc, diện tích mặt cắt theo lý trình.

## Ghi rõ là chưa có

- **Mặt bằng:** ảnh vệ tinh kèm nét tuyến cắt từ mockup, nhãn "DEMO imagery · survey / GIS not connected". Thanh điều hướng in sẵn trên ảnh đã được inpaint. Nhãn lý trình trong ảnh có lỗi của AI (hai chữ "0+100"); lỗi này nằm trong ảnh DEMO, không phải dữ liệu.
- Nút giao, chú thích, kích thước, 3D: báo "cần engine hạ tầng".
- Trợ lý AI Civil chỉ gồm các kiểm tra theo quy tắc, có ghi rõ "AI cục bộ chưa kết nối".

## Tương tác đã kiểm tra (`ui/tools/smoke-civil.mjs` — 12/12 đạt)

- Màn mở giống mockup.
- Độ sâu dòng tính ra 0.50 m.
- Kiểm tra độ dốc tìm đúng hai đoạn.
- Khối lượng: chênh = đào − đắp.
- Đổi đáy 7 m: đỉnh thành 11.20 m; độ cao an toàn 0 bị chặn; ⌘Z khôi phục.
- Áp dụng gợi ý tối ưu rồi hoàn tác.
- Tăng lưu lượng Q thì độ sâu dòng tăng.
- Chọn STA 0+500 trong cây thì mặt cắt đổi lý trình.
- Tab Profile và Schedule.
- Bê tông gia cố 927.93 m³.
- Xuất CSV.
- Bản VI dịch đủ.
- Không có lỗi console.
