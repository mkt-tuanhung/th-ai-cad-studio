# CHARTER CHÍNH THỨC — MD CAD AI STUDIO v2.0

## I. Tuyên ngôn sản phẩm — KHÓA

> **MD CAD AI STUDIO không chỉ là phần mềm giúp kỹ sư vẽ nhanh hơn. Mục tiêu là để kỹ sư nội thất và xây dựng gần như không phải tự tay thực hiện phần lớn công việc vẽ 2D, dựng 3D, bóc tách và lập hồ sơ.** Người dùng giao nhiệm vụ một lần, hệ thống tự triển khai bằng công cụ CAD/BIM/CAM thực và trả bộ hồ sơ để kỹ sư kiểm tra, sửa và phê duyệt.

> **Đồng thời phải duy trì môi trường thủ công đầy đủ**, lấy thao tác AutoCAD cho CAD 2D, SketchUp cho dựng hình nhanh, và 3ds Max cho dựng hình polygon / 3D chuyên sâu làm chuẩn tương thích đã chọn; gồm câu lệnh, phím tắt, quy trình chọn đối tượng, mặt nhìn, vật liệu và thao tác chuột.

**Định nghĩa yêu cầu "100%":** Đây là mục tiêu nghiệm thu của chủ dự án đối với **phiên bản chuẩn tham chiếu được chốt và danh mục tính năng/shortcut đóng băng**; không phải lời tuyên bố khả năng đã có hoặc bảo đảm có thể thay thế toàn bộ ba sản phẩm ngay. Không được tự xóa hạng mục khó khỏi danh mục để tăng % hoàn thành. Ngoại lệ kỹ thuật/OS/license phải báo và xin chủ dự án quyết định — không tự đánh dấu đạt.

## II. Ưu tiên sản phẩm

- **P0 — Autonomous Interior**: nhập số đo hiện trường (đánh dấu thiếu/sai số) → đồ nội thất/tủ tham số → bản vẽ thi công 2D → dựng 3D → cut list/BOM/dán cạnh/khoan → nesting → CAM 2.5D → mô phỏng và gói file CNC theo máy đã xác minh → kỹ sư kiểm tra.
- **P0 — Autonomous Architecture & Construction**: CAD 2D chính xác, tường/sàn/cột/dầm/cửa, BIM parametric, hồ sơ mặt bằng/mặt đứng/mặt cắt/chi tiết, quantity takeoff, clash cơ bản, hồ sơ PDF/DXF/DWG qua adapter tương thích đã được kiểm thử.
- **P0 — Full Manual Editing Fallback**: lập bản vẽ độc lập AI, đủ thao tác cho ngành nội thất/xây dựng, chế độ compat bàn phím và viewport tương ứng. Không được làm AI trước rồi bỏ qua khả năng sửa bằng tay.
- **P0 — Local AI Project Orchestrator**: nhận một yêu cầu, tự lập plan, phân luồng công cụ, chạy tác vụ dài có pause/resume, tự kiểm tra các lỗi thường gặp, xuất báo cáo kết quả/chưa đạt; nhiệm vụ nhạy cảm chờ duyệt.
- **P1 — MEP**: kiến trúc & BIM ổn định rồi mở rộng HVAC/plumbing/electrical/coordination.
- **P1 — Advanced 3D**: polygon mesh, modifier stack, UV/material, scene/camera, animation thiết yếu và các tool workflow giống SketchUp/3ds Max. Được phát triển song song có kiểm soát nếu không làm trễ P0.
- **P2 — Mechanical advanced**: part/assembly/constraints/drawings; rendering chuyên sâu sau khi có model thật.
- **DEFERRED — Civil/Thủy lợi**: kênh, trắc dọc/trắc ngang, địa hình, earthwork để backlog giai đoạn sau. **Không xóa mockup Civil đã duyệt** nhưng dừng ưu tiên lập trình.

Projects, Settings, Components, undo/redo, history, data storage, VI/EN, local AI models và file interchange là nền tảng chung cần xây sớm.

## III. Trải nghiệm chuẩn

**Mẫu đầu vào nội thất:** "Từ file đo hiện trường và kích thước đã kiểm tra, thiết kế tủ bếp chữ L theo vật liệu đã chọn; làm bản vẽ chi tiết, dựng 3D, xuất cut list, nesting và CAM thử. Dừng chờ tôi duyệt trước khi phát hành NC production."

**Mẫu đầu vào xây dựng:** "Dựa trên lô đất và brief 3 tầng, đề xuất 3 sơ đồ công năng đúng giới hạn kích thước; dựng BIM, tạo mặt bằng/mặt đứng/mặt cắt, kiểm tra giao cắt, thống kê và xuất bộ hồ sơ nháp để kỹ sư rà soát."

Kỹ sư có thể rời máy để AI chạy, nhưng hệ thống phải thông báo khi đầu vào thiếu, các ràng buộc mâu thuẫn, hoặc phải duyệt giải pháp quan trọng. Không được bịa tọa độ, tiêu chuẩn, kích thước, quy chuẩn hay kết quả kiểm định.

## IV. Chính sách sản phẩm không đổi

- Tên chính thức: **MD CAD AI STUDIO**, monogram **MD**.
- Logo/intro app và installer có credit bắt buộc: **Xây dựng và phát triển bởi Minh Dũng**.
- Apple Silicon macOS ưu tiên; thiết kế hỗ trợ Windows sau.
- AI local/offline, model thông qua llama.cpp/MLX khi tương thích tài nguyên máy; không yêu cầu token API cloud. Không dùng LLM sinh G-code production trực tiếp.
- VI + EN toàn giao diện (UI/help/log), thuật ngữ/ký pháp kỹ thuật và tên lệnh giữ tương thích.
- Giao diện pixel-lock chỉ là contract thiết kế UI; muốn gọi chức năng hoàn thành phải có chạy thực, test, reopen và file đúng.
- Kỹ sư chuyên môn duyệt hồ sơ ảnh hưởng an toàn công trình. File CNC production phải xác minh máy/postprocessor và first-article trước khi chạy thật.
