# QA — Brand MD CAD AI STUDIO (2026-10-12)

## Nguồn asset
- **Logo:** `~/Downloads/Biểu tượng MD CAD AI Studio hiện đại.png`, PNG nền trong suốt. Đây chính là logo trong ảnh anh gửi.
- **Ảnh tham chiếu thiếu:** brief để trống đường dẫn của app icon, intro 01 và intro 02. Trên máy cũng không có file nào như vậy (các ảnh ChatGPT hôm nay là ảnh cá nhân, không liên quan).
- **Cách xử lý:**
  - App icon dựng từ chính monogram của logo.
  - Intro và màn chào cài đặt dựng bằng code (CSS / SVG / canvas), các lớp chuyển động đặt chồng lên ảnh logo gốc.
  - Logo **không** bị vẽ lại: chỉ cắt (monogram / wordmark) và làm thêm bản nền tối. Trong bản nền tối, chữ graphite được nâng thành màu bạc để đọc được.

## Đã làm

**Đổi tên toàn hệ thống thành MD CAD AI STUDIO**
- Giao diện, tiêu đề cửa sổ.
- `.app` / `.exe`, DMG `MD-CAD-AI-STUDIO-0.1.0-macOS-arm64.dmg`, installer `MD-CAD-AI-STUDIO-Setup-…exe` (publisher: Minh Dũng).
- Metadata PDF / DXF / DWG / IFC / LandXML / G-code.
- Prompt AI.

**Giữ dữ liệu cũ**
- Tên nội bộ của Qt vẫn giữ nên không mất dự án, bản vẽ, cài đặt đã lưu.
- Bundle id giữ nguyên nên quyền micro đã cấp vẫn còn.
- Thư mục mô hình: dùng `…/MD CAD AI STUDIO/models`. Nếu chưa có mà thư mục cũ có, app dùng thư mục cũ, không tự di chuyển file.

**Component** (`ui/src/components/brand/`, mô tả trong README cùng thư mục)
- `BrandLogo`, `IntroScreen`, `SplashScreen`, `InstallerWelcomeScreen`, `BrandLoader` (kèm `brandLoading`), `AppIconPreview`.
- Trang xem trước: `#/brand`.

**Icon**
- macOS `AppIcon.icns` trong bundle, cũng là icon của ổ DMG.
- Windows `app.ico` gắn vào exe và setup.
- Favicon.

**Intro khi mở app**
- 5 pha, khoảng 4,5 giây (gồm cả tải trang).
- Chạy song song với các bước khởi động thật, sau đó mờ dần vào Dashboard.
- Bỏ qua bằng click / Esc / Enter.
- Tắt animation trong Cài đặt thì hiện khung tĩnh.
- Native: nền cửa sổ tối ngay từ đầu, không loé trắng.

**Installer**
- *Windows (Inno Setup):*
  - Bật trang Welcome, với ảnh hero xuất từ `InstallerWelcomeScreen` cho 7 mức DPI.
  - Lời chào tiếng Anh / tiếng Việt kèm đúng dòng credit; file `.iss` là UTF-8 có BOM để tiếng Việt hiển thị đúng.
- *macOS:* cửa sổ DMG dựng bằng dmgbuild, gồm:
  - nền brand (1× + 2×), tagline, mũi tên app → Applications, dòng credit;
  - icon đặt tại (165, 242) và (495, 242), đã đọc lại từ `.DS_Store` để xác nhận.

**BrandLoader dùng ở:** khởi động (thanh tiến độ của intro), nạp mô hình AI (Cài đặt), mở DWG (CAD 2D).

## Bằng chứng (`qa/brand/`)
- **Intro trên trình duyệt:**
  - `intro_recording.webm`: quay toàn bộ intro rồi vào Dashboard.
  - `intro_0250ms` … `intro_4200ms.png`: khung 250 ms tối hoàn toàn; 1,5 s monogram đang ghép; 2,3 s quét sáng và chữ đang hiện; 2,9 s đủ chữ; 3,5–4,2 s có dòng credit và thanh tiến độ.
- **Intro trong app desktop:**
  - `desktop_intro_2600/4200/6500ms.png`: intro, sau đó là Dashboard tiếng Việt với logo mới ở sidebar.
  - `dmg_app_intro.png`: app chạy từ DMG.
- **Installer:** `installer_welcome.png`, `windows_wizard_250.png`, `dmg_background@2x.png`, `app_icon_preview.png`, `brand_screen.png`.
- **`smoke-brand.mjs` 7/7:**
  - intro chạy hết rồi vào Dashboard (4,5 s); Esc bỏ qua được;
  - dòng credit **khớp từng chữ** ở intro, màn chào installer, hero và nền DMG;
  - không còn chuỗi "TH AI CAD" trong giao diện;
  - loader hiện ra rồi tự tắt; trang xuất ảnh installer hiển thị đúng;
  - **không có lỗi console**.
- **Hồi quy:**
  - 20 bộ smoke trên trình duyệt đều PASS.
  - e2e desktop đều PASS, intro tự tắt khi chạy kiểm thử: `e2e_cad` 12/12, `e2e_scan` 6/6, `e2e_voice` 3/3, `e2e_bimviews` 11/11.

## Chưa kiểm chứng được
- Ảnh chụp cửa sổ Finder của DMG: cần quyền ghi màn hình. Đã thay bằng việc kiểm tra `.DS_Store` và ảnh nền.
- Giao diện cài đặt thật trên Windows: CI chỉ build và biên dịch installer, không chụp được màn hình.
