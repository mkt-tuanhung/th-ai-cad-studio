#!/bin/zsh
# Builds the llama-mtmd-cli helper (reference photo → interior style) from the pinned llama.cpp source: static,
# Metal shaders embedded, only system frameworks linked. Prints its path.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
tgz=$("$here/../libredwg/fetch.sh" https://github.com/ggml-org/llama.cpp/archive/refs/tags/b11429.tar.gz 0487b2e58d0f87c50def234ebda5dd8c1ab6c7afbc440ebef0080203110db6d7)
src="$here/../downloads/llama-src/llama.cpp-b11429"
bin="$src/build/bin/llama-mtmd-cli"
if [[ ! -x "$bin" ]]; then
  mkdir -p "$here/../downloads/llama-src"
  tar -xzf "$tgz" -C "$here/../downloads/llama-src"
  cmake -S "$src" -B "$src/build" -G Ninja -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DGGML_METAL=ON \
    -DGGML_METAL_EMBED_LIBRARY=ON -DGGML_NATIVE=OFF -DLLAMA_CURL=OFF -DLLAMA_OPENSSL=OFF -DLLAMA_BUILD_TESTS=OFF \
    -DLLAMA_BUILD_SERVER=OFF -DLLAMA_BUILD_EXAMPLES=OFF -DCMAKE_OSX_DEPLOYMENT_TARGET=13.0 >&2
  cmake --build "$src/build" --target llama-mtmd-cli >&2
fi
echo "$bin"
