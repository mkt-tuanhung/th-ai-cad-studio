# llama.cpp `llama-mtmd-cli` (reference photo → interior style)

Interior → AI → "Ảnh mẫu → phong cách" reads the user's reference photos with a local vision-language model
(Qwen2.5-VL-7B-Instruct) through llama.cpp's multimodal tool **`llama-mtmd-cli`**, run as a **separate program**
(child process; the photos are temporary JPEG files deleted after the run). The app does not link libmtmd:

- the 7B vision model needs ~5.5 GB while it reads a photo — the helper gives it back as soon as it exits, and the
  app's own text model (in-process llama.cpp) stays loaded and untouched;
- a crash / GPU driver problem in the vision path cannot take the app down;
- on Windows the app links vcpkg's `llama-cpp` (no multimodal library), so a source build is needed anyway.

The helper is only ever given local files (`-m`, `--mmproj`, `--image`, `--grammar-file`); it is never given a URL
(`-hf`, `-mu`, `-mmu`), so it makes no network connection.

- License: **MIT** (`LICENSE`, shipped in `licenses/llama-mtmd/`).
- Version: tag **b11429** (llama.cpp 0.6.0, commit d81235049 — the same build as Homebrew `llama.cpp` 0.6.0 used on the
  development Mac) — source `b11429.tar.gz` (github.com/ggml-org/llama.cpp archive, sha256
  `0487b2e58d0f87c50def234ebda5dd8c1ab6c7afbc440ebef0080203110db6d7`).
- macOS: built from that source by `build_macos.sh` — static, Metal shaders embedded; only system frameworks are
  linked; copied to `MD CAD AI STUDIO.app/Contents/Helpers/llama-mtmd-cli`. Development builds also find the pinned
  source build or Homebrew's `/opt/homebrew/bin/llama-mtmd-cli` (`THCAD_MTMD_CLI` overrides).
- Windows: built from the same source in CI (`build_windows.ps1`) with the **Vulkan** backend (any GPU vendor
  through the driver's Vulkan) and every CPU variant as backends loaded at run time (`GGML_BACKEND_DL`), shipped in
  `vision\` with its own `ggml*.dll` / `llama.dll` / `mtmd.dll`, apart from the app's llama.cpp. CI smoke-runs
  `llama-mtmd-cli --help` from the staged folder.
- Model (not shipped; downloaded by the user from Settings → Quản lý mô hình → "Mô hình đọc ảnh mẫu", or placed by
  hand in `<models>/vision/`), from huggingface.co/ggml-org/Qwen2.5-VL-7B-Instruct-GGUF pinned to commit
  `508edd0afaa66bb9e9f40587acc2184f02daf1f6`:
  - `Qwen2.5-VL-7B-Instruct-Q4_K_M.gguf` — 4 683 072 032 bytes, sha256 `9258bf05b12686d097ff3b6b18d968ab393649780aa2b3cd67fec43d50554392`
  - `mmproj-Qwen2.5-VL-7B-Instruct-Q8_0.gguf` — 853 119 712 bytes, sha256 `2ddb555391bae966e412deab9e07b58afa18bcc06930ba0f1c78a3695ab9e506`
  - Licence: **Apache-2.0** (Qwen/Qwen2.5-VL-7B-Instruct; the 3B and 72B variants have other licences and are not used).
- Downloads are cached in `third_party/downloads/` (not committed) and verified by sha256.
