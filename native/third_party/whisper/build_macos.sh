#!/bin/zsh
# Builds the whisper-cli helper (static, Metal embedded) from the pinned whisper.cpp source. Prints its path.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
tgz=$("$here/../libredwg/fetch.sh" https://github.com/ggml-org/whisper.cpp/archive/refs/tags/v1.9.4.tar.gz 57e280cee375ab02425b806ad5146b99f6eb9357e3c2b31357c8a6af2e2e44ae)
src="$here/../downloads/whisper-src/whisper.cpp-1.9.4"
bin="$src/build/bin/whisper-cli"
if [[ ! -x "$bin" ]]; then
  mkdir -p "$here/../downloads/whisper-src"
  tar -xzf "$tgz" -C "$here/../downloads/whisper-src"
  cmake -S "$src" -B "$src/build" -G Ninja -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DGGML_METAL=ON \
    -DGGML_METAL_EMBED_LIBRARY=ON -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_SERVER=OFF -DWHISPER_SDL2=OFF \
    -DGGML_NATIVE=OFF -DCMAKE_OSX_DEPLOYMENT_TARGET=13.0 >&2
  cmake --build "$src/build" --target whisper-cli >&2
fi
echo "$bin"
