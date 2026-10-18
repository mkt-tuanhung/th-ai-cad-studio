# QA — Render cục bộ v2.4 (GLB, Blender Cycles, bookmark, Ngày/Hoàng hôn/Đêm, so sánh, phương án vật liệu)

**Ngày:** 2026-10-18 · **Máy:** MacBook Apple M1 Max, 32 GB · **Blender:** 5.2.2 LTS (`/Applications/Blender.app`, bản anh đã cài, chạy như tiến trình riêng, **không đóng gói**) · **OCCT:** 7.9.3

Thiết kế: `docs/v2_4/AUDIT_AND_DELTA.md` §3.4. Crosswalk: SP38, SP40–SP46, SP63. Nghiệm thu: V24-015, V24-036, V24-041…V24-047.

Mọi ảnh render, file sidecar và GLB đều mang nhãn **"PRESENTATION ONLY – không dùng cho kích thước, BOM, khối lượng hay CNC"**. Không có đường nào từ render đi vào BOM/CNC.

## 1. Đã làm gì (tóm tắt)

| Hạng mục | Cách làm | Vị trí code |
|---|---|---|
| Xuất GLB (SP38) | Tự viết glTF 2.0 binary từ chính B-rep OCCT (BRepMesh): mỗi phần tử 1 node (tên = id, extras = id/mat/group), vật liệu PBR theo màu + bề mặt, mm → m, Z-up → Y-up. Không dùng `RWGltf_CafWriter` vì bản OCCT Windows (vcpkg, CI) không bật RapidJSON — writer đó sẽ không chạy trên Windows; Homebrew thì có `TKDEGLTF`. | `native/libs/geom_occt/src/gltf.cpp`, `SceneView::writeGlb` |
| Nút "Export GLB" | Thêm vào menu Export sẵn có của BIM, Nội thất và Cơ khí (cạnh STEP/IFC), không đổi bố cục | `BimHeader.tsx`, `InteriorScreen.tsx`, `MechanicalScreen.tsx` |
| Blender worker (SP42/43/63) | `QProcess`: `blender -b --factory-startup --offline-mode -noaudio -P md_render.py -- job.json`, bọc trong `sandbox-exec` cấm mạng (macOS). Không bao giờ chạy trên luồng giao diện. Metal GPU khi có, không thì CPU. AgX tone mapping, preset Ngày / Hoàng hôn / Đêm. Tiến độ đọc từ stdout (`Sample n/N`). Huỷ = kill tiến trình + xoá thư mục job. | `native/app/src/blender_worker.*`, `native/app/resources/md_render.py`, `HostBridge::renderStartBlender / blenderDone` |
| Khoá revision lúc xếp hàng | Khi job vào hàng đợi: chụp spec cảnh + revision, hash hình học từ kernel, GLB (job Blender), khung 3D trực tiếp từ camera. Sửa mô hình sau đó không đổi job. | `ui/src/renders/snapshot.ts`, `runner.ts` |
| Sidecar provenance | `<ảnh>.provenance.json` cạnh ảnh: scene id + revision lúc xếp hàng, hash GLB, camera (eye/at/up/fov/lens), thiết lập, engine, thiết bị, sha256 ảnh, nhãn trình bày; PNG có thêm text `Comment` cùng nhãn | `host_bridge.cpp writeProvenance` |
| Chọn engine | "Render Engine" có thêm **Blender Cycles (local)**; các lựa chọn cũ hiện là "OCCT …". Không có Blender → render bằng OCCT và **badge ghi rõ "Blender not found — rendered with the OCCT path tracer instead"**. Panorama/video vẫn dùng OCCT. | `RenderSettingsPanel.tsx`, `runner.ts` |
| Cài đặt | Settings → Integrations hiện "Blender (photoreal renders): 5.2.2 · /Applications/…" hoặc "Not found — OCCT is used" | `SettingsCards.tsx` |
| Camera bookmark (SP41) | `{eye, at, up, fov, lens, level, hidden/isolate, section, lighting, scene revision, render settings}`. Lưu/khôi phục từ menu view sẵn có của 3D BIM ("3D - Section View") và Nội thất ("3D - Perspective"); mỗi bookmark cũng thành một camera trong Renders. | `ui/src/renders/bookmarks.ts`, `Viewer3D.tsx`, `InteriorViewport.tsx` |
| Ngày/Hoàng hôn/Đêm realtime (SP40) | `SceneView::setLighting` chỉ đổi đèn + nền. Có `geomHash` để chứng minh hình học không đổi. Live view của Renders theo preset của thiết lập. | `scene.cpp`, `NativeScene.tsx` |
| So sánh trước/sau (SP45) | Hộp thoại trong Renders (Save View → "Compare live 3D ↔ render…", hoặc nhấp đúp một dòng History): khung OCCT lúc xếp hàng và ảnh render, thanh trượt, revision đọc từ sidecar. | `screens/renders/CompareDialog.tsx` |
| Phương án vật liệu (SP46) | Menu "Render Current View ▾" → "Render material options (4)": As designed / Warm timber / Concrete & steel / White marble. Cùng một snapshot (cùng GLB), chỉ đổi vật liệu theo nhóm. | `provenance.ts MATERIAL_OPTIONS`, `state/renders.ts enqueueMaterialOptions` |
| Chặn bộ nhớ 4K/8K (SP44) | Ước tính bộ nhớ (OCCT ≈ 300 MB + 110 B/px; Blender ≈ 900 MB + 120 B/px) so với 60 % RAM vật lý; vượt thì từ chối trước khi cấp phát gì. `THCAD_RENDER_MEM_LIMIT_MB` giả lập máy ít RAM. Ô ước tính trong Output hiện thêm "render memory ≈ … GB". | `host_bridge.cpp memoryCheck`, `RenderSettingsPanel.tsx` |

Chuỗi mới có EN + VI trong `ui/src/i18n/ws/render24.ts`.

## 2. Lệnh đã chạy và kết quả

Chuẩn bị (worktree): symlink theo `AGENT_BRIEF.md`, `cmake --build native/build`, dev server riêng cổng **5291** (cấu hình tạm có `server.fs.allow` gồm `ui/node_modules` của bản chính, không commit).

| # | Lệnh | Kết quả |
|---|---|---|
| 1 | `cd ui && npx tsc --noEmit -p tsconfig.app.json` | **PASS** (0 lỗi) |
| 2 | `cd ui && UNIT=render node tools/test-cam.mjs run` | **PASS 24/24** (revision, provenance, trạng thái huỷ, bookmark, preset, phương án vật liệu, bộ nhớ, đọc GLB) |
| 3 | `UNIT=render node tools/test-cam.mjs glbFile <villa.glb>` / `<interior.glb>` | **PASS** — villa 46 node, 1084 tam giác, 14000 × 10000 × 9200 mm; nội thất 30 node, 3668 tam giác, 14300 × 10530 × 3040 mm |
| 4 | e2e desktop, lượt A (có Blender): `qa/tools/rune2e.sh $PWD/native/app/resources/e2e_blender.js 600 THCAD_PROFILE=agent-render24 THCAD_UI_URL=http://127.0.0.1:5291 THCAD_SPLASH=0 THCAD_RENDER_OUT=$PWD/qa/v2_4/render THCAD_DOWNLOAD_DIR=$PWD/qa/v2_4/render THCAD_RENDER_CACHE=<tmp>/cache THCAD_GLB_OUT=<tmp>/e2e.glb THCAD_DWG_SAMPLE=<tmp>/e2e.glb` | **PASS 34, FAIL 0** (sau khi merge `main`) |
| 5 | e2e desktop, lượt B (không Blender + máy ít RAM): như trên + `THCAD_BLENDER=none THCAD_RENDER_MEM_LIMIT_MB=1200`, `THCAD_RENDER_OUT=$PWD/qa/v2_4/render/fallback` | **PASS 9, FAIL 0** |
| 6 | Self-test trong app (`THCAD_SELFTEST=1`, chạy cả trên CI Windows): thêm 2 kiểm tra GLB + preset ánh sáng | **SELFTEST DONE OK** |
| 7 | Mạng bị chặn: `sandbox-exec -p '(version 1)(allow default)(deny network*)' Blender -b --factory-startup --offline-mode -P qa/tools/blender_offline_probe.py` | **all-blocked**: 1.1.1.1:443 và 8.8.8.8:53 `PermissionError`, `api.blender.org` không phân giải được; `online_access = False` |
| 8 | `THCAD_UI=http://127.0.0.1:5291 node tools/smoke-renders.mjs` (đã thêm 3 bước v2.4 + kiểm tra VI) | **PASS 14/14**, không lỗi console |
| 9 | Các smoke khác: settings, bim, interior, interior-plan, mechanical, ai, auto, bim-draw, brand, cad2d, civil-tools, civil, components, fromcad, mep-draw, mep, part, projects, route, scan, survey | **Tất cả PASS**, không FAIL |
| 10 | e2e hồi quy (bản sao trỏ ảnh QA ra thư mục tạm): `e2e_panovideo` 3/3, `e2e_view3d` 23/23, `e2e_bim3d` 9/9, `e2e_interiorcut` 4/4, `e2e_bimviews` 11/11 (cần `THCAD_DWG_OUT`, nếu không bước DWG cuối mở hộp thoại lưu và chờ) | PASS |

Ghi chú: lần render Blender **đầu tiên** trên một máy mất ~80 s vì Cycles biên dịch kernel Metal (chỉ một lần, có cache). Sau đó villa 480 × 270, 32 mẫu ≈ 3,2–3,5 s tính cả khởi động Blender.

## 3. Kết quả theo bài nghiệm thu

| Bài | Nội dung | Đã chạy | Bằng chứng |
|---|---|---|---|
| **V24-036** GLB | Kích thước + id vật liệu ổn định | ✅ PASS | e2e A: hộp bao GLB = hộp bao OCCT chính xác (±1 mm; thực tế lệch 0,0 mm) cho villa và nội thất; id vật liệu từng phần tử khớp mô hình; xuất lại lần 2 trùng sha256. Blender nhập lại được GLB (các render bên dưới). |
| **V24-041** Render offline | Cấm mạng mà vẫn ra ảnh | ✅ PASS | Worker chạy trong sandbox cấm mạng (`sandboxNetworkDenied: true` trong sidecar) và vẫn ra ảnh; probe #7 chứng minh sandbox thật sự chặn mạng; Blender chạy với `--offline-mode`. |
| **V24-042** Render nền | Giao diện vẫn phản hồi, đúng revision camera | ✅ PASS | Trong lúc Blender render: 32–35 lần gọi host, trung vị 0,4–0,5 ms, lớn nhất ≤ 57 ms (ngưỡng 250 ms). Sửa tường sau khi xếp hàng: revision trực tiếp đổi (`58d46b8ef034 → 6913ad05e72f`) nhưng job và sidecar giữ `58d46b8ef034`. |
| **V24-043** Huỷ | Tiến trình thoát, không đánh dấu hoàn thành | ✅ PASS | Job 1280 × 720 / 4096 mẫu bị huỷ sau ~150 ms → trạng thái `cancelled`, không có ảnh, không có sidecar, không vào History; job kế tiếp khởi động ngay (worker đã thoát). Thư mục job tạm bị xoá. |
| **V24-044** Ngày/Hoàng hôn/Đêm | Chỉ ánh sáng, hình học không đổi | ✅ PASS | `geomHash` (id + thể tích chính xác + hộp bao) giống hệt qua day/golden/night/standard (46 phần tử, 191,107 m³); 3 khung khác nhau: `render/realtime-*.png`. Self-test cũng kiểm. |
| **V24-045** Trước/sau | Hai ảnh cùng revision camera | ✅ PASS | Hộp thoại so sánh: "Same camera and scene revision 58d46b8ef034" (revision render đọc từ sidecar); thanh trượt cắt ảnh (`inset(0 65% 0 0)`); `render/compare-dialog.png`. |
| **V24-046** 4K khi ít RAM | Báo lỗi gọn, dự án không hỏng | ✅ PASS (giả lập) | Giới hạn 1200 MB: 4K Blender bị từ chối (cần ≈ 1,8 GB), 8K OCCT bị từ chối (≈ 3,7 GB) trước khi cấp phát; job `failed` có lời nhắn; mô hình BIM + nội thất giống hệt trước; store renders còn nguyên; render nhỏ ngay sau đó vẫn chạy. **Chưa** thử trên máy RAM thật nhỏ. |
| **V24-047** Ảnh concept AI | Không bao giờ đổi mô hình xây dựng | ⚠️ Một phần | SP47 (diffusion) vẫn **Blocked** (chờ chủ dự án). Phần áp dụng được đã kiểm: mọi đường render chỉ đọc snapshot, sidecar `feedsBom:false, feedsCnc:false`, mô hình không đổi sau render (lượt B). |
| **V24-015** Điểm nhìn đã lưu | Khôi phục đúng camera, FOV, tầng, revision | ✅ PASS | Lưu bookmark trong 3D BIM (menu "3D - Section View"), xoay camera + đổi tầng L2 + đổi ánh sáng, khôi phục: eye/at/up/fov trùng tuyệt đối, tầng L1, ánh sáng golden, mặt cắt, revision khớp; bookmark xuất hiện thành camera trong Renders. `render/bim-bookmark-restored.png`. |
| SP46 phương án vật liệu | Cùng mô hình, khác vật liệu | ✅ PASS | 4 job dùng chung 1 GLB (`f268b88c…`), cùng geomHash và revision; 4 ảnh khác nhau (sha256 khác), sidecar ghi `materialOption`. |
| Fallback không có Blender | Báo trong giao diện | ✅ PASS | `THCAD_BLENDER=none`: job Blender render bằng OCCT, badge ghi "Blender not found — rendered with the OCCT path tracer instead", sidecar `fallback: "blender-missing"`. |

## 4. Ảnh mẫu (`qa/v2_4/render/`)

| File | Là gì |
|---|---|
| `Cam 01 - e2e Blender villa.png` + `.provenance.json` | Villa, Blender Cycles Metal, 480 × 270, 32 mẫu, preset Day |
| `Cam 03 - e2e Blender interior.png` | Nội thất phòng khách, 320 × 180 |
| `Cam 03 - As designed / Warm timber / Concrete & steel / White marble.png` | 4 phương án vật liệu, cùng hình học |
| `realtime-day / golden / night.png` | Viewport OCCT realtime với 3 preset (hình học không đổi) |
| `compare-dialog.png` | Hộp thoại trước/sau trong màn Renders (thu nhỏ 1000 px) |
| `bim-bookmark-restored.png` | 3D BIM sau khi khôi phục bookmark (ánh sáng hoàng hôn) |
| `fallback/*.png` + sidecar | Lượt B: render OCCT thay Blender; render nhỏ sau khi chặn 8K |

## 5. Hạn chế và việc còn lại

- Cảnh nội thất không có trần nên ảnh ban ngày bị chói (ánh nắng chiếu thẳng vào phòng); Đêm dùng đèn ấm đặt ở tâm mỗi phòng/sàn. Chưa có HDRI ngoài, cân bằng trắng.
- Trong cảnh Blender (chỉ cảnh render, không phải mô hình hay GLB) mép sàn mặc định được thu vào 3 mm để tránh vệt đen do mặt trùng nhau với tường.
- Thư mục cache (`~/Library/Caches/…/render-snapshots`: GLB, khung 3D) chưa có dọn tự động.
- Sau khi khởi động lại app, spec cảnh của job đang chờ (OCCT) không còn trong bộ nhớ: job chỉ render nếu mô hình vẫn ở đúng revision lúc xếp hàng, nếu không thì báo "scene changed since this job was queued".
- Hộp thoại so sánh dùng khung OCCT chụp lúc xếp hàng (640 px); khung realtime không có vật liệu PBR nên màu khác ảnh render — đây là đúng ý đồ (so hình học/camera).
- Việc đóng gói Blender vào bộ cài để phát hành vẫn là quyết định của chủ dự án (GPL); hiện **không đóng gói**.
- Windows: code worker tìm `Program Files/Blender Foundation/Blender*/blender.exe` và PATH, không có sandbox cấm mạng (chỉ `--offline-mode`); chưa chạy thử trên Windows.
