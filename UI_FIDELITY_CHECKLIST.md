# UI Fidelity Checklist — 12 màn (Pixel-Lock v2)

- **Nguồn chuẩn:** `../TH_AI_CAD_Studio_UI_LOCK_v2/mockups/*.png` (1586 × 992).
- **Chụp app:** `ui/tools/capture.mjs` (Chromium, 1586 × 992 @1x, dữ liệu mẫu, EN).
- **So sánh:** `../TH_AI_CAD_Studio_UI_LOCK_v2/qa/compare_screens.py` → `qa/v2/<màn>/` (overlay, difference, MAE). Kèm đo bbox
  từng phần tử (`ui/tools/inkbox.py`), vì MAE bị nội dung ảnh minh hoạ chi phối.

Mockup 01–04 của bộ v2 **trùng từng pixel** (MAE 0.00) với bộ đã duyệt trước (`mockups_full/`), nên
kết quả đo của 4 màn này vẫn còn giá trị.

## AppShell (dùng chung cho cả 12 màn)

| Mục | Trạng thái |
|---|---|
| Sidebar: logo, 12 mục theo đúng thứ tự, mục đang chọn, promo card | ✅ Đã sửa 2026-10-11: icon 24 → 28 px, chỉnh vị trí từng dòng theo số đo. Icon lệch ≤ 2 px, chữ ≤ 3 px, dòng đang chọn ≤ 4 px trên mockup 01 và 05–12 |
| Top bar: tìm kiếm ⌘K, chế độ sáng, VI/EN, thông báo, profile | ✅ Như màn 01 (đã đo) |
| Khung cửa sổ macOS, nút đèn giao thông | ✅ |
| Breadcrumb + tab nhóm + nút Share / Export / AI Assistant (màn 08–12) | ⏳ Chưa có — làm thành component dùng chung khi dựng màn 08 |

## Từng màn

| # | Màn | Trạng thái | Việc còn thiếu (so với mockup) |
|---|---|---|---|
| 01 | Dashboard | ✅ 49/51 phần tử ≤ 2 px (đo lại sau khi sửa shell); overlay `qa/v2/01_dashboard/` | — |
| 02 | CAD 2D | ✅ 47/53 ≤ 3 px | — |
| 03 | AI Intelligence | ✅ 54/55 ≤ 5 px | — |
| 04 | Architecture / BIM | ✅ 45/54 ≤ 5 px | — |
| 05 | Projects | ✅ Đã duyệt 2026-10-11: 57/62 phần tử ≤ 2 px, smoke test 18/18 — `qa/QA_PROJECTS.md` | Chờ ảnh sạch (DEMO); cần chọn trạng thái yêu thích của Pump |
| 06 | Settings | ✅ Đã dựng (chờ duyệt): 45/58 phần tử ≤ 2 px, smoke test 16/16, số liệu thật trong app desktop — `qa/QA_SETTINGS.md` | — |
| 07 | Components | ⏳ | Toàn bộ màn: 7 thẻ nhóm, cây danh mục, lưới linh kiện, Preview 2D/3D, tham số, tuỳ chọn chèn, Recently Used |
| 08 | MEP | ⏳ | Breadcrumb, tab chuyên ngành, ribbon, Project Browser, viewport 3D, bảng schedule, Properties, AI Recommendations |
| 09 | Interior | ⏳ | Như MEP, thêm mặt bằng thu nhỏ, AI Interior Designer, bảng Furniture/Cut List, Room Information |
| 10 | Civil | ⏳ | Mặt bằng tuyến, trắc dọc, trắc ngang, khối lượng đào đắp, Design Parameters, AI Civil Assistant |
| 11 | Mechanical | ⏳ | Model Browser, viewport cụm lắp, Parameters, BOM, Mates, AI Design Checks |
| 12 | Renders | ⏳ | Scene & Cameras, Asset Library, viewport render, Variations, Render Queue, Render Settings |

## Nội dung mockup sai chuyên môn — giữ bố cục, sửa nội dung (cần chủ đầu tư duyệt)

| Màn | Trong mockup | Trong app |
|---|---|---|
| 05, 06 | AI Model "AutoCAD Assistant (Local)" | Tên model thật đang chạy (ví dụ "Qwen2.5-7B-Instruct (Local)"). "AutoCAD" là thương hiệu của Autodesk |
| 06 | "Model Ready", "VRAM 6.2 / 16 GB (39%)" | Số liệu đọc từ runtime llama.cpp. Trên trình duyệt (không có host) ghi "Demo UI / Not connected" |
| 06 | "Hardware Acceleration: Enabled", "Offline Mode: Available" | Lấy từ trạng thái thật (Metal backend, ứng dụng không gọi mạng) |
| 06 | Default file format "DWG (AutoCAD 2021)" | Ứng dụng chưa ghi được DWG; mặc định là DXF, còn DWG ghi rõ "chưa hỗ trợ ghi" |
| 10 | "TCVN 11823:2017" cho kênh tưới | TCVN 11823:2017 là tiêu chuẩn thiết kế cầu đường bộ. Với kênh thuỷ lợi cần đối chiếu TCVN 4118:2021 (hệ thống tưới tiêu — yêu cầu thiết kế); chờ chủ đầu tư chọn |
| 10 | Bảng đào đắp: dòng 0+100–0+200 ghi Cut 980.40, Fill 85.20, Net 895.20 | Các ô Net đều khớp Cut − Fill. App tính lại từ dữ liệu, không chép số trong ảnh |
| 11 | "Meets ISO 5199" | Đây là tiêu chuẩn có thật cho bơm ly tâm. App chỉ hiện kết quả khi có engine kiểm tra; trước đó ghi "Not connected" |
