# MD CAD AI STUDIO — v2.2 P0 INTERIOR PRODUCTION / CNC MACHINE-AWARE CAM

**TRẠNG THÁI:** CHANGE REQUEST TRÊN REPO HIỆN HỮU; KHÔNG REBUILD. **MỤC TIÊU:** sản xuất thật, không dừng ở prototype hay tạo file NC minh họa. Chưa có máy thật được khai báo và nghiệm thu; toàn bộ profile mẫu trong package là `DRAFT_UNVERIFIED`, không được phép xuất G-code phát hành sản xuất.

## 0. Mệnh lệnh thiết kế
- Gắn module `Interior > Manufacturing` **vào AppShell cũ** (12 màn pixel-lock + branding MD), giữ nguyên toàn bộ tính năng của bản đang chạy. Rà soát mã hiện hữu trước, giữ lại/tận dụng CAD, BIM, Interior, CAM, nesting, tool library, file services, i18n và Local AI đã chạy tốt.
- Đây là công nghệ phục vụ xưởng; tiêu chí là tấm ván thực, gia công thật, đầu máy/dao thật, kích thước đo thật, hồ sơ truy xuất được. **Không được báo đã sản xuất được chỉ vì xuất ra một đoạn G-code.**
- Thực hiện theo thứ tự: AUDIT → DATA CONTRACT → MACHINE SELECTOR → PARTS/BOM → NESTING → CAM TOOLPATH → POSTPROCESSOR PER MACHINE → BACKPLOT/SIMULATION → MACHINE QUALIFICATION → PRODUCTION RELEASE.

## 1. Thuật ngữ phải phân biệt
- **Đầu spindle (routing head)**: mỗi đầu có trục quay, dao riêng, chiều dài dao, offset XYZ, giới hạn và công suất khác nhau; 1/2/3 đầu không phải 1/2/3 dao.
- **ATC (automatic tool changer)**: một spindle có thể tự thay nhiều dao qua ổ dao; không tự suy ra số đầu từ số ổ dao.
- **Drilling bank**: cụm mũi khoan đứng/ngang hoặc đầu khoan nhiều mũi; cấu hình offset và logic kích hoạt riêng.
- **Saw blade / lưỡi cưa**: công cụ cưa có bề dày kerf và cơ cấu hướng cắt riêng; không dùng toolpath bù dao phay tròn khi không phù hợp.
- **Knife / oscillating cutter**: công cụ dao cắt có động học riêng; hỗ trợ bằng adapter độc lập khi được nghiệm thu.
- **Multi-head sequential**: các đầu làm tuần tự trên cùng phôi; **multi-head parallel/synchronous**: nhiều đầu chạy đồng thời, chỉ khi động học độc lập/offset/chống va chạm đã được chứng minh. Mặc định **sequential-only**.
- **Controller**: LinuxCNC, GRBL, Mach3/Mach4, NcStudio, RichAuto, Syntec v.v. chỉ là họ tham khảo; cần rõ **model + firmware + postprocessor kiểm thử trên máy đó**, không giả định tương thích do tên giống nhau.

## 2. Luồng UX bắt buộc — chọn máy trước khi tính gia công
1. `Project > Interior > Manufacturing > Machine Selection` hoặc `Machines & Tools` có thể mở bất kỳ lúc nào; khi tạo manufacturing job, **bắt buộc chọn machine profile cụ thể trước khi nesting/CAM**.
2. Chọn **xưởng** → máy đã đăng ký → kiểm tra `manufacturer / model / serial-identifier (nội bộ) / controller firmware / số đầu / loại đầu / ATC / bàn máy / fixture / stock/work origin / tool mapping`.
3. Hiện `Machine Capability Summary`: cắt profile, pocket, khoan đứng, khoan ngang, cưa, phay rãnh; các mục không hỗ trợ phải tắt, giải thích lý do.
4. `Material & Stock`: mã vật liệu, **độ dày thực đo**, khổ, chiều vân, mặt A/B, stock origin, chiều quay part, cạnh dán, lớp laminate; máy không đủ hành trình → chặn job / tách chiến lược được kỹ sư duyệt.
5. `Part Breakdown`: cấu tạo tủ, khe lắp, dung sai được chỉ định, phụ kiện, tách tấm chuẩn; tạo `Canonical Part Model` độc lập khỏi máy.
6. `Machine-Specific Manufacturing Plan`: sau khi chọn máy, chạy validation cho phép nest (xoay/khổ/ống hút/kẹp), gán operations cho từng đầu/dao, kiểm tra vùng xung đột và khe hở.
7. `CAM Operations`: profile inside/outside, pocket, groove/slot, vertical/horizontal drilling **nếu phần cứng có hỗ trợ**, saw cut **nếu có adapter được xác minh**. Mỗi operation ghi `head_id`, `tool_id`, tool geometry, setup, feed/speed từ bộ thông số duyệt, top/bottom allowance, lead in/out, ramp, stepdown.
8. `Simulation & Validation`: stock removal, work envelope, safe Z, clamps/vacuum, tool length/diameter, head offsets, transitions, collision checking theo model máy, parser/backplot bằng dialect thực, machine setup check.
9. `Release Gate`: `machine VERIFIED + postprocessor APPROVED + job validated + tools/calibration current + simulation pass + operator/engineer sign-off + first article qualification` mới cho phép xuất **PRODUCTION-RELEASE**. Chưa đạt → chỉ `engineering preview` có watermark metadata NOT FOR MACHINE USE; không được lưu đuôi được máy nhận chạy như file production hoặc gửi file vào máy.
10. `Production Pack`: parts/cut list/BOM/edge labels/nesting sheet/tool list/setup sheet/machine profile revision/NC files/checksum/traceability/QC report.

## 3. Hợp đồng dữ liệu — machine-neutral vs machine-specific
- `DesignRevision` (source geometry/constraints/unit mm) → `PartRevision` (L,W,T; mặt A/B; vân; vật liệu; finish; dán cạnh; lỗ khoan; liên kết; tolerance) → `ManufacturingJob` (machine_profile_version, operator, stock measured) → `NestPlan` → `CamJob` (tool/head mappings) → `ValidatedNeutralIR` → `MachinePost` → `NCRelease`.
- Machine selected **trước khi tạo plan**, nhưng **không được sửa kích thước part chuẩn chỉ để phù hợp máy**; nếu không khả thi thì báo `NOT_MANUFACTURABLE_ON_SELECTED_MACHINE`, yêu cầu đổi máy hoặc thay đổi thiết kế có phê duyệt.
- Toolpath và NC tham chiếu **content hashes** của geometry, stock, thickness, edge rules, head/tool offsets, controller firmware, postprocessor và safety validation. Bất kỳ thay đổi nào → `STALE`, bắt buộc regenerate, kiểm thử, ký lại.
- Dữ liệu sản xuất canonical dùng mm với precision rõ; định dạng màn hình VI/EN và các đơn vị hiển thị không đổi tọa độ nội bộ. Tất cả postprocessor xác nhận G20/G21 hoặc tương đương theo controller.

## 4. Cấu hình thiết bị cần khai báo (chi tiết)
### Hồ sơ máy
`profile_id`, `revision`, `machine_type` (`CNC_ROUTER`,`CNC_SAW`,`PANEL_SAW`,`CNC_DRILL`,`HYBRID`), `manufacturer`, `model`, `controller` + `firmware`, `serial reference`, `axes`, `work envelope`, `travel soft/hard limits`, `homing/coordinate mapping`, `stock origin/corner`, `work offset conventions`, `clamps/no-go zones`, `bed / vacuum / spoilboard`, `guard / interlock integration` (chỉ tham chiếu, không thay thế bảo vệ vật lý), `postprocessor_id+hash`, `verified_supported_codes`, approved file extension, `safe start/stop/parking`.
### Mỗi đầu gia công
`head_id`, `head_type` (ROUTER_SPINDLE/SAW_BLADE/DRILL_BANK/KNIFE), `kinematics_group`, `can_activate_with[]`, `enable_sequence / tool_select` được xác thực theo controller, `offset_mm(X,Y,Z)`, offset reference datum, tool length/calibration date, RPM range nếu spindle, power / shaft rotation, tool diameter, blade thickness / blade diameter / blade orientation nếu saw, duty limitations, reach envelope, collision geometry.
### Dao và năng lực
Đường kính và chiều dài dao **thực đo**, loại dao/rãnh/phay/khoan, feeds/speeds **từ thư viện đã được xưởng xác nhận**, vật liệu phù hợp, tool wear/remaining life, min radius, stepdown/stickout limit; không được để AI tự chọn số mặc định nguy hiểm.
### Head scheduling
Một đầu → chọn dao/ATC/manual change; hai/ba đầu → chỉ tự gán operation cho đầu có tool phù hợp, đếm head/tool rõ ràng. Tự tính offset/head transform. Parallel motion **tắt** trừ khi model động học và khả năng controller đã chứng nhận bằng thử nghiệm riêng; nhiều đầu trên cùng gantry có thể gây va chạm ngay cả khi kích hoạt riêng.

## 5. Bóc tách nội thất chuẩn kỹ thuật
- Templates: tủ áo, tủ bếp dưới/trên, kệ, cánh, ngăn kéo, vách; tham số chiều rộng/cao/sâu, chân tủ, độ dày tấm **đo thực tế**, hậu phủ/lọt, nòc/đáy phủ/lọt, bản lề, tay nâng, khe cánh, khe lắp, tấm nẹp.
- Khác biệt **kích thước thành phẩm** và **kích thước ván trước dán cạnh**; chiều vân từng mặt; 4 cạnh dán chỉ tương ứng; khoan phải theo lắp ghép và orientation A/B. Đổi vật liệu/độ dày cập nhật ràng buộc, cut list, nesting, CAM mới.
- Quy tắc phụ kiện phụ thuộc model và catalog kỹ thuật (hinge cup / drawer slides / min edge distance / 32mm drilling), có profile thư viện nhà sản xuất; thiếu dữ liệu → bắt xác nhận, không đoán.
- Xuất cut list minh bạch: Part ID, quantity, L × W × thickness mm, material code/lot, grain, edge sides, face/origin reference, ops, assembled unit, machine assignment, revision.

## 6. Nesting theo máy
- Chỉ gộp cùng vật liệu, lớp phủ, độ dày tương thích; không xoay chi tiết có khóa vân. Phải xét khổ ván dùng được, lề biên, clamps, đầu máy travel/reach, dao diameter, chiều sâu phôi, chiến lược giữ tấm, tabs/bridges, thứ tự khoan/rãnh/cắt.
- Nếu vật liệu vượt khổ hoặc đầu không với tới, xác định vị trí blocker chứ không tự ép kích thước.
- Báo cáo yield, số tấm, offcut reuse, scrap, cycle time estimate với giả định rõ. Không dùng estimated cycle time làm cam kết sản xuất.

## 7. Toolpath & postprocessing kỹ thuật
- Compute: deterministic CAD/CAM algorithms, contour offset theo bán kính dao, inside/outside, tool approach, retract, safe Z theo fixture, stock Z reference, heights, stepdown, tabs, cut-through strategy vs spoilboard.
- Tách IR trung gian trước post; `postprocessor = controller+machine+firmware+head mapping+ATC/drilling+safety sequence`, không map bằng tên controller chung.
- Với máy nhiều đầu, không giả định M3/M5 hoặc Tn M6 cho tất cả. LinuxCNC có cú pháp nhiều spindle với `$n` trong phiên bản hỗ trợ; controller khác có thể yêu cầu M-code OEM. Cấm phát NC không có verified mapping.
- G-code parser/backplot phải đọc lại **file chính xác vừa post**. Test critical modal state: units, absolute/incremental, plane, offsets, spindle, compensation, tool length, safe retract, end M-codes. Không suy ra tool length `G43` hỗ trợ ở GRBL v1.1 chuẩn; không phát canned cycles unsupported.
- Machining bundle không tự gửi đến máy. Chỉ export manual file khi production gate pass; direct DNC/streaming phải là tính năng riêng, qua safety review và quyền operator.

## 8. AI Autopilot ràng buộc
- AI được quyền lập kế hoạch sản xuất, đọc sơ đồ máy đã xác minh, đề xuất part/nesting/tool assignment, giải thích issue, tạo checklist và preview.
- Không cho LLM tự ghi `G0/G1/G2/M-codes` production, đoán số spindle, đoán tốc độ dao, quên clamp, override interlock hoặc tự start CNC.
- Output AI → typed manufacturing intents → deterministic planning/geometry validator → CAM → machine-specific post → machine validation → human sign-off.
- Offline hoàn toàn sau setup model, song ngữ VI/EN; không API trả phí. UI có `Machine Selection` cho phép chọn máy theo job và màn `Machines & Tools` tạo/clone/hiệu chuẩn profile.

## 9. Bảo đảm kỹ thuật và tiêu chuẩn
- `ISO 6983 / RS-274` chỉ là cơ sở ngôn ngữ NC, **không** thay thế manual của bộ điều khiển cụ thể. Không được gắn chữ “ISO certified” nếu chưa có chứng nhận độc lập.
- Tùy thị trường và loại máy, nhà sản xuất/chủ xưởng phải thực hiện đánh giá tiêu chuẩn và biện pháp an toàn áp dụng, gồm bảo vệ vật lý, liên động, E-stop, điện, hút bụi và PPE; phần mềm không thay thế hệ an toàn vật lý của CNC.
- Chốt acceptance **theo loại sản phẩm thực tế**: dung sai chi tiết, độ vuông góc, vị trí lỗ, chiều sâu rãnh, độ sạch cạnh, chi tiết ghép, độ lặp; do kỹ sư sản xuất xác lập, máy thực tế đo và duyệt. Không áp đặt chung ±0.1mm cho tất cả vật liệu/máy.
- Machine commissioning: manufacturer docs → config nhập → tool measurements / origin / head calibration → parser/post compatibility → air-cut dry run dưới giám sát → mẫu thật (first article) → đo QC → operator sign-off → chuyển VERIFIED có thời hạn và version.

## 10. Nghiệm thu không thương lượng
1. Chọn máy 1 đầu, 2 đầu, 3 đầu, ATC; controller & đầu khác nhau → plan/post đúng khác nhau.
2. Đầu router vs cưa: nếu không có operation adapter thật, UI phải báo unsupported, không xuất file sai.
3. Đổi máy sau khi nesting/CAM → đánh dấu `STALE` và regenerate; change tool offset → invalidate NC.
4. Head assignment phù hợp tool / reach, không chạy đầu 2/3 nếu chưa có mapping; không tự bật simultaneous multihead.
5. Toolpath bù bán kính dao và hình học pass; fixture collision và z-clearance pass trước export.
6. Machine status `DRAFT` hoặc `UNVERIFIED` → không thể xuất NC production, kể cả bằng API/script/shortcut/import trạng thái cũ.
7. NC parse đúng dialect, mô phỏng chính file đã post, release audit với checksum, revision & phê duyệt.
8. Cắt mẫu, đo thực tế và ký duyệt trước khi machine profile VERIFIED.
9. Giao diện cũ và CAD thủ công không được regress; VI/EN, local offline, layout và brand MD tiếp tục chạy.
10. Report source paths, tests, ảnh, logs, những sai số đo thực tế theo machine/model/material, chưa pass hạng mục nào thì không nói “sẵn sàng đưa xưởng”.

## 11. Nguồn tài liệu kỹ thuật tham khảo
- FreeCAD CAM Job / post: https://github.com/FreeCAD/FreeCAD-documentation/blob/main/wiki/CAM_Job.md
- FreeCAD CAM Workbench: https://github.com/FreeCAD/FreeCAD-documentation/blob/main/wiki/CAM_Workbench.md
- LinuxCNC G-code: https://linuxcnc.org/docs/html/gcode.html
- LinuxCNC M-code + tool change: https://github.com/LinuxCNC/linuxcnc/blob/master/docs/src/gcode/m-code.adoc
- GRBL v1.1 supported dialect: https://github.com/gnea/grbl/blob/master/README.md

**Lưu ý**: document này là đặc tả/điều kiện nghiệm thu. Chưa có machine profile thực tế, kiểm thử controller hoặc production NC đã được duyệt.
