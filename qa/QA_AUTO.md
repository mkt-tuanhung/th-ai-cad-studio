# QA — "1 lệnh: làm hết từ bản vẽ"

Ngày: 2026-10-13.

Lối vào:
- thanh lệnh **⌘K**, gõ "1 lệnh", "làm hết" hoặc "one command";
- **Dashboard → All Actions → "1 lệnh: làm hết từ bản vẽ…"**.

Đây là một hộp thoại mở thêm. Không đổi bố cục của 12 màn đã duyệt.

## Nhiều file một lúc (2026-10-13)

Chọn hoặc thả **nhiều file cùng lúc**:
- bản vẽ kiến trúc (mặt bằng);
- bản vẽ **kết cấu**: file có tên chứa STRUCT / KẾT CẤU / KC thì được xếp sau;
- tuỳ chọn một file **đơn giá `.csv`** (cột Mã / Hạng mục / Đơn giá). File mẫu "Đơn giá (điền vào).csv" luôn có trong bộ hồ sơ để anh điền.

## Luồng

1. **Chọn bản vẽ.** Thả hoặc chọn file DWG / DXF, hoặc dùng bản vẽ đang mở trong CAD 2D. DWG được đọc qua LibreDWG.
2. **Tự chạy, không hỏi gì** (`ui/src/auto/pipeline.ts`):
   - Vai trò layer: code gán theo tên, dùng luật nhà và luật tuyến.
   - AI cục bộ: Qwen chỉ được hỏi về các layer mà luật không nhận ra (tối đa 40 layer) và chỉ được điền vào các layer đó, không bao giờ đè lên luật tên. AI chạy khi đã có file mô hình; mô hình được nạp ở lần dùng đầu.
   - Nhận diện **nhà**:
     - mặt bằng có ≥ 4 tường và có phòng hoặc ≥ 2 lỗ cửa;
     - **ít nhất một mặt bằng phải có phòng**. Nếu chỉ có các cặp nét song song có khe hở (lớp áo kênh, bó vỉa) thì không coi là nhà.
   - Dựng BIM nhiều tầng (tên và cao độ tầng lấy từ tiêu đề mặt bằng) rồi kiểm tra mô hình. Phần Nội thất lấy tầng có nhiều đồ nhất: phòng, đồ đặt sẵn, tủ tham số.
   - Nhận diện **tuyến**: trắc dọc kèm ≥ 2 trắc ngang. Tuyến có nhiều mặt cắt nhất được chọn trước. Nếu bản vẽ có nhiều tuyến, anh đổi được ở ô "Tuyến".
3. **Xem tóm tắt** gồm:
   - loại bản vẽ (nhà / tuyến / cả hai);
   - số tầng, tường, cửa, phòng, cột, đồ nội thất;
   - phần Nội thất: số tủ, số tấm, số tấm ván, số chương trình CNC;
   - kết quả kiểm tra mô hình;
   - khối lượng đào/đắp so với diện tích trong hồ sơ;
   - danh sách cảnh báo.

   Anh có thể bỏ chọn từng phần: BIM, Nội thất, Tuyến, Ghi bộ hồ sơ.
4. **Duyệt & làm hết.** Mỗi phân hệ (BIM, Nội thất, Civil) nhận **một bước hoàn tác**. Sau đó anh chọn thư mục để ghi bộ hồ sơ. Ứng dụng **không ghi đè** file đã có.

## Bộ hồ sơ (`ui/src/auto/package.ts`, `drawings.ts`, `report.ts`)

**Nhà:**
- `BIM.ifc` (IFC4);
- Walls / Rooms / Doors and windows / Furniture (BIM) `.csv`;
- mặt bằng từng tầng dạng **DXF + DWG**, cùng một file **PDF nhiều trang**. Mặt bằng có:
  - tường tô đặc, ngắt ở chỗ lỗ cửa;
  - cửa đi (2 cánh khi rộng > 1200 mm), cửa sổ, cột;
  - tên phòng + diện tích (chữ tự thu nhỏ cho vừa phòng);
  - đồ nội thất, lưới trục, kích thước tổng;
  - **ký hiệu mặt cắt 1-1, 2-2**: nét đậm ở hai đầu, mũi tên chỉ đúng hướng nhìn, số hiệu;
  - **cầu thang**: vế, nét bậc, mũi tên lên, chiếu nghỉ, lan can.
- **mặt đứng và mặt cắt nhà** (chỉ có trên bản desktop), mỗi bản vẽ dạng DXF + DWG, cùng một file PDF "Mặt đứng + mặt cắt":
  - 4 mặt đứng, **đặt tên theo trục** như bản vẽ VN: "Mặt đứng trục 1-4", "4-1", "A-F", "F-A". Nếu không có lưới trục thì đặt theo hướng (Nam, Bắc, Đông, Tây);
  - **mặt cắt 1-1 qua cầu thang** (như bộ hồ sơ VN): mặt cắt đi dọc theo tim vế 1 của cầu thang thấp nhất, nhìn về phía vế 2. Kết quả: vế 1 bị cắt tô đặc (bậc + bản thang nghiêng), chiếu nghỉ tô đặc, vế 2 thấy phía sau, **lan can dốc theo vế**, sàn tầng trên có lỗ ô thang. **Mặt cắt 2-2** qua giữa nhà theo phương còn lại. Nhà không có cầu thang thì cả hai mặt cắt qua giữa nhà;
  - nét vẽ là nét khuất được khử chính xác bằng lõi OCCT (cùng lõi với BIM → Project Browser); phần bị cắt (tường, sàn) tô đặc;
  - trên bản vẽ có: cao độ từng tầng (tên + cốt), trục kèm bóng số, kích thước tầng và tổng, tên phòng trên mặt cắt;
  - **mặt đứng ghi cốt bậu và cốt đỉnh từng cửa sổ nhìn thấy** (cửa sổ khuất sau tường gần hơn thì không ghi);
  - khổ A3 tỉ lệ 1:100; nếu công trình lớn không vừa thì tự lên 1:125, 1:150…
- **Bảng khối lượng** (CSV + PDF/DXF/DWG), mỗi tầng một cột, có cột tổng (`bim/quantities.ts`):
  - **BTCT:** sàn (đã trừ lỗ ô thang, ô thông tầng), sàn mái, chiếu nghỉ, cột, bản thang + bậc;
  - **xây:** theo bề dày tường — diện tích đã trừ cửa, và khối xây;
  - **hoàn thiện:** trát và sơn, tách mặt trong / mặt ngoài. Tường nằm trên chu vi sàn có một mặt ngoài; tường lan can ban công có hai mặt ngoài;
  - **lát nền:** theo diện tích phòng, không tính ô thông tầng;
  - **cửa:** số lượng và diện tích cửa đi, cửa sổ; diện tích vách kính;
  - **lan can:** chiều dài, đo dọc theo độ dốc.
- **Bảng thống kê cửa** (PDF/DXF/DWG): mỗi dòng là một ký hiệu + kích thước, kèm tầng và số lượng.
- **Khung tên** ghi tên công trình (tên file bản vẽ) và tên tờ.

**Nội thất — cả nhà, mọi tầng có phòng** (phân hệ Nội thất vẫn mở một tầng, tầng có nhiều đồ nhất):
- Interior furniture `.csv` (có cột tầng);
- Cut list `.csv`;
- Part labels `.csv`;
- Nesting `.dxf`;
- **chương trình CNC `.nc`** cho mỗi tấm ván và mỗi dao: T1 cắt biên, T2 khoan lỗ chốt kệ, T3 khoét bản lề. Khi có nhiều tầng, tên tủ ghi kèm tầng ("Tầng 2 · Tủ áo").

**Kết cấu — từ bản vẽ kết cấu** (`bim/structure.ts`):
- **Đọc mặt bằng móng:** đài móng (tên "M3 (2 cọc)", đếm cọc vẽ trong đài và đối chiếu với số ghi), cọc, giằng móng "GM 250×450". Đỉnh và đáy đài lấy theo chữ "ĐỈNH ĐÀI −0.950" / "ĐÁY ĐÀI −1.600".
- **Đọc mặt bằng kết cấu sàn từng tầng:**
  - dầm: hai nét song song, kích thước theo ký hiệu "D2-1 220x300"; dầm không có ký hiệu lấy chiều cao của dầm cùng bề rộng, có đánh dấu;
  - lỗ sàn: hình gạch chéo; chiều dày sàn "h=120"; cao độ KC theo tên bản vẽ.
- **Đặt vào mô hình** theo giao trục 1/A.
- **Kết quả:**
  - dầm, đài, giằng được dựng 3D, có trong IFC (IfcBeam, IfcFooting) và hiện trên mặt cắt;
  - bản vẽ **mặt bằng móng** và **mặt bằng dầm từng tầng** nằm trong bộ hồ sơ;
  - bảng khối lượng có thêm móng, dầm, **ván khuôn**, **cốt thép ước tính**.
- **Dự toán:** khi có file đơn giá thì làm thêm "Dự toán" (CSV + PDF): khối lượng × đơn giá, có tổng.

**Cầu thang, mái** (bổ sung 2026-10-13):
- **Thang chữ L:** hai vế vuông góc, chiếu nghỉ vuông ở góc.
- **Bậc rẻ quạt:** dựng thành chiếu nghỉ, có cảnh báo.
- **Thang xoắn:** nét bậc toả ra từ tâm. Dựng 3D bậc hình quạt quanh cột giữa, có lan can vòng theo bậc; IFC .SPIRAL_STAIR.
- **Mái dốc:** đọc từ "MẶT BẰNG MÁI", độ dốc ghi bằng "i = 35%" hoặc "30°".
  - **4 mái hay 2 mái** nhận theo chữ ghi, hoặc theo nét bờ nóc chạy hết chiều dài;
  - dựng 3D, IFC (IfcRoof), hiện trên mặt đứng; có bản vẽ **mặt bằng mái**; bảng khối lượng có diện tích lợp, bờ nóc, bờ chảy, tường thu hồi;
  - độ dốc dưới 5° (dốc thoát nước "i=2%") là mái bằng, không dựng mái dốc.

**Mô hình nhà, từ tên phòng** (`balconiesAndVoids` trong `bim/fromCadBuild.ts`):
- **Ban công, lô gia, sân thượng, sân phơi:**
  - phần nằm ngoài chu vi nhà có sàn riêng;
  - tường vẽ trên mép ngoài là **tường lan can cao 1100 mm**, không phải cao cả tầng. Tường chạy dài qua chỗ có cửa thì được tách: chỉ đoạn dọc ban công thành lan can, đoạn có cửa vẫn cao cả tầng;
  - mép hở không có tường thì đặt lan can thép cao 1100 mm.
- **Ô thông tầng:**
  - nhận khi phòng tầng dưới có tên "… THÔNG TẦNG" và tầng trên có phòng chồng lên nó, hoặc khi phòng được đặt tên đúng là "Ô thông tầng" / "giếng trời";
  - sàn được khoét lỗ, mép hở có lan can cao 1000 mm;
  - không tính lát nền, không đưa vào Nội thất.

**Ban công / ô thông tầng không có tên** (bổ sung):
- phòng nằm ngoài chu vi sàn, ở tầng trên tầng 1, là ban công;
- phòng có dấu gạch chéo (hai đường chéo nối góc) là ô thông tầng.

**Tuyến — mọi tuyến trong bản vẽ** (phân hệ Civil mở tuyến được chọn; các file mang tên tuyến khi có nhiều tuyến):
- Earthwork (theo 100 m) / Cross sections / Long profile `.csv`. File Earthwork có thêm cột **đào/đắp bằng máy và thủ công** (mặc định 90 % / 10 %, ghi rõ trong tên cột) và dòng tổng;
- **trắc dọc** dạng DXF + DWG. Bản vẽ phóng đại tỉ lệ đứng, có tên từng đường và bảng cọc;
- **trắc ngang** 6 mặt cắt mỗi tờ A3, dạng DXF + DWG;
- một file PDF gộp trắc dọc và trắc ngang.

**Báo cáo:** `… - MD CAD AI STUDIO - Report.html`.

**Chữ trên bản vẽ tuyến** theo ngôn ngữ giao diện (Anh / Việt). **Ngày ở khung tên** lấy theo giờ máy, không theo giờ UTC.

**Trình duyệt thường** (không có ứng dụng desktop): bộ hồ sơ tải về là một file ZIP. Bản vẽ ở dạng SVG. PDF, DWG, mặt đứng và mặt cắt chỉ có trên bản desktop; hộp thoại có ghi rõ điều này.

## Kết quả kiểm thử

| Bản vẽ | Kết quả |
|---|---|
| `house_vn_SYNTHETIC.dxf` (smoke-auto, trình duyệt) | Building · 3 tầng · 18 tường · 9 cửa đi · 13 cửa sổ · 10 phòng · 12 cột · 18 đồ. Nội thất Tầng 1: 5 phòng, 4 tủ. Kiểm tra mô hình đạt hết. ZIP có IFC4, DXF mặt bằng chứa A-WALL, CSV, G-code, báo cáo. |
| `canal_route_SYNTHETIC.dxf` (smoke-auto) | Route · 4 mặt cắt · 150 m · đào 650 m³ · đắp 741 m³. |
| `VILLA_150_MASTER.dwg` (e2e_auto, desktop, LibreDWG) | Building · 4 tầng · 77 tường · 35 cửa đi · 22 cửa sổ · 45 phòng · 63 cột · 62 đồ. Nội thất Tầng 1: 14 phòng · 12 món · 3 tủ → 39 tấm trên 9 tấm ván · 19 chương trình CNC. Kiểm tra mô hình đạt hết. **4 vế thang (2 thang chữ U) · 3 lan can**. **4 mặt đứng (trục 1-4, 4-1, A-F, F-A) · 2 mặt cắt (1-1 qua cầu thang, 2-2)**, OCCT mất 12 s; toàn bộ chạy 13 s. **12 đoạn tường lan can ban công / sân thượng** (1100 mm; tường sau ban công có cửa được tách). **Ô thông tầng** trên P. KHÁCH THÔNG TẦNG: sàn Tầng 2 có lỗ. **Nội thất cả nhà:** 3 tầng, 11 tủ → 152 tấm trên 35 tấm ván · 66 chương trình CNC. **Bảng khối lượng** 22 hạng mục, ví dụ: sàn 51,79 m³, cột 14,57 m³, thang 1,16 m³, xây tường 200 là 90,91 m³, lát nền 397,92 m², lan can 14,51 m. **Bảng thống kê cửa** 2 tờ. Mặt đứng có cốt cửa sổ. **105 file, 0 lỗi.** |
| **VILLA_150_MASTER.dwg + VILLA_150_STRUCTURE.dwg + đơn giá thử** (e2e_auto, nhiều file) | Kết cấu: **20 đài móng · 46 cọc · 32 giằng · 109 dầm** (kích thước theo ký hiệu), thêm 2 lỗ sàn (giếng thang máy, ô thoáng mái). Lỗ ô thang và ô thông tầng đọc từ bản kết cấu **trùng khớp** với lỗ mà phần kiến trúc tự suy ra. Số cọc của cả 20 đài khớp với số ghi. Bảng khối lượng có móng, dầm 21,97 m³, ván khuôn, cốt thép ước tính. Dự toán: 6 / 38 hạng mục có giá (file giá thử). IFC: 141 IfcBeam, 20 IfcFooting, 0 lỗi. **125 file, 0 lỗi.** |
| `house_vn_SYNTHETIC.dxf + roof_hip_SYNTHETIC.dxf` | Mái 4 mái 19° (i = 35 %), 138 m² lợp = 13 × 10 m / cos 19,3°. Mặt đứng có mái; có mặt bằng mái; IFC IfcRoof 0 lỗi. **74 file, 0 lỗi.** |
| Kênh Đức Phong (DWG thật, e2e_auto) | **Cả 2 tuyến** trong hồ sơ: Đức Phong 1 (33 mặt cắt · 1.600 m · đào 6.161 m³ · đắp 4.324 m³, lệch so với hồ sơ −0,04 % / +0,44 %) và Đức Phong 3 (27 mặt cắt · 1.350 m · đào 6.000 m³ · đắp 6.901 m³). **35 file, 0 lỗi.** |

**Kiểm tra file đầu ra:**
- **IFC:** IfcOpenShell đọc được — 4 IfcBuildingStorey · 73 IfcWall + 4 IfcCurtainWall · 35 IfcDoor · 22 IfcWindow · 45 IfcSpace · 63 IfcColumn · 4 IfcSlab · 62 IfcFurniture.
- **PDF:**
  - mặt bằng 3 trang (3 tầng có tường);
  - mặt đứng + mặt cắt 6 trang, tỉ lệ 1:100;
  - tuyến 7 trang (1 trắc dọc + 6 tờ trắc ngang).

  Đã xem từng trang dạng ảnh.
- **DWG** (AC1015): đọc ngược bằng `dwg2dxf` của LibreDWG, số đối tượng khớp đúng với file DXF cùng tên. Cụ thể: mặt bằng 216, trắc dọc 270, trắc ngang 45, mặt đứng A-F 257, mặt cắt 1-1 257.
- **G-code:** đầu file có ghi chú gốc toạ độ / dao / chiều sâu. Ví dụ tấm MFC 18 #1 T1 có 208 lệnh G1.

**Lỗi tìm ra và đã sửa trong lúc kiểm thử (đợt 2026-10-13 chiều):**
- Dốc thoát nước "i=2%" của mái bằng VILLA bị nhận thành mái 4 mái 1°. Giờ dưới 5° coi là mái bằng.
- Hàm chuẩn hoá chữ bỏ cả dấu "=", "%", "(" nên không đọc được "i = 35%", "(2 cọc)", "H=700". Đã sửa.
- Kiểm thử desktop chập chờn ở bước ⌘K: cửa sổ app không được focus nên ô tìm kiếm không mở. Kịch bản giờ gửi sự kiện focus.
- Một phiên Claude khác (dự án khác) đang chạy Vite ở cổng 5173. Các bộ smoke giờ đọc địa chỉ từ biến `THCAD_UI`.

**Lỗi tìm ra và đã sửa trong lúc kiểm thử:**
- Tên chương trình CNC bị lặp tên job ("sample - CNC sample - …").
- AI bị coi là "chưa nạp" khi mô hình chưa được nạp lần đầu. Giờ chỉ cần có file mô hình là đủ.
- Bản vẽ kênh bị nhận nhầm thành "nhà + tuyến" (49 "tường", 0 phòng). Đã thêm điều kiện ít nhất một mặt bằng phải có phòng.
- Khung tên hiện đuôi ".dwg" và ngày theo giờ UTC.
- Trắc dọc lẫn chữ Anh và Việt, thiếu tên các đường.
- Mặt cắt: tên phòng dài chồng lên nhau. Giờ số phòng nằm trên, tên phòng nằm dưới, chữ tự thu nhỏ cho vừa bề rộng phòng (sửa luôn cho BIM → Project Browser).
- Bản vẽ mặt đứng / mặt cắt BIM luôn mang tên mẫu "Villa Riverside - …" ở khung tên. Bộ 1 lệnh giờ dùng tên bản vẽ thật.

Ảnh mẫu đầu ra (VILLA_150): `qa/fromcad/auto_plan_cuts.png`, `auto_elevation_A-F.png`, `auto_section_1-1.png` (mặt cắt qua cầu thang), `auto_section_stair_zoom.png` (phóng to phần thang), `auto_boq.png` (bảng khối lượng), `auto_door_schedule.png` (bảng thống kê cửa). Kết cấu và mái: `auto_foundation_plan.png`, `auto_beam_plan_T2.png`, `auto_roof_elevation.png`.

## Cách chạy lại

```bash
cd ui && node tools/smoke-auto.mjs
```

Kiểm thử desktop:

```bash
qa/tools/rune2e.sh native/app/resources/e2e_auto.js 600 THCAD_UI_URL=http://127.0.0.1:5173 THCAD_SPLASH=0 "THCAD_DWG_SAMPLE=<kiến trúc.dwg>|<kết cấu.dwg>|<đơn giá.csv>" THCAD_PICK_DIR=<thư mục trống>
```

Sau khi chạy kiểm thử desktop, chạy `qa/tools/reset_qa_profile.js` trước `e2e_bimviews`. Lý do: Chromium ghi localStorage chậm.

Ghi chú: e2e lấy file qua `host.qaSampleFile(i)` (chỉ có ở chế độ QA), nên file mang đúng tên gốc. Bộ smoke chạy được trên Vite ở cổng khác: `THCAD_UI=http://127.0.0.1:5174 node tools/smoke-auto.mjs`.

## Chưa làm / giới hạn

- **Chưa thử trên bản vẽ nhà do người thật vẽ.** Bộ VILLA_150 (kiến trúc + kết cấu) do AI tạo; bộ SYNTHETIC do code tạo. Cần file thật của anh.
- **Bảng khối lượng / dự toán:**
  - cốt thép là **ước tính theo hàm lượng** (kg/m³ ghi trên từng dòng), chưa phải bóc từ bảng thống kê thép;
  - cọc mới đếm số cây, vì chiều dài cọc không có trên bản vẽ;
  - đơn giá: phần mềm không có sẵn giá, anh điền vào file "Đơn giá (điền vào).csv" rồi chọn file đó cùng bản vẽ;
  - tường tính cả phần chồng lên cột và dầm; sàn tầng 1 tính như sàn BTCT, ván khuôn chỉ tính phần thành.
- **Kết cấu:** chỉ đọc mặt bằng móng và mặt bằng dầm (đài, giằng, dầm, lỗ sàn, chiều dày sàn). Chưa đọc mặt cắt dầm, chi tiết thép, cột thay đổi tiết diện theo tầng.
- **Cầu thang:**
  - bậc rẻ quạt dựng thành chiếu nghỉ, có cảnh báo;
  - thang xoắn: số bậc tính theo chiều cao tầng (≤ 180 mm), góc quay kéo dài theo số bậc đó;
  - mặt cắt 1-1 chỉ đi qua thang vế thẳng.
- **Mái dốc:** dựng theo hình chữ nhật bao ngoài (mái chữ L dựng gần đúng, có cảnh báo); chỉ có mái 4 mái và 2 mái; mái phải có độ dốc ghi trên bản vẽ.
- **Ban công, ô thông tầng:** nhận theo tên phòng, theo vị trí ngoài chu vi nhà, hoặc theo dấu gạch chéo ô thông tầng. Ban công nằm trong chu vi nhà mà không có tên thì chưa nhận được.
- **Nội thất:** phân hệ Nội thất chỉ mở một tầng; bảng cắt / CNC thì đủ mọi tầng.
- **Tuyến:** tách đào/đắp máy và thủ công theo **tỷ lệ** (mặc định 90/10, sửa bằng dòng `machineShare` trong bảng đơn giá), chưa tính theo hình học mặt cắt. Chưa ghép với toạ độ tuyến.
- **CNC:** G-code theo cấu hình máy trong Interior → Nesting. **Phải chạy thử không phôi** trước khi cắt thật.
