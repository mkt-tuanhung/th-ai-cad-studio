# ENGINE / LIBRARY SELECTION — ƯU TIÊN MIỄN PHÍ, OFFLINE

**Tất cả là đề xuất TÍCH HỢP, KHÔNG phải bằng chứng đã cài trong MD CAD AI STUDIO.** Trước khi thêm thư viện, Claude audit đã có gì và license; giảm tối đa dependencies, cài bên trong app hoặc build pipeline, không yêu cầu người dùng cài Python/Ollama thủ công.

| Nhu cầu | Ưu tiên | Đánh giá / giới hạn |
|---|---|---|
| CAD 2D geometry, 3D solids | Open CASCADE Technology (OCCT) | Native 3D B-Rep & geometry, **không** phải clone AutoCAD/SketchUp đầy đủ; xem license OCCT. |
| DXF import/export | ezdxf (MIT) | Python helper cho DXF; không tự đọc/ghi DWG; có thể dùng importer native đã có để bớt overhead. |
| Ảnh/PDF scan preprocessing | OpenCV (Apache-2.0; kiểm tra theo version) | Deskew, contour, Hough lines, biến đổi tọa độ; **không** tự hiểu công năng phòng. |
| OCR bản vẽ | PaddleOCR (kiểm tra license model + library) hoặc Tesseract OCR (Apache-2.0) | Nhận kích thước/text, cần benchmark tiếng Việt/ký hiệu/dim chuyên ngành. |
| BIM IFC | IfcOpenShell (LGPL; kiểm tra version) | IFC objects + shape data, có geometry kernel OCCT; không tự suy ra 3D từ linework. |
| Mesh, UV, render/3D automation | Blender (GPL; dùng process/asset pipeline cần review license) | Python automation/headless; không thay thế parametric manufacturing core. |
| Reference CAM | FreeCAD CAM Workbench | CAM job, tool, stock, postprocessor pattern; có thể tích hợp qua module/CLI theo điều kiện giấy phép, KHÔNG mặc định nhúng nguyên app. |
| Polygon offset, inside/outside | Clipper2 (Boost Software License; kiểm tra) | Offset, boolean; chú ý dữ liệu polygon precision; phần triangulation có cảnh báo. |
| Nesting/bin packing | libnest2d (LGPL-3.0; kiểm tra) | Có thể dùng thử cho irregular parts; tủ panel cần extension vân, face, clamp, kerf, machine reach. |
| Local LLM | llama.cpp hoặc MLX/MLX-LM + model nhỏ có license thương mại phù hợp | Ra typed commands, task planner; không làm CNC controller; benchmark RAM/VRAM/QA. |
| DWG import/export | ODA File Converter standalone cho nghiên cứu; licensing thương mại/SDK riêng | DXF trước, DWG production chỉ sau được phép phân phối và tương thích kiểm chứng. |
| G-code verifier | Controller-specific parser + tested CAM backplot (custom) | Không có simulator phổ quát nào tự đủ để chứng nhận máy vật lý; CAMotics (GPL) có giới hạn mô phỏng/va chạm. |

## Kiến trúc module có thể thay thế
`ImageIngest adapter`, `DocumentVectorizer`, `CAD Canonical Engine`, `BIM/Interior Mapper`, `Parametric Cabinet Catalog`, `PartMaster`, `Nest Engine`, `CAM Operations`, `Controller Postprocessors`, `NC Interpreter & Validation`, `Autonomy Orchestrator`.
API module dùng typed data (struct/schema) & versioned contracts, CI unit tests; AI chỉ điều phối.

## License & operation
- LGPL: nghĩa vụ khi link/phân phối, cung cấp thông báo/source portions theo license; cần kiểm tra dynamic linking và relinking requirements.
- GPL: tích hợp vào sản phẩm thương mại cần xem tính tương thích copyleft và tách process có thực sự phù hợp không, nên tư vấn license trước.
- "Miễn phí tải về" ≠ "miễn phí tích hợp thương mại"; model AI có thể có license riêng.
- Đánh giá hiệu năng Mac Apple Silicon, dependencies aarch64, memory use và offline asset caching.

## Official docs / sources consulted October 2026
- FreeCAD CAM workflow: https://github.com/FreeCAD/FreeCAD-documentation/blob/main/wiki/CAM_Workbench.md
- LinuxCNC G-code dialect: https://www.linuxcnc.org/docs/html/gcode.html
- LinuxCNC multi-spindle M-codes: https://github.com/LinuxCNC/linuxcnc/blob/master/docs/src/gcode/m-code.adoc
- ezdxf limitations: https://ezdxf.readthedocs.io/en/stable/introduction.html
- IfcOpenShell geometry: https://docs.ifcopenshell.org/ifcopenshell-python/geometry_processing.html
- Clipper2 project: https://github.com/AngusJohnson/Clipper2
- libnest2d: https://github.com/tamasmeszaros/libnest2d
- CAMotics limitations: https://camotics.org/
