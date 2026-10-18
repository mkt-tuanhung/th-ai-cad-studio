# v2.1 INCREMENTAL UPDATE — ĐỌC FILE NÀY TRƯỚC

**KHÔNG REBUILD**. Claude đã triển khai phiên bản hiện tại gần hoàn thiện. Toàn bộ tài liệu là yêu cầu **nâng cấp trong repo cũ**, không tạo mới. Mở **`00_UPDATE_ONLY_READ_FIRST.md`** trước tất cả những file còn lại.

# MD CAD AI STUDIO — PRODUCT STRATEGY LOCK v2.0

**Trạng thái:** Định hướng sản phẩm đã được chủ dự án CHỐT. Tài liệu này là cập nhật chiến lược và chuẩn nghiệm thu mới, **không chứng minh** sản phẩm đã có các tính năng mô tả.

**Đọc theo thứ tự:**
1. `docs/01_PRODUCT_VISION_AND_PRIORITY_LOCK.md`
2. `docs/02_MANUAL_PARITY_MASTER_REQUIREMENTS.md`
3. `docs/03_AUTONOMOUS_DESIGN_FACTORY_ARCHITECTURE.md`
4. `docs/04_CLAUDE_NEW_MANDATE.md` (prompt giao việc trực tiếp)
5. `qa/FEATURE_COMPATIBILITY_SEED.csv` và `qa/AUTONOMY_ACCEPTANCE_SEED.csv`

**Đi cùng các gói hiện có trong dự án:**
- `TH_AI_CAD_Studio_UI_PIXEL_LOCK_12_SCREENS_v2.zip` — 12 mockup khóa bố cục. Chỉ thay thương hiệu TH thành **MD CAD AI STUDIO**, không thiết kế lại.
- `TH_AI_CAD_Studio_Approval_Package_v1_2_AI_Local_Bilingual.zip` — CAD/AI offline, alias, VI/EN.
- `TH_AI_CAD_Studio_Interior_CNC_Upgrade_v1_3.zip` — bóc tách nội thất/CAM/CNC an toàn.
- Bộ branding logo/icon/intro **MD** đã được duyệt, dòng credit: **“Xây dựng và phát triển bởi Minh Dũng”**.

**Bất biến:** AI offline trên Mac Apple Silicon, không cloud API bắt buộc; giao diện chốt; song ngữ Việt–Anh; các thao tác hình học do engine deterministic thực hiện, AI chỉ lập kế hoạch qua typed tools; phê duyệt kỹ thuật và CNC trước khi xuất chương trình chạy máy.

**Điểm mới:** Nội thất và xây dựng là P0. Thủy lợi/Civil để sau. AI làm thay phần lớn việc tay là mục tiêu trung tâm, không phải chatbot trang trí. Chế độ thủ công tương thích các luồng AutoCAD/SketchUp/3ds Max là bắt buộc, có bộ test chi tiết và không được khai man mức độ tương thích.


## UPDATE v2.2 CNC Machine-Aware (P0)
ĐỌC `docs/08_CLAUDE_CNC_UPDATE_ONLY_MANDATE.md` để bổ sung **chọn máy 1/2/3 đầu / controller / tools / post** vào chính source hiện tại. Thêm file `docs/06_*`, `docs/07_*`, `docs/09_*`; schema machine/job, ví dụ DRAFT, bảng QA và GUI demo trong `ui/`. Không có máy thật được xác minh: **production G-code luôn khóa**.
