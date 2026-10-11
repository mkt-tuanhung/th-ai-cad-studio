# QA — Màn 08: MEP (Pixel-Lock v2)

- **Ngày:** 2026-10-11.
- **Chuẩn so sánh:** `../TH_AI_CAD_Studio_UI_LOCK_v2/mockups/08_MEP.png` (1586 × 992).

## Ảnh

Mọi ảnh nằm trong `qa/v2/08_mep/`.

| | Tệp |
|---|---|
| Mockup và app đặt cạnh nhau | `side_by_side.png`, `mockup.png` |
| Overlay, anaglyph, difference | `overlay_50_50.png`, `overlay_anaglyph.png`, `difference_amplified.png` (MAE 14.02) |
| EN / VI | `app_en.png`, `app_vi.png` |
| Kích thước khác | `app_en_1440x900.png`, `app_en_1920x1080.png` |

## Đo bbox 73 phần tử (`ui/tools/regions_mep.json` → `inkbox.txt`)

| Lệch tối đa | Số phần tử |
|---|---|
| 0 px | 12 |
| 1 px | 28 |
| 2 px | 16 |
| 3–5 px | 13 |
| 6–8 px | 4 |

**57/73 phần tử ≤ 2 px; 70/73 ≤ 5 px** (đo lại sau khi sửa bộ chọn CSS dùng chung).

4 phần tử lệch 6–8 px:
- `pb.hvac`: chấm màu hệ thống nằm cạnh chữ.
- `pill.duct`: vùng đo lẫn nền nút đang chọn.
- `rp.name`: khối tên và mô tả trong thẻ phần tử dàn dòng khác mockup.
- `ai.title`: nội dung thẻ gợi ý là số liệu thật, dài ngắn khác mockup.

## Nội dung mockup đã sửa cho đúng (giữ bố cục)

| Mockup | App (tính thật) |
|---|---|
| SA-01 600 × 400, 1200 L/s: "Velocity 6.5 m/s" | **5.00 m/s** (Q / A = 1.2 / 0.24) |
| "Pressure Drop 45.0 Pa/m" (phi thực tế với ống gió) | **0.57 Pa/m**. Tính bằng Darcy–Weisbach với hệ số ma sát Haaland, đường kính tương đương 533 mm (Huebscher), tôn mạ kẽm ε = 0.15 mm |
| "Clash Detection (8)" | Số va chạm tính bằng phép giao hộp bao 3D giữa ống gió (gồm cả bảo ôn), ống nước và dầm 300 × 600. Mẫu hiện có **5** va chạm |
| "Equipment (18)" | **32**: tổng số thiết bị trong cây (AHU 4 + FCU 12 + Bơm 6 + Chiller 2 + Tủ điện 8). Con số 18 trong mockup mâu thuẫn với chính cây của nó |
| Nhãn ribbon "O" (lỗi do AI vẽ) | "Visibility" |
| AI Recommendations (văn bản cố định) | Danh sách vấn đề tính thật (va chạm, kiểm tra thiết kế). Nút "Apply Suggestion" hạ ống gió đang va chạm xuống dưới đáy dầm. Có ghi rõ: kiểm tra theo quy tắc, AI cục bộ chưa nối với MEP |

## Chức năng thật

- **Mô hình mẫu:** 48 ống gió, 32 ống nước, 56 mạch điện, 32 thiết bị, dầm ở 3 tầng.
- **Bảng thống kê ống gió, ống nước, điện, thiết bị:**
  - mặc định chỉ hiện tầng đang chọn (Level 2, như mockup); "View all" hiện tất cả;
  - con số trên nút lọc là tổng toàn công trình;
  - cột trạng thái là kết quả kiểm tra thật: Đạt / Kiểm tra / Va chạm.
- **Kiểm tra thiết kế:**
  - vận tốc ống gió ≤ 8 m/s, tổn thất ≤ 1.5 Pa/m;
  - vận tốc ống nước ≤ 2.5 m/s;
  - mạch điện: dòng điện không vượt khả năng tải của cáp, sụt áp ≤ 3 % theo ΔU = k·I·L·(R cosφ + X sinφ).
- **Sửa tự động** (đều qua kiểm tra hợp lệ và hoàn tác được bằng ⌘Z):
  - hạ ống gió xuống dưới dầm;
  - tăng tiết diện cáp cho tới khi sụt áp ≤ 3 %.
- **Panel Thuộc tính:**
  - sửa rộng, cao, dài, lưu lượng, cao độ;
  - vận tốc, tổn thất và đường kính tương đương tính lại ngay;
  - giá trị sai bị từ chối (ví dụ rộng 50 mm).
- **System Data:** tổng lưu lượng gió cấp, chiều dài ống gió và ống nước, lưu lượng nước lạnh, phụ tải điện, phân theo tầng.
- **Coordination Status:** mỗi hệ thống có số đối tượng, tổng khối lượng, số va chạm và số lỗi thiết kế.
- **Chọn bộ môn ở header** (HVAC / Plumbing / Electrical / Coordination): đổi bảng và khung nhìn tương ứng. Chọn tầng ở khung nhìn thì bảng lọc theo tầng.
- **Xuất CSV:** ống gió (kèm vận tốc và ma sát), ống nước, điện (kèm dòng điện và sụt áp), báo cáo va chạm.

## Ghi rõ là chưa có (không giả lập)

- **Khung nhìn 3D:** ảnh DEMO cắt từ mockup. Các phần giao diện in sẵn trên ảnh đã được inpaint. Ảnh có nhãn "DEMO render · MEP engine not connected".
- Các công cụ vẽ (Duct, Pipe, Cable Tray, Fitting…), xoay và thu phóng khung nhìn: báo "cần engine MEP (chưa kết nối)".

## Tương tác đã kiểm tra (`ui/tools/smoke-mep.mjs` — 11/11 đạt)

- Màn mở giống mockup.
- SA-01 hiện vận tốc 5.00 m/s và tổn thất 0.57 Pa/m.
- Thu hẹp SA-01: chặn 50 mm; nhận 300 mm thì vận tốc thành 10.00 m/s và trạng thái thành "Check"; ⌘Z khôi phục.
- Hạ ống gió để hết va chạm, ⌘Z đưa va chạm trở lại.
- Bảng ống nước lọc theo tầng; "View all" hiện đủ 32.
- Sửa cáp theo sụt áp.
- Coordination Status và System Data.
- Nút "Apply Suggestion".
- Xuất CSV báo cáo va chạm.
- Tab Plumbing mở bảng ống nước; chọn Level 1 thì bảng lọc đúng.
- Bản VI dịch đủ.
- Không có lỗi console.
