# QA — Xếp tấm, CNC / G-code, FEA (mục 5)

Tất cả tính trong ứng dụng (TypeScript, không dịch vụ ngoài, miễn phí). Trong trình duyệt và app desktop đều chạy.

## Xếp tấm (Nội thất → Bảng cắt → "Xếp tấm & CNC…", hoặc Thêm công cụ → Xếp tấm)

- MaxRects (nhiều thứ tự sắp × 3 tiêu chí khớp, giữ phương án ít tấm nhất), mỗi vật liệu một khổ tấm (mặc định 2440 × 1830, sửa được), lề xén 10 mm, khe giữa chi tiết = Ø dao + 4 mm, ván vân gỗ giữ hướng thớ (HDF trắng được xoay).
- Bộ kiểm độc lập `verifyNest`: trong vùng xén, đủ khe, không xoay ngược thớ, đúng vật liệu → 0 lỗi.
- Mẫu 3 tủ: 44 chi tiết → 40 chi tiết trên 10 tấm (óc chó × 6 hiệu suất 72 %, sồi × 3 58 %, HDF × 1 44 %); **4 chi tiết lớn hơn khổ tấm** (nóc/đáy tủ TV dài 3164 mm, hậu tủ TV 3180, hậu tủ áo 1980 × 2380) được báo rõ, không giấu — chọn khổ dài hơn hoặc chia chi tiết.
- Dòng tổng của Bảng cắt dùng số tấm xếp thật (thay "ước tính 80 %").

## CNC / G-code

- Khoan: chén bản lề Ø35 × 12,5 trên cánh (2–5 bản lề theo chiều cao), lỗ chốt kệ Ø5 × 12 hệ 32 mm trên hông / vách tủ có kệ. Cắt biên: dao Ø8 cắt thuận (theo chiều kim đồng hồ, M3), góc vuông chính xác (cung G2 quanh góc), nhiều lớp sâu (18 + 0,3 mm vào ván lót), cầu giữ phôi 10 × 2 mm ở lớp cuối, chi tiết nhỏ cắt trước; khoan trước cắt.
- GRBL: mỗi dao một chương trình (GRBL không đổi dao); ISO / Fanuc: một chương trình, đổi dao T… M6. Gốc: góc dưới trái tấm, Z0 = mặt ván.
- **Kiểm chứng độc lập** (`simulate`, đọc lại G-code không dùng dữ liệu CAM): mọi lệnh cắt có F và trục chính quay, không chạy nhanh G0 khi dao dưới Z0, sâu nhất ≤ 18,3 mm, mọi điểm (kể cả cung) trong tấm ± bán kính dao, điểm cuối cung nằm đúng trên đường tròn → 31 chương trình (GRBL + ISO), 0 lỗi; mọi lỗ khoan nằm trong chi tiết của nó.
- Thời gian ước tính (cắt + xuống dao theo F, chạy nhanh 15 m/phút, 20 s mỗi lần đổi dao): toàn bộ ~48 phút.
- Xuất: G-code (ZIP — kiểm bằng `unzip -t`: không lỗi), sơ đồ tấm DXF (lớp SHEET / TRIM / PARTS / DRILL / LABELS), nhãn chi tiết CSV.

## FEA trục bơm (Cơ khí → Kiểm tra bền (FEA))

- Phần tử dầm Timoshenko 2 nút (v, θ), ổ bi là lò xo (mặc định 200 MN/m), hình học lấy từ mô hình 3D (bánh công tác treo, phớt, 2 ổ bi cách nhau Bearing_Center, nửa khớp nối). Tải: trọng lượng bánh công tác + lực hướng tâm thuỷ lực Stepanoff (K = 0,36 khi đóng van, ψ = 1, sửa được) cùng chiều (trường hợp xấu nhất), trọng lượng khớp nối, tự trọng trục; mô-men xoắn từ P / ω. Ứng suất σvm = √(σb² + 3τ²). Trị riêng: Cholesky + Jacobi.
- **Kiểm chứng giải tích** (`tools/test-cam.mjs fea`): dầm tựa đơn tải giữa nhịp δ = PL³/48EI + PL/4κGA → sai 0,000 %, mô-men PL/4 khớp; công-xôn δ = PL³/3EI + PL/κGA → 0,000 %, mô-men gốc PL khớp; tần số riêng 1 dầm tựa đơn so với Euler → −0,22 % (Timoshenko mềm hơn do cắt — đúng chiều), tần số 2 −0,9 %.
- Mẫu bơm (trục Ø40 AISI 1045): σvm 19,8 MPa, hệ số an toàn 15,7; tốc độ tới hạn 1 = 10 264 v/ph (+254 % so với 2 900); **võng tại phớt 63 µm > 50 µm (API 610) ở tải đóng van** → "1 cảnh báo" (trước đây kiểm tra tay báo đạt). Trục Ø55 → đạt. Đây là kết quả tính thật, không chỉnh để "đẹp".
- Ứng suất vòng thân bơm vẫn là tính tay (ghi rõ trong chi tiết).

## Kiểm thử

- `tools/test-cam.mjs` (Node): xếp tấm 0 lỗi, CAM 31 chương trình 0 lỗi, FEA khớp giải tích.
- Smoke: interior 13/13 (thêm xếp tấm + tải ZIP), mechanical 13/13 (thêm FEA, Ø55 đạt), toàn bộ 13 bộ smoke khác 0 lỗi.
- Ảnh: `interior_nesting_cnc_vi.png`, `mech_fea_vi.png`.

## Giới hạn

- Xếp tấm hình chữ nhật (chi tiết tủ); chưa xếp chi tiết hình tự do, chưa tận dụng phần dư giữa các lần.
- CAM: chưa có bù dao G41/G42 phía máy, chưa ramp/helix xuống dao, chưa khoan mặt cạnh (chốt gỗ, cam); lỗ chốt kệ chỉ một mặt vách.
- FEA: dầm một mặt phẳng, trục đường kính đều như mô hình (chưa vai trục / rãnh then / Kt), chưa con quay hồi chuyển, chưa FEA khối 3D cho vỏ bơm (cần bộ chia lưới thể tích).
- Nút "Chuẩn bị CAM" ở Cơ khí (tiện/phay chi tiết cơ khí) chưa có — CAM hiện dành cho ván tủ (router).
