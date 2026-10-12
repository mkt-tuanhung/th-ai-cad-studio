# whisper.cpp (speech recognition helper for Voice CAD)

Voice CAD transcribes the microphone with **whisper.cpp** run as a **separate program** (`whisper-cli`,
child process, a temporary WAV file in between). The app does not link it, so its ggml never meets the one
llama.cpp uses.

- License: **MIT** (`LICENSE`, shipped in `licenses/whisper/`).
- Version: v1.9.4 — source `whisper.cpp-1.9.4.tar.gz` (github.com/ggml-org/whisper.cpp archive, sha256
  `57e280cee375ab02425b806ad5146b99f6eb9357e3c2b31357c8a6af2e2e44ae`).
- macOS: built from that source by `build_macos.sh` — static, Metal shaders embedded; only system
  frameworks are linked.
- Windows: built from the same source in CI (`build_windows.ps1`) with the **Vulkan** backend — the GPU of
  any vendor (NVIDIA, AMD, Intel, integrated GPUs included) through the graphics driver's Vulkan — and all CPU
  variants, as backends loaded at run time (`GGML_BACKEND_DL`): without a Vulkan driver it runs on the CPU.
  Shipped in `whisper\` with its own `ggml*.dll`, kept apart from llama.cpp's. Vulkan headers, loader and
  `glslc` come from vcpkg (`ggml[vulkan]`). CI runs a real transcription (tiny model) on the GPU-less runner.
- Model (not shipped; downloaded by the user from Settings → Manage Models, or placed by hand in
  `<models>/whisper/`): `ggml-large-v3-turbo-q5_0.bin` from huggingface.co/ggerganov/whisper.cpp, MIT,
  574 041 195 bytes, sha256 `394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2`.
- Downloads are cached in `third_party/downloads/` (not committed) and verified by sha256.
