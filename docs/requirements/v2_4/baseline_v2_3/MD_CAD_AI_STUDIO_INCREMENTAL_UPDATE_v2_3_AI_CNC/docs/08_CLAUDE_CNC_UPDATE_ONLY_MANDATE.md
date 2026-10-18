# CLAUDE — BỔ SUNG CNC v2.2 / PATCH VÀO PROJECT CŨ

**BẮT BUỘC ĐỌC `00_UPDATE_ONLY_READ_FIRST.md` VÀ `docs/06_CNC_MACHINE_AWARE_MANUFACTURING_MASTER_SPEC.md` TRƯỚC KHI CODE.**

Anh đã phát triển gần xong MD CAD AI STUDIO ở phiên bản trước. Đây là `CHANGE REQUEST v2.2` tập trung **sản xuất nội thất CNC thực tế**; tuyệt đối không tạo repo mới, scaffold lại app, đổi framework, dựng lại UI/mockup hoặc xóa/ghi đè các chức năng đang chạy. Mọi nâng cấp phải là patch trên repository hiện hữu, có baseline, delta audit, tests và rollback.

## Yêu cầu sản xuất bắt buộc
1. Tại `Interior > Manufacturing`, **thêm bước CHỌN MÁY CNC TRƯỚC KHI NESTING/CAM**. Người dùng chọn model máy, bộ điều khiển và các loại 1/2/3 đầu gia công (cũng bao gồm ATC, drill bank, saw blade, hybrid). Đừng hiểu số dao = số spindle; đừng mặc định 3 đầu chạy song song.
2. Hệ thống phải chọn đúng phương án bóc tách, nesting, gia công, phân công đầu / dao, bù đầu và postprocessor theo **capability của máy**, không phải cùng một G-code cho mọi máy.
3. Giữ canonical dimensions của part/BOM độc lập với máy. Chỉ manufacturing setup/strategy/nesting/toolpaths/NC thay đổi theo máy. Thay đổi máy/đầu/dao/độ dày/phôi → invalidation đúng chuỗi sản xuất.
4. Với CNC nhiều đầu: tính head offsets XYZ đo thực, tool length, kinematics/reach, vùng cấm, fixture, thứ tự chuyển đầu, tool assignments, kiểm tra va chạm. Chế độ đồng thời OFF trừ khi có bằng chứng máy hỗ trợ.
5. CNC G-code thực chỉ được tạo bởi **deterministic CAM + verified postprocessor**; AI local được phép đề xuất typed commands nhưng **không trực tiếp viết G-code để chạy máy**.
6. Ngăn production export khi thiếu thông tin máy, controller/firmware, tool, offsets/zero, calibrated fixtures, profile verification, simulation, qualification và phê duyệt operator. Không cho bypass bằng đường gọi API/CLI.
7. Từng máy/controller được kiểm chứng bởi parser, mô phỏng file đã post, air cut, first article đo kích thước và sign-off kỹ thuật. Không tuyên bố sẵn sàng sản xuất khi chưa có máy thật nghiệm thu.
8. Giao diện bám bộ pixel-lock MD đã duyệt (white, graphite/teal, VI/EN); thêm Machine Selector và tooling UI **theo thành phần giao diện hiện có**; không tự thay AppShell.

## Bắt đầu đúng cách — audit trước code
- Mở repo hiện hữu và lập `docs/CNC_EXISTING_IMPLEMENTATION_AUDIT.md`: source path, các module `Interior`, `Part/BOM`, `Nesting`, `CAM`, `MachineConfig`, `Post`, `Simulation`, `Export`, bản chất thực hay UI-only, test chạy/không chạy.
- So với `qa/CNC_MULTI_MACHINE_ACCEPTANCE_TESTS.csv` và `qa/CNC_UPDATE_GAP_AUDIT_TEMPLATE.csv` để xác định **delta nhỏ nhất**. Sửa chỉ phần thiếu/lỗi.
- Tạo checkpoint Git và baseline; không reset thay đổi người dùng. Tạo `docs/CNC_DELTA_IMPLEMENTATION_PLAN.md` theo từng phase, ghi file sẽ đổi, risk, rollback.
- Dùng `schemas/machine_profile.schema.json`, `schemas/manufacturing_job.schema.json` tham khảo; phải hòa vào cấu trúc lưu trữ hiện hữu, không phá format.
- Phase 0: machine selection UI, profile registry, capability checks, no production export.
- Phase 1: part/BOM/edge/nesting linked to machine.
- Phase 2: machine-aware CAM 2.5D, head scheduler (sequential default), deterministic validation.
- Phase 3: controller-specific post and NC parser/backplot.
- Phase 4: nghiệm thu cùng xưởng và máy thực; production-release chỉ sau sign-off.

## Acceptance & reporting
Đừng gửi những nút demo hoặc HTML giả là tính năng CNC hoàn chỉnh. Mỗi milestone báo module thực có thể vận hành, regression pass, lỗi còn tồn tại, kiểm tra NC, các điểm cần máy thật. Bất kỳ NC thử nghiệm nào đều phải có nhãn `NOT FOR MACHINE USE`; không tự chạy máy hoặc bypass E-stop/liên động.

**ƯU TIÊN CAO NHẤT: cập nhật phần mềm cũ, giữ mockup cũ và để đúng loại máy quyết định gia công — SẢN XUẤT THẬT, AN TOÀN, CÓ NGHIỆM THU.**
