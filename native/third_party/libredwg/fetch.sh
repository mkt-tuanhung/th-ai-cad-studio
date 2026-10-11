#!/bin/zsh
# Downloads (once) and verifies a LibreDWG artefact into third_party/downloads. Prints the path.
# Usage: fetch.sh <url> <sha256>
set -euo pipefail
url=$1 sum=$2
dir="$(dirname "$0")/../downloads"
mkdir -p "$dir"
out="$dir/$(basename "$url")"
if [[ ! -f "$out" ]] || [[ "$(shasum -a 256 "$out" | cut -d' ' -f1)" != "$sum" ]]; then
  curl -fsSL "$url" -o "$out.part"
  mv "$out.part" "$out"
fi
got=$(shasum -a 256 "$out" | cut -d' ' -f1)
[[ "$got" == "$sum" ]] || { echo "sha256 mismatch for $out: $got" >&2; exit 1; }
echo "$out"
