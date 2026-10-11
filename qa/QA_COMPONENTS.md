# QA — Màn 07: Components Library (Pixel-Lock v2)

- **Ngày:** 2026-10-11.
- **Chuẩn so sánh:** `../TH_AI_CAD_Studio_UI_LOCK_v2/mockups/07_Components.png` (1586 × 992).

## Ảnh

Mọi ảnh nằm trong `qa/v2/07_components/`.

| | Tệp |
|---|---|
| Mockup và app đặt cạnh nhau | `side_by_side.png` (bản gốc của mockup: `mockup.png`) |
| Overlay, anaglyph, difference | `overlay_50_50.png`, `overlay_anaglyph.png`, `difference_amplified.png`, `reference_85_actual_15.png`. MAE 12.53 |
| EN / VI ở 1586 × 992 | `app_en.png`, `app_vi.png` |
| Kích thước khác | `app_en_1440x900.png` và `app_vi_1440x900.png` (lưới 3 cột, panel 352 px); `app_en_1920x1080.png` (lưới 6 cột) |

## Đo bbox 66 phần tử (`ui/tools/regions_components.json` → `qa/v2/07_components/inkbox.txt`)

Bảng dưới tính độ lệch vị trí (dx, dy).

| Lệch tối đa | Số phần tử |
|---|---|
| 0 px | 11 |
| 1 px | 23 |
| 2 px | 22 |
| 3–5 px | 6 |
| 6–10 px | 4 |

- **56/66 phần tử lệch ≤ 2 px; 62/66 lệch ≤ 5 px.**
- 4 phần tử lệch trên 5 px. Cả bốn không phải lỗi bố cục:
  - `tree.all.count`: số thật "156" ngắn hơn "12,580" và căn phải, nên điểm bắt đầu của chữ lệch.
  - `search.ph`: vùng đo lẫn icon kính lúp.
  - `tile.mech.title`: mockup vẽ các thẻ nhóm không đều nhau.
  - `tree.interior.label`: vùng đo lẫn đường viền dưới của thẻ.
- Chiều rộng chữ phần lớn lệch +2 đến +8 px. Chữ trong mockup hẹp hơn Roboto ở cùng chiều cao. Tôi chọn cỡ chữ
  theo chiều rộng để giữ bố cục.

## Nội dung mockup đã sửa cho đúng (giữ bố cục)

| Mockup | App |
|---|---|
| "12,580 items", "Blocks 2,840"… | Số thật của thư viện: 156 cấu kiện dựng sẵn cộng các tệp người dùng tải lên. Các số trên thẻ nhóm, cây danh mục và lưới luôn khớp nhau. Thẻ "Components Library" ở Dashboard giờ cũng hiện số thật này thay cho 12,580 |
| "Family • RFA", tệp `.rfa` / `.dwg` 12.4 MB | App không đọc hay ghi được RFA. Mỗi cấu kiện là hình học tham số, ghi ra **DXF thật**. Dung lượng hiển thị là kích thước thật của tệp DXF (1–3 KB) |
| Associated Files: `Modern_Sofa_3Seater.rfa`, `.dwg`, `Thumbnail.png` | Tệp tạo thật: `Modern_Sofa_3-Seater.dxf`, `Thumbnail.png`, ảnh vật liệu. Bấm ↓ là tải về |
| AI Recommended | AI cục bộ chưa xếp hạng cấu kiện, nên tab này ghi "Not connected" thay vì hiện danh sách giả |
| 3D Preview | Chỉ có ảnh sản phẩm (DEMO), được gắn nhãn "Product render (DEMO)". Cấu kiện không có ảnh thì ghi rõ "no 3D geometry" |
| Manufacturer "Generic" | Giữ nguyên: thư viện dựng sẵn không thuộc hãng nào |

## Chức năng thật

- **Insert** (nút ↓ hoặc nhấp đúp vào thẻ):
  - Mở CAD 2D và chạy lệnh INSERT, có bóng mờ theo con trỏ. Điểm chèn chọn bằng chuột hoặc gõ toạ độ.
  - Block giữ nguyên tên. Nhấp một nét là chọn cả block.
  - Theo đúng Insertion Options:
    - điểm chèn: Center, Bottom left hoặc Bottom center;
    - xoay 0/90/180/270°;
    - Explode after insert;
    - Place on current layer.
  - Theo đúng Layer Mapping: layer (tự tạo nếu chưa có, qua op `addLayer` mới, có cả bên C++), màu, linetype.
  - Một lần chèn là một bước Undo.
- **Upload Component:** nhận DXF (và DWG trong app desktop qua LibreDWG). Tệp được đọc thành hình học thật,
  đưa về gốc toạ độ và lưu vào thư viện. Sau đó cấu kiện chèn được như mọi cấu kiện khác.
- **Bộ lọc:** tìm kiếm theo tên, tag, bộ môn và danh mục, ở cả EN và VI. Ngoài ra có lọc Discipline / File Type /
  Software / Size / Tag, sắp xếp Popular / Name / Newest / Size, nút đảo chiều, xem dạng lưới hoặc danh sách, và Reset.
- **Cây danh mục:** lọc theo nhóm hoặc danh mục, tìm trong cây, thu gọn từng nhánh hoặc cả cây.
- **Yêu thích (★)** và **Recently Used** được lưu lại. Thời gian "Used … ago" là thời gian thật. View all lọc lưới theo danh sách đó.
- **Panel phải:**
  - Preview 2D vẽ bằng chính renderer CAD: mặt đứng và mặt bên có kích thước, hoặc mặt bằng.
  - Tab Details.
  - Tab References: đếm số lần chèn trong các bản vẽ đang mở, có nút mở bản vẽ.
  - Tab Version History.
  - Tham số.
  - Insertion Options: khoá cho tới khi bấm Edit.
- **Menu "…":** xuất catalogue ra JSON.
- **CAD 2D → tab Blocks:** liệt kê các block trong bản vẽ (số lần chèn, số đối tượng, layer). Bấm một dòng là chọn
  mọi lần chèn của block đó. Có liên kết mở Thư viện cấu kiện.
- **VI:** dịch cả tag, loại cấu kiện, bộ môn và ghi chú phiên bản. Tên cấu kiện giữ tiếng Anh vì đó là dữ liệu catalogue, như mockup.

## Tương tác đã kiểm tra (`ui/tools/smoke-components.mjs` — 17/17 đạt)

- Màn mở giống mockup: 7 thẻ, cây danh mục, Sofa được chọn, Preview 2D.
- Số trên thẻ là số thật: tổng các nhóm bằng All, và bằng số thẻ trên lưới.
- Cây danh mục lọc được (Doors). Tìm "light" trong cây thì cây thu hẹp lại.
- Tìm kiếm, lọc theo Discipline MEP, Reset.
- Sắp xếp theo tên (thứ tự số tự nhiên), đảo chiều, dạng danh sách.
- Yêu thích được lưu.
- Chọn thẻ thì panel cập nhật. Các tab Details / Version History / References.
- Insertion Options bị khoá tới khi bấm Edit. Góc xoay được lưu.
- Associated Files tải về một tệp DXF hợp lệ.
- Chèn vào CAD 2D tại toạ độ gõ tay:
  - cả block mang cùng một block id;
  - layer đã có trong bản vẽ;
  - đã xoay 90°;
  - có dòng log.
- Nhấp một nét là chọn cả block. Tab Blocks liệt kê block đó và chọn lại được.
- Recently Used đứng đầu với "Used just now". References đếm được 1 lần chèn.
- Upload một DXF (LINE + CIRCLE) → thêm vào thư viện, được chọn, kích thước 1000 mm.
- Team Shared có dữ liệu. AI Recommended ghi "Not connected". View all lọc theo Recently Used.
- Vật liệu không chèn được: nút bị khoá và có ghi lý do.
- Xuất catalogue JSON đủ số mục.
- Chuyển sang VI thì tiêu đề, thẻ nhóm, tag và loại cấu kiện đều được dịch.
- Không có lỗi console.

Chạy lại các smoke test cũ, không có lỗi hồi quy:
Dashboard 14/14, CAD 2D 21/21, AI 14/14, BIM 16/16, Projects 18/18, Settings 16/16.

## Asset

15 ảnh crop DEMO trong `ui/public/assets/v2/components/` (xem `MANIFEST.md` và `MISSING_PRODUCTION_ASSETS.md`, mục
07-xx). Ngôi sao trong ảnh đã được inpaint. Không dùng ảnh stock. 141 cấu kiện còn lại dùng hình vẽ mặt bằng thật làm ảnh thu nhỏ.

## Còn khác mockup

- Icon trong cây danh mục: icon trong mockup quá nhỏ, không đọc được. App dùng icon lucide theo nghĩa của từng mục (cửa, cửa sổ, sofa, đèn…).
- Hàng thẻ thứ hai trong mockup có ảnh thấp hơn hàng đầu (lỗi khi AI vẽ mockup). App dùng lưới đều 227 px.
- Ở 1920 px lưới có 6 cột chứ không giãn 4 cột, để ảnh không bị kéo méo.
