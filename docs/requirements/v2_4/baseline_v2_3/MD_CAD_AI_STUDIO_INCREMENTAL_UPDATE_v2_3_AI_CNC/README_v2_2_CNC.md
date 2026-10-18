# MD CAD AI STUDIO v2.2 — UPDATE TRÊN DỰ ÁN CŨ (KHÔNG REBUILD)

Đây là bản v2.1 UPDATE ONLY **được bổ sung CNC Machine-Aware Manufacturing v2.2**. Vẫn giữ toàn bộ chiến lược AI Autopilot, mục tiêu tương thích công cụ thủ công, ưu tiên Nội thất/Xây dựng, local AI 100%, song ngữ và UI Pixel-Lock MD.

## Bắt đầu giao Claude
1. Đọc `00_UPDATE_ONLY_READ_FIRST.md` (ưu tiên cao nhất).
2. Đọc `docs/08_CLAUDE_CNC_UPDATE_ONLY_MANDATE.md` (prompt CNC bổ sung).
3. Đọc `docs/06_CNC_MACHINE_AWARE_MANUFACTURING_MASTER_SPEC.md` (đặc tả sản xuất).
4. Đọc `docs/07_MACHINE_SELECTION_UX_AND_ARCHITECTURE_DELTA.md` (chọn máy, UI, hooks, migrations).
5. Đọc `docs/09_MACHINE_COMMISSIONING_AND_QC.md` (nghiệm thu trên máy).
6. Audit repo đang chạy, điền `qa/CNC_UPDATE_GAP_AUDIT_TEMPLATE.csv` và chạy `qa/CNC_MULTI_MACHINE_ACCEPTANCE_TESTS.csv`.
7. Dùng schemas JSON và profile 1/2/3 head `examples/` làm bộ dữ liệu **DRAFT CHỈ THAM KHẢO**.
8. Mở `ui/MD_CAD_CNC_MACHINE_SELECTOR_DEMO.html` để tham khảo giao diện. Mở bằng trình duyệt; bản HTML **chỉ minh họa UX**, không chạy CAM, không sinh G-code. Có ảnh tham khảo `ui/MD_CAD_CNC_MACHINE_SELECTOR_PREVIEW.png`.

## Những gì cần chọn trong chương trình
- 1 spindle router, 2 spindles router, 3 spindles router, ATC, head saw, drill bank/hybrid (đầu máy **khác** số dao). Cấu hình tùy theo **machine profile thực tế**, không suy diễn.
- Đúng controller + firmware + postprocessor + tool/head offsets + hành trình + vùng kẹp/vacuum + safe Z + stock zero.
- Bóc tách chuẩn và machining plan theo máy, operator sign-off, kiểm chuẩn air-cut/first article trước khi được xuất NC production.

## Kiểm thử mô tả / không dùng máy thật
```bash
python qa/test_cnc_reference_gate.py
python qa/reference_release_gate.py examples/machine_3_router_heads_UNVERIFIED.json
```

**TẤT CẢ profile ví dụ là chưa được xác minh. Không có khả năng phát hành G-code production từ package này. Chỉ Claude, sau khi audit và lập trình engine đúng, cộng với kỹ sư/xưởng test trên máy thực tế mới có thể tiến tới chế độ này.**
