> **UPDATE-ONLY OVERRIDE v2.1:** Claude đang có codebase MD CAD AI STUDIO gần hoàn thiện. Phải đọc `../00_UPDATE_ONLY_READ_FIRST.md` trước khi áp dụng bất kỳ yêu cầu nào trong file này. Mọi cụm từ “hãy tạo/xây dựng” chỉ áp dụng cho module chưa có; KHÔNG rebuild, không thiết kế lại hay chuyển framework.

# COPY / PASTE TO CLAUDE — UPDATE TO THE LOCKED MD CAD AI STUDIO STRATEGY

Tôi CHỐT LẠI TRIẾT LÝ SẢN PHẨM và cập nhật điều kiện bắt buộc của dự án **MD CAD AI STUDIO**. Đây là nhiệm vụ triển khai, KHÔNG phải yêu cầu bạn tạo thêm concept hoặc thiết kế lại mockup.

**TẦM NHÌN:** Kỹ sư nội thất và xây dựng giao một yêu cầu; AI tự triển khai phần lớn công việc khảo sát dữ liệu → thiết kế CAD 2D → dựng 3D/BIM → xuất hồ sơ/bóc tách → tự kiểm tra và trả kết quả để kỹ sư duyệt. Phần mềm không được là một chatbot trả lời văn bản hoặc một trình render hình ảnh.

**BẮT BUỘC 1 — MANUAL PARITY:** Tôi yêu cầu môi trường chỉnh sửa thủ công đầy đủ, nhắm tới tương thích 100% tính năng/quy trình/phím tắt với **AutoCAD, SketchUp và 3ds Max** theo bản tham chiếu sẽ đóng băng. Bạn KHÔNG ĐƯỢC tự giới hạn vào vài lệnh thông dụng. Khẩn trương tạo registry đầy đủ từ tài liệu chính thức (bao gồm alias, shortcut, thao tác chuột, tool state machine, khả năng mở/lưu file, nhóm chức năng). Mỗi chức năng đều có test. Nếu chưa thực hiện hoặc chưa xác minh, hiển thị rõ `NOT DONE`/`NOT TESTED`. Không được nói tương thích 100% khi chưa thực sự đạt, không được dùng ảnh mockup làm bằng chứng.

Dùng **3 compatibility profiles riêng** (AutoCAD 2D, SketchUp 3D, 3ds Max Advanced 3D) và cho phép remap vì shortcut có thể xung đột theo context/macOS. Người dùng phải sửa được bản vẽ/model do AI tạo bằng tay, và thay đổi tự cập nhật các file phụ thuộc một cách kiểm chứng được.

**BẮT BUỘC 2 — AI AUTOPILOT:** Hãy tạo Autonomous Project Director / Task DAG / native CAD & 3D tool workers / Geometry Validator / Auto-fix loop / Review & Approval / Job Queue & Resume. AI chạy offline trên Apple Silicon qua model local và không dựa vào API cloud trả phí. LLM chỉ sinh kế hoạch gọi công cụ có schema, không trực tiếp bịa hình học hoặc G-code. Cho phép tác vụ kéo dài mà không yêu cầu người dùng liên tục nhấn từng bước, nhưng phải chặn khi thiếu kích thước, chưa kiểm chứng an toàn hoặc phải ký duyệt chuyên môn.

**BẮT BUỘC 3 — ƯU TIÊN:** P0 Nội thất + Xây dựng/Kiến trúc. Nội thất gồm đo đạc, tủ tham số, cut list, BOM, nesting, CAM/CNC có machine gate. Xây dựng gồm CAD2D, Architecture/BIM, 3D, plans/elevations/sections, PDF, quantities. Projects/Settings/Components là nền tảng chung. MEP sau P0, Mechanical/Rendering nâng cao tiếp theo; Civil/Thủy lợi tạm hoãn.

**BẮT BUỘC 4 — KHÔNG PHÁ SẢN PHẨM HIỆN CÓ:** Tên chính thức **MD CAD AI STUDIO**. Giữ nguyên UI Pixel-Lock 12 màn đã duyệt, chỉ cập nhật branding và các bổ sung cần duyệt; không rebuild. Splash/installer phải có đúng chữ “Xây dựng và phát triển bởi Minh Dũng”. Song ngữ VI/EN. Native desktop macOS Apple Silicon. Không phụ thuộc API AI. Không xóa tính năng đã có mà không có migration/test.

**CÁCH TRIỂN KHAI:**
1. Trước khi viết mã mới, kiểm tra repo thực tế: liệt kê các tính năng đã chạy, chỉ là UI, còn thiếu; không được đoán.
2. Đọc `01_PRODUCT_VISION_AND_PRIORITY_LOCK.md`, `02_MANUAL_PARITY_MASTER_REQUIREMENTS.md`, `03_AUTONOMOUS_DESIGN_FACTORY_ARCHITECTURE.md`, seed QA CSV, bộ UI LOCK v2 và CNC v1.3.
3. Đưa ra architecture delta (thêm gì, sửa gì, giữ gì), registry tính năng/shortcut tham chiếu và kế hoạch P0 có test end-to-end.
4. Bắt tay CODE một vertical slice THẬT: từ một câu tiếng Việt → local AI → typed commands → tạo hình học CAD chính xác → review → save/reopen → manual edit. Tạo một case nội thất/tủ tham số có bóc tách và một case kiến trúc có hồ sơ.
5. Tự chạy test, chụp màn thật, đối chiếu mockup và xuất log. Nếu kẹt, ghi rõ rào cản, không dừng ở giải thích chung và không tuyên bố hoàn thành ảo.

**KHÔNG ĐƯỢC**: chỉ làm UI; sinh G-code production trực tiếp từ LLM; giả mạo 100% parity; âm thầm dùng cloud; tự thay đổi UI; bỏ qua fallback thủ công; ưu tiên Civil trước Interior/Architecture.

Hãy bắt đầu bằng kiểm tra repo và thực thi từng milestone có tiêu chí nghiệm thu. Mọi câu trả lời phải phân biệt rõ: **ĐÃ CODE / ĐÃ TEST / CHƯA CODE / BỊ CHẶN**.
