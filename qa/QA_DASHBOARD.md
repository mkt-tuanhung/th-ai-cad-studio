# QA — Màn 1: Dashboard / Project Hub

Ngày: 2026-10-10 · Chuẩn so sánh: `mockups_full/01_dashboard.png` (1586×992, 1x)
Cách chụp: Playwright Chromium headless, viewport 1586×992, deviceScaleFactor 1, profile mới (dữ liệu seed, EN).

## Kết quả

| Kiểm tra | Kết quả |
|---|---|
| Chụp ảnh thực tế cùng kích thước | `dashboard_en.png` · đặt cạnh nhau: `dashboard_side_by_side.png` |
| Chồng lớp pixel | `dashboard_overlay_anaglyph.png` (đỏ = chỉ có ở mockup, xanh = chỉ có ở bản dựng, xám = trùng) |
| Đo bbox mực in 51 phần tử (`dashboard_inkbox_report.txt`) | Vị trí lệch ≤1px: 35/51 · ≤2px: 47/51 · kích thước lệch ≤3px: 39/51 |
| 4 phần tử còn lệch | `proj1.modified`, `ai.vrambar` lệch 3px; `lang.en`, `stat.ap.tile` là lỗi vùng đo (chữ trắng trên nền đậm / viền mờ), đã kiểm bằng mắt |
| Tiếng Việt | `dashboard_vi.png` — không tràn chữ |
| Thích ứng | `dashboard_en_1280x800 / 1440x900 / 1728x1117 / 1920x1080.png` |
| Tương tác (`npm run test:smoke`) | 14/14 PASS, không lỗi console |
| `tsc -b`, `vite build`, `oxlint` | Sạch (1 cảnh báo fast-refresh không ảnh hưởng chạy) |

**Không tuyên bố giống 100%.** Bản dựng khớp bố cục, màu, font, icon và khoảng cách trong khoảng
±2px ở hầu hết phần tử đo được; các khác biệt còn lại được liệt kê dưới đây.

## Khác biệt đã biết (có chủ đích hoặc do nguồn)

1. **Độ rộng thẻ không đều trong mockup** — mockup (ảnh dựng bằng AI) có thẻ Recent Projects rộng
   228/224/217/209px và thẻ thống kê 222/230/211/219px. Bản dựng dùng lưới chia đều (component thật),
   nên thẻ 2–4 lệch tối đa ~10px theo chiều ngang.
2. **Thumbnail dự án** — asset trong gói nhỏ hơn ô hiển thị và có lẹm viền/chữ từ mockup; được cắt vùng
   sạch và phóng đều ~1.15–1.2× (không méo). Nét hơi mềm hơn mockup. Cần xuất lại asset @2x.
3. **Ngôi sao thẻ 2** — mockup thẻ 2 có sao trắng. Hiểu là trạng thái hover: sao vàng = yêu thích,
   sao trắng hiện khi rê chuột. Ảnh `dashboard_en_hover_card2.png` khớp mockup ở trạng thái đó.
4. **Ảnh nhỏ không có trong gói asset** (avatar, ảnh Learning) — cắt 1:1 từ mockup, ghi rõ tại
   `ui/public/assets/extracted/README.md`, cần thay bằng asset chính thức.
5. **Chữ in sẵn trong asset** — "IDEAS TO REALITY WITH AI" (hero) và "AI × CAD for a Smarter
   Tomorrow." (promo) nằm trong ảnh nên không dịch được; slogan thương hiệu "Design Smarter. Build
   Faster." giữ tiếng Anh ở cả hai ngôn ngữ cho đồng nhất với các asset này.
6. **Font** — mockup không kèm tên font. Đo tỉ lệ chiều cao chữ hoa/bề rộng cho thấy khớp Roboto
   (SF Pro và Inter rộng hơn 8–13%), nên dùng Roboto variable bundle offline.
7. **Nút mặt trời (giao diện tối)** — chưa có thiết kế được duyệt; nút ghi nhận tùy chọn và báo
   "chưa có thiết kế", không tự vẽ dark theme.
8. **Số liệu Local AI / thư viện / gợi ý AI** là dữ liệu `demo` (chưa có runtime thật).

## Tái lập

```bash
cd ui && npm run dev
```

```bash
cd ui && node tools/capture.mjs dashboard ../qa/dashboard_en.png en && npm run test:smoke
```

Script đo `tools/inkbox.py` cần Python có Pillow + NumPy:
`python inkbox.py <mockup.png> <capture.png> tools/regions_dash.json`.
