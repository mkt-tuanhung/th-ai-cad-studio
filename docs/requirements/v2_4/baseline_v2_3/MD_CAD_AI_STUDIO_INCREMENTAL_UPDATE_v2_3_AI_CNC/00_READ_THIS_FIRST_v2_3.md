# MD CAD AI STUDIO v2.3 — UPDATE IN PLACE / AI → CAD → 3D → CNC

**Không phải source code phần mềm**. Đây là gói CHANGE REQUEST bổ sung **trên chính repository của Claude**, kế thừa v2.2; source của Claude chưa được kiểm tra trong phiên ChatGPT này. KHÔNG tuyên bố tính năng đã code xong nếu chưa có executable/test thực tế.

## Định hướng được CHỐT
- Local AI offline 100%, ưu tiên Apple Silicon, VI / EN; không phụ thuộc cloud API. Giữ branding **MD CAD AI STUDIO**, 12 màn UI đã khóa.
- Kỹ sư giao một nhiệm vụ; hệ thống tự xử lý phần lớn các bước có thể chuẩn hóa: đọc ảnh/PDF/DXF → CAD 2D editable → kiến trúc/nội thất 3D parametric → BOQ/BOM → bản vẽ → CNC. Người dùng giám sát/duyệt.
- **Ưu tiên P0 cao nhất: sản xuất nội thất thật** với cut list, vân, dán chỉ, khoan/đánh dấu, nesting theo máy và CAM **machine-aware**.
- Vẽ/dựng thủ công vẫn là dự phòng bắt buộc. Mục tiêu AutoCAD/SketchUp/3ds Max tương thích đầy đủ phải kiểm kê/theo dõi theo phiên bản tham chiếu; KHÔNG giả nhận 100%.
- Civil/Thủy lợi làm sau, Mechanical nâng cao sau; không xóa module cũ.

## Sự khác nhau giữa output
1. **Bản vẽ ảnh** (raster/reference): không phải CAD chỉnh sửa.
2. **CAD vector** (DXF/DWG): phải có LINE/ARC/POLYLINE/TEXT/DIM/BLOCK, layer, mm, scale, snap, graph topology; không phải JPG được nhúng trong DXF.
3. **3D model**: tường/sàn/cửa hoặc part/tủ tham số có GUID liên kết 2D và cấu tạo; không phải ảnh render.
4. **Manufacturing CAD**: part-level geometry L,W,T, vân, mặt, khoan/khía, dán chỉ, phụ kiện, dung sai, mã, revision.
5. **CAM**: quỹ đạo dao deterministic + postprocessor theo máy; file NC chưa là chứng cứ máy đã cắt đúng.
6. **Physical CNC cutting**: operator xác nhận setup, an toàn máy, air cut/cắt mẫu và đo QC; AI không tự kích hoạt/stream xuống CNC.

## Dùng tài liệu theo thứ tự
1. `00_READ_THIS_FIRST_v2_3.md`.
2. `docs/11_CLAUDE_AUTONOMOUS_PRODUCTION_UPDATE_ONLY_PROMPT.md` — paste cho Claude.
3. `docs/10_END_TO_END_AI_TO_CNC_P0.md` — chuẩn sản xuất, state machine, gates.
4. `docs/12_IMAGE_PDF_TO_EDITABLE_CAD.md` — ảnh/PDF → CAD.
5. `docs/13_CAD2D_TO_PARAMETRIC_3D.md` — CAD → 3D.
6. `docs/14_FREE_LOCAL_INTEGRATIONS.md` — thư viện ưu tiên miễn phí và licenses.
7. `docs/15_P0_ROADMAP_AND_EVIDENCE.md` — roadmap incremental + nghiệm thu.
8. Giữ tất cả docs/schemas/examples/82 bài QA v2.2, đặc biệt `docs/06_CNC_MACHINE_AWARE_MANUFACTURING_MASTER_SPEC.md` và `docs/09_MACHINE_COMMISSIONING_AND_QC.md`.
9. `qa/AI_TO_CAD_TO_CNC_ACCEPTANCE_v2_3.csv` và `qa/IMPLEMENTATION_DELTA_AUDIT_v2_3.csv`.

## Không thể thực hiện khi thiếu xác minh
- Ảnh phối cảnh một góc không thể định ra kích thước xưởng chính xác nếu không có mốc/scan đo đạc.
- Thiếu đường kính dao đo, bù đầu, controller, fixture và post xác minh → KHÓA PRODUCTION EXPORT.
- Phần mềm local AI không bảo đảm tự hoàn thiện mọi dự án, cần chỉ báo confidence/uncertainty.
- Không được cho rằng thư viện CAD/CAM miễn phí đồng nghĩa không có nghĩa vụ cấp phép (GPL/LGPL/third-party).
