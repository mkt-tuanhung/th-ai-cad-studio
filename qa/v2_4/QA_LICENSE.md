# Bản quyền theo máy (KEY kích hoạt) — thiết kế, kiểm thử, giới hạn

Ngày: 2026-10-18 · Mã nguồn: `native/libs/license`, `native/app/src/licence_gate.*`, `native/tests/test_license.cpp`

## 1. Cách hoạt động

1. **Bản cho khách** (bộ cài Windows, DMG) được build với `THCAD_LICENSE_ENFORCE=ON`. Khi chưa có KEY hợp lệ cho đúng máy:
   - app vẫn mở và hiện giao diện phía sau, nhưng **mọi chức năng bị khoá**:
     - không có cầu nối native (`HostBridge`) nào cho giao diện;
     - khung web không nhận chuột hay bàn phím;
     - tải file xuống bị huỷ;
   - một **lớp watermark do app vẽ trực tiếp** (Qt, không nằm trong file giao diện) phủ toàn cửa sổ. Lớp này lặp chữ chéo và có dải đỏ ở đáy với đúng câu:
     "TRIAL VERSION - SẢN PHẨM ĐƯỢC PHÁT TRIỂN BỞI MINH DŨNG Vui lòng liên hệ để cung cấp KEY - HOTLINE: 0879232666";
   - **cửa sổ kích hoạt** tự hiện sau khoảng 1 giây. Bấm hay gõ phím vào bất cứ đâu, cửa sổ hiện lại và rung lên. Cửa sổ gồm:
     - mã máy, với nút "Sao chép mã máy";
     - ô dán KEY;
     - nút "Chọn file key (.mdkey)…";
     - nút "Kích hoạt" và "Thoát phần mềm";
     - lỗi rõ ràng: sai KEY / KEY của máy khác / KEY hỏng hoặc thiếu ký tự / hết hạn / không phải KEY.
2. **Kích hoạt đúng** thì KEY được lưu vào thư mục dữ liệu của người dùng (`licence.mdkey`), rồi app **tự khởi động lại** ở chế độ đầy đủ.
3. **Mỗi lần mở app**, KEY được kiểm tra lại với mã máy hiện tại. Trong lúc chạy:
   - cứ 10 phút kiểm tra lại một lần, KEY không còn hợp lệ thì khoá lại;
   - các chức năng AI, render và xuất STEP cũng kiểm tra lại (lưu kết quả 1 phút).
4. **Cài đặt → Cập nhật** có thêm hai dòng: "Bản quyền" (khách hàng, số KEY, ngày cấp, hạn dùng) và "Mã máy".
5. **Dòng lệnh** (dùng cho kiểm tra và triển khai):
   - `"MD CAD AI STUDIO" --licence-info` in ra `enforce=… licensed=… reason=… machine=…`;
   - `--licence-activate=<file.mdkey>` kích hoạt bằng file.

**Bản dev/QA** (`native/build`, `THCAD_LICENSE_ENFORCE=OFF`) không bao giờ khoá. Bản này chỉ dùng cho bộ e2e và **không bao giờ được đóng gói**:
- `package_macos.sh` build bản cho khách vào `native/build-release` và **từ chối đóng gói** nếu app không báo `enforce=1`.
- `build_windows.ps1` cũng **từ chối** nếu app trong thư mục stage không báo `enforce=1 licensed=0` trên máy build.
- Bài tự kiểm tra trong app trên CI Windows chạy bằng một bản QA build riêng (`-QaBuild`, thư mục `build-win-qa`), đặt vào bản sao của thư mục stage. Bản này không bao giờ vào bộ cài.

## 2. Mã máy và KEY

- **Mã máy:** `MDCA-XXXXX-XXXXX-XXXXX-XXXXX-C`.
  - Là 100 bit băm BLAKE2b có khoá miền riêng, từ:
    - macOS: IOPlatformUUID và số serial máy;
    - Windows: MachineGuid và serial ổ đĩa hệ thống.
  - Ký tự cuối là ký tự kiểm tra, nên gõ nhầm sẽ bị phát hiện. Chữ thường, dấu cách, O↔0, I/L↔1 đều được chấp nhận.
  - **Mã thay đổi khi:**
    - Windows: cài lại Windows hoặc format ổ hệ thống;
    - Mac: thay bo mạch chủ.
  - Khi đó khách gửi mã mới để được cấp lại KEY.
- **KEY:** `MDK1-…`, gồm phần dữ liệu và chữ ký **Ed25519** (64 byte) cùng 2 byte kiểm tra lỗi gõ.
  - Phần dữ liệu: phiên bản, gói, băm ràng buộc máy, ngày cấp, hạn dùng (0 = vĩnh viễn), số KEY, tên khách (tối đa 48 byte).
  - File `.mdkey` gồm vài dòng `#` để người đọc, cộng KEY nằm giữa hai dòng BEGIN/END.
- App chỉ chứa **khoá công khai** của anh, được tách đôi và XOR để không nằm lộ trong file chạy. Khoá bí mật nằm trong két đã mã hoá ở máy anh và **không có trong mã nguồn, git hay bộ cài**.

## 3. Mức bảo vệ (nói thật)

| Kiểu tấn công | Kết quả |
|---|---|
| Tự tạo KEY giả, đoán KEY | **Không làm được**: cần khoá bí mật Ed25519. Đã thử 3.000 chuỗi ngẫu nhiên, KEY của khoá khác, và sửa từng ký tự một: tất cả bị từ chối |
| Chép KEY sang máy khác | Bị từ chối ("KEY này được cấp cho máy khác") |
| Sửa file giao diện (HTML/JS) để gỡ lớp khoá | Không có tác dụng: lớp khoá là widget native, app không cấp chức năng nào cho giao diện khi chưa kích hoạt |
| Mở DevTools / remote debugging, chạy script QA (`THCAD_SCRIPT`, `THCAD_UI_URL`…) | Bản cho khách bỏ qua các biến và tham số này |
| Sửa trực tiếp file chạy (patch nhị phân), hoặc giả mã phần cứng | **Có thể**, với người có kỹ năng dịch ngược. Mọi hệ thống bản quyền offline đều vậy. Các lớp kiểm tra lặp lại và việc giấu khoá chỉ làm việc này khó hơn. Muốn mạnh hơn thì cần ký số (code signing) và công cụ bảo vệ thương mại (có phí) |
| Lộ két và mật khẩu của anh | Ai có cả hai thì cấp được KEY. Phải giữ két offline, sao lưu, và dùng mật khẩu dài |

## 4. Kiểm thử đã chạy (2026-10-18)

| Bài | Kết quả |
|---|---|
| `ctest` (`thcad_tests`, 4 bài bản quyền, dùng cặp khoá TEST sinh lúc chạy) | 42/42 đạt |
| Bản cho khách trên Mac (`build-release`), `--licence-info` | `enforce=1 licensed=0 reason=missing` |
| KEY hỏng / không phải KEY qua `--licence-activate` | `reason=corrupted` / `malformed`, mã thoát 1, không lưu gì |
| Mở bản cho khách, chụp màn hình (`qa/v2_4/licence_locked_window.png`) | Có watermark, dải đỏ và cửa sổ kích hoạt kèm mã máy; giao diện báo `host: undefined` (không có chức năng native); `THCAD_SCRIPT` bị bỏ qua |
| Bản dev: tự kiểm tra trong app | `SELFTEST DONE OK` |
| Bản dev: e2e (cad 12, bim3d 9, aichat 3, platform 4, linked3d 36, fromcad 12, blender 34) | tất cả đạt |
| Cài đặt → Cập nhật: dòng Bản quyền + Mã máy (bản dev) | đạt |
| **Kích hoạt bằng KEY thật** | **Chưa chạy**: cần chương trình cấp KEY (mục 5) |

## 5. Còn thiếu

- **Chương trình cấp KEY (MDKeyGen):**
  - cần: đăng nhập vào két, cấp KEY theo mã máy, lịch sử mỗi máy một KEY, đổi mật khẩu;
  - **chưa làm** trong đợt này;
  - két và khoá thật đã được tạo ở `~/Downloads/MD_CAD_AI_STUDIO_KEYGEN_PRIVATE/vault/` (ngoài repo, quyền 600). Khoá công khai đã nhúng vào app.
  - Khi chưa có chương trình này thì **không cấp được KEY**: bộ cài cho khách sẽ luôn ở chế độ khoá.
- **Phát hành:**
  - chưa ký số Windows/macOS, nên SmartScreen/Gatekeeper vẫn cảnh báo;
  - nên mua chứng chỉ ký số khi bán chính thức.
