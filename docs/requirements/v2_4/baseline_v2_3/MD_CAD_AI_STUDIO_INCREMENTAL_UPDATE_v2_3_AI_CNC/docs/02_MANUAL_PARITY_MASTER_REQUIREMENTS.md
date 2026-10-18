# MANUAL PARITY — AUTO CAD / SKETCHUP / 3DS MAX

## A. Khóa chuẩn tham chiếu

Việc yêu cầu "tương thích 100%" không có nghĩa sao chép code Autodesk/Trimble, giao diện độc quyền hay lách bản quyền. Hãy **mô phỏng hành vi công cụ** bằng implementation được cấp phép và có kiểm thử.

1. Trong giai đoạn Audit, chốt **phiên bản / hệ điều hành / edition** của 3 sản phẩm tham chiếu (baseline gợi ý: AutoCAD desktop 2026, SketchUp desktop 2026, 3ds Max desktop 2026; xác nhận với chủ dự án trước khi đóng băng).
2. Phân ranh core product, specialized toolsets, extension/plugin, third-party render, scripting API; không giả định chúng là một sản phẩm duy nhất. Nếu chủ dự án yêu cầu cả extension, phải thêm tên/version và tài liệu.
3. Lập `parity_registry` **đầy đủ** theo tài liệu chính thức: `product`, `version`, `platform`, `workspace`, `category`, `feature_id`, `command`, `alias`, `keyboard_shortcut`, `mouse_behavior`, `dialog_fields`, `selection_behavior`, `input_state_machine`, `expected_geometry`, `supported_formats`, `reference_url`, `implementation_module`, `test_id`, `status`, `gap_reason`.
4. Không lấy danh mục 401 lệnh cũ làm "toàn bộ AutoCAD"; nó chỉ là danh mục khởi đầu.
5. Trạng thái bắt buộc: `UNAUDITED`, `AUDITED`, `PLANNED`, `IMPLEMENTED_UNTESTED`, `PASS`, `FAIL`, `BLOCKED`. **% parity = PASS / AUDITED BASELINE TOTAL**, đồng thời công bố số UNAUDITED/PLANNED để không che giấu phần chưa kiểm kê. Không tuyên bố 100% nếu còn gap hoặc audit chưa trọn.

## B. 3 workspace compatibility tách biệt

### 1) AutoCAD Compatible — Drafting 2D/BIM annotations
- Command Line thật (alias, lệnh đầy đủ, lệnh có dấu `-` khi applicable); trạng thái nhập lệnh theo bước; ESC, Enter/Space repeat; UI feedback.
- LINE/PLINE/ARC/CIRCLE/ELLIPSE/RECTANG/SPLINE/REGION, MULTILINE, HATCH, FILL, LAYER, BYLAYER, BLOCK/INSERT, GROUP, XREF, text/dim/mleader, hatch patterns, layouts and print.
- Modify: MOVE, COPY, ROTATE, SCALE, MIRROR, STRETCH, TRIM, EXTEND, FILLET, CHAMFER, OFFSET, ARRAY, ALIGN, JOIN, EXPLODE, BREAK, grips, selection windows/crossing, crossing polygon, object snap tracking, ortho/polar, dynamic input, UCS/WCS, precision coordinates (absolute/relative/polar).
- 3D AutoCAD-style entity/solid commands if within frozen edition, plus data exchange.
- `acad.pgp` import compatibility for alias where legally appropriate; hotkey config separate from aliases. Mouse wheel/pan/orbit must match.
- DWG import/export via lawful compatible tooling and round-trip testing; never call DWG 100%-compatible without exact evidence.

### 2) SketchUp Compatible — Fast 3D
- Viewport orbit/pan/zoom/zoom extents, inference engine axis lock, endpoint/midpoint/on-face snap, push/pull, line, rectangle, circle, arc, polygon, freehand, follow-me, offset, scale, rotate, move with copies and arrays.
- Groups/components/instances, nested edits, section planes, tags/layers, materials, entity information, model units, solid operations, outliner/scenes/styles, dimension/text, import/export per baseline.
- Measurement input: type exact lengths and repeat/array using model conventions; precise 3D topology and edit feedback.
- Native hotkey profile, editable shortcuts, export/import profile where feasible. Make Mac OS reserved shortcut conflicts explicit, with tested alternatives.

### 3) 3ds Max Compatible — Advanced Mesh Modeling
- Object transforms, pivot/gizmo, snapping, viewports, selection sets, hierarchy, modifiers + non-destructive stack, Edit/Editable Poly (vertex/edge/border/polygon/element), insets, extrudes, bevel, chamfer, bridge, loop/ring, cut/connect, smoothing/subdivision, normals.
- UVW Map, Unwrap UVW, materials/shaders, lighting, cameras, instancing, groups, scene graph, keyframe/animation timeline, rigs/deformers, rendering workflow as specified by selected baseline.
- Context-specific hotkeys (e.g. UV editor/mesh editor/material editor), dedicated profile and conflict detection. 3ds Max scripting ecosystem and third-party plugins must be separately inventoried for required scope.

## C. Không thể có một bộ hotkey mặc định cho mọi workspace

Ví dụ **Space** có nghĩa khác nhau giữa SketchUp và 3ds Max, và trong AutoCAD còn có ngữ cảnh Command Line. Thiết kế 3 profile và dispatcher theo workspace + focus:

```
InputEvent → ActiveWorkspace → FocusContext → KeymapProfile
           → Command Registry → Native CAD/3D Tool State Machine
```

- Profiles `AutoCAD Legacy`, `SketchUp Legacy`, `3ds Max Legacy`, `MD Native`.
- Import custom mapping, visual keyboard map, command search, collision warning, revert to product defaults, per-user overrides.
- Chuyển mode phải cập nhật help, shortcut hints và thao tác chuột mà không đổi bản vẽ; unit precision không bị ảnh hưởng.

## D. Các engine phải cùng tồn tại

- 2D CAD geometry/document/constraints/annotation engine.
- Parametric B-Rep solids for architectural/manufacturable geometry (e.g. Open CASCADE).
- Polygon mesh/modifier/UV scene engine riêng cho kiểu 3ds Max.
- BIM semantics/families/levels/quantities, reused in Interior and MEP.
- Production/CAM deterministic engine separate from beauty mesh. Rendered meshes **không được xem như dữ liệu đủ để xuất G-code**.
- Single canonical Document/Revision + IDs, transaction/undo, interoperable typed tool bus, graph/scene sync, conversion warnings when semantics lost.

## E. Nghiệm thu nghiêm ngặt

Cho mỗi mục trong registry phải có test hành vi chuột/phím/tọa độ/UI và test geometry/file. Quay video chạy native, chụp screenshot, test undo/redo, lưu–mở lại, xuất định dạng có round trip. Không pass một lệnh nếu chỉ hiển thị nút/tooltip/animation. Ngay cả cùng tên lệnh nhưng hành vi khác, phải FAIL.

Nguồn tham khảo chính thức để Claude lập baseline (không copy mã nguồn/asset độc quyền):
- https://help.autodesk.com/cloudhelp/2022/ENU/AutoCAD-DidYouKnow/files/GUID-D2B4BF16-B1F7-4EF2-89AF-88ACE85FAD73.htm
- https://www.autodesk.com/products/autocad/overview.htm
- https://help.sketchup.com/en/default-keyboard-shortcuts
- https://help.sketchup.com/en/creating-and-editing-shortcuts
- https://help.autodesk.com/cloudhelp/2026/ENU/3DSMax-Basics/files/GUID-6D38579A-C018-47F6-AC57-2578CF903F2D.htm
- https://help.autodesk.com/cloudhelp/2026/ENU/3DSMax-Modeling/files/GUID-6055787D-E988-4C92-A568-85C317BF4F58.htm
