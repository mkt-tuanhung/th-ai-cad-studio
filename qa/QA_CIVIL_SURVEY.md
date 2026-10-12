# QA — Civil: nhập khảo sát / GIS (mục 3)

Dữ liệu khảo sát thật thay cho ảnh vệ tinh DEMO và trắc dọc tự nhiên mẫu. Mọi thứ chạy cục bộ trong giao diện (không dịch vụ ngoài, không AI). Khi chưa nhập, màn Civil giữ nguyên như mockup đã duyệt (ảnh DEMO có nhãn).

## Định dạng nhập

| Định dạng | Đọc gì |
|---|---|
| CSV / TXT | PNEZD, PENZD, NEZ, ENZ… — tự nhận dấu phân cách, dòng tiêu đề, thứ tự cột (từ tiêu đề hoặc giá trị), dấu phẩy thập phân; tiêu đề X/Y kiểu trắc địa VN-2000 (X = Bắc) được nhận theo giá trị; đơn vị m / ft / US ft |
| LandXML 1.x | CgPoints, Surface (Pnts + Faces: giữ nguyên TIN của đơn vị khảo sát), Alignment (đoạn thẳng, cung tròn; clothoid lấy dây cung — có ghi chú); đơn vị theo `<Units>` |
| GeoJSON | Point/MultiPoint có z hoặc thuộc tính cao độ, đường 3D làm điểm địa hình, LineString 2D làm tuyến; WGS84 → UTM (múi tự xác định) |
| Shapefile | .shp + .dbf + .prj chọn cùng lúc: PointZ / MultiPointZ / PolyLineZ, hoặc hình học 2D + trường cao độ trong .dbf; .prj địa lý → UTM; tệp chỉ có tuyến → dùng làm tim tuyến |
| DXF | POINT, block điểm đo có Z, POLYLINE 3D, LWPOLYLINE có cao độ (đường đồng mức), 3DFACE, LINE có Z; polyline 2D trên lớp tuyến/tim (C-ALIGN, TIM, TUYEN…) làm tuyến; cao độ chỉ ghi bằng chữ thì không đọc (có cảnh báo) |

## Xử lý

- Bề mặt TIN: Delaunay (thư viện `delaunator`, ISC, miễn phí) hoặc tam giác của LandXML; cắt tam giác biên dài (mặc định 4 × cạnh trung vị, sửa được); tra cao độ bằng lưới chỉ mục.
- Đường đồng mức: nội suy trên tam giác, nối thành polyline, đường cái mỗi 5 khoảng (có nhãn).
- Tuyến: lấy từ tệp, tệp tuyến riêng, hoặc vẽ trên mặt bằng (bấm điểm, bấm đúp / Enter để xong, Esc huỷ).
- Mặt đất tự nhiên dọc tuyến lấy mẫu mỗi 20 m từ TIN → trắc dọc, mặt cắt, khối lượng. Mặt cắt ngang vẽ đường mặt đất thật cắt từ TIN; **khối lượng đào/đắp tính theo mặt cắt khảo sát** (tích phân giữa mặt đất và mặt cắt thiết kế: lòng kênh, cơ 3 m, mái đắp ngoài), trung bình hai mặt cắt mỗi 20 m.
- Tuyến mới dài khác → trắc dọc thiết kế và vị trí cống co giãn theo tỉ lệ, có thông báo để rà lại độ dốc (kiểm tra độ dốc tự đánh dấu).
- Mỗi lần nhập / vẽ tuyến / gỡ là một bước hoàn tác (⌘Z).
- Xuất: điểm CSV (PNEZD), đường đồng mức DXF R12 (lớp C-TOPO-MINR / MAJR, có cao độ), bề mặt + tuyến LandXML 1.2 (nhập lại được).

## Kiểm thử

Dữ liệu thử là **dữ liệu tổng hợp** (`qa/fixtures/civil/*_SYNTHETIC.*`, sinh bằng `ui/tools/make-survey-fixtures.mjs`) — không phải khảo sát thật: trắc dọc mẫu dọc một tuyến cong ở UTM 48N, dốc ngang 0,6 %, nhiễu ±3 cm, 1 404 điểm.

| Kiểm tra | Kết quả |
|---|---|
| Đọc 5 định dạng (`tools/test-survey.mjs`, Chromium) | CSV, LandXML, GeoJSON, DXF, Shapefile cho cùng bề mặt: 1 404 điểm, 2 734 tam giác, 8,48 ha, 6,325 … 8,434 m |
| Mặt đất dọc tuyến so với trắc dọc gốc | sai số lớn nhất 0,031 m (= biên độ nhiễu) |
| GeoJSON / Shapefile WGS84 → UTM 48N | trùng toạ độ với bản CSV (cùng diện tích, cùng chiều dài tuyến 619,99 m) |
| Khối lượng (cùng dữ liệu) | mặt đất ngang tại tim: đào 8 011 / đắp 396 m³; theo mặt cắt khảo sát: đào 8 065 / đắp 376 m³ (+0,7 % / −5 %, đúng chiều dốc ngang) |
| `tools/smoke-survey.mjs` | 12/12 — nhập CSV/LandXML/GeoJSON/DXF/Shapefile, bảng xem trước, panel bề mặt, xuất 3 loại và nhập lại LandXML, vẽ tuyến, hoàn tác, tệp lỗi bị từ chối rõ ràng, gỡ khảo sát |
| Tải nặng: 100 000 điểm (3,5 MB) | đọc 0,1 s, TIN 0,37 s (199 495 tam giác), đường đồng mức 0,11 s; nhập + vẽ ~1,1 s; zoom/kéo ~50 ms/khung (ảnh đệm, vẽ lại đầy đủ khi dừng) — `civil_survey_100k.png` |
| App desktop (Qt WebEngine) | mặt bằng khảo sát vẽ đúng — `native_civil_survey.png` |
| Smoke toàn app | 13 bộ, không lỗi (civil 12/12 giữ nguyên mockup khi chưa nhập) |

Ảnh: `civil_survey_plan.png` (mặt bằng TIN + đồng mức + tuyến + cống + mặt cắt, trắc dọc/mặt cắt/khối lượng từ khảo sát), `civil_survey_import_dialog_vi.png`.

## Giới hạn

- Không chuyển đổi giữa các hệ toạ độ phẳng (VN-2000 múi 3° ↔ UTM…): dữ liệu phẳng được dùng nguyên đơn vị mét của tệp; chỉ WGS84 địa lý được chiếu sang UTM.
- Chưa đọc GeoTIFF/ASCII grid (DEM), đường gãy (breakline) và biên (boundary) của LandXML; clothoid lấy dây cung.
- Bộ khảo sát rất lớn có thể vượt dung lượng lưu trữ cục bộ: khi đó tuyến và mặt đất đã lấy mẫu vẫn được lưu, điểm thô phải nhập lại sau khi khởi động (có thông báo).
- Tab 3D của Civil chưa có (bề mặt chưa đưa sang engine OCCT).
