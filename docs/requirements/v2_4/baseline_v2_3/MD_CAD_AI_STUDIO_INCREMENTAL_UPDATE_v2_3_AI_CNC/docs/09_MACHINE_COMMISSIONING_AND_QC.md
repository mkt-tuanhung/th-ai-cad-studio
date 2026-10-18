# Nghiệm thu kỹ thuật tại xưởng — Commissioning & QC

## Điều kiện tiên quyết
Nhận từ chủ xưởng: hãng/model/serial tham chiếu, controller + firmware + manual, ảnh bảng điều khiển, xác nhận máy 1/2/3 đầu **loại nào**, cấu hình spindle/ATC/đầu khoan/dao cưa, hành trình, khổ bàn, vacuum/clamps, dao cụ đang lắp, file NC mẫu **đã chạy thành công** do bên máy cung cấp, môi trường kiểm thử do người có thẩm quyền phụ trách.

## Phiếu khảo sát thiết bị (ký)
- Machine ID/serial, ngày bảo dưỡng, sơ đồ nguồn/vị trí E-stop/interlock; không để phần mềm bypass.
- Controller: OEM/build/firmware, chương trình mẫu, bộ mã NC hỗ trợ, quy ước M/T/S/F, chu trình khoan, thay đầu/dao.
- X/Y/Z axis mapping, travel hard/soft limits, gốc HOME/work zero, hướng tăng trục, G54.., safe Z, khu vực park, vị trí kẹp/vacuum.
- Head list: 1/2/3 heads, spindle/drill/saw/knife; offset XYZ đo thực và tool length zero; active tool, thứ tự kích hoạt, giới hạn chuyển đầu, inter-head collision geometry.
- Material/stock profile theo vật liệu: khổ, độ dày thực đo, vân, mặt A/B, vật tư tiêu hao, phương án giữ phôi, spoilboard.
- Approved tools: diameter/kerf actual, protrusion, max RPM, feeds/speeds validated by shop/tool manufacturer, tool life & material compatibility.

## Qualification workflow
1. Tạo machine profile `DRAFT`, snapshot refs, RBAC/quyền chỉnh sửa.
2. Ghi đầu/dao thật, controller capabilities, postprocessor map và calibrations có minh chứng.
3. Test hình học, bù dao, bù đầu, thứ tự job / modal state / cấm unsupported G/M code.
4. Test parser và backplot trên NC output; mô phỏng va chạm bao gồm đầu không dùng, head offsets, dao, spindle body nếu model có.
5. Chạy air-cut/dry-run **dưới giám sát người vận hành CNC được đào tạo**, không vật liệu, tốc độ và vùng an toàn có giám sát.
6. Cắt first article bằng tấm/phôi mẫu; đo kích thước sản xuất, tâm lỗ, chiều sâu rãnh, độ vuông, chất lượng cạnh/vị trí ghép. Ghi kết quả vs dung sai có phê duyệt.
7. Khi tất cả pass + ký `operator` và `engineering QA`, đổi trạng thái machine/post từ `UNVERIFIED` → `VERIFIED`, gắn thời hạn kiểm tra và profile hash. Thay controller/dao/offets/đầu → hạ trạng thái hoặc yêu cầu requalification theo phạm vi ảnh hưởng.
8. Mỗi job cần check setup, bản vẽ release, part revision, NC revision, vật liệu đúng, operator sign-off trước giao máy; hệ thống không điều khiển Cycle Start.

## Những gì hoàn toàn KHÔNG được cam kết chỉ bằng phần mềm
- Không khẳng định độ chính xác ±0.1mm hoặc tuổi thọ dao khi chưa đo và xác nhận cho máy/vật liệu/công đoạn đó.
- Không cho rằng đã mô phỏng là đã an toàn trên máy; tiếp xúc kẹp/vacuum/tool holder/spindle body cần mô hình và giám sát thực tế.
- Không suy từ số đầu spindle ra tốc độ cắt hoặc khả năng cắt đồng thời.
- Không đánh dấu tương thích controller dựa trên tên hãng mà chưa chứng minh firmware/post.
- Không tự gửi G-code qua mạng và khởi động máy. Truyền file nếu thêm sau phải cần xác thực, checksum và độc lập khâu Cycle Start của người vận hành.

## Gói bằng chứng nghiệm thu
- `machine_profile_revision.json` + checksum
- `approved_postprocessor` version/hash, changelog
- controller parse/backplot logs & ảnh mô phỏng
- physical dry-run / first article report (người thực hiện, ngày, đo đạc, ảnh)
- NC release manifest (CAD/part/job/revision + machine/tool/stock + approved operator)
- rollback/version history và dấu vết các lần thay đổi

## Tài liệu máy thực ưu tiên cao nhất
Tài liệu chính thức của nhà sản xuất/đơn vị lắp đặt cho **đúng model, đúng firmware, đúng sơ đồ điện/dao**. Tài liệu generic là nền tảng tham khảo, không phải chỉ dẫn vận hành máy cụ thể.
