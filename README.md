# TH AI CAD Studio

Hệ thống CAD đa ngành tích hợp AI chạy offline trên macOS Apple Silicon.

> **Native:** `native/` (C++20 / Qt 6 / Open CASCADE / llama.cpp) — xem [native/README.md](native/README.md).
>
> **Trạng thái (2026-10-10):** UI sản phẩm (React + Vite + TS, sẽ chạy trong Qt 6 WebEngine — phương án
> A đã chốt) cho cả 4 màn: **Dashboard**, **CAD 2D Workspace**, **AI Intelligence Studio** và **Architecture / BIM
> Workspace**. Màn CAD 2D chạy trên một **mô hình prototype
> TypeScript** (`ui/src/cad/`) để dựng và kiểm thử hợp đồng Command Bus — **không phải CAD Engine
> native** (C++20/OCCT, chưa viết). Không đọc DWG; mở/xuất được DXF. Local AI chưa kết nối: phiên chat
> trong AI Studio là phiên mẫu, tin nhắn mới không nhận câu trả lời bịa; số liệu demo gắn cờ `source: 'demo'`. Xem [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Cấu trúc

```
th-ai-cad-studio/
├── ui/                     # UI shell (React 19 + Vite + TS, CSS Modules)
│   ├── public/assets/      # asset chính thức từ gói handoff (giữ nguyên tên file)
│   │   └── extracted/      # vài ảnh nhỏ cắt từ mockup vì gói chưa có (xem README trong đó)
│   ├── src/
│   │   ├── components/     # shell/ (AppWindow, Sidebar, TopBar, SearchBar, LanguageSwitch, PromoCard)
│   │   │                   # ui/ (ActionButton, SectionHeader, Popover/Menu, Modal, Field, Toast, CroppedImage)
│   │   │                   # icons/ (Lucide + icon tự vẽ cùng phong cách)
│   │   ├── cad/            # mô hình prototype: types, geometry, commandBus, commands (bảng lệnh AutoCAD), dxf, checks, seed
│   │   ├── ai/             # phiên mẫu của AI Studio (dữ liệu demo, có nhãn)
│   │   ├── bim/            # mô hình BIM prototype: tường/cửa/phòng/cao độ, khối lượng tính toán, kiểm tra mô hình
│   │   ├── screens/        # dashboard/, cad2d/, ai/, bim/ (đã xong), placeholder/ (Projects, Mechanical… ngoài mockup)
│   │   ├── state/          # zustand: settings (persist), workspace (persist), router (hash), toast
│   │   ├── services/       # ranh giới tới native host: localAi, componentLibrary (hiện là demo)
│   │   ├── i18n/           # en.ts (nguồn), vi.ts (được type-check theo en)
│   │   └── styles/         # tokens.css (màu/size đo từ mockup), global.css
│   └── tools/              # capture.mjs, smoke.mjs, rects.mjs, inkbox.py… (QA fidelity)
├── qa/                     # ảnh chụp thực tế, overlay so sánh, báo cáo
└── docs/ARCHITECTURE.md    # kiến trúc dài hạn (engine C++20/Qt 6/OCCT, Local AI, command system)
```

## Chạy

```bash
cd ui && npm install && npm run dev
```

Mở http://127.0.0.1:5173 — mặc định hiển thị dạng "cửa sổ macOS trên desktop" giống mockup.
Thêm `?shell=native` để bỏ khung (khi nhúng vào app desktop, hệ điều hành tự vẽ nút cửa sổ).

## Kiểm thử

```bash
cd ui && npm run test:smoke
```

```bash
cd ui && node tools/capture.mjs dashboard ../qa/dashboard_en.png en
```

```bash
cd ui && node tools/smoke-cad2d.mjs
```

```bash
cd ui && node tools/smoke-ai.mjs
```

```bash
cd ui && node tools/smoke-bim.mjs
```

Cần dev server đang chạy. Dashboard: 14 kịch bản; CAD 2D: 19; AI Studio: 14; BIM: 16 (vẽ bằng dòng lệnh và chuột,
chọn, sửa thuộc tính, xoá, undo/redo, phím F, lớp, xuất/nhập DXF, layout, AI chưa kết nối…).
Kết quả đối chiếu mockup: [qa/QA_DASHBOARD.md](qa/QA_DASHBOARD.md), [qa/QA_CAD2D.md](qa/QA_CAD2D.md), [qa/QA_AI_STUDIO.md](qa/QA_AI_STUDIO.md), [qa/QA_BIM.md](qa/QA_BIM.md).

## Quy ước

- Không đổi bố cục/màu/font/icon so với mockup. Token nằm ở `ui/src/styles/tokens.css`.
- Font: **Roboto (variable, bundle offline, có subset tiếng Việt)** — khớp số đo chữ của mockup.
- Thêm chuỗi giao diện: thêm vào `i18n/en.ts` trước, TypeScript sẽ báo thiếu ở `vi.ts`.
- Dữ liệu demo phải đi qua `services/*` và mang `source: 'demo'`; không vẽ số liệu giả trực tiếp trong component.
