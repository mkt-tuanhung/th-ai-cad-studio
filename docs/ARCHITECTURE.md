# TH AI CAD Studio — Kiến trúc dài hạn

Tài liệu này ghi lại các quyết định đã được chủ đầu tư khóa và phần còn **đang chờ phê duyệt**.
Không có tài liệu kiến trúc/CAD Engine/Local AI nào khác trong gói handoff v1 — mọi điểm dưới đây
xuất phát từ yêu cầu trực tiếp của chủ đầu tư.

## 1. Quyết định đã khóa

| Hạng mục | Quyết định |
|---|---|
| Nền tảng | macOS, Apple Silicon (arm64), chạy offline |
| CAD Engine | Native, **C++20**, **Qt 6**, **Open CASCADE (OCCT)** |
| Tương thích | Thao tác, câu lệnh, phím tắt kiểu AutoCAD — chỉ ở mức **đã đặc tả và có test** |
| Local AI | **llama.cpp / MLX** chạy trong tiến trình app; không bắt buộc cloud API |
| Cài đặt | Người dùng **không** phải cài Python, Ollama, hay nhập API key |
| AI ↔ CAD | AI chỉ thao tác đối tượng CAD thật qua **hệ thống lệnh có kiểm tra → xem trước → phê duyệt → hoàn tác** |
| Mở rộng | Kiến trúc module cho Cơ khí, BIM, MEP, Nội thất, Hạ tầng |
| Giao diện | 4 mockup đã duyệt là chuẩn hình ảnh; UI prototype dùng React + Vite + TS (theo `CLAUDE_CODE_UI_PROMPT.md`) |

## 2. Các lớp

```
┌──────────────────────────── macOS app bundle (.app, ký + notarize) ────────────────────────────┐
│  UI shell (React/TS — repo này: ui/)            │  Viewport native (Qt RHI/Metal, OCCT V3d/AIS)│
│  sidebar, top bar, panel, ribbon, dialog, i18n  │  vẽ 2D/3D, chọn đối tượng, snap, grip        │
├─────────────────────── Host bridge (typed, versioned, JSON-RPC qua QWebChannel) ───────────────┤
│  Command Bus  ── validate → preview (transaction tạm) → approve → commit → undo/redo stack     │
├──────────────────────────────────────────────────┬─────────────────────────────────────────────┤
│  CAD Core (C++20)                                │  Local AI Runtime (C++)                      │
│  Document/Entity model, Layers, Blocks, Xref     │  llama.cpp (GGUF, Metal) / MLX               │
│  OCCT: B-Rep, booleans, offset, fillet, STEP/IGES│  model manager (tải/kiểm chứng checksum)     │
│  2D: polyline/arc/hatch/dim/text, OSNAP, ORTHO   │  tool-calling → chỉ sinh *Command* hợp lệ    │
│  I/O: DXF; DWG qua thư viện có giấy phép (xem §5) │  không bao giờ sửa document trực tiếp        │
├──────────────────────────────────────────────────┴─────────────────────────────────────────────┤
│  Discipline modules (plugin): mechanical · bim(IFC) · mep · interior · civil                   │
└────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Command Bus (điểm chung cho người dùng, dòng lệnh kiểu AutoCAD và AI)

Mọi thay đổi document đi qua một `Command`:

1. **Parse/validate** — tham số, đơn vị, layer khóa, ràng buộc hình học.
2. **Preview** — chạy trên transaction tạm, trả về diff (thêm/sửa/xóa entity) để UI vẽ ghost.
3. **Approve** — người dùng duyệt (AI không được tự commit). Màn AI Studio có sẵn nút
   *Preview Changes / Approve & Apply / Reject / Undo* cho đúng luồng này.
4. **Commit** — ghi vào undo stack như một bước nguyên tử; **Undo** khôi phục toàn bộ.

Lệnh AutoCAD (`LINE`, `PLINE`, `TRIM`, `OFFSET`, `_OPEN`…) và alias/phím tắt được khai báo trong một
bảng đặc tả; mỗi lệnh chỉ được ghi "tương thích" khi có test hành vi tương ứng.

### Ranh giới UI ↔ native (đã có trong code)

`ui/src/services/*` định nghĩa interface (`LocalAiRuntime`, thư viện cấu kiện…). Host native sẽ
gắn implementation thật vào `window.thcadHost`; khi chưa có host, UI dùng bản `demo` và mọi dữ
liệu mang `source: 'demo'`. Prototype chỉ đọc *metadata* của tệp (tên, dung lượng) — không giả vờ
đã mở bản vẽ.

## 3. Cách ghép UI React với Qt 6 — ĐÃ CHỐT: Phương án A (2026-10-10)

Chủ đầu tư chọn **A**. Các phương án đã cân nhắc:

- **A — Qt 6 host + Qt WebEngine cho shell, viewport native** *(đề xuất)*: giữ 100% UI đã code và đã
  đối chiếu mockup; viewport OCCT là widget native nằm cạnh/bên dưới vùng web. Rủi ro: chồng lớp
  panel web lên viewport (AI Assist nổi trên canvas) cần giải pháp composite; dung lượng app tăng
  (~150 MB Chromium).
- **B — Viết lại UI bằng Qt Quick/QML**: native thuần, nhẹ hơn, nhưng phải dựng lại toàn bộ UI và
  đối chiếu fidelity lại từ đầu.
- **C — Shell WKWebView/Tauri + engine C++ dạng thư viện**: nhẹ, nhưng lệch khỏi quyết định "Qt 6".

Hệ quả của A: UI trong `ui/` là UI sản phẩm thật (không phải bản nháp); vùng vẽ CAD trong UI là một
*slot* để host native đặt viewport OCCT vào. Bridge: `QWebChannel` (JSON-RPC có version).

## 4. Lộ trình gần

1. ✅ Dashboard (đã đối chiếu mockup 01).
2. ✅ CAD 2D Workspace (đã đối chiếu mockup 02). Prototype TS trong `ui/src/cad/` hiện thực hợp đồng
   Command Bus (`commandBus.ts`) và bảng lệnh (`commands.ts`, cột `status: prototype | native`); engine
   native phải thoả cùng hợp đồng và cùng bộ test hành vi. Vùng vẽ là slot `data-native-viewport-slot`.
3. ✅ AI Intelligence Studio (đã đối chiếu mockup 03). Luồng xem trước → duyệt (có xác nhận) → hoàn tác
   / từ chối đã có; phiên chat là dữ liệu mẫu cho tới khi tích hợp runtime llama.cpp / MLX.
4. ✅ Architecture / BIM Workspace (đã đối chiếu mockup 04). Mô hình BIM prototype `ui/src/bim/` (khối
   lượng tính toán, kiểm tra mô hình xác định, chỉnh sửa có kiểm tra + hoàn tác); khung 3D là slot
   `data-native-viewport-slot="bim-3d"` cho trình xem OCCT.
5. ✅ Khung native (`native/`, 2026-10-10): core C++20 (Command Bus, bảng lệnh, DXF, ProposalQueue),
   BIM, OCCT (khối, boolean, STEP, trình xem 3D), llama.cpp (Metal), app Qt 6 + WebEngine + QWebChannel,
   gói `.app` tự chứa. Xem `native/README.md`, `qa/QA_NATIVE.md`.
6. ✅ (a) AI thật: Qwen2.5-3B GGUF qua llama.cpp/Metal, giải mã hybrid + GBNF, đánh giá 3 bộ câu
   (`qa/QA_AI_LOCAL.md`). ✅ (b) CAD 2D đồng bộ Command Bus C++ (engine quyết định, giao diện tự hoàn tác
   khi bị từ chối). ✅ (c) OCCT vẽ offscreen vào slot web, overlay web nằm trên.
7. Còn lại (đo 2026-10-11, `qa/QA_DWG_RENDER_PACKAGING.md`):
   (d) renderer 2D — **không cần native** ✅: SVG chỉ mượt đến ~3–5k đối tượng (bản vẽ thật 41k: 267 ms/khung);
       đã làm lớp vẽ WebGL2 trong web view (`ui/src/screens/cad2d/gpu/`, ≥ 2 000 đối tượng): 60 fps ở 200k
       đối tượng; SVG giữ cho lớp tương tác và bản vẽ mockup;
   (e) phát hành: `.dmg` ký ad-hoc + hardened runtime (miễn phí) ✅; Developer ID + notarize tuỳ chọn ($99/năm);
       Windows `.exe` — mã nguồn đã tách phần riêng macOS, script MSVC + Inno Setup + GitHub Actions sẵn, chưa build trên Windows thật;
   (g) đọc DWG ✅ — LibreDWG `dwg2dxf` đi kèm như chương trình riêng (GPL-3.0, kèm mã nguồn), bộ nhập DXF
       R12–2018 đầy đủ block/kích thước/hatch, tiếng Việt UTF-8 / code page / TCVN3; ghi DWG chưa có.
   Sau này: PWA kết nối server để theo dõi/ra lệnh cho app desktop (bản mobile chỉ quản lý, không có công cụ kỹ thuật).
   ✅ (f) So sánh 3B/7B: 7B 95% so với 3B 73% trên câu chưa gặp; engine tự chọn theo bộ nhớ máy.

## 5. Rủi ro đã biết

- **DWG**: định dạng đóng; đọc/ghi đầy đủ cần thư viện có giấy phép (ví dụ ODA Drawings SDK — có
  phí). DXF làm được bằng mã mở. Cần quyết định trước khi hứa "mở DWG".
- **Mô hình AI offline**: dung lượng GGUF/MLX vài GB phải đóng gói hoặc tải lần đầu (có checksum,
  không cần tài khoản).
- **Asset handoff**: các ảnh trong `assets/` là ảnh cắt 1x từ mockup, có lẹm viền và nhỏ hơn ô hiển
  thị (thumbnail phải phóng ~1.15–1.2×). Nên xuất lại ở @2x cho màn Retina.
