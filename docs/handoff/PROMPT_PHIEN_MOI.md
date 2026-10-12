# Prompt mở phiên Claude mới (dán nguyên khối dưới đây vào phiên chat đầu tiên)

> **Cách dùng:**
> - **Claude Code trên chính máy Mac này:** chỉ cần dán khối prompt bên dưới. Claude sẽ tự đọc các file trong repo.
> - **Claude trên web (claude.ai) không đọc được file trên máy:** dán khối prompt và **đính kèm thêm** `docs/handoff/AUDIT_2026-10-12.md`. Nếu được thì kèm cả `qa/QA_MODEL_DOWNLOAD.md` và `qa/QA_FINISH_3.md`.

---

```text
Chào em. Anh là Minh Dũng, chủ dự án phần mềm MD CAD AI STUDIO (tên cũ: TH AI CAD Studio). Anh vừa chuyển sang phiên chat mới, tiếp nối một phiên dài trước đó. Em đọc kỹ phần dưới rồi làm theo.

## Dự án
- Phần mềm CAD + AI chạy offline trên desktop, phát hành bằng file macOS .dmg (Apple Silicon) và Windows .exe.
- Stack đã khoá: UI React/TypeScript (Vite) chạy trong Qt 6 WebEngine; engine C++20; hình học Open CASCADE (OCCT); AI cục bộ llama.cpp với Qwen2.5-7B (máy RAM thấp dùng 3B); giọng nói whisper.cpp. Không cloud, không API key, không Python.
- Mã nguồn: /Users/mac/Downloads/TH_AI_CAD_Studio_UI_Handoff_v1/th-ai-cad-studio (git, nhánh main, repo private https://github.com/mkt-tuanhung/th-ai-cad-studio). Windows build bằng GitHub Actions: gh workflow run windows-installer --ref main.

## Việc đầu tiên em phải làm (chưa sửa code)
1. Đọc toàn bộ docs/handoff/AUDIT_2026-10-12.md. Đây là bản audit và bàn giao đầy đủ: luật đã khoá, kiến trúc, cách build, kiểm thử, trạng thái từng tính năng, rủi ro, việc đang mở.
2. Đọc thêm khi cần: docs/ARCHITECTURE.md, native/README.md, các file qa/QA_*.md (bằng chứng kiểm thử của từng phần).
3. Chạy git log --oneline -15 và git status để xác nhận trạng thái repo (commit cuối lúc bàn giao: 5911319).
4. Tóm tắt lại cho anh bằng tiếng Việt, ngắn gọn: em hiểu dự án đang ở đâu, các luật bắt buộc, và việc đang chờ. Sau đó mới làm tiếp.

## Luật bắt buộc (không được tự thay đổi)
- Tên sản phẩm "MD CAD AI STUDIO". Dòng credit "Xây dựng và phát triển bởi Minh Dũng" phải đúng từng chữ, không dịch, không bỏ, có ở intro của app và intro của bộ cài. Logo MD không được vẽ lại.
- Không tự đổi kiến trúc, stack hay thiết kế đã khoá. 12 màn giao diện đã được anh duyệt theo mockup (TH_AI_CAD_Studio_UI_LOCK_v2/mockups): code theo mockup, không redesign.
- AI chỉ được sửa bản vẽ hay mô hình qua trình tự: kiểm tra → đề xuất xem trước → anh bấm Duyệt → hoàn tác được. Phép tính do code làm, không để AI tự tính.
- Không giả trạng thái chạy. Thứ gì là demo phải gắn nhãn DEMO. Không báo "100 %" hay "Success" khi chưa kiểm chứng. Báo rõ cái gì đã kiểm, cái gì chưa.
- Em được tự cài công cụ, thiết lập môi trường, viết mã trong phạm vi dự án. PHẢI HỎI ANH TRƯỚC khi: xoá hoặc phá huỷ dữ liệu, đổi cấu hình hệ thống quan trọng, làm việc gì tốn tiền, tải thêm mô hình hay dữ liệu lớn.
- Ưu tiên giải pháp miễn phí.
- Giữ nguyên Qt applicationName "TH AI CAD Studio" và bundle id vn.th.aicadstudio (để không mất dữ liệu cũ). Không tự đổi visibility của repo GitHub.
- Làm trọn việc rồi báo một lần ở cuối, không dừng xin duyệt từng bước (trừ các việc phải hỏi ở trên). Báo cáo bằng tiếng Việt, xưng "em", gọi anh là "anh".

## Lưu ý kỹ thuật dễ sai
- Kiểm thử desktop dùng qa/tools/rune2e.sh. Có THCAD_QA=1 thì app dùng hồ sơ web riêng thcad-qa, không đụng dữ liệu của anh.
- Kịch bản e2e cần window.__thcad thì build UI bằng: VITE_QA_HOOKS=1 npm run build. Trước khi đóng gói DMG phải build lại bằng npm run build thường.
- Đóng gói Mac: cd native && ./package_macos.sh && ./packaging/macos/make_dmg.sh
- Mô hình AI trên máy anh nằm ở ~/Library/Application Support/TH AI CAD Studio/models (7B, 3B, whisper). Đừng xoá hay di chuyển.

## Việc đang chờ (tiếp tục từ đây)
Anh đã chọn làm cả hai hướng dựng 3D từ bản vẽ 2D, B trước; ưu tiên nội thất, xây dựng và máy CNC.
- B (nhà: DWG mặt bằng → BIM 3D, IFC, Nội thất, bảng cắt CNC) ĐÃ XONG ngày 2026-10-12, xem qa/QA_FROM_CAD.md. Chưa kiểm trên DWG thật do người vẽ: xin anh file nhà thật để kiểm.
- A (kênh, đường: DWG trắc dọc + trắc ngang theo lý trình → corridor 3D, mặt đất và mặt thiết kế, khối lượng đào đắp) CHƯA LÀM. Mẫu thật có trên máy: ~/Documents/Zalo Received Files/1. BVTK Kênh Đức Phong - Kênh đất.dwg (hỏi anh trước khi dùng).
Nguyên tắc: code đọc hình học, AI chỉ giúp nhận diện layer và đối tượng, kết quả vẫn qua bước đề xuất và duyệt.

Các việc khác còn mở, xem mục 9–10 của file audit: chưa thử nút tải mô hình AI trên máy Windows thật; AI chưa tự tạo được tường hay ống mới trong BIM/MEP; IFC và STEP mới chỉ xuất được, chưa mở được; ký mã (tốn phí) để sau; PWA giám sát từ xa để sau.

Bắt đầu bằng bước "Việc đầu tiên" ở trên.
```
