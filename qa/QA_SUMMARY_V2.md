# Pixel-Lock v2 — tổng kết 12 màn (2026-10-12)

Mọi số đo đều ở 1586 × 992, so với `TH_AI_CAD_Studio_UI_LOCK_v2/mockups/*.png` bằng `ui/tools/inkbox.py`: hộp bao quanh phần nét vẽ (ink bbox) của từng phần tử, lấy độ lệch vị trí lớn nhất. Không màn nào được tuyên bố giống 100 %.

| # | Màn | ≤ 2 px | ≤ 5 px | Smoke test | Báo cáo |
|---|---|---|---|---|---|
| 01 | Dashboard | 50/54 | — | 14/14 | `QA_DASHBOARD.md` |
| 02 | CAD 2D | 47/53 | 53/53 | 21/21 | `QA_CAD2D.md` |
| 03 | AI Intelligence | 46/55 | 55/55 | 14/14 | `QA_AI_STUDIO.md` |
| 04 | Architecture / BIM | 37/54 | 50/54 | 16/16 | `QA_BIM.md` |
| 05 | Projects | 57/62 | — | 18/18 | `QA_PROJECTS.md` |
| 06 | Settings | 45/58 | — | 16/16 | `QA_SETTINGS.md` |
| 07 | Components | 56/66 | 62/66 | 17/17 | `QA_COMPONENTS.md` |
| 08 | MEP | 57/73 | 70/73 | 11/11 | `QA_MEP.md` |
| 09 | Interior | 51/65 | 64/65 | 12/12 | `QA_INTERIOR.md` |
| 10 | Civil | 34/66 | 66/66 | 12/12 | `QA_CIVIL.md` |
| 11 | Mechanical | 47/73 | 69/73 | 12/12 | `QA_MECHANICAL.md` |
| 12 | Renders | 27/59 | 53/59 | 11/11 | `QA_RENDERS.md` |

**Smoke test tổng cộng: 174/174 đạt, không có lỗi console.**

App desktop macOS (`native/dist`, DMG 131 MB) có tự kiểm tra trong app (bridge, engine, BIM, OCCT, AI cục bộ): **SELFTEST DONE OK**.

## Nguyên tắc trung thực áp dụng trên mọi màn

- **Khung nhìn 3D / ảnh render của các màn 08–12:** là ảnh DEMO cắt từ mockup. Các phần giao diện in sẵn trên ảnh đã được inpaint. Mỗi ảnh có nhãn ghi rõ engine nào chưa kết nối.
- **Số liệu kỹ thuật được tính thật từ dữ liệu, không lấy theo mockup:**
  - MEP: vận tốc, tổn thất áp, va chạm, sụt áp;
  - Civil: dòng đều Manning, đào đắp, độ dốc;
  - Mechanical: ứng suất xoắn, khe hở, khối lượng;
  - Interior: bảng cắt ván, diện tích phòng;
  - Renders: dung lượng tệp, kích thước in.

  Chỗ nào mockup sai hoặc mâu thuẫn đều được ghi trong mục "Nội dung mockup đã sửa" của từng báo cáo.
- **Trạng thái AI và runtime:** bản xem trên trình duyệt ghi "Demo UI / Not connected" (Dashboard, AI Studio). Hàng đợi render không bao giờ hiện tiến độ giả.
- **Các "AI Suggestions / Design Checks":** là kiểm tra theo quy tắc, có ghi rõ "AI cục bộ chưa kết nối". Mọi thao tác áp dụng đều qua kiểm tra hợp lệ và hoàn tác được bằng ⌘Z.

## Bộ khung dùng chung mới

- `ui/src/components/workspace/` (header, ribbon, cây duyệt, khung nhìn, bảng, panel thuộc tính) và `ui/src/state/undoable.ts`.
- Dùng cho Interior, MEP, Civil, Mechanical và Renders.
