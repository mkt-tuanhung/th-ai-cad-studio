# QA — "1 lệnh: làm hết từ bản vẽ"

Ngày: 2026-10-13.

Lối vào:
- thanh lệnh **⌘K**, gõ "1 lệnh", "làm hết" hoặc "one command";
- **Dashboard → All Actions → "1 lệnh: làm hết từ bản vẽ…"**.

Đây là một hộp thoại mở thêm. Không đổi bố cục của 12 màn đã duyệt.

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
  - khổ A3 tỉ lệ 1:100; nếu công trình lớn không vừa thì tự lên 1:125, 1:150…

**Nội thất:**
- Interior furniture `.csv`;
- Cut list `.csv`;
- Part labels `.csv`;
- Nesting `.dxf`;
- **chương trình CNC `.nc`** cho mỗi tấm ván và mỗi dao: T1 cắt biên, T2 khoan lỗ chốt kệ, T3 khoét bản lề.

**Tuyến:**
- Earthwork (theo 100 m) / Cross sections / Long profile `.csv`;
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
| `VILLA_150_MASTER.dwg` (e2e_auto, desktop, LibreDWG) | Building · 4 tầng · 77 tường · 35 cửa đi · 22 cửa sổ · 45 phòng · 63 cột · 62 đồ. Nội thất Tầng 1: 14 phòng · 12 món · 3 tủ → 39 tấm trên 9 tấm ván · 19 chương trình CNC. Kiểm tra mô hình đạt hết. **4 vế thang (2 thang chữ U) · 3 lan can**. **4 mặt đứng (trục 1-4, 4-1, A-F, F-A) · 2 mặt cắt (1-1 qua cầu thang, 2-2)**, OCCT mất 12 s; toàn bộ chạy 13 s. **49 file, 0 lỗi.** |
| Kênh Đức Phong (DWG thật, e2e_auto) | Route trong 43 s (AI phân loại 10/23 layer lạ, mất 38,8 s). Tuyến Đức Phong 1: 33 mặt cắt · 1.600 m · đào 6.161 m³ · đắp 4.324 m³, lệch so với hồ sơ −0,04 % / +0,44 %. **19 file, 0 lỗi.** |

**Kiểm tra file đầu ra:**
- **IFC:** IfcOpenShell đọc được — 4 IfcBuildingStorey · 73 IfcWall + 4 IfcCurtainWall · 35 IfcDoor · 22 IfcWindow · 45 IfcSpace · 63 IfcColumn · 4 IfcSlab · 62 IfcFurniture.
- **PDF:**
  - mặt bằng 3 trang (3 tầng có tường);
  - mặt đứng + mặt cắt 6 trang, tỉ lệ 1:100;
  - tuyến 7 trang (1 trắc dọc + 6 tờ trắc ngang).

  Đã xem từng trang dạng ảnh.
- **DWG** (AC1015): đọc ngược bằng `dwg2dxf` của LibreDWG, số đối tượng khớp đúng với file DXF cùng tên. Cụ thể: mặt bằng 216, trắc dọc 270, trắc ngang 45, mặt đứng A-F 257, mặt cắt 1-1 257.
- **G-code:** đầu file có ghi chú gốc toạ độ / dao / chiều sâu. Ví dụ tấm MFC 18 #1 T1 có 208 lệnh G1.

**Lỗi tìm ra và đã sửa trong lúc kiểm thử:**
- Tên chương trình CNC bị lặp tên job ("sample - CNC sample - …").
- AI bị coi là "chưa nạp" khi mô hình chưa được nạp lần đầu. Giờ chỉ cần có file mô hình là đủ.
- Bản vẽ kênh bị nhận nhầm thành "nhà + tuyến" (49 "tường", 0 phòng). Đã thêm điều kiện ít nhất một mặt bằng phải có phòng.
- Khung tên hiện đuôi ".dwg" và ngày theo giờ UTC.
- Trắc dọc lẫn chữ Anh và Việt, thiếu tên các đường.
- Mặt cắt: tên phòng dài chồng lên nhau. Giờ số phòng nằm trên, tên phòng nằm dưới, chữ tự thu nhỏ cho vừa bề rộng phòng (sửa luôn cho BIM → Project Browser).
- Bản vẽ mặt đứng / mặt cắt BIM luôn mang tên mẫu "Villa Riverside - …" ở khung tên. Bộ 1 lệnh giờ dùng tên bản vẽ thật.

Ảnh mẫu đầu ra (VILLA_150): `qa/fromcad/auto_plan_cuts.png`, `auto_elevation_A-F.png`, `auto_section_1-1.png` (mặt cắt qua cầu thang), `auto_section_stair_zoom.png` (phóng to phần thang).

## Cách chạy lại

```bash
cd ui && node tools/smoke-auto.mjs
```

Kiểm thử desktop:

```bash
qa/tools/rune2e.sh native/app/resources/e2e_auto.js 600 THCAD_UI_URL=http://127.0.0.1:5173 THCAD_SPLASH=0 THCAD_DWG_SAMPLE=<file.dwg> THCAD_PICK_DIR=<thư mục trống>
```

Sau khi chạy kiểm thử desktop, chạy `qa/tools/reset_qa_profile.js` trước `e2e_bimviews`. Lý do: Chromium ghi localStorage chậm.

Ghi chú: trong e2e, file mẫu luôn mang tên `sample.dwg` vì host không truyền tên gốc. Khi anh dùng thật, các file trong bộ hồ sơ mang tên bản vẽ gốc.

## Chưa làm / giới hạn

- **Mặt đứng, mặt cắt:**
  - mặt cắt 2-2 luôn đi qua giữa nhà; chỉ nhận được thang vế thẳng (1 vế, chữ U), chưa nhận thang xoắn hay bậc rẻ quạt;
  - lan can cầu thang tự đặt theo quy tắc: phía ô giếng, cạnh không có tường, và lan can chắn ở tầng cuối. Chiều cao mặc định 900 / 1000 mm, chưa có hộp chọn mẫu lan can (kính, gỗ, song sắt). Trụ đặt cách nhau ≤ 1,2 m, chưa vẽ từng song;
  - chưa ghi cốt cửa sổ, chưa ký hiệu vật liệu mặt ngoài;
  - mặt đứng chỉ đẹp khi mô hình dựng đúng: phần nào máy nhận nhầm trên mặt bằng thì mặt đứng cũng sai theo.
- Chưa có bảng thống kê cửa trên bản vẽ (cửa mới có trong CSV).
- **Nội thất:** chỉ dựng cho một tầng (tầng có nhiều đồ nhất). Tủ là tủ tham số theo loại đồ nhận ra (tủ áo, tủ bếp, kệ TV…), chưa đọc chi tiết cánh và ngăn từ bản vẽ.
- **Tuyến:** chỉ dựng tuyến được chọn. Bộ hồ sơ chưa có trắc dọc các tuyến khác trong cùng bản vẽ.
- **CNC:** G-code theo cấu hình máy trong Interior → Nesting (mặc định chung). **Phải chạy thử không phôi** trước khi cắt thật.
