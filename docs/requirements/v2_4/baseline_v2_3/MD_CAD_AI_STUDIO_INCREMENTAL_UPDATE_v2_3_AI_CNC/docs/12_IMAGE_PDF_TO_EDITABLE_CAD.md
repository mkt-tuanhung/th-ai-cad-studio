# IMAGE/PDF → EDITABLE CAD — IMPLEMENTATION & QUALITY

## Đầu vào và tính khả thi
- PDF vector: ưu tiên giữ vector gốc, text/line/curve/layers khi có; không rasterize nếu không bắt buộc.
- PDF scan/JPG/PNG mặt bằng: hiệu chỉnh méo, tách nét, OCR chữ/số đo, phát hiện tỷ lệ bằng một hoặc nhiều dimension có chứng cứ, nhận tường/cửa/phòng/cột/cửa sổ.
- Ảnh phối cảnh phòng đơn: suy đoán 3D không có độ chính xác thi công nếu thiếu kích thước/multiple views/scan; hiển thị `ESTIMATED_NOT_FOR_PRODUCTION`.
- Ảnh có 1 dimension tham chiếu vẫn có sai số phối cảnh, pixel line thickness, scan distortion; cần đo thêm hai chiều/đối chiếu kiểm chứng trước thành CAD verified.

## 8 bước kỹ thuật
1. Intake: file hash, page, DPI, nguồn, unit hinted, orientation.
2. Preprocess: denoise, deskew/dewarp, background correction, crop, threshold; lưu original không thay.
3. Scale Calibration: OCR dim text + dimension endpoints, user point-to-point reference. Lưu transform image→world, validation residual, source tag. Không có scale VERIFIED → export UNCALIBRATED for tracing only.
4. Primitives: Hough/contours/semantic segmentation, line/arc fitting, orthogonal constraints, intersections, gap bridging với giới hạn sai số rõ.
5. Object semantic: tường, cửa, cửa sổ, phòng, chữ và kích thước ở layers riêng, object confidence; unknown stays unknown.
6. Build editable CAD: entities + stable IDs, block references, DIM style, mm, line types, layer colors, topology and construction history.
7. Engineer preview: overlay original vs vector with diff, reviewer confirm uncertain entities/dims before downstream 3D/manufacturing.
8. Validation export: DXF out then reimport, inspect coordinates/dimensions/entity count/polylines/closed status, source↔target diff tolerance.

## Yêu cầu bắt buộc khi triển khai
- Không nhúng ảnh toàn trang vào DXF rồi gọi đó là vector CAD.
- Không biến PDF ảnh thành DXF sai tỷ lệ hoặc xem câu OCR `1200` là kích thước chắc chắn khi chưa xác nhận đường đo.
- Layer semantic, object IDs, confidence; độ chính xác có ngưỡng acceptance theo phép đo benchmark của xưởng/dự án.
- Từ ảnh 3D render, công cụ chỉ tạo concept/approximation trừ khi có survey evidence.
- File DXF editable đầu ra có thể dùng manual tools: LINE, TRIM, OFFSET, DIM, layer editing, snap.

## Phụ thuộc gợi ý
OpenCV (preprocess/hình học ảnh), OCR engine PaddleOCR/Tesseract (đọc dimension), local image model nếu cần segmentation, ezdxf (serialisation DXF), OCCT/CAD core hiện hữu (topology). `ezdxf` KHÔNG phải CAD kernel và KHÔNG tự xuất DWG. Chỉ dùng DWG via adapter nếu được cấp phép và kiểm thử.
