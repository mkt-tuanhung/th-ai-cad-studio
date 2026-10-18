# Ảnh mặt bằng → BIM 3D + Nội thất (v2.4, tính năng A)

Đưa một **ảnh** mặt bằng (bản scan, trang PDF, ảnh chụp điện thoại một bản in, bản vẽ tay rõ nét) vào "1 lệnh".
Phần mềm tìm tường, cửa đi, cửa sổ, cột, phòng (tên phòng đọc bằng OCR). Bạn kiểm tra và sửa, đặt tỉ lệ rồi duyệt.
Sau đó các bước giống hệt đường DWG: xem tóm tắt → Duyệt → dựng BIM 3D + Nội thất, kèm bộ hồ sơ.

Tất cả chạy **trên máy, không dùng AI, không gửi đi đâu**: xử lý ảnh cổ điển cộng với OCR Tesseract có sẵn (`ui/public/ocr`).
**Không thêm thư viện mới.** Chỉ dùng tesseract.js và pdf.js đã có trong THIRD_PARTY_NOTICES.

## Cách dùng

1. Mở ⌘K → "1 lệnh" (hoặc Dashboard → 1 lệnh). Kéo thả hay chọn file **PNG / JPG / JPEG / WebP / PDF**.
   - Cách khác: AI Studio → Scan to CAD → nút **"Dựng 3D từ ảnh này"**.
2. **PDF nhiều trang:** bắt buộc chọn trang mặt bằng. Trước khi chọn trang, phần mềm không đọc gì.
3. **Ảnh chụp điện thoại:** phần mềm tự tìm 4 góc tờ giấy. Nếu sai, kéo các chấm tròn vào đúng góc.
   - Ô "Ảnh chụp điện thoại: nắn thẳng tờ giấy" tự bật khi tìm thấy góc.
   - Ô "Tỉ lệ khổ giấy A (1:√2)" bù sai lệch tỉ lệ dọc/ngang sau khi nắn.
   - Các tuỳ chọn khác: xoay thẳng (deskew), cân sáng và khử nhiễu (bóng đổ, nhiễu JPEG), đọc tên phòng (OCR).
4. Bấm **Nhận dạng**. Mất khoảng 2–10 giây, phần lớn là OCR. Kết quả vẽ đè lên ảnh:
   - tường (xanh dương), tường ngoài (tím), vách kính (lam);
   - cửa đi (xanh lá), cửa sổ (xanh trời), lỗ mở (cam), cột (đỏ);
   - phòng (tên + diện tích).
   Đối tượng có **độ tin cậy dưới 60 % tô màu cam**. Bấm vào một đối tượng để xem độ tin cậy và căn cứ nhận dạng ("arc", "glazing 2", "tag"…).
5. **Sửa**, thao tác nào cũng hoàn tác được (nút Hoàn tác):
   - Xoá tường, cửa, cột. Với phòng, xoá nghĩa là loại khỏi mô hình.
   - **Thêm tường** bằng 2 cú bấm (tự vuông góc, tự bắt vào tường gần).
   - Đổi loại cửa (cửa đi / cửa sổ / lỗ mở) và bề rộng (mm).
   - Đổi tên phòng (tên gõ tay được giữ lại khi tường thay đổi).
   - Đổi độ dày tường.
   Phòng được tính lại từ tường sau mỗi lần sửa.
6. **Tỉ lệ (bắt buộc để có kích thước thật):**
   - "Gợi ý từ bản vẽ": khi ≥ 2 tham chiếu khớp nhau trong khoảng 3 %, lấy từ chữ kích thước đọc được nằm trên đường kích thước, hoặc từ diện tích ghi trong phòng ("13.53 m²"). Bấm **Dùng gợi ý**.
   - "Giả định cửa đi rộng 900 mm" là một giả định. Bạn tự quyết định có dùng hay không.
   - Có thể chọn 2 điểm trên ảnh rồi gõ khoảng cách thật (cùng bộ chọn với Scan to CAD), hoặc bấm "Dùng" trên từng chữ kích thước OCR.
   - Sau khi hiệu chỉnh, nếu tỉ lệ lệch xa tỉ lệ đoán ban đầu, bấm **Nhận dạng lại**: ngưỡng kích thước cửa, tường… sẽ theo tỉ lệ thật.
   - **Chưa hiệu chỉnh** thì mô hình vẫn dựng được theo tỉ lệ danh định (dpi × tỉ lệ bản vẽ đã chọn), nhưng bị gắn **CẦN XEM LẠI (REVIEW REQUIRED)** và chặn sản xuất. Gói CNC chỉ có bản xem trước NOT FOR MACHINE, kèm mã chặn `SOURCE_DRAWING_NOT_FABRICATION_READY`. Quy tắc này giống hệt Scan to CAD (`cad/provenance.ts`).
7. **Duyệt và dựng** → bước tóm tắt của "1 lệnh", gồm:
   - BIM: số tầng, tường, cửa, phòng; mặt đứng và mặt cắt do lõi OCCT dựng (bản desktop);
   - Nội thất: phòng; đồ đạc bố trí theo **quy tắc loại phòng** có sẵn (`interior/options.ts`) cho phòng khách / phòng ngủ / bếp, cửa phòng lấy từ BIM;
   - cut list, CNC preview.
   **Chưa có gì được áp dụng cho tới khi bấm Duyệt ở bước này.** Khi duyệt:
   - mỗi phần là một bước Undo (mô hình cũ được sao lưu);
   - mặt bằng đã nhận dạng mở trong CAD 2D, có ảnh nằm dưới và nguồn gốc (đã hiệu chỉnh / CẦN XEM LẠI).

Kỹ thuật: kết quả nhận dạng ảnh được đổi sang **đúng cấu trúc trung gian `Recognition` của bộ nhận dạng DWG** (`bim/fromCad.ts`, mm, trục y hướng lên).
Vì vậy `buildBimModel`, `buildInterior`, kiểm tra mô hình, gói hồ sơ, IFC, mặt đứng… được dùng lại nguyên vẹn (`ui/src/planimage/toModel.ts`, `build.ts`).

## Độ chính xác đo được (chạy thật)

Lệnh đo: `THCAD_UI=… node tools/measure-planimage.mjs`. Lệnh này chạy đúng pipeline của app trong trình duyệt, có cả OCR.
Kết quả lưu ở `qa/v2_4/planimage_accuracy.json`; ảnh chồng kết quả nằm ở `qa/v2_4/planimage_*.jpg`.

Cách đo:
- Phòng được ghép theo **vị trí**: điểm trong phòng thật rơi vào phòng tìm được.
- Tên đúng = giống ≥ 80 % sau khi bỏ dấu.
- Diện tích tính theo mặt trong tường.
- Dữ liệu chuẩn:
  - (a), (b): Tầng 1 của VILLA_150_MASTER.dwg do bộ nhận dạng DWG đọc ra; tên và diện tích phòng lấy từ AREA_SCHEDULE.csv. File: `fixtures/planimage/villa_t1.truth.json`.
  - (c): hình học dùng để vẽ ra ảnh.

| Ảnh | Tỉ lệ dùng | Tường (số / tổng dài) | Cửa đi | Cửa sổ | Phòng tìm được | Tên đúng | Sai số diện tích phòng |
|---|---|---|---|---|---|---|---|
| (a) `villa_t1_150dpi.png` (trang A2 1:100, 150 dpi, 3507×2480) | đúng tỉ lệ tờ giấy, 16,933 mm/px | 21 / 22; 101,2 m so với 90,45 m (**+11,9 %**) | **9 / 9** | 10 (thật: 7 + 2 vách kính) | **14 / 14** | 5 / 14 (+2 đúng một phần) | trung vị **11,5 %**; 6 phòng có tường bao kín ≤ 1,5 % (WC P.NK −1,0 %, WC KHÁCH −0,9 %, THANG MÁY +0,3 %, HỘP KT −0,6 %, GIẶT −0,9 %, P. ĐA NĂNG −1,5 %); phòng "mở" chia theo tên lệch lớn (PHÒNG ĂN gộp vào BẾP +55–63 %, P. NGỦ KHÁCH −30 %, KHO −36 %) |
| (b) `villa_t1_phone_SYNTHETIC.jpg` (ảnh (a) chụp nghiêng, bóng đổ, mờ, nhiễu, JPEG 0,72) | 2 điểm theo bề rộng tường ngoài (giả lập người dùng hiệu chỉnh) → 20,40 mm/px | 18 / 22; +46,9 % (nhận nhầm đường mảnh đậm thành tường) | 5 / 9 | 28 (nhiều cửa sổ giả) | **14 / 14** | 1 / 14 | trung vị **13,2 %**, lớn nhất 34 %; 6 phòng ≤ 2 % (P. KHÁCH +0,3 %, THANG BỘ −0,4 %, KHO +0,2 %, GIẶT +0,1 %, WC P.NK −1,0 %, THANG MÁY +1,5 %) |
| (c) `sketch_plan_SYNTHETIC.png` (vẽ tay, nét bút dạ, 12,5 mm/px) | chữ kích thước "9000" đọc được → 12,517 mm/px (sai 0,14 %) | **9 / 9**; +0,7 % | **6 / 6** | **4 / 4** | **6 / 6** | 5 / 6 (KHO đọc thành "HO") | trung vị **1,6 %**, lớn nhất **2,9 %** |

Thời gian một lần nhận dạng có OCR (trình duyệt): 1,9 s (c); 7,1 s (a); 7,7 s (b).
Ảnh (c) dựng ra 2 tầng (Tầng 1 + mái), 9 tường, 6 cửa đi, 4 cửa sổ, 6 phòng, nội thất 18 món / 8 tủ cho 4 phòng.

Nhận xét thật:
- **Tường, cửa và diện tích phòng có tường bao kín rất tốt** ở bản scan và bản vẽ tay.
- **Tên phòng là phần yếu** ở trang A2 150 dpi: chữ trên giấy cao 2–2,5 mm chỉ được 9–15 px, lại nằm đè lên đồ đạc.
  Cần scan 300 dpi, hoặc dùng PDF vector (khi đó Scan to CAD đọc trực tiếp).
  Phòng không có tên được gắn cam và tô nổi để người dùng gõ tên.
- **Ảnh chụp điện thoại ~120 dpi tương đương:** nắn phối cảnh và đo diện tích tốt, nhưng nét mảnh đậm (đường cắt, trục) dễ thành tường hoặc cửa sổ giả.
  Bước sửa (xoá, thêm tường) là bắt buộc. OCR gần như không đọc được ở độ phân giải này.
- Không gian mở (phòng khách + ăn + bếp không có tường ngăn) được chia giữa các tên đọc được bằng đường đi ngắn nhất, có bám theo nét mảnh vẽ trên bản vẽ. Diện tích các phòng này chỉ là ước lượng (sai tới vài chục %).

## Kiểm thử đã chạy (kết quả thật, kiểm cả mã thoát)

- `npx tsc --noEmit -p tsconfig.app.json`: sạch.
- Unit `UNIT=planimage node tools/test-cam.mjs run`: **34 / 34 PASS**, rc 0. Phạm vi:
  - hình thái học, bóng đổ, homography, góc tờ giấy, deskew;
  - nhận dạng một mặt bằng tổng hợp (tường, cung cửa, cửa sổ, phòng có tên và diện tích);
  - Recognition → BIM / Nội thất qua bộ dựng DWG;
  - cổng sản xuất (provenance), gợi ý tỉ lệ, sửa chữ OCR, các thao tác sửa.
- Unit hồi quy, đều ALL PASS, rc 0: `fromcad run`, `auto run`, `importcal run / junctions / queue`, `dxfround run`, `spaceplan run`.
- Smoke trình duyệt `tools/smoke-planimage.mjs`: **9 / 9 PASS**, gồm:
  - hộp thoại nhận ảnh;
  - nhận dạng ảnh vẽ tay;
  - sửa / hoàn tác;
  - chưa hiệu chỉnh → CẦN XEM LẠI + chặn CNC;
  - duyệt → BIM + Nội thất + CAD 2D;
  - hiệu chỉnh bằng "9000" → hết CẦN XEM LẠI;
  - PDF nhiều trang bắt chọn trang;
  - Scan to CAD → "Dựng 3D từ ảnh này".
- 24 smoke cũ (chạy `node` trực tiếp): **tất cả rc 0**.
  - smoke-scan lần đầu hỏng 1 bước, vì bước đó bấm "nút đầu tiên" của footer. Đã chuyển nút mới ra cuối; chạy lại được 13 / 13.
- Desktop e2e (app Qt, UI từ dev server của nhánh này, profile riêng):
  - `e2e_planimage.js` (mới): **23 / 23 PASS**. Chạy ảnh → nhận dạng → duyệt → mặt đứng / mặt cắt OCCT → ghi gói vào thư mục, cho cả 2 lần: chưa hiệu chỉnh (CẦN XEM LẠI, `SOURCE_DRAWING_NOT_FABRICATION_READY`) và đã hiệu chỉnh.
  - `e2e_auto` (DWG VILLA_150_MASTER): 4 / 4.
  - `e2e_fromcad`: 12 / 12.
  - `e2e_scan`: 6 / 6.
  - Ba script cũ chạy từ bản sao trỏ ảnh chụp vào /tmp, không ghi vào qa/ của bản checkout chính.

Lệnh chạy desktop e2e:

```
qa/tools/rune2e.sh $PWD/native/app/resources/e2e_planimage.js 900 THCAD_PROFILE=<riêng> THCAD_UI_URL=http://127.0.0.1:<port> THCAD_SPLASH=0 \
  THCAD_DWG_SAMPLE=$PWD/qa/v2_4/fixtures/planimage/sketch_plan_SYNTHETIC.png THCAD_PICK_DIR=<thư mục trống>
```

Ảnh chụp màn hình được ghi vào /tmp/thcad_planimage_e2e. Hai ảnh đã được chép vào repo: `planimage_review_desktop.png`, `planimage_auto_review_desktop.png`.

## Giới hạn (ảnh nào dùng được / không)

Dùng tốt:
- Bản in / PDF xuất từ CAD có **tường tô đặc** hoặc nét tường đậm.
- Bản scan ≥ 150 dpi, thẳng hoặc nghiêng ít (≤ 8°).
- Bản vẽ tay rõ nét: tường nét đậm, cửa có cung, cửa sổ hai nét.
- Ảnh chụp cả tờ giấy trên nền tối hơn.

Dùng được nhưng phải sửa nhiều:
- Ảnh chụp điện thoại độ phân giải thấp.
- Tường vẽ hai nét rỗng (chế độ "outline" có làm, nhưng chưa có bộ ảnh đo).
- Mặt bằng có không gian mở.
- Chữ nhỏ (< 15 px).

Không dùng được hoặc chưa hỗ trợ:
- Tường xiên nhiều (chỉ nhận được đoạn xiên dài, dạng tường "slanted").
- Tường cong.
- Tường gạch chéo (hatch) không có nét bao đậm.
- Ảnh xoay 90° / lộn ngược (chưa tự xoay).
- Chữ đứng dọc (không đọc được).
- Ảnh chỉ chụp một phần mặt bằng.
- Ảnh mờ, nhòe mạnh.
- Nhiều mặt bằng trên cùng một trang: chỉ lấy cụm tường lớn nhất (cùng các cụm ≥ 1/4 cụm đó); các hình khác bỏ qua và có cảnh báo.

Thang bộ:
- Có nhận dạng bậc (≥ 5 nét song song đều nhau).
- Nhưng **thang chỉ được dựng khi có mặt bằng hai tầng** (quy tắc của bộ dựng DWG). Một ảnh = một tầng, nên ảnh đơn không tạo thang.

Không có lưới trục (lưới không đọc từ ảnh). Mô hình được căn theo góc tường.

Độ dày tường đo từ ảnh trừ đi bề dày nét bao, rồi làm tròn về chuẩn 100 / 110 / 150 / 200 / 220 / 250 / 300 khi lệch ≤ 12 %.
Với nét bút dạ, độ dày ra hơi mỏng hơn thật: bản vẽ tay ra 180 thay vì 200.
