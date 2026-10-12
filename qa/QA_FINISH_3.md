# QA — Ba việc cuối (2026-10-12)

Ba việc anh đã duyệt:
1. Nhận giọng nói tiếng Việt và chuyển ảnh quét sang vector.
2. Ghi layout vào paper space của DXF / DWG.
3. Mặt đứng và mặt cắt BIM thành bản vẽ 2D có ghi chú.

Build: macOS arm64 (M1 Max). Bản Windows được build và chạy tự kiểm thử trên GitHub Actions.

## 1a. Voice CAD tiếng Việt — Whisper chạy trên máy

**Cách hoạt động**
- Trang web tự thu âm micro (16 kHz mono, WAV) rồi gửi cho app.
- App chạy `whisper-cli` (whisper.cpp v1.9.4, giấy phép MIT) như một chương trình riêng, với mô hình `ggml-large-v3-turbo-q5_0` (547 MB, sha256 cố định).
- Không có gì gửi ra ngoài máy. File WAV tạm bị xoá ngay sau khi nhận dạng xong.
- Micro chỉ được cấp cho chính giao diện của app (`thcad://` hoặc dev server); mọi nguồn khác bị từ chối.
- Có lời nhắc theo lĩnh vực CAD (tường, cửa sổ, milimét…).
- Ngưỡng im lặng: không chạy Whisper trên âm thanh im lặng, tránh trường hợp mô hình tự "bịa" chữ.

**Cài đặt mô hình**
- Cài đặt → Quản lý mô hình → "Tải Whisper large-v3-turbo (547 MB)": có tiến độ và kiểm tra sha256.
- Chưa có mô hình thì Voice CAD dùng bộ nhận dạng của hệ thống như trước.

**Đóng gói**
- macOS: `Helpers/whisper-cli` (static, Metal nhúng sẵn).
- Windows: thư mục `whisper\` (bản chính thức b5130, dùng ggml riêng, tách khỏi ggml của llama.cpp).

**Bằng chứng**
- `e2e_voice.js` 3/3: micro giả của Chromium phát file `qa/fixtures/voice/vi_window_SYNTHETIC.wav` (giọng "Linh" của macOS, là giọng TỔNG HỢP).
  - Câu đọc: "Thêm một cửa sổ rộng một mét hai vào tường W25, cao độ bậu cửa chín trăm milimét".
  - Kết quả trong ô chat: "Thêm một cửa sổ rộng 1m2 vào tường W-25, cao độ bẩu cửa 900mm."
  - Thời gian: 1,6 s.
  - Sai đúng 1 chữ ("bậu" → "bẩu"). Văn bản chỉ nằm trong ô để người dùng kiểm tra, không tự gửi.
- `e2e_speechmodel.js` 4/4: thư mục mô hình trống → Tải → 14 s → sha256 khớp → sẵn sàng.

## 1b. Ảnh quét → vector (Scan to CAD) — chạy offline

**Nét vẽ: xử lý ảnh cổ điển**
- Nhị phân hoá Otsu → lọc nhiễu → làm mảnh nét (Zhang–Suen) → dò chuỗi điểm (điểm nút xác định bằng crossing number) → đơn giản hoá Ramer–Douglas–Peucker → khớp đường tròn → nắn nét gần ngang / dọc.

**Chữ: OCR Tesseract**
- Dùng tesseract.js 5.1.1 với mô hình `vie` bản *best* 4.1.0 (Apache-2.0, 12,4 MB, đóng gói kèm app).
- Chạy 2 lượt: trên ảnh gốc, và trên ảnh chỉ còn các cụm cỡ chữ (tách chữ khỏi hình). Hai lượt cho chữ trùng vị trí thì giữ chữ có độ tin cậy cao hơn.
- Vùng chữ được xoá khỏi ảnh trước khi dò nét.
- Chỉ dùng `vie`: thêm `eng` làm chữ in hoa mất dấu (đã đo: "MAT BANG" so với "MẶT BẰNG").

**Kết quả**
- Kết quả mở trong CAD 2D ở 2 lớp SCAN-LINES và SCAN-TEXT; ảnh quét giữ làm ảnh nền để đối chiếu.
- Đây **không** phải AI hiểu bản vẽ, và hộp thoại nói rõ điều này. Mũi tên, hatch và kích thước ra dưới dạng hình học / chữ thường, cần người kiểm tra lại.

**Bằng chứng (`smoke-scan.mjs` 6/6, `e2e_scan.js` 6/6 trong app đóng gói)**

*Ảnh mặt bằng tổng hợp `vi_plan_SYNTHETIC.png` (200 dpi, 1:50):*
- Khung rộng 8 864,6 mm, đáp án 8 890 mm (lệch 0,3%).
- Đường tròn r = 752 mm, đáp án 762 mm (lệch 1,3%).
- OCR đọc đúng 7/7 chữ: PHÒNG KHÁCH BẾP MẶT BẰNG TẦNG 1 (độ tin cậy 93–97%).

*Bản vẽ kênh thật quét ở 200 dpi:*
- Khung 410,08 mm (đáp án 410).
- Đọc được "CÔNG TY … TƯ VẤN THỦY LỢI MINH", "Kênh N2 Hệ thống tưới Nam", "KS Vũ Dũng", "Trần Hòa", "18/09/2026"…
- Chữ còn sai: "TNHV" (đúng là TNHH), "CÁT" (đúng là CẮT).
- Ảnh: `scan_canal_vectorised.png`.

*Trong app (`thcad://`):* worker OCR đọc mô hình nhờ bật `FetchApiAllowed` cho scheme `thcad`.

## 2. Layout trong DXF / DWG

**DXF 2000 (AC1015)**
- Mỗi layout là một LAYOUT thật, có block `*Paper_Space…`, khổ giấy, khung tên và VIEWPORT nhìn vào model đúng tỉ lệ. Hình học dùng chung với bản in PDF (`sheetLayout`).
- Chữ ngoài bảng mã ASCII được ghi dạng `\U+XXXX`, theo chuẩn AutoCAD.
- Vẫn có mục "DXF R12 (chỉ model)" cho phần mềm cũ.

**DWG**
- Đi đường DXF 2000 → LibreDWG `dxf2dwg`, rồi app đọc ngược lại để đếm số đối tượng, số lớp và số layout.
- Chữ căn giữa được ghi thành chữ căn trái tại điểm đầu đã tính sẵn, vì `dxf2dwg` làm mất điểm căn giữa.

**Mở tệp:** bộ nhập DXF đọc lại layout (tên, khổ A4–A1, tỉ lệ lấy từ viewport).

**Bằng chứng**
- ezdxf 1.4.2 audit: **0 lỗi, 0 chỗ phải sửa**. Ba layout (A3 1:50, A1 1:50 tên tiếng Việt "Mặt bằng 1-50", A4 1:200) đúng khổ và tỉ lệ.
- Ảnh vẽ bằng ezdxf (trình đọc độc lập): `dxf2000_layout_A1_ezdxf.png`.
- DXF → DWG → đọc lại: vẫn đủ 3 layout đúng tỉ lệ.
- `e2e_layouts.js` 5/5: thông báo "read back: … 5 layouts" sau khi xuất DWG.
- Smoke CAD 2D: đọc lại layout từ DXF 2000 xuất ra.
- Cảnh báo "Invalid symbol table record name" khi `dxf2dwg` nhập VIEWPORT: file tham chiếu do ezdxf tạo cũng bị đúng như vậy, nên đây là đặc điểm của LibreDWG và vô hại.

## 3. Mặt đứng / mặt cắt BIM 2D có ghi chú

**Hình học**
- Kernel OCCT khử nét khuất chính xác (`HLRBRep_Algo`): chỉ lấy nét thấy và đường bao.
- Mặt cắt: chỉ giữ phần phía sau mặt phẳng cắt (đi qua tâm công trình), các mặt bị cắt thành vùng tô (poche).

**Ghi chú lấy từ mô hình**
- Đường cao độ từng tầng (Level 1 ±0.000 … Roof +9.000).
- Trục lưới có bóng tròn (khi mô hình có trục).
- Kích thước tổng và kích thước theo tầng.
- Tên phòng ở mặt cắt (khi phòng có đường bao).
- Tên bản vẽ và tỉ lệ.

**Trình bày và xuất**
- Hiển thị như tờ A3 1:100.
- Các nút: Xem 3D (camera trực giao đúng phía), PDF, Mở trong CAD 2D (các lớp A-ELEV / A-SECT-CUT / A-ANNO-…, một layout A3 1:100), rồi xuất DXF / DWG.

**Bằng chứng (`e2e_bimviews.js` 11/11)**

| Bản vẽ | Số nét | Mặt cắt | Thời gian |
|---|---|---|---|
| Mặt đứng Nam | 87 | 0 | 60 ms |
| Mặt đứng Đông | 73 | 0 | 62 ms |
| Mặt đứng Bắc | 73 | 0 | 59 ms |
| Mặt đứng Tây | 49 | 0 | 62 ms |
| Mặt cắt 1 | 123 | 14 | 110 ms |
| Mặt cắt 2 | 96 | 13 | 125 ms |

- Sheet A201 mở mặt đứng Nam.
- Xuất DWG thông báo "read back: 130 entities, 16 layers, 1 layouts". Ảnh DWG đọc lại vẽ bằng ezdxf: `bim_south_elevation_dwg_readback_ezdxf.png`.
- Ảnh trong app: `bim_elevation_south_2d.png`, `bim_section_1_2d.png`. Ảnh HLR thô: `bim_hlr_south_section_east.png`.

## Hồi quy
- 19 bộ smoke trên trình duyệt: tất cả PASS.
- Unit test và native ctest: đạt.
- 18 e2e desktop: tất cả PASS.
  - `e2e_aichat` được sửa để so với số tường thật của mô hình: AI trả lời đúng "25 walls" sau khi e2e vẽ BIM thêm W25.

## Chưa kiểm chứng được
- Giọng nói thật của người qua micro thật (đã kiểm bằng giọng tổng hợp; cần anh cấp quyền micro).
- Whisper trên Windows: chỉ chạy trên CPU, nên chậm hơn.
- AutoCAD mở DXF / DWG có layout: đã kiểm bằng ezdxf và LibreDWG, máy này không có AutoCAD.
