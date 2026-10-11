# TH AI CAD Studio — native (C++20 / Qt 6 / Open CASCADE / llama.cpp)

Phương án A đã chốt: **Qt 6 host + Qt WebEngine hiển thị UI (`../ui`) + engine C++ native**, nối qua
`QWebChannel`. Mọi thay đổi bản vẽ đi qua Command Bus C++; AI chỉ được tạo **đề xuất** (proposal), muốn
áp dụng phải `approve`.

## Thành phần

| Thư mục | Nội dung |
|---|---|
| `libs/core` | Hình học 2D, mô hình thực thể/lớp, **Command Bus** (validate → preview → commit → undo/redo, batch nguyên tử), bảng lệnh AutoCAD (28 lệnh, alias, `x,y` / `@dx,dy` / `@d<góc`), JSON, định dạng op JSON (gồm `rect`, `eraseWhere`, toạ độ tương đối), **ProposalQueue** (tự đổi ID trùng, giải bộ lọc thành ID), DXF R12 đọc/ghi, kiểm tra bản vẽ |
| `libs/bim` | Mô hình BIM Villa Riverside (giống hệt `ui/src/bim/model.ts`): khối lượng tính toán, kiểm tra mô hình 0/3/5/0/0, vị trí tường trên mặt bằng |
| `libs/geom_occt` | Open CASCADE 7.9: khối tường, **khoét lỗ cửa bằng boolean**, thể tích chính xác (BRepGProp), dựng cả công trình, ép đùn đa tuyến kín, xuất **STEP**, **trình vẽ offscreen** (Shaded / Wireframe / Hidden Line thật bằng HLR, xoay/kéo/zoom, preset, tô sáng đối tượng) |
| `libs/ai` | Runtime AI cục bộ: **llama.cpp** (Metal, nạp GGUF từ ổ đĩa, không mạng), trạng thái đo thật, giải mã **hybrid** (tự do → ngữ pháp GBNF khi không hợp lệ), trợ lý biến yêu cầu → op JSON → **proposal**; `thcad-cli ai-eval` đánh giá trên 3 bộ câu |
| `app` | Ứng dụng macOS `TH AI CAD Studio.app`: cửa sổ title bar trong suốt, WebEngine nạp UI qua scheme `thcad://`, cầu nối `window.thcadHost`; CAD 2D **đồng bộ với Command Bus C++** (engine có quyền quyết định, giao diện tự hoàn tác khi bị từ chối); khung 3D BIM hiển thị mô hình OCCT thật **nằm dưới** các nút web |
| `tools/thcad_cli.cpp` | `thcad-cli`: script lệnh kiểu AutoCAD → DXF, `bim-check`, `extrude` → STEP, `ai` |
| `tests` | 22 kiểm thử đơn vị (core, BIM, AI, OCCT) |

## Build & chạy

Cần (máy phát triển): Xcode CLT, CMake ≥ 3.24, Ninja, Homebrew `qtbase qtwebchannel qtwebengine opencascade llama.cpp`.

```bash
cmake -S . -B build -G Ninja && cmake --build build
```

```bash
./build/tests/thcad_tests
```

```bash
open "build/app/TH AI CAD Studio.app"
```

Đóng gói `.app` tự chứa (người dùng cuối **không** cần Homebrew/Python/Ollama/API key):

```bash
./package_macos.sh
```

→ `dist/TH AI CAD Studio.app` (~339 MB, tự chứa).

### Bộ cài macOS (.dmg)

```bash
./packaging/macos/make_dmg.sh
```

→ `dist/TH-AI-CAD-Studio-<ver>-macOS-arm64.dmg` (~104 MB). **Miễn phí**: ký ad-hoc + hardened runtime
(`packaging/macos/entitlements.plist`: JIT cho Chromium/V8, nạp backend ggml). Máy khác mở lần đầu sẽ
bị Gatekeeper chặn → chuột phải → Open, hoặc System Settings → Privacy & Security → Open Anyway.
Có Apple Developer Program ($99/năm) thì cùng script ký Developer ID + notarize + staple, mở không cảnh báo:
`DEVELOPER_ID="Developer ID Application: … (TEAMID)" NOTARY_PROFILE=thcad ./packaging/macos/make_dmg.sh`.

### Bộ cài Windows (.exe)

Mã nguồn đã tách phần riêng macOS (Cocoa/AppKit, sysctl, `_NSGetExecutablePath`) sang nhánh Windows
(WNT_Window, `GlobalMemoryStatusEx`, `GetModuleFileNameW`, `%LOCALAPPDATA%\TH AI CAD Studio\models`).
Lõi (core/bim/ai + test + CLI) đã biên dịch chéo thành `.exe` bằng MinGW trên Mac. App đầy đủ phải
build bằng MSVC trên máy Windows (Qt WebEngine không hỗ trợ MinGW):

```powershell
cd native\packaging\windows; .\build_windows.ps1
```

→ `dist-win\TH-AI-CAD-Studio-Setup-<ver>.exe` (Inno Setup; Qt qua aqtinstall, OCCT + llama.cpp qua vcpkg,
tất cả miễn phí). Không ký thì SmartScreen cảnh báo lần đầu (More info → Run anyway).

## Biến môi trường (phát triển / QA)

| Biến | Tác dụng |
|---|---|
| `THCAD_UI_URL=http://127.0.0.1:5173` | Dùng Vite dev server thay cho UI đóng gói |
| `THCAD_ROUTE=bim` | Màn mở đầu |
| `THCAD_NATIVE_VIEWPORT=1` | Bật viewport 3D OCCT native trong màn BIM (thử nghiệm, xem hạn chế) |
| `THCAD_MODEL=/path/model.gguf` | Chọn mô hình. Mặc định: trong `~/Library/Application Support/TH AI CAD Studio/models/`, mô hình lớn nhất có trọng số ≤ 35% bộ nhớ máy (32 GB → Qwen2.5-7B), hoặc tên ghi trong `models/default.txt`. `thcad-cli models` liệt kê, `*` = đang dùng |
| `THCAD_SELFTEST=1` | Chạy `app/resources/selftest.js` trong trang thật, in `SELFTEST …` |
| `THCAD_GRAB=/x.png`, `THCAD_OCCT_DUMP=/y.png`, `THCAD_QUIT_AFTER_MS` | Chụp UI, chụp khung 3D, tự thoát |

## Kiểm thử trong app

| Script | Kiểm tra |
|---|---|
| `THCAD_SELFTEST=1` | 10 kiểm tra cầu nối (engine, AI, command bus, proposal, BIM, OCCT) |
| `THCAD_QA=1 THCAD_SCRIPT=$PWD/app/resources/e2e_ai.js` | 7 — AI thật qua giao diện chat → đề xuất → duyệt → CAD 2D |
| `… e2e_cad.js` | 12 — CAD 2D ⇄ engine: vẽ, undo/redo, engine từ chối → tự hoàn tác, đổi tab |
| `… e2e_bim3d.js` | 9 — 3D OCCT trong slot web: 3 chế độ, view cube, tô sáng, sửa mô hình → dựng lại, ⌘Z |
| `… e2e_gpu.js` | 4 — bản vẽ lớn: WebGL2 có trong QtWebEngine, hình vẽ bằng lớp GPU, zoom ≤ 2 vsync |

## Hạn chế hiện tại (nói thẳng)

- **Độ chính xác AI trên câu chưa gặp:** 7B 21/22 (95%), 3B 16/22 (73%) — mẫu nhỏ (xem `qa/QA_AI_LOCAL.md`); lỗi hiện rõ ở bước xem trước, không tự áp dụng. 7B chậm hơn (~3.3 s so với ~2 s mỗi yêu cầu).
- **Chế độ "Realistic"** vẫn là ảnh render đã duyệt (ảnh tĩnh); mô hình thật ở Shaded/Wireframe/Hidden Line.
- **Renderer 2D**: bản vẽ ≥ 2 000 đối tượng được vẽ bằng WebGL2 ngay trong web view (60 fps ở 200k đối
  tượng, xem `qa/QA_DWG_RENDER_PACKAGING.md`); không cần renderer native. Nét đứt (linetype) chưa có trên
  đường GPU.
- **Chưa đọc DWG** (chờ chọn thư viện); DXF R12–2018 đọc được, kể cả block, kích thước và hatch.
- **Phát hành**: `.dmg` ký ad-hoc (miễn phí, có cảnh báo lần đầu). Bản Windows chưa build/chạy thử thật
  (chưa có máy Windows) — script đã viết nhưng chưa được kiểm chứng.
- Biến `THCAD_NATIVE_VIEWPORT=1` (widget OpenGL đè lên web) đã được thay thế bằng trình vẽ offscreen; giữ lại để so sánh.
- Ảnh chụp bằng `screencapture` cho nội dung trống vì terminal chưa có quyền Screen Recording; QA dùng Qt grab.
