# QA — Dựng mô hình từ bản vẽ CAD (hướng B: nhà → BIM 3D, IFC, Nội thất, CNC)

Ngày: 2026-10-12. Lối vào:
- **BIM → Thêm công cụ → "Dựng từ bản vẽ CAD…"**
- **Nội thất → Thêm công cụ → "Phòng & đồ nội thất từ bản vẽ CAD…"**

Cả hai mở cùng một hộp thoại. Không màn nào đã duyệt bị đổi bố cục: lối vào nằm trong menu thả xuống có sẵn, hộp thoại dùng đúng kiểu của hộp thoại Xếp tấm (Nesting).

## Luồng

1. Chọn một bản vẽ đang mở trong CAD 2D, hoặc bấm **Mở DWG / DXF…**. DWG đi qua bộ đọc LibreDWG kèm app; chữ TCVN3 được chuyển sang Unicode.
2. **Vai trò layer** (tường, cửa đi, cửa sổ, cột, tên/đường bao phòng, nội thất, cầu thang, lưới trục, cao độ, chữ, bỏ qua). Có 4 nguồn:
   - **Tên:** luật theo quy ước đặt tên Việt và Anh (TUONG, CUA, CUA SO, COT, TRUC, NOI THAT, TBVS, KICH THUOC, A-WALL…).
   - **Hình học:** layer có tên lạ nhưng chứa nhiều cặp nét song song cách nhau 60–450 mm thì coi là tường.
   - **AI:** mô hình Qwen chạy trên máy gợi ý vai trò. Đầu ra bị ngữ pháp GBNF giới hạn chỉ được dùng tên layer có thật và danh sách vai trò cố định. Mỗi gợi ý được đánh dấu "AI" để anh xem.
   - **Bạn:** anh tự chọn. Lựa chọn của anh không bao giờ bị AI ghi đè.
3. **Các mặt bằng trong bản vẽ:** hình học tường được gom thành từng cụm theo khoảng cách. Mỗi cụm được đặt tên theo chữ tiêu đề bên dưới, ví dụ "MẶT BẰNG TẦNG 2 +3.900" cho ra tầng "Tầng 2" ở cao độ 3.900. Mặt đứng và mặt cắt được nhận ra và tự bỏ chọn. Tên tầng, cao độ và ô "mặt bằng mái" đều sửa được.
4. **Xem trước:** vẽ chồng lên bản vẽ gốc tường, vách kính, cửa đi, cửa sổ, lỗ mở, cột, phòng (tên + diện tích), nội thất và cảnh báo.
5. **Duyệt & dựng** là **một bước hoàn tác**: thay mô hình BIM, hoặc thêm vào mô hình hiện tại. Nếu tick ô Nội thất thì có thêm một bước hoàn tác bên Nội thất. Quy tắc mô hình kiểm lại trước khi ghi; nếu bị từ chối thì không có gì thay đổi.

## Code đọc hình học (`ui/src/bim/fromCad.ts`, `fromCadBuild.ts`)

- **Tường:**
  - các nét thẳng hàng được gộp thành mặt tường;
  - mỗi đoạn mặt tường ghép với mặt song song **gần nhất ở cả hai phía** (cặp ghép phải hai chiều);
  - nét gần hơn 40 mm thì chặn việc ghép, nên dải mỏng không bị hiểu thành hai tường;
  - bỏ nắp đầu tường (cặp nét qua khe cắt ở cột hoặc lỗ cửa) và bỏ đoạn nằm trong cột;
  - nối góc L lên mặt ngoài, góc T dừng ở mặt tường kia (nối giáp mép, không chồng thể tích);
  - bỏ tường trùng (một tường vẽ thành hai dải song song).
- **Cửa:** là khe giữa hai đoạn của cùng một tường.
  - Phần "đặc" trong khe (tường cắt ngang, cột) được tách ra trước.
  - Phần trống còn lại được xét bằng chứng: nét thuộc layer cửa nằm trong ô cửa, block cửa phủ ≥ 60 % ô cửa, cung mở quay quanh mép khe, nét kính chạy dọc khe.
  - Cửa đi rộng hơn 2,6 m phải có block hoặc cung mở.
  - Khe ≤ 2,5 m không có ký hiệu được dựng thành **lỗ mở**. Khe rộng hơn mà không có ký hiệu thì để hở và có cảnh báo.
  - Block cửa vẽ đè lên tường liền (không cắt tường) cũng được gắn vào tường đó. Block cửa sổ không có tường xung quanh nhưng sâu bằng tường thì thành **vách kính**.
- **Nhãn cửa:** mỗi chữ nhãn (Đ1, D-02, S3, CS1, SD4…) chỉ gắn cho ô cửa gần nhất cùng loại. Chữ kích thước "900x2200" cho chiều cao.
- **Phòng:**
  - Nếu bản vẽ có đường bao phòng (layer phòng) thì dùng đúng diện tích người thiết kế đã vẽ.
  - Nếu không có, code tô loang trên lưới quanh tường, rồi kéo từng cạnh đường bao về đúng mặt tường. Vì vậy với tường thẳng, diện tích là chính xác. Cột nằm trong phòng được trừ ra.
  - Tên phòng lấy từ chữ nằm bên trong; ưu tiên chữ thuộc layer phòng.
- **Sàn:** lấy đường bao ngoài của nhà. Có sàn mái trên tầng cao nhất. Lõi OCCT không còn tự thêm sàn hộp chữ nhật ở tầng đã có sàn vẽ (sửa ở `scene.cpp`).
- **Bản vẽ xoay:** code tìm hướng tường chính rồi xoay vuông bản vẽ trước khi đọc. Mô hình BIM được dựng thẳng trục; bản xem trước xoay lại đúng như bản vẽ.
- **Căn các tầng:** theo giao điểm trục mà mọi mặt bằng cùng có (ví dụ trục 1/A). Nếu không có trục chung thì căn theo góc dưới-trái của tường.
- **Nội thất:**
  - block trên layer nội thất được đo trong hệ toạ độ riêng của block và phân loại theo tên (SOFA, GIUONG, TU_AO, KE_TIVI, TU_BEP, BAN_AN…);
  - chiều cao lấy theo bảng mặc định;
  - tủ áo, kệ, tủ bếp, đảo bếp, tủ giày, tủ thờ thành **tủ tham số** (thân 18 mm). Từ đó ra bảng cắt, xếp tấm và G-code CNC có sẵn trong Nội thất;
  - mỗi tủ là một mục riêng, để bảng cắt đếm đủ số tấm.
- **Phép tính do code làm:** AI không tạo hình học, không tính diện tích, không tính khối lượng.

## Bằng chứng

### 1. Bộ mẫu kiểu văn phòng Việt Nam — `qa/fixtures/bim/house_vn_SYNTHETIC.dxf` (TỰ TẠO)

Tạo bằng `ui/tools/make-plan-fixtures.mjs`. Đáp án nằm ở `house_vn_SYNTHETIC.truth.json`.
- Định dạng: R12.
- Tường ngoài 220 vẽ bằng cặp LINE, cắt tại ô cửa. Tường ngăn 110 là hình chữ nhật vẽ chồng lên tường gặp nó.
- Cửa đi và cửa sổ là block, **cùng một layer "CUA"**. Cột vuông 220 có SOLID.
- Chữ TCVN3 (.VnArial / .VnArialH). Có trục với bong bóng, block nội thất đặt tên tiếng Việt.
- Hai tầng đặt cạnh nhau; kèm một bản sao xoay 30°.

`UNIT=fromcad node tools/test-cam.mjs run` cho **ALL PASS**:

| Tầng | Cửa đi | Cửa sổ | Phòng (m², đáp án tính tay từ mặt trong tường) | Cột | Nội thất | Trục |
|---|---|---|---|---|---|---|
| Tầng 1 ±0.000 | 5/5 | 6/6 | P. khách 24,19 · P. ngủ 1 24,19 · Bếp + ăn 15,60 · WC 5,32 · P. ngủ 2 26,94 (hình chữ L) — **đúng cả 5** | 6/6 | 11/11 | 1,2,3,A,B |
| Tầng 2 +3.600 | 4/4 | 7/7 | **đúng cả 5** | 6/6 | 7/7 | 1,2,3,A,B |

- Bản **xoay 30°** cho kết quả y hệt: cùng số lượng, cùng diện tích, cùng khối lượng tường 81,194 m³.
- 5/5 bộ kiểm tra mô hình BIM đạt.
- Nội thất: 9 món, 4 tủ (kệ TV 10 tấm, tủ áo 1600 có 17 tấm, tủ bếp 12 tấm, tủ áo 1200 có 11 tấm). `validateInterior` không báo lỗi.

### 2. Bộ VILLA_150 (`~/Documents/VILLA_150M2_CAD_TEST`, do AI tạo bằng ezdxf, có đáp án `model_data.json`)

So với đáp án:
- **Tầng 1:**
  - cửa đi 9/9 (8 cửa + 1 cửa thang máy);
  - cửa sổ 7/7, cùng 2 vách kính thông tầng (W01, W02);
  - **14/14 phòng đúng tên và đúng diện tích** (25,42 / 17,63 / 16,81 / 13,53 / 13,3 / 11,5 / 10,24 / 6,72 / 4,8 / 4,2 / 3,24 / 2,8 / 2,2 / 1,6).
- **Tầng 2:**
  - cửa đi 11/11 (gồm 4 cửa lùa SD1–SD4);
  - cửa sổ 7 + 2 vách kính, trên đáp án 9;
  - **12/12 phòng đúng**, cộng thêm 3 ban công và ô thông tầng (không có tên, có cảnh báo).
- **Tầng 3:** cửa đi 10/10, cửa sổ 8/8, **13/13 phòng đúng**, cộng thêm ban công và sân phơi.
- Chưa đúng hoàn toàn:
  - Tầng 2 và 3 có 2–3 "lỗ mở không ký hiệu" (có cảnh báo);
  - phòng thang bộ lấy tên "LÊN / XUỐNG" (mũi tên thang) vì bản vẽ không có chữ tên phòng trong đó;
  - ~~cầu thang chưa dựng~~ **cầu thang chữ U đã dựng** (2026-10-13): 4 vế, 2 chiếu nghỉ, lỗ sàn;
  - mặt bằng mái không có tường nên không dựng; cao độ mái +11.100 được lấy từ tên bản vẽ.

### 3. Trong app desktop — `native/app/resources/e2e_fromcad.js`

Bài này chạy **12/12 PASS** trên bản đóng gói (UI build phát hành):
- **DWG thật** `VILLA_150_MASTER.dwg` được đọc qua LibreDWG; tìm thấy 3 mặt bằng.
- **AI Qwen2.5-7B Q4_K_M chạy trên máy** trả lời trong khoảng 13 giây. AI chỉ đề xuất 1 thay đổi (A-AREA → bỏ qua) và giữ đúng vai trò mọi layer chính. Số lượng nhận diện không đổi.
- Duyệt & dựng: 4 tầng · 77 tường · 35 cửa đi · 22 cửa sổ · 45 phòng · 63 cột · 62 đồ nội thất.
- 3D OCCT: **210 khối, dựng trong 0,4–0,7 giây**. Mặt đứng phía Nam bằng HLR: 146 nét.
- Nội thất: 14 phòng, 12 món, 3 tủ. 3D OCCT 40 khối. Bảng cắt có tủ áo.
- Ảnh: `qa/fromcad/villa150_*.png`.

Cách chạy:

```
qa/tools/rune2e.sh $PWD/native/app/resources/e2e_fromcad.js 420 THCAD_SPLASH=0 \
  THCAD_DWG_SAMPLE=~/Documents/VILLA_150M2_CAD_TEST/01_SOURCE/VILLA_150_MASTER.dwg
qa/tools/rune2e.sh $PWD/qa/tools/reset_qa_profile.js 60   # trả hồ sơ QA về mô hình mẫu
```

**Lưu ý:** script tự khôi phục dữ liệu trong phiên. Tuy vậy Chromium giới hạn tốc độ ghi localStorage lớn xuống đĩa, mà runner lại tắt app ngay. Vì thế **phải chạy `reset_qa_profile.js` trước** `e2e_bimviews`. Đã kiểm: chạy reset xong thì e2e_bimviews đạt 11/11.

### 4. IFC 4 (`tools/check_ifc.py`-style, IfcOpenShell 0.8.4 cài trong venv tạm)

| Mô hình | Lỗi chuẩn IFC4 | Hình học | Ghi chú |
|---|---|---|---|
| house_vn (2 tầng + mái) | **0** | 83/83 dựng được | Sàn 38,88 m³ = 3 × 108 m² × 0,12 m (đúng tuyệt đối); tường 74,08 m³ (đã trừ lỗ cửa) |
| VILLA_150 (3 tầng + mái) | **0** | 308/308 dựng được | 73 IfcWall + 4 IfcCurtainWall, 35 IfcDoor, 22 IfcWindow, 45 IfcSpace |

### 5. Giao diện trình duyệt — `ui/tools/smoke-fromcad.mjs`

Bài này chạy **12/12 PASS**. Kiểm tra:
- đọc vai trò layer theo tên; tìm mặt bằng, tên tầng, cao độ;
- đổi vai trò thì nhận diện lại;
- nút AI bị tắt khi chạy trên trình duyệt (không giả kết quả);
- Duyệt & dựng → đúng số tầng, đúng diện tích; Kiểm tra mô hình đạt;
- Nội thất có bảng cắt và xếp tấm; Hoàn tác trả lại mô hình cũ;
- bản xoay 30°; giao diện tiếng Việt.

Ảnh: `qa/fromcad/fromcad_dialog_{en,vi}.png`, `fromcad_preview_rot30.png`.

**Hồi quy:**
- 21/21 bộ smoke trình duyệt: không có FAIL.
- `ctest`: đạt.
- `e2e_cad` 12/12, `e2e_bimviews` 11/11.
- `tsc --noEmit` sạch. oxlint không có cảnh báo nào ở file mới.
- Self-test trong app (`THCAD_SELFTEST=1`): 16/16, chạy 4 lần liên tiếp đều đạt.
  - Trước khi sửa, có lúc 3 mục CAD bị lỗi chập chờn: máy đang tải nặng, UI nạp lại bản vẽ khôi phục từ IndexedDB sau khi self-test đã bắt đầu.
  - Đã sửa `selftest.js`: chờ đến khi không còn lượt nạp nào trong 1,5 giây rồi mới chạy.
- DMG mới: `native/dist/MD-CAD-AI-STUDIO-0.1.0-macOS-arm64.dmg` (150 MB, ký ad-hoc). Đã kiểm tra trong bundle: có tính năng mới, không lẫn móc QA `__thcad`.

## Giới hạn (nói rõ)

- **Chưa kiểm trên bản vẽ DWG thật do người vẽ.** Hai bộ kiểm thử đều là bản vẽ tự tạo hoặc do AI tạo; đã cố tình làm khác kiểu nhau. Cần file thật của anh để kiểm tiếp.
- **Mái dốc, ô thông tầng trong sàn** chưa dựng từ mặt bằng (có cảnh báo). Cầu thang: chỉ nhận vế thẳng (thang 1 vế, thang chữ U). Thang xoắn, thang cong, thang chữ L có bậc rẻ quạt chưa nhận được; khi đó có cảnh báo "cầu thang chưa dựng".

**Cầu thang** (`findFlights` trong `bim/fromCad.ts`, `stairsFrom` trong `bim/fromCadBuild.ts`), đã có từ 2026-10-13:
- **Vế thang:** các nét bậc trên layer cầu thang (A-STAIR, CAU THANG…), cùng chiều dài 500–2500 mm (= bề rộng vế), cách đều 180–380 mm (= chiều rộng bậc), ít nhất 4 nét. Đường biên cổ thang và mép chiếu nghỉ có chiều dài khác nên bị loại.
- **Chiều lên:** đầu có mũi tên là đầu trên. Nếu không có mũi tên thì đầu có chấm tròn là chân thang. Nét gấp khúc cắt ngang vế là đường cắt của vế bị cắt trên mặt bằng tầng dưới.
- **Ghép các tầng:** mỗi vế vẽ trên nhiều mặt bằng (tầng dưới thấy nửa vế bị cắt, tầng trên thấy đủ), nên các vế được gộp theo vị trí trước. Một tầng có cầu thang khi cả mặt bằng tầng đó và tầng trên đều vẽ thang.
- **Thang chữ U:** hai vế cạnh nhau, đi ngược chiều.
  - Vế 1 là vế có trên mặt bằng thấp nhất.
  - Chiếu nghỉ ở đầu trên vế 1, phủ cả hai vế, sâu tới mặt tường phía sau; không có tường thì sâu bằng bề rộng vế.
  - Vế 2 đi ngược lại lên sàn trên.
- **Chiều cao bậc** = chiều cao tầng / tổng số bậc vẽ, nếu ra 140–200 mm; nếu không thì chia tầng thành các bậc ≤ 175 mm.
- **Ô sàn tầng trên được khoét** lỗ cầu thang. Trong IFC: sàn có lỗ (IfcArbitraryProfileDefWithVoids), chiếu nghỉ là IfcSlab `.LANDING.`.
- **Hình khối 3D:** mỗi vế là một khối bậc + bản thang nghiêng dày 150 mm (OCCT), nên mặt cắt ra giống bản vẽ thật.
- **Lan can cầu thang** (2026-10-13): thép, trụ cách nhau ≤ 1,2 m, tay vịn và thanh giữa song song với mũi bậc.
  - **Thang chữ U:** lan can phía ô giếng là một đường liền, đi lên vế 1, vòng qua chiếu nghỉ, rồi lên vế 2. Cao 900 mm.
  - **Cạnh vế không có tường** (tim tường cách mép vế quá 350 mm): có lan can 900 mm. Cạnh có tường thì không đặt lan can.
  - **Tầng cuối của thang:** lan can chắn cao 1000 mm chạy ngang mép ô thang phía trên vế 1, dừng cách tường 50 mm.
  - **Trong IFC:** là IfcRailing; tay vịn dốc theo vế.
  - **VILLA_150:** 3 lan can — 2 lan can ô giếng (tầng 1→2 và 2→3) và 1 lan can chắn ở tầng 3.
- **Ban công, ô thông tầng** (2026-10-13): xem `QA_AUTO.md`, mục "Mô hình nhà, từ tên phòng".
  - Tường vẽ trên mép ban công là tường lan can cao 1100 mm; tường dài có cửa thì được tách.
  - Ô thông tầng làm sàn có lỗ, có lan can.
  - VILLA_150: 12 đoạn tường lan can; Tầng 2 có ô thông tầng trên P. KHÁCH THÔNG TẦNG.
- **VILLA_150:** 2 thang chữ U (tầng 1→2 và 2→3), 4 vế × 11 bậc. Cao bậc 177 mm và 164 mm, chiếu nghỉ sâu 1200 mm. Kiểm tra mô hình đạt hết.
- **Cao độ bậu và chiều cao cửa sổ:** nếu bản vẽ không ghi kích thước bằng chữ thì dùng giá trị mặc định trong hộp thoại.
- **Thể tích tường:** tường chạy qua cột tính cả phần chồng lên cột. Sai số nhỏ, cỡ 0,25 × 0,2 × chiều cao tầng cho mỗi cột nằm trong khe tường.
- **Tường cong:** cung và polyline cong bị chia thành đoạn thẳng nhỏ, nên tường cong chỉ dựng được gần đúng.
- **Đồ nội thất:** chỉ nhận khi bản vẽ dùng block. Nét vẽ rời không gom thành đồ. Chiều cao là giá trị mặc định theo loại.
- **Hướng A (kênh, đường từ trắc dọc + trắc ngang):** chưa làm, để sau theo thứ tự anh chọn.
