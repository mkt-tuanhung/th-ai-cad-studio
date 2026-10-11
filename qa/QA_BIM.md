# QA — Màn 4: Architecture / BIM Workspace

Ngày: 2026-10-10 · Chuẩn so sánh: `mockups_full/04_architecture_bim_workspace.png` (1586×992, 1x)

## Kết quả

| Kiểm tra | Kết quả |
|---|---|
| Ảnh thực tế / đặt cạnh nhau | `bim_en.png` · `bim_side_by_side.png` |
| Chồng lớp pixel | `bim_overlay_anaglyph.png` |
| Đo bbox mực in 54 phần tử (`bim_inkbox_report.txt`) | Vị trí lệch ≤3px: 37/54 · ≤5px: 45/54 · kích thước lệch ≤5px: 40/54 |
| Lệch lớn nhất (9–13px) | Nhãn nút Share/AI Assistant ở thanh trên, nút chế độ "Realistic", "More Tools", "View Details" — phần lớn do vùng đo gộp icon/nền nút; đã kiểm bằng mắt |
| Tiếng Việt | `bim_vi.png` |
| Thích ứng | `bim_en_1280x800.png` (nút Share/Export chỉ còn icon, ribbon cuộn ngang, thanh điều khiển viewer bám cạnh dưới/phải), `bim_en_1440x900.png`, `bim_en_1920x1080.png` |
| Tương tác (`node tools/smoke-bim.mjs`) | **16/16 PASS** (2 lần), không lỗi console |
| Hồi quy | Dashboard 14/14, CAD 2D 19/19, AI Studio 14/14 |

**Không tuyên bố giống 100%.**

## Những gì chạy thật (mô hình BIM prototype `ui/src/bim/model.ts`)

- 24 tường, 12 cửa đi, 18 cửa sổ, 8 phòng, 4 cao độ. **Diện tích và thể tích được tính** từ chiều dài ×
  chiều cao (cao độ đỉnh − cao độ chân + lệch) × chiều dày — khớp đúng số trong mockup (W1 12.75 m² /
  2.55 m³ … W5 11.70 / 2.34).
- **Model Coordination** chạy bộ kiểm tra xác định trên dữ liệu: va chạm (cửa vượt quá tường chủ, hai lỗ
  mở chồng nhau), tiêu chuẩn (cửa sổ thiếu Mark), sức khỏe (đỉnh tường không cao hơn chân), phòng, tham
  số → ra đúng 0 / 3 / 5 / 0 / 0 như mockup; "Check Model" chạy lại sau mỗi chỉnh sửa. Click một dòng chọn
  đối tượng lỗi đầu tiên.
- **Properties** sửa được Type Mark và Top Level (biểu tượng bút chì như mockup), có kiểm tra hợp lệ (từ
  chối nếu đỉnh ≤ chân) và hoàn tác/làm lại ⌘Z / ⌘⇧Z. Chọn dòng trong bảng thống kê → hiện thuộc tính
  tường / cửa / cửa sổ / phòng / cao độ.
- **AI Recommendations**: gợi ý là mẫu (ghi rõ), nhưng "Apply Suggestion" thực hiện thay đổi thật có xác
  nhận: đổi W1 sang loại tường cách nhiệt 250 mm → thể tích 3.19 m³; hoàn tác được.
- Bảng thống kê 5 nhóm, chọn hàng/chọn tất cả, tab Schedule xem toàn bảng, **xuất CSV** khối lượng tường.
- Project Browser: mở/thu nhánh, tìm kiếm, thu gọn; Level 1–3/Roof mở tab Plan đúng tầng; lịch thống kê
  mở tab Schedule đúng nhóm.
- Tab **Plan** hiển thị bản vẽ Level 1 thật của dự án (cùng tài liệu với CAD 2D), kéo/thu phóng được.
- Chế độ hiển thị Realistic / Shaded / Wireframe / Hidden Line, tầng, tỉ lệ, phóng to khung nhìn.
- Bình luận theo đối tượng (lưu cục bộ), tab AI Assistant báo rõ runtime chưa kết nối.

## Không giả lập (báo rõ)

- Khung 3D là **ảnh render đã duyệt** (`bim_main_3d_model.png`), không phải mô hình 3D: xoay/zoom/hộp
  cắt/view cube và các công cụ tạo đối tượng (Wall, Door, …), mặt đứng, mặt cắt, bản vẽ A1, xuất IFC →
  "cần BIM engine native".
- Wireframe / Hidden Line là **bộ lọc ảnh** (phát hiện cạnh / phân ngưỡng) trên render — chỉ mang tính
  minh hoạ cho tới khi có trình xem OCCT.

## Khác biệt đã biết

1. **Asset render bị cắt ở x = 1144** nhưng khung xem trong mockup rộng tới 1243 → phần bên phải
   (cây, khối nhà nền) không có trong asset; được thay bằng nền chuyển sắc. Đây là khác biệt dễ thấy nhất.
2. Render chứa sẵn (baked) thanh công cụ, menu, bản mặt bằng nhỏ và nút chế độ; các thành phần thật được
   đặt chồng chính xác lên các vùng đó. Vì vậy ảnh 3D không pan/zoom được trong trình duyệt.
3. Mockup 04 tô sáng mục "CAD Tools" trên sidebar; chủ đầu tư đã quyết định (2026-10-10) tô sáng **"BIM"** cho màn này.
4. Thông số 19 tường, 12 cửa, 18 cửa sổ, 8 phòng ngoài các dòng hiện trong mockup là dữ liệu mẫu do tôi
   đặt ra cho khớp các con số tổng (24/12/18/8/4) và kết quả kiểm tra.
5. Bảng thống kê hiện thêm một phần dòng W6 ở cuối (mockup có khoảng trắng sau W5).
6. Mũi tên trong Project Browser, view cube và icon công cụ là bản vẽ lại bằng SVG/Lucide gần nhất.
