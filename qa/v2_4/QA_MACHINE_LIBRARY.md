# QA — Thư viện máy CNC, tự nhập máy, nghiệm thu tại xưởng

**Ngày:** 2026-10-18. **Nhánh:** `worktree-agent-acc53c56ec3f2961f` (đã `git merge main`).
**Yêu cầu của anh Minh Dũng:** xây một thư viện máy để người dùng chọn máy gần giống hoặc đúng máy đang dùng, hoặc tự điền thông số máy; hệ thống lập xếp tấm / chương trình theo đúng máy đó.

**Kết luận ngắn**
- Đã có **Thư viện máy** (tìm, lọc, thẻ chi tiết, máy tương tự, "Dùng máy này") và **Tự nhập máy** (form đầy đủ, có kiểm tra).
- Máy lấy từ thư viện **luôn thành hồ sơ của người dùng, CHƯA NGHIỆM THU**. Số liệu chỉ là tham khảo catalogue.
- NC sản xuất chỉ mở sau **trình nghiệm thu 6 bước** do chính xưởng làm. Mọi thay đổi đầu / dao / offset / bộ điều khiển / hậu xử lý sau đó lại khoá.
- App **không bao giờ** tự gửi file hay khởi động máy.
- **Chưa có máy thật, chưa chạy không tải thật, chưa cắt mẫu thật.** Toàn bộ kiểm thử bên dưới là kiểm thử phần mềm. Không hạng mục nào được coi là "sẵn sàng đưa xưởng".

## 1. Đã làm gì

| Hạng mục | Trạng thái | File chính |
|---|---|---|
| 1. Mô hình thư viện + giao diện | Đã làm, đã test | `ui/src/cam/library/{types,index,fromTemplate,own}.ts`, `ui/src/screens/cnc/{MachinesDialog,MachineLibrary}.tsx` |
| Script nhập dữ liệu nghiên cứu | Đã làm, đã chạy thử với dữ liệu nghiên cứu (chưa commit dữ liệu đó, xem §5) | `ui/tools/import-machinelib.mjs` → `ui/src/cam/library/data/*.ts` |
| 2. Hậu xử lý theo họ bộ điều khiển | Đã làm, đã test. Tất cả CHƯA NGHIỆM THU | `ui/src/cam/posts/family.ts`, `sawCutList.ts`, `index.ts` |
| DXF cho CAM của hãng (Biesse / Homag / SCM) | Đã làm, đã test | `ui/src/cam/vendorDxf.ts` |
| 3. Máy cưa panel (guillotine) + bộ kiểm tra | Đã làm, đã test | `ui/src/cam/guillotine.ts`, `interiorJob.ts` (nhánh PANEL_SAW), `release.ts` |
| Cụm cưa gắn trên máy phay | Đã làm, đã test. Bị chặn cho tới khi nghiệm thu | `machine.ts` (`sawAggregateBlock`), `gcode.ts` (`straightSawLines`) |
| 4. Thư viện phụ kiện → khoan | Đã làm, đã test | `ui/src/cam/hardware.ts`, `gcode.ts` (`holesOf`), `ui/src/screens/interior/HardwareDialog.tsx` |
| 5. Trình nghiệm thu | Đã làm, đã test (phần mềm) | `ui/src/cam/commissioning.ts`, `ui/src/screens/cnc/CommissioningWizard.tsx` |
| 6. Chuỗi chữ EN + VI | Đã làm | `ui/src/i18n/ws/machlib.ts` (+ mã chặn trong `ws/cnc.ts`) |

Tất cả giao diện mới nằm trong **hộp thoại**: tab trong "Máy & Dao", hộp "Phụ kiện" mở từ Thuộc tính tủ. **Không đổi bố cục 12 màn khoá.**

### 1.1 Thư viện máy (Máy & Dao → tab "Thư viện máy", hoặc nút "Thư viện máy…" cạnh ô chọn máy trong "Xếp tấm & CNC" và CAM Part Studio)
- **Tìm và lọc:** ô tìm (hãng, model, bộ điều khiển…); lọc theo hãng, nước, loại máy, bộ điều khiển, khổ tấm phải đặt vừa (D × R, hai chiều).
- **Thẻ chi tiết**, mọi số đều có đơn vị: hành trình, bàn, trục chính (kW, v/ph, đầu kẹp), ATC, cụm khoan, lưỡi cưa, bộ điều khiển, bộ hậu xử lý tương ứng trong app, định dạng gốc, CAM của hãng, ghi chú.
  - Nguồn: liệt kê dạng chữ (tiêu đề — URL).
  - Nhãn độ tin cậy: số liệu hãng / đại lý / chung theo loại.
  - Dòng cảnh báo: "Số liệu là tham khảo catalogue — hãy đo và xác nhận trên máy của bạn".
  - Bảng ghi chú họ bộ điều khiển. Mục "chưa có trong tài liệu" tô đỏ.
- **Máy tương tự:** cùng loại, rồi cùng bộ điều khiển / loại máy, rồi khổ gần nhất.
- **"Dùng máy này":** `templateToProfile()` tạo hồ sơ của người dùng:
  - đầu máy từ trục chính / cụm khoan / lưỡi cưa, ATC, hành trình, bộ hậu xử lý theo họ bộ điều khiển, mã điều khiển điền sẵn theo ghi chú họ (sửa được);
  - kẹp trống, offset / dao / gốc / Z an toàn để trống, trạng thái **CHƯA NGHIỆM THU**, ghi `provenance` (mã mẫu + nguồn);
  - nhật ký liệt kê những gì phải đo. Nếu mở từ "Xếp tấm & CNC" thì máy được chọn luôn cho lệnh sản xuất.

### 1.2 Tự nhập máy (tab "Tự nhập máy")
- Chọn họ bộ điều khiển, loại máy, mã hồ sơ, rồi nhập form đầy đủ:
  - loại máy, hãng / model, hành trình, bàn;
  - các đầu: loại phay / cụm khoan / cưa / dao cắt; kW, v/ph, đầu kẹp, offset XYZ; dao với Ø và chiều dài đo thực; công việc làm được;
  - mã chọn trục chính, số ổ ATC;
  - họ + model + firmware bộ điều khiển; mã đã kiểm (điền sẵn theo họ, sửa được);
  - đuôi file, cách bù chiều dài dao, mã dừng, cú pháp chú thích;
  - kẹp / vùng cấm, Z an toàn, góc gốc phôi; lưỡi cưa (mạch cưa, cao cắt, dài cắt, hướng, xén biên).
- **Kiểm tra** (`validateOwnProfile`): thiếu hãng / model / hành trình; mã đầu trùng; số dao trùng; mã chọn trục chính hoặc mã dừng không nằm trong mã đã kiểm; thiếu đuôi file… Lưu được rồi vẫn là **CHƯA NGHIỆM THU**.
- Cùng các trường này cũng có trong trình sửa hồ sơ ở tab "Máy của tôi".

### 1.3 Hậu xử lý theo họ bộ điều khiển (tất cả từ lệnh trung gian IR, tất cả CHƯA NGHIỆM THU)

Các post: Syntec, Mach3, FANUC (`%` + `O1000`), SINUMERIK 840D (chế độ ISO dialect), OSAI (G71), RichAuto DSP, Weihong NcStudio, LNC, Beckhoff TwinCAT. Giữ nguyên LinuxCNC / GRBL / ISO / NcStudio-style.

**Quy tắc chung:**
- Chỉ ghi mã nằm trong **dialect ∩ mã đã kiểm của hồ sơ**.
- Mã bắt buộc (đơn vị, G90, G0 / G1, M3 / M5, kết thúc) mà chưa có thì vẫn ghi trong bản xem trước nhưng báo `<POST>_CODE_NOT_DOCUMENTED:<mã>` và **chặn**.
- Mã tuỳ chọn (G17 / G94 / G40 / G49 / G80 / G54) không được phép thì bỏ. Không có G2 / G3 thì cung tròn được viết bằng dây cung G1, sai lệch ≤ 0,01 mm.
- Đơn vị G21 hay G71 theo mã được phép (Syntec / TwinCAT dùng G71). Parser đọc đúng theo đó.

**ATC và bù chiều dài dao:**
- `T M6` chỉ khi có ATC và M6 + T đã kiểm.
- Cách bù chiều dài dao lấy theo hồ sơ (G43 H / bộ điều khiển tự bù khi M6 / set Z từng chương trình). Có ATC mà không khai báo thì **chặn**.

**Chú thích:** chỉ dùng cú pháp mà tài liệu nêu rõ: `( )`, `;`, `//`, `'`, `/* */`. Tài liệu không nêu thì **không ghi chú thích**. Ví dụ RichAuto: không có chú thích. OSAI: dùng `;`, vì `( )` của OSAI là mã ba chữ.

**Đuôi file:** theo hồ sơ hoặc theo họ bộ điều khiển. Không có thì chặn.

**Nhiều đầu:**
- Mã chọn trục chính lấy **chỉ từ hồ sơ** (theo tài liệu máy). Khi đó các đầu chung một chương trình, có một lần dừng kiểm tra dao ở đầu chương trình.
- **Weihong 4-process / nhiều trục chính thiếu mã chọn → CHẶN**, thông báo `WEIHONG_SPINDLE_SELECT_NOT_DOCUMENTED:<các đầu>`.
- RichAuto cũng vậy. Mã kiểu `T1…T4` cũng được nhận.

**RichAuto không ATC:**
- Mỗi dao một chương trình. Không có T / M6 / G43.
- Lệnh dừng chỉ có khi tài liệu nêu.

**Định dạng gốc độc quyền (CIX / BPP / MPR / Xilog):**
- App **không** viết các định dạng này.
- Máy có họ PROPRIETARY không nhận NC (`UNSUPPORTED_OPERATION:PROFILE:VENDOR_CAM_GENERATES_PROGRAM`).
- Thay vào đó có nút **"DXF cho CAM của hãng (ZIP)"**: mỗi chi tiết một DXF, kích thước thành phẩm, mặt A hướng lên.
  - Tên lớp đặt được trong hồ sơ: `OUTLINE`, `DRILL_D{d}_Z{z}`, `HDRILL_…`, `GROOVE_W{w}_Z{z}`, `POCKET_Z{z}`.
  - Kèm README nói rõ: bSolid / woodWOP / Maestro là phần mềm tạo chương trình máy.

**Part Studio:** CAM của Part Studio tự viết text ISO / GRBL. Nếu hồ sơ dùng post theo họ bộ điều khiển thì báo `PART_CAM_POST_NOT_AVAILABLE/<post>` và chặn, chứ không gắn nhãn sai.

### 1.4 Máy cưa panel (PANEL_SAW)

**Xếp tấm guillotine:**
- Thứ tự cắt: xén biên (rạch nằm trong dải xén) → rip theo chiều dài tấm → cắt ngang qua cả dải → cắt lại trong cột (chỉ các chi tiết cùng rộng).
- Mạch cưa lấy từ lưỡi cưa của hồ sơ. Giữ hướng vân. Các tấm giống nhau gộp thành một sơ đồ, cắt theo chồng: số tấm mỗi chồng = ⌊cao cắt / độ dày⌋.

**Bộ kiểm tra `verifyGuillotine`:**
- Chạy lại từng đường cắt trên hình chữ nhật tấm: mỗi đường phải chạy hết mép tới mép của đúng một mảnh hiện có và bỏ đúng mạch cưa.
- Sau đó mỗi chi tiết phải **là** một mảnh còn lại: không chồng nhau, không nằm trong mạch cưa, trong vùng xén, đúng kích thước, đúng vân.

**Đầu ra:**
- Sơ đồ cắt SVG.
- Danh sách cắt CSV và thứ tự đường cắt CSV, định dạng `MDCAD-SAW-CSV-1`, các cột mô tả trong code.
- **Không viết PTX**: dữ liệu nghiên cứu hiện có không mô tả định dạng này. Người dùng nhập danh sách cắt vào phần mềm tối ưu của máy cưa.
- Máy cưa panel **không bao giờ** nhận đường dao phay. Khoan và rãnh được ghi là "làm trên máy khác".

**Thiếu số liệu → chặn:**
- `SAW_KERF_NOT_DEFINED`, `SAW_MAX_CUT_HEIGHT_NOT_DEFINED`, `SAW_CUT_LENGTH_NOT_DEFINED`.
- `SAW_TRIM_LESS_THAN_KERF`, `STOCK_LONGER_THAN_SAW_CUT`, `BOARD_THICKER_THAN_SAW_CUT_HEIGHT`.

**Phát hành:** danh sách cắt chỉ phát hành qua cùng cổng (máy ĐÃ NGHIỆM THU, đã duyệt lệnh…), kèm manifest sha256.

**Cụm cưa trên máy phay:**
- Chỉ cắt đường thẳng mép-tới-mép giữa các chi tiết, dùng mạch cưa của hồ sơ.
- Bị chặn (`SAW_AGGREGATE_NOT_COMMISSIONED`) cho tới khi hồ sơ ĐÃ NGHIỆM THU **và** đã thử cắt cưa có giám sát trong trình nghiệm thu.
- Thiếu hướng lưỡi → `SAW_ORIENTATION_NOT_DEFINED`.

### 1.5 Phụ kiện → khoan

Mở bằng: Thuộc tính tủ → Sản xuất → "Phụ kiện: Chọn…" → hộp thoại. Áp dụng thì thành một bước hoàn tác.

**Chọn sản phẩm và vị trí:**
- Bản lề / ray / liên kết lấy từ thư viện. Hộp thoại hiện số liệu khoan, nguồn và độ tin cậy.
- Các thông số vị trí thuộc về thiết kế: khoảng khoan C, khoảng cách bản lề tới đầu cánh, số bản lề, chiều dài ray, các hàng lỗ ray.

**Quy ước khoan:**
- Hệ 32: lỗ cách mép trước 37 mm, bước 32 mm.
- Chén lấy Ø / sâu từ sản phẩm. Tâm chén cách mép cánh C + Ø/2.
- Lỗ chốt 45 / 9,5 khi sản phẩm có số liệu. Lỗ đế bản lề trên hông: 37 / 32.
- Ray: hai hông đối xứng gương; hông phải nằm ở x = H − h.
- Liên kết cam: chén Ø15 trên nóc / đáy, bu-lông trên hông. Lỗ cạnh nằm ngang được ghi là không gia công (CAM này không viết khoan ngang).

**Kiểm tra (chặn):**
- Lỗ nằm ngoài chi tiết; hai lỗ chồng nhau (kể cả với lỗ chốt kệ).
- Phần ván còn lại dưới lỗ < 1 mm so với **độ dày đo thực** (`HW_THROUGH_HOLE`).
- Độ dày cánh ngoài khoảng của bản lề; C ngoài khoảng của sản phẩm; ray dài quá chiều sâu tủ.

**Thiếu số liệu → chặn, không đoán:**
- `HW_NEEDS_DATA:<sản phẩm>:<trường>`. Nếu catalogue có nhiều giá trị (ví dụ B = 24 | 34) thì `HW_NEEDS_CHOICE`.
- Người dùng nhập giá trị theo dưỡng khoan của hãng ngay trong hộp thoại. Giá trị lưu trên tủ dưới dạng `overrides`; app không tự điền.

**Tương thích ngược:** tủ chưa chọn phụ kiện vẫn dùng mẫu chén cũ (sản phẩm `generic-hinge-35`), NC không đổi. Đã kiểm.

**Các trường hợp khác:**
- Lỗ có Ø khác Ø5 / Ø35 được cấp dao riêng (T4…).
- Máy không có dao đúng Ø → `UNSUPPORTED_OPERATION:…:TOOL_NOT_ON_MACHINE` (chặn). Đây là lỗ hổng cũ đã được bịt: trước đây NC có thể gọi số dao không có trên máy.

### 1.6 Trình nghiệm thu (Máy & Dao → hồ sơ → "Trình nghiệm thu máy")

| Bước | Nội dung |
|---|---|
| 1. Khảo sát | 10 mục theo docs/09: mã máy, an toàn, bộ điều khiển, mã lệnh, trục, hành trình **đo thực**, bàn / kẹp, đầu + offset, dao, phôi. Có số máy và ngày bảo dưỡng. Hồ sơ lấy từ thư viện **bắt buộc** phải có phiếu khảo sát đủ (`SURVEY_MISSING` / `SURVEY_INCOMPLETE`) |
| 2. Số đo | Liệt kê dữ liệu máy còn thiếu (theo `machineBlockers`) và bảng dao đã đo |
| 3. Parser / backplot (tự động) | `automatedChecks()`: post của chính hồ sơ viết tủ thử; parser đọc lại đúng các byte với dialect, mã, ATC, hành trình và kẹp của hồ sơ |
| 4. Chạy không tải | Tải ZIP file chạy không tải `*.AIRCUT_TEST.nc`: **mọi Z nâng lên** để điểm sâu nhất cao hơn mặt ván 20 mm (và cao hơn kẹp); parser kiểm lại. Ghi kết quả, người giám sát, ngày, ghi chú; thử cưa nếu có cụm cưa; kỹ sư duyệt post |
| 5. Mẫu đầu | Bảng số đo so với dung sai (kỹ sư đặt). Hàng nào ngoài dung sai → `FIRST_ARTICLE_OUT_OF_TOLERANCE` |
| 6. Ký | Người vận hành + kỹ sư (họ tên), ngày, **hạn hiệu lực** (mặc định 180 ngày), tài liệu chứng minh |

- Đủ cả 6 bước → `commission()` cho **ĐÃ NGHIỆM THU** có hạn + hash hồ sơ. Lúc đó "Xuất NC sản xuất" mới mở cho hồ sơ này.
- Đổi đầu / dao / offset / bộ điều khiển / post / phần mở rộng (đuôi file, mã chọn trục chính…) → **CHƯA NGHIỆM THU** (logic cũ `reviseProfile`).

## 2. Lệnh đã chạy và kết quả

Chạy trong worktree, sau `git merge main`. Dev server riêng ở cổng 5287, dùng file cấu hình Vite tạm có `server.fs.allow` (không commit).

| Lệnh | Kết quả |
|---|---|
| `cd ui && npx tsc --noEmit -p tsconfig.app.json` | Không lỗi |
| `UNIT=machlib node tools/test-cam.mjs run` | **70/70 PASS** với dữ liệu mẫu. **70/70 PASS** với dữ liệu nghiên cứu đã nhập thử (122 máy, 12 họ, 27 phụ kiện) |
| `UNIT=cnc node tools/test-cam.mjs run` (hồi quy) | ALL PASS |
| `UNIT=cam …` / `UNIT=partcam …` (hồi quy) | ALL PASS |
| `THCAD_UI=http://127.0.0.1:5287 node tools/smoke-interior.mjs` | **19/19 passed** (13 cũ + 6 mới), không lỗi console |
| `… node tools/smoke-part.mjs` | **8/8 passed** (7 cũ + 1 mới) |
| `… smoke-auto.mjs`, `smoke.mjs`, `smoke-mechanical.mjs` (hồi quy) | ALL PASS / pass / 13/13 |
| `npx oxlint` | Không có cảnh báo mới trong file đã sửa (các cảnh báo còn lại có từ trước) |

### Danh sách kiểm thử `machlib` (đều PASS, có assert)
- **Thư viện:** dữ liệu nạp được; lọc theo loại / khổ tấm; máy tương tự; ghi chú họ bộ điều khiển → mã (GRBL không bao giờ có M6 / G43 / chu trình khoan).
- **Mẫu → hồ sơ:**
  - Máy 4-process = 4 đầu phay, không ATC, post Weihong, mã theo họ, CHƯA NGHIỆM THU, chưa đo gì.
  - PTP = cụm khoan 21 đứng + 8 ngang + lưỡi cưa rãnh, không post, có lớp DXF.
  - Máy cưa panel = PANEL_SAW, post `saw_cutlist`, có mạch cưa.
  - Mọi mẫu trong thư viện đều có post hợp lệ hoặc đi đường CAM của hãng.
- **Tự nhập máy:** kiểm tra form.
- **Post (Syntec, Mach3, FANUC, Siemens, OSAI, RichAuto, Weihong, LNC):**
  - Chỉ ghi mã có trong hồ sơ.
  - Khi hồ sơ chỉ có mã trong ghi chú tài liệu thì mọi mã khác cần dùng **đều được báo và chặn**, không bao giờ ghi lặng lẽ.
  - Không có G2 / G3 → dây cung. Thiếu mã đơn vị → chặn.
  - OSAI G71 + chú thích `;`; FANUC `%` / `O1000`; Siemens ISO dialect.
  - OSAI có ATC mà chưa khai báo cách bù dao → chặn.
- **RichAuto không ATC:** không T / M6 / G43, mỗi dao một chương trình.
- **Weihong nhiều trục chính:** không có mã chọn → **CHẶN**. Có M51 / M52 / M53 từ tài liệu → một chương trình, chọn đầu trước mỗi đầu:
  ```
  G21 G90
  (CHECK TOOLS: T2 Drill Ø5 [shelf pins] ON HEAD_2, T3 Forstner Ø35 [hinge cups] ON HEAD_3, T1 End mill Ø8 [profile] ON HEAD_1, ZERO Z, THEN START)
  M52
  S6000 M3
  …
  M53
  …
  M51
  ```
- **Máy cưa panel, chạy trên 3 tủ mẫu:**
  - Kết quả: 10 sơ đồ, 10 tấm, 108 đường cắt, bộ kiểm tra 0 lỗi.
  - 4 chi tiết quá khổ được liệt kê: nóc / đáy tủ TV 3164 và 2 tấm hậu.
  - Không chồng nhau; chi tiết cạnh nhau cách ≥ 4,4 mm. Rip chạy hết tấm đã xén. Giữ vân. Chồng 5 tấm.
  - Không có NC phay.
  - Bộ kiểm tra bắt được: đường cắt không mép-tới-mép, chi tiết lệch vào mạch cưa, sai mạch cưa.
  - Thiếu mạch cưa → chặn. Hồ sơ chưa nghiệm thu → không phát hành.
  - Mẫu thứ tự cắt:
    ```
    Pattern,Cut,Stage,Axis,Position (mm),From (mm),To (mm),Kerf (mm)
    P1,1,trim,H,5.6,0,2440,4.4
    P1,2,trim,H,1820,0,2440,4.4
    P1,3,trim,V,5.6,10,1820,4.4
    P1,4,trim,V,2430,10,1820,4.4
    P1,5,rip,H,805,10,2430,4.4
    ```
- **Phụ kiện:** tủ bếp 2400 × 600 × 850, bản lề kiểu Blum CLIP top (C = 4, cách đầu 100) và ray hệ 32 dài 500, hàng lỗ cao 100 / 300:
  ```
  DOOR hinge-cup    x=100 / 747          y=21.5  Ø35×13
  DOOR hinge-fixing x=77.5 122.5 724.5 769.5  y=31  Ø8×13
  SIDE hinge-plate  x=85.5 117.5 732.5 764.5  y=37  Ø5×13
  SIDE#1 slide      x=100, 300           y=37 / 261 / 453  Ø5×13
  SIDE#2 slide      x=750, 550 (gương)   y=37 / 261 / 453  Ø5×13
  ```
  - Cánh đo 12 mm với chén sâu 13 → `HW_THROUGH_HOLE` (chặn).
  - Sản phẩm thiếu số liệu → `HW_NEEDS_DATA`.
  - C ngoài khoảng → chặn.
  - Lỗ phụ kiện có trong NC: dao Ø8 riêng, chén sâu 13 (không bị cắt bớt).
  - Thiếu dao trên máy → chặn.
  - Liên kết cam: lỗ cạnh không gia công.
  - Tương thích ngược: NC giữ nguyên như cũ.
- **CAM của hãng:** không có NC; DXF có các lớp `DRILL_D35_Z13`, `GROOVE_W6_5_Z8`, tách hông trái / phải.
- **Cụm cưa:** thiếu hướng lưỡi → chặn; chưa nghiệm thu → không cắt. Sau nghiệm thu có thử cưa → chỉ đường thẳng mép-tới-mép giữa các chi tiết.
- **Trình nghiệm thu, toàn bộ đường đi trên một máy TEST lấy từ mẫu Syntec 2131:**
  1. Bước 3 tự động đạt.
  2. File chạy không tải có Z ≥ 20 mm.
  3. Thiếu phiếu khảo sát → không nghiệm thu được. Mẫu đầu ngoài dung sai → FAILED.
  4. Đủ cả 6 bước → ĐÃ NGHIỆM THU đến 2027-04-16.
  5. Lệnh sản xuất → `.nc` (post Syntec) + manifest có sha256 của từng file.
  6. **Đổi Ø dao 8 → 7,98** → CHƯA NGHIỆM THU, xuất sản xuất bị chặn lại.
  7. Đổi đuôi file → khoá lại. Đổi `provenance` → không khoá.
  8. Giả mạo VERIFIED → vẫn chặn.

## 3. Ảnh (qa/v2_4/machlib/, chụp tự động trong smoke-interior)

| File | Nội dung |
|---|---|
| `01_library_detail.png` | Tab Thư viện máy: lọc "Máy cưa panel", thẻ chi tiết, nhãn độ tin cậy, dòng "tham khảo catalogue", máy tương tự |
| `02_panel_saw_patterns.png` | Xếp tấm & CNC với hồ sơ máy cưa panel: sơ đồ cắt guillotine có đánh số đường cắt, không có NC phay, nút phát hành bị khoá |
| `03_wizard_survey.png` | Trình nghiệm thu, bước 1 khảo sát |
| `04_wizard_automated.png` | Bước 3 tự động trên máy mẫu (Parser KHÔNG ĐẠT vì máy mẫu chưa có mã đã kiểm). Ghi biên bản → FAILED với đủ lý do |
| `05_own_machine.png` | Tự nhập máy: form và danh sách lỗi kiểm tra |
| `06_hardware_dialog.png` | Hộp Phụ kiện: bản lề kiểu Blum, C = 4, cách đầu 100 → "Không thấy lỗi", 10 lỗ |
| `07_library_vi.png` | Thư viện máy bằng tiếng Việt |

## 4. Giới hạn đã biết (nói thật)
- Mọi post và mọi hồ sơ đều **CHƯA NGHIỆM THU**. Không post nào đã chạy trên bộ điều khiển thật.
- OSAI ghi `T n M6`. Định dạng `T dao.offset` của OSAI chưa được viết. Phải chọn cách bù chiều dài dao trong hồ sơ, và chạy không tải sẽ cho biết offset có được áp hay không.
- Siemens: ghi chú nghiên cứu nói G43 / H không có ở chế độ Siemens, nên G43 không được điền sẵn. Người dùng phải kiểm G43 trong chế độ ISO dialect và thêm vào mã đã kiểm, hoặc chọn "bộ điều khiển tự bù khi M6".
- Không viết khoan ngang (lỗ cạnh của liên kết) và không viết PTX cho máy cưa. Các mục này được báo rõ.
- Lỗ đế bản lề trên **vách giữa** cần khoan cả hai mặt: chỉ có ghi chú, chưa gia công.
- Không có mô hình va chạm hình học đầu máy (giống báo cáo trước: CNC-029 / CNC-057).
- Cách tách câu trong ghi chú bộ điều khiển là heuristic. Người dùng luôn có thể sửa mã đã kiểm, cú pháp chú thích, đuôi file, cách bù dao trong hồ sơ.
- Ghi chú thêm: file xuất "Export JSON" chứa phần mở rộng `ext`, nằm ngoài schema v2.2. Hàm `schemaProfile()` bỏ phần này khi cần đúng schema.

## 5. Dữ liệu nghiên cứu
- Thư mục `scratchpad/machinelib/` hiện có: `controllers.json`, `hardware.json`, `part_cn.json`, `part_eu.json`, `part_asia_vn.json`, `parts/*.json`.
- **Chưa có `machines.json` và `README.md`.** Tác tử nghiên cứu có vẻ còn đang làm.
- Đã chạy thử `node tools/import-machinelib.mjs <thư mục>`:
  - nhập được 115 máy (+ 7 mẫu chung) / 11 họ bộ điều khiển (+ PROPRIETARY mẫu) / 22 phụ kiện (+ 5 mẫu), không cảnh báo;
  - 70/70 kiểm thử vẫn đạt.
- **Dữ liệu được commit vẫn là bộ mẫu chung.** Khi tác tử nghiên cứu xong, điều phối viên chạy:
  ```
  cd ui && node tools/import-machinelib.mjs /private/tmp/claude-501/-Users-mac-Downloads-TH-AI-CAD-Studio-UI-Handoff-v1/aa7cf3d6-234f-4ab3-89a4-30970fddf811/scratchpad/machinelib
  UNIT=machlib node tools/test-cam.mjs run
  ```
  rồi commit `ui/src/cam/library/data/*.ts`.

## Dữ liệu thật đã nhập (2026-10-18)

`ui/tools/import-machinelib.mjs` đọc thư mục nghiên cứu. Kết quả: **122 mẫu máy**, **12 loại bộ điều khiển**, **27 phụ kiện**, mỗi mục có nguồn và mức tin cậy. `UNIT=machlib` đạt 70/70 trên dữ liệu thật.

- **Máy (122):**
  - Châu Âu: Biesse, HOMAG, Weeke, SCM / Morbidelli / Gabbiani / Accord, Felder Format-4, Holz-Her, Masterwood, Busellato, IMA.
  - Trung Quốc: KDT, Nanxing, Blue Elephant, iGOLDEN, BCAMCNC, STYLECNC, Remax, Excitech, Quick, Jinan SUDIAO.
  - Đài Loan / Nhật: Anderson, Shoda, Heian.
  - Đại lý tại Việt Nam: CabinetMaster / Quốc Duy / SEMAC, Đại Phúc Vinh (Woodmaster, Holztek), Việt Thành (MAS), Vinacomm, CNCMAN.
  - Mẫu tham khảo chung: router 1325 / 1530 / 2130, router 4 công đoạn, máy khoan 6 mặt, máy cưa panel 3800.
- **Bộ điều khiển (12):** Syntec, Weihong NcStudio, RichAuto, Mach3/4, FANUC, SINUMERIK 840D, OSAI, Beckhoff TwinCAT, LNC, LinuxCNC, GRBL, và nhóm "độc quyền". Thông tin lấy từ sổ tay lập trình; mục nào sổ tay không nói rõ thì ghi "not documented" và bắt người dùng tự nhập.
- **Phụ kiện (27):**
  - bản lề Blum CLIP top, Hettich Sensys, Häfele Metalla, Grass Tiomos, Salice;
  - ray Blum TANDEMBOX / MOVENTO / TANDEM, Hettich Atira, Häfele Matrix;
  - liên kết Minifix, Rastex, chốt gỗ, confirmat, chốt kệ;
  - quy chuẩn hệ 32.

**Lưu ý:**
- Catalogue máy cưa panel không ghi bề dày mạch cưa (kerf). Khi chọn máy cưa từ thư viện, app **chưa xếp tấm** cho tới khi nhập kerf đo thực trong Máy & Dao.
- Smoke `smoke-interior` đã cập nhật đúng thao tác này: chọn máy cưa, nhập kerf 4.4 rồi mới xem sơ đồ cắt. Kết quả 19/19.
