# CHANGE CONTROL & COMPATIBILITY GATES — v2.1

## Cơ chế duyệt sửa code
- Nhóm **safe additive**: thêm module không đụng backward compatibility, kèm unit tests, có thể triển khai sau audit.
- Nhóm **moderate**: chỉnh API nội bộ, UI state, library format, keyboard shortcut, migration; phải liệt kê affected callsites và chạy regression.
- Nhóm **high-risk**: thay CAD/3D engine, thay framework, thay kiến trúc tài liệu, schema dữ liệu, viết lại toàn UI, xóa hệ thống đã dùng, thay cài đặt user; phải xin phép rõ ràng **trước khi thay đổi**.

## Output bắt buộc của mỗi PR / milestone
- Đầu vào và giả định; các chức năng baseline phải giữ nguyên.
- Repo path / branch / commit before / after (nếu có).
- Danh sách file/code unit thay đổi; cơ chế tương thích ngược.
- Màn UI ảnh trước/sau, kết quả Pixel-Lock.
- Kiểm thử thực thi; kết quả qua/không qua; tác động hiệu năng.
- Nếu chưa đo được accuracy CAM hoặc chưa có máy thật, ghi 'CHƯA NGHIỆM THU G-CODE SẢN XUẤT'.
- Hướng dẫn rollback mà không mất project người dùng.

## Definition of Done của một chức năng
- Có thao tác thực tế không phụ thuộc ảnh tĩnh.
- Kết quả có file/geometry thực, có thể lưu mở, undo và chỉnh lại.
- Bài test tự động hoặc manual steps tái lập được.
- Không phá luồng cũ, không đổi mẫu giao diện.
- Khả năng còn thiếu phải được ghi rõ, không ghi '100%' khi chưa chứng minh.
