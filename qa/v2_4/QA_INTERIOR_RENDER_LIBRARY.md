# QA — Phối cảnh nội thất photoreal + Thư viện nội thất 3D (v2.4)

Ngày: 2026-10-18 · Nhánh: `worktree-agent-aedc5e2233caa1ccd` · Máy kiểm thử: MacBook Pro M1 Max (Metal), Blender 5.2.2 LTS

## 1. Đã làm gì

### Phần 1 — Phối cảnh nội thất chân thực (Blender Cycles)
| Hạng mục | Trạng thái | Ghi chú |
|---|---|---|
| Thư viện trên đĩa `<app data>/library/` + `library.json` | Đã làm, đã kiểm thử | macOS: `~/Library/Application Support/MD CAD AI STUDIO/library` (nếu thư mục cũ "TH AI CAD Studio" đang dùng cho AI thì nằm cạnh nó — máy này: `~/Library/Application Support/TH AI CAD Studio/library`); Windows: `%LOCALAPPDATA%\MD CAD AI STUDIO\library`. Không nằm trong repo, không nằm trong bộ cài. `THCAD_LIBRARY_DIR` cho QA. |
| Tải bộ mẫu Poly Haven (CC0) trong app | Đã làm, đã chạy thật trên máy này | 60 mẫu đồ nội thất/trang trí, 34 vật liệu PBR, 4 HDRI; mỗi file kiểm tra dung lượng + md5 từ API; tải tiếp được (HTTP Range); chỉ khi người dùng bấm nút. Kết quả: xem §3. |
| Dựng model thật khi render | Đã làm, đã kiểm thử | Mỗi hạng mục: mẫu được gán (asset) hoặc khớp theo nhóm + kích thước gần nhất; co giãn đều để nằm trong W×D×H thật, đặt theo vị trí/góc xoay trên mặt bằng; hộp thay thế bị ẩn. Tủ tham số (có cut list) luôn giữ nguyên tấm ván thật. |
| Vật liệu PBR | Đã làm | Tên vật liệu của app → vật liệu PBR thư viện (chiếu hộp/triplanar theo mét, không cần UV); gạch porcelain và đá marble dùng vật liệu thủ tục (lưới gạch 600, mạch 5 mm; vân đá); sơn tường: màu ấm + nhám nhẹ. |
| Trần, kính, ánh sáng | Đã làm | Khi phòng lấy từ BIM: dùng cả công trình BIM làm vỏ (tường có cửa sổ/cửa đi, kính, sàn tầng trên làm trần; phòng thông tầng thấy sàn 2 tầng trên, không lộ trời). Không có BIM: thêm trần theo chiều cao phòng. Kính cửa sổ cho ánh sáng/bóng đi qua; khung nhôm đen; HDRI + mặt trời; đèn downlight 3000K theo lưới; light portal ở cửa sổ; AgX + tự đo phơi sáng; khử nhiễu OIDN; mặc định 1920×1080. |
| Máy ảnh kiến trúc | Đã làm, đã kiểm thử | Mắt 1,3 m, ống kính 24 mm (phòng nhỏ) / 26 mm tương đương full-frame, máy ảnh cân bằng (dùng lens shift −6 %), tự đặt ở góc/giữa tường nhìn chéo về nhóm đồ chính; "Góc nhìn tự động (phối cảnh)" trong menu Camera của Interior tạo 3 camera "Góc nhìn 1/2/3 – <phòng>" trong Renders. |
| Màn Interior không hiện ảnh DEMO cho dự án thật | Đã làm | Chế độ Realistic: dự án mẫu vẫn hiện ảnh DEMO (có nhãn); dự án thật hiện ảnh render thật mới nhất của phòng, nếu chưa có thì hiện mô hình OCCT trực tiếp. Không đổi layout. |
| Xem trước mesh trong OCCT | Một phần | Mẫu ghép khối ("Tự vẽ" và mẫu tham số) hiện đúng các khối trong 3D trực tiếp. Mẫu GLB/glTF từ file **không** hiện mesh trong OCCT (vẫn là hộp/khối tham số đúng W×D×H) — chỉ hiện trong ảnh render. |

### Phần 2 — Thư viện đồ nội thất người dùng mở rộng được
Mở: **Interior → Space Planning → Thư viện → "Thư viện 3D…"**, hoặc **Cài đặt → AI → Quản lý (Manage) → Thư viện nội thất 3D**.

| Hạng mục | Trạng thái |
|---|---|
| Duyệt / tìm / lọc (loại, nhóm, nguồn), ảnh thu nhỏ, nguồn + giấy phép, "Đặt vào phòng", "Thay mục đang chọn (giữ vị trí)", "Dùng cho mục đang chọn khi render" | Đã làm, đã kiểm thử (e2e) |
| "Thêm từ file": GLB/glTF/OBJ/FBX/STL/.blend → Blender chuyển sang GLB, đo kích thước thật, đoán đơn vị (m/cm/mm), người dùng xác nhận W×D×H, nhóm, tên, vật liệu, **Nguồn/giấy phép (bắt buộc)**, ảnh thu nhỏ | Đã làm, đã kiểm thử OBJ (cm) + GLB (m). DAE: Blender 5 đã bỏ Collada → báo lỗi rõ ràng. FBX/.blend/STL: dùng chung đường importer của Blender nhưng chưa có e2e riêng. |
| "Tải từ mạng": bộ mẫu + tìm trong kho Poly Haven, tải 1 mẫu/vật liệu/HDRI | Đã làm; bộ mẫu đã chạy thật; tải 1 mục đã chạy thật (HDRI studio_garden) |
| "Tự vẽ": ghép khối (hộp, hộp bo góc, trụ), mẫu sẵn (sofa, ghế bành, ghế ăn, bàn trà, bàn ăn, giường, tab, đảo bếp, kệ, tivi, thảm, đèn thả), xem 3D OCCT trực tiếp, lưu vào thư viện; "Từ mục đang chọn" (hạng mục/tủ tham số) | Đã làm; kiểm thử đơn vị (preset đúng kích thước, kiểm tra hợp lệ); lưu qua UI chưa có e2e riêng |
| Sửa / xoá mục của người dùng | Đã làm, xoá đã kiểm thử (e2e) |
| Xuất / nhập thư viện người dùng (.zip) | Đã làm, đã kiểm thử (e2e) — zip không nén (stored); file zip nén từ công cụ khác bị từ chối kèm thông báo. |
| Hàm host C++ (`libraryList/Fetch/Download/Cancel/Put/Remove/Thumbs/Import/Export/ImportZip/Reveal`), đường dẫn bị giới hạn trong thư mục thư viện, chỉ các host Poly Haven (https) | Đã làm, đã kiểm thử (e2e: từ chối `../`, file ngoài thư mục, URL lạ) |

## 2. Cách dùng (từng bước)
1. **Tải thư viện mẫu**: Cài đặt → AI → Quản lý → "Tải thư viện nội thất mẫu (Poly Haven, CC0)" (hoặc trong hộp Thư viện 3D → tab "Tải từ mạng"). Có thanh tiến độ, Tạm dừng, tải tiếp.
2. **Dựng nhà bằng "1 lệnh"** (⌘K → "1 lệnh", thả các file DWG) → Duyệt.
3. **Interior** → menu **Camera** → **"Góc nhìn tự động (phối cảnh)"**: tạo 3 camera kiến trúc cho phòng đang chọn (live view nhảy tới góc 1).
4. **Renders** → chọn camera "Góc nhìn n – <phòng>", engine **Blender Cycles (local)**, 1920×1080 → Render. Đồ nội thất tự thay bằng mẫu thật; ánh sáng/vật liệu tự động.
5. **Đổi mẫu cho một món**: Space Planning → Thư viện 3D → chọn mẫu → "Dùng cho mục đang chọn khi render" (giữ kích thước) hoặc "Thay mục đang chọn (giữ vị trí)" (lấy kích thước thật của mẫu).
6. **Thêm mẫu tải từ internet**: Thư viện 3D → "Thêm từ file" → chọn file → kiểm tra kích thước → nhập tên, nhóm, **nguồn/giấy phép** → Lưu.
7. **Tự vẽ**: Thư viện 3D → "Tự vẽ" → chọn mẫu bắt đầu → sửa các khối → xem 3D → Lưu.
8. **Chuyển sang máy khác**: Thư viện 3D → "Xuất / nhập" → Xuất (.zip) → trên máy kia: Nhập.

## 3. Kết quả kiểm thử (đã chạy thật, 2026-10-18)
| Kiểm thử | Lệnh | Kết quả |
|---|---|---|
| Kiểu TypeScript | `cd ui && npx tsc --noEmit -p tsconfig.app.json` | sạch |
| Đơn vị — thư viện + render nội thất (mới) | `UNIT=library node tools/test-cam.mjs run` | **43/43 PASS** (manifest, chặn đường dẫn, fit kích thước, khớp mẫu, ánh xạ vật liệu, kế hoạch tải Poly Haven, mẫu ghép, hướng đồ từ CAD, dressing/staging, bộ bàn ăn, góc nhìn tự động, 3D trực tiếp của mẫu ghép) |
| Đơn vị — liên quan | `UNIT=render / spaceplan / fromcad / auto / linked / platform` | tất cả ALL PASS |
| Desktop e2e — thư viện (mới) | `native/app/resources/e2e_library.js` (THCAD_LIBRARY_DIR tạm, fixture `qa/v2_4/fixtures/library/`) | **26/26 PASS**: mở hộp thoại từ Space Planning; nhập OBJ đơn vị cm → 400×400×450 mm; bắt buộc giấy phép; nhập GLB đơn vị m → 600×450×550; đặt vào phòng; dressing dùng đúng model; **render Blender ra PNG**; xuất/xoá/nhập zip; từ chối `../`, file ngoài thư mục, URL ngoài Poly Haven |
| Desktop e2e — Blender (chạy A có Blender) | `e2e_blender.js` | 34/34 PASS |
| Desktop e2e — Blender (chạy B: không Blender + giới hạn RAM) | `e2e_blender.js` + `THCAD_BLENDER=none THCAD_RENDER_MEM_LIMIT_MB=1200` | 9/9 PASS |
| Desktop e2e — linked 3D | `e2e_linked3d.js` (bản sao ghi ảnh ra thư mục tạm) | 36/36 PASS |
| Desktop e2e — platform | `e2e_platform.js` | 4/4 PASS |
| Bridge selftest | `THCAD_SELFTEST=1` | 19/19 PASS |
| Offline | `qa/tools/offline-run.sh` | 0 kết nối ra ngoài (47 lần lấy mẫu) — thư viện không dùng mạng khi khởi động |
| SBOM | `node tools/check-sbom.mjs` | ok (không có model/texture/HDRI nào trong bộ cài) |
| 24 bộ smoke trình duyệt | `THCAD_UI=… node tools/smoke*.mjs` | **Không có hồi quy**: so từng bài với bản `main` 9a1b892 (giải nén ra thư mục tạm, cùng máy) → 77 PASS = 77 PASS, 0 bài đổi trạng thái. Lưu ý: trên `main`, phần lớn smoke đã fail **từ trước** vì commit 9a1b892 đổi ngôn ngữ mặc định sang tiếng Việt (smoke ghi `thcad.settings` version 1 → bị migrate sang `vi`, locator tiếng Anh hết hạn). Chạy lại bằng bản sao ghi version 2 (giữ tiếng Anh, không sửa file test): 18 bộ có seed → **toàn bộ PASS** (interior 19/19, interior-plan 17/17, renders 14/14, components 18/18, …); settings 18/20 (2 bài fail giống hệt `main`). |

Ảnh demo (1920×1080, Blender Cycles 256 mẫu + OIDN, Metal GPU M1 Max, ~2–3 phút/ảnh), nhà Villa 150 dựng lại bằng "1 lệnh" từ 3 DWG: `~/Downloads/MD_CAD_DEMO_VILLA150_PHOI_CANH/`
- `01/02_PhongKhach_ThongTang_GocNhin1/2.png`, `03/04_Bep_DaoBep_GocNhin1/2.png`, `05/06_PhongAn_GocNhin1/2.png`, `07/08_PhongNguKhach_GocNhin1/2.png` (+ `.provenance.json` mỗi ảnh).

Thư viện trên máy này: `~/Library/Application Support/TH AI CAD Studio/library/` — **792 MB**, 96 mục (60 mẫu 3D, 34 vật liệu, 4 HDRI — HDRI thứ 4 "studio_garden" tải bằng đường "tải 1 mục").

## 4. Giới hạn (trung thực)
- **Đồ của Poly Haven phần lớn mang phong cách cổ điển/vintage** (sofa da chesterfield, ghế ăn bọc da nút); kho CC0 này gần như không có sofa vải hiện đại, giường hiện đại, tủ bếp. Giường và bàn ăn trong ảnh demo là **mẫu tham số dựng sẵn** (khối bo góc + vật liệu PBR), không phải model quét — nhìn sạch nhưng phẳng (chăn ga không có nếp).
- **Bếp**: bản vẽ chỉ có đảo bếp (không có tủ bếp dọc tường) nên ảnh bếp chỉ có đảo + đồ trang trí; không tự "bịa" tủ bếp.
- **Phòng ngủ** là ảnh yếu nhất: phòng nhỏ 3,3 × 4,1 m, góc nhìn 2 đứng gần đầu giường, tường trống; chao đèn ngủ phát sáng yếu khi có ánh sáng ngày.
- **Trang trí (staging)** — tivi treo tường, thảm, bình gốm/bát gỗ trên bàn, ghế quanh bàn ăn, đèn thả trên đảo, đèn ngủ — chỉ có trong ảnh render (đánh dấu `prop`), **không** vào mô hình, bảng thống kê, BOM hay CNC.
- Hướng đồ nội thất từ khối CAD được suy luận (đồ tựa tường quay lưng vào tường gần, ghế/sofa quay về bàn trà) — có thể sai với bản vẽ đặc biệt.
- Góc nhìn tự động là heuristic (góc phòng/giữa tường, tránh vật cản gần ống kính); người dùng nên xem lại và có thể tự lưu camera khác.
- Xem trước OCCT: model GLB/FBX/OBJ nhập vào **không** hiện mesh trong 3D trực tiếp (chỉ trong render); mẫu ghép khối thì hiện.
- Nhập file: DAE không dùng được với Blender 5.x (Collada đã bị bỏ); FBX/.blend/STL chưa có e2e riêng; đoán đơn vị chỉ xét m/cm/mm (inch không được đoán — người dùng sửa kích thước ở bước xác nhận).
- Zip xuất/nhập là dạng không nén (stored); zip nén từ công cụ khác bị từ chối kèm thông báo.
- 1 mẫu của bộ khởi đầu không tải được: `side_table_tall_01` — file `.bin` trên máy chủ (204 400 B) không khớp dung lượng/md5 Poly Haven công bố (183 536 B) nên bị loại (đúng thiết kế kiểm tra); `decorative_book_set_01` không có bản glTF.
- Kiểm thử chạy trên macOS; bản Windows chỉ được giữ cho biên dịch được (không có lời gọi POSIX), chưa chạy thật trên Windows.
