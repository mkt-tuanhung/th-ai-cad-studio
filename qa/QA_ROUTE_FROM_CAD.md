# QA — Dựng tuyến từ bản vẽ CAD (hướng A: kênh, đường → tuyến, diện tích, khối lượng, 3D)

Ngày: 2026-10-13. Lối vào: **Civil → Thêm công cụ → "Dựng tuyến từ bản vẽ CAD (trắc dọc + trắc ngang)…"**. Lối vào nằm trong menu có sẵn, không đổi bố cục đã duyệt.

## Luồng

1. Chọn bản vẽ đang mở, hoặc bấm **Mở DWG / DXF…**. DWG được đọc qua LibreDWG.
2. **Layer đường mặt đất và đường thiết kế:** code chọn sẵn theo tên ("Mat dat tu nhien", "Thietke", "TK2"…). Có thể bấm **AI gợi ý**: Qwen chạy trên máy, đầu ra bị ngữ pháp giới hạn, gợi ý được đánh dấu "AI". Anh có thể đổi từng layer.
3. **Tuyến:** mỗi bảng trắc dọc là một tuyến. Tuyến được đặt tên theo dòng chữ dưới tiêu đề "CẮT DỌC TUYẾN". Nhiều tờ của cùng một tuyến được gộp lại.
4. **Bảng đối chiếu từng cọc:** lý trình, diện tích đào và đắp do code tính, diện tích người thiết kế ghi, kết quả đối chiếu. Dấu * nghĩa là bảng cao độ ghi khác với hình vẽ; dấu † nghĩa là cao độ được đặt theo trắc dọc.
5. **Xem trước trắc ngang** (tô màu vùng đào/đắp) và tổng khối lượng theo phương pháp mặt cắt trung bình, so với tổng tính từ diện tích người thiết kế ghi.
6. **Duyệt & dựng tuyến** là **một bước hoàn tác**. Sau đó Civil có:
   - trắc dọc: mặt đất hiện trạng, đáy thiết kế, bờ trái/phải thiết kế;
   - trắc ngang thật của từng cọc;
   - bảng khối lượng đào/đắp chia theo từng 100 m;
   - mặt bằng dạng sơ đồ duỗi thẳng theo lý trình;
   - **hành lang 3D OCCT** dựng từ các mặt cắt;
   - xuất CSV từng mặt cắt.

## Code đọc gì (`ui/src/civil/fromCad.ts`, `fromCadBuild.ts`)

- **Trắc dọc:**
  - neo ở dòng "tên cọc";
  - các dòng nhãn cùng cột: khoảng cách cộng dồn / lý trình, cao trình đáy kênh hiện trạng, đáy kênh thiết kế, bờ trái/phải (hiện trạng, thiết kế);
  - mỗi giá trị được gán cho cọc gần nhất theo trục x.
- **Trắc ngang:**
  - mỗi tên cọc lớn ("C12") đi kèm thước cao độ ngay bên dưới. Thước được nhận theo dãy nhãn cách đều; nhiều mặt cắt xếp chồng trên một cột vẫn tách được;
  - khung của mặt cắt dừng trước thước của mặt cắt kế bên phải;
  - đường mặt đất là đường liền bắt đầu gần thước nhất;
  - tâm offset là đường dọc cạnh chữ "tim kênh tk", nếu không có thì lấy "tim khảo sát".
- **Tỉ lệ:**
  - Tỉ lệ ngang lấy từ dòng "Khoảng cách".
  - **Tỉ lệ đứng và cao độ khớp theo dòng "Cao độ mặt đất tự nhiên"** bằng bình phương tối thiểu. Chữ nhãn của thước đặt lệch vạch chia vài đơn vị nên chỉ dùng thước làm dự phòng.
  - Điểm nào bảng ghi lệch hình vẽ quá 3 cm thì bị loại khỏi phép khớp và được báo lên.
  - Nếu không dùng được bảng: tỉ lệ đứng lấy bằng tỉ lệ ngang, cao độ neo vào đáy thiết kế của cọc trong trắc dọc.
- **Diện tích:**
  - mặt hoàn thiện = đường thiết kế ở chỗ có, mặt đất ở chỗ còn lại;
  - đào = phần đất nằm trên mặt hoàn thiện, đắp = phần nằm dưới; tích phân từng 1 cm.
- **Khối lượng:** phương pháp mặt cắt trung bình giữa các lý trình liên tiếp.
- **Thông số điển hình:** chiều rộng đáy và độ dốc mái được đo trên chính đường thiết kế đã vẽ.
- **Không tạo số liệu giả:**
  - bản vẽ không có lưu lượng Q và đáy thiết kế nằm ngang, nên **thuỷ lực không được tính**: hiện "—" kèm lý do;
  - mục "tối ưu bề rộng đáy" được ẩn;
  - không có nước giả trong 3D;
  - bộ trắc dọc + trắc ngang không có toạ độ mặt bằng, nên mặt bằng là **sơ đồ duỗi thẳng theo lý trình** và có ghi rõ điều đó. Ảnh mẫu DEMO không còn hiện.

## Bằng chứng

### 1. Bản vẽ thật: "1. BVTK Kênh Đức Phong – Kênh đất.dwg"

File thật của anh, nằm trong Zalo Received Files. File không được đưa vào repo. Bản vẽ có 41.717 đối tượng.

| Tuyến | Cọc / trắc ngang | Đào: code / người thiết kế | Đắp: code / người thiết kế | Mặt cắt khớp ±0,02 m² | ±0,10 m² |
|---|---|---|---|---|---|
| Kênh Đức Phong 1 (1.600 m) | 33 / 33 | 6.161 / 6.164 m³ (**−0,04 %**) | 4.324 / 4.305 m³ (**+0,44 %**) | 22/33 | 31/33 |
| Kênh Đức Phong 3 (1.350 m) | 27 / 27 | 6.000 / 5.982 m³ (**+0,31 %**) | 6.901 / 6.883 m³ (**+0,25 %**) | 25/27 | 26/27 |

- "Người thiết kế" ở đây là khối lượng em tính theo phương pháp mặt cắt trung bình từ các ô "S đào đất / S đất đắp bằng máy / S đắp thủ công" ghi cạnh từng mặt cắt. Đó chưa phải bảng dự toán của họ, vì bảng dự toán không có trong file.
- Code phát hiện **13 + 13 mặt cắt mà bảng cao độ và đường vẽ lệch nhau ở một vài điểm** (ví dụ C3 tuyến Đức Phong 1: bảng ghi 1,40, đường vẽ là 1,30). Phần lớn các mặt cắt lệch diện tích nằm ở những chỗ này; có lẽ người thiết kế tính diện tích theo bảng. Code dùng đường vẽ và báo chỗ lệch cho anh kiểm tra.
- C4 tuyến Đức Phong 1: người thiết kế ghi đắp 0; đường thiết kế có một nêm đắp nhỏ (≈ 0,58 m²) nên code tính ra phần đắp đó.
- Kiểm thử trong app desktop (`native/app/resources/e2e_route.js`, có THCAD_DWG_SAMPLE trỏ tới file này): **9/9 PASS**.
  - DWG được đọc và tìm thấy 2 tuyến trong khoảng 4 giây.
  - **Qwen2.5-7B trên máy** gợi ý 2 vai trò trong 32 giây, giữ đúng layer mặt đất và layer thiết kế, khối lượng không đổi.
  - Duyệt & dựng xong thì trắc ngang thật hiện đủ; hành lang 3D OCCT có 33 mặt cắt, 3.248 tam giác, dựng trong khoảng 0,5 giây.
  - Ảnh: `qa/fromcad/route_kenh_{dialog,profile,section,3d}.png`. Tuyến dài 1,6 km mà chỉ rộng khoảng 30 m, nên ở mức nhìn cả tuyến, ảnh 3D chỉ thấy như một vệt dài.
  - Lần chạy đầu bước AI quá thời gian chờ (máy đang tải nặng). Em đã giảm prompt xuống tối đa 40 layer có từ 5 nét trở lên; sau đó chạy lại đạt.

### 2. Bộ mẫu tự tạo — `qa/fixtures/civil/canal_route_SYNTHETIC.dxf`

Tạo bằng `ui/tools/make-route-fixtures.mjs`. Bộ mẫu bắt chước kiểu bản vẽ thật:
- tỉ lệ 1:100;
- nhãn thước lệch vạch;
- C3 có bảng số viết xoay đứng;
- C4 có một số trong bảng cố tình sai 0,10 m;
- có ô diện tích của người thiết kế.

Đáp án tính **giải tích** (điểm cắt và hình thang), độc lập với cách code lấy mẫu từng 1 cm.

`UNIT=civilroute node tools/test-cam.mjs run` cho **ALL PASS**:
- cả 4 mặt cắt khớp đáp án đến ±0,005 m², ví dụ C1 đào 4,7873 / đắp 5,4923 m²;
- khối lượng đào **649,93**, đắp **741,46** m³, đúng bằng đáp án;
- ô số sai bị phát hiện (lệch 0,10 m tại 1 điểm), bảng viết xoay đứng đọc được;
- mô hình Civil hợp lệ; bảng khối lượng bằng tổng khối lượng của các mặt cắt; đo được bề rộng đáy 2,5 m;
- không tạo số thuỷ lực; dựng được 3D.

### 3. Giao diện — `ui/tools/smoke-route.mjs`

**9/9 PASS**. Kiểm tra:
- đọc file, nhận vai trò layer;
- diện tích và khối lượng khớp đáp án, cảnh báo đúng;
- nút AI tắt khi chạy trên trình duyệt;
- Duyệt → trắc ngang thật, sơ đồ lý trình (không DEMO), thuỷ lực "—";
- Hoàn tác trả lại mô hình mẫu;
- giao diện tiếng Việt.

Ảnh: `qa/fromcad/route_dialog_{en,vi}.png`, `route_civil_plan.png`.

**Hồi quy:** smoke Civil 12/12, Civil tools 7/7, khảo sát 12/12. Kết quả chạy đủ các bộ ghi ở `QA_FROM_CAD.md` và `AUDIT`.

## Giới hạn (nói rõ)

- **Mặt bằng tuyến:** bộ trắc dọc + trắc ngang không có toạ độ, nên tuyến được duỗi thẳng theo lý trình. Muốn có tuyến thật trên mặt bằng thì nhập tuyến khảo sát (đã có sẵn: Nhập khảo sát / GIS → LandXML, CSV…). Hiện chưa tự ghép tuyến khảo sát với các mặt cắt đã nhập.
- **Đắp máy và đắp thủ công:** code chỉ tính **tổng phần đắp**, chưa tách lớp thủ công 15 cm như người thiết kế.
- **Mới kiểm trên một bộ hồ sơ thật** (Kênh Đức Phong). Hồ sơ của đơn vị khác có thể đặt nhãn khác: các dòng của bảng được nhận theo luật tên tiếng Việt và tiếng Anh, nếu không khớp thì code báo "không thấy bảng trắc dọc".
- **Đường (road):** cùng cách đọc (tên cọc, lý trình, mặt đất, thiết kế), nhưng chưa kiểm trên hồ sơ đường thật.
