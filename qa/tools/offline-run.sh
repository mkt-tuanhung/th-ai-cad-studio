#!/bin/bash
# Offline run (V24-048 / SP62): the desktop app's bridge self-test — OCCT, the native CAD command bus, BIM, DWG
# write and a request to the local AI model (llama.cpp) — with outbound networking made unusable WITHOUT admin
# rights, and every socket of the app and its helper processes sampled while it runs.
#
# How networking is blocked (no firewall / pf, which would need sudo):
#   - http_proxy / https_proxy / ALL_PROXY (and the upper-case ones) point at a dead local port (127.0.0.1:9);
#   - Qt WebEngine (Chromium) gets --proxy-server=127.0.0.1:9 and its background networking switched off;
#   - loopback stays allowed (the dev UI on 127.0.0.1, if THCAD_UI_URL is given; without it the bundled UI loads
#     through the thcad:// scheme, no socket at all).
# What is measured: `lsof -nP -i` on the app and all its descendants every 0.5 s; any connection to an address
# other than 127.0.0.1 / ::1 / localhost is listed as OUTBOUND. Limits: a program that ignores proxies and talks
# to a raw IP would not be stopped — it would still be SEEN by the sampling (unless it opens and closes a socket
# between two samples).
#
# usage: qa/tools/offline-run.sh [timeout-s=120]   env: THCAD_UI_URL (optional), OUT (result folder),
#        THCAD_PROFILE (default offline-qa), THCAD_SCRIPT (instead of the self-test)
here=$(cd "$(dirname "$0")/../.." && pwd)
to=${1:-120}
out=${OUT:-$here/qa/v2_4/platform/offline}
mkdir -p "$out"
# THCAD_APP_BIN: another build, e.g. the packaged installer app native/dist/MD CAD AI STUDIO.app/Contents/MacOS/…
app=${THCAD_APP_BIN:-"$here/native/build/app/MD CAD AI STUDIO.app/Contents/MacOS/MD CAD AI STUDIO"}
dead=http://127.0.0.1:9
log="$out/app.log"; conns="$out/connections.txt"; : > "$conns"
mode=(THCAD_SELFTEST=1)
[ -n "$THCAD_SCRIPT" ] && mode=(THCAD_SCRIPT="$THCAD_SCRIPT")
ui=()
[ -n "$THCAD_UI_URL" ] && ui=(THCAD_UI_URL="$THCAD_UI_URL")
for i in $(seq 1 20); do pgrep -f "MD CAD AI STUDIO.app/Contents/(MacOS|Frameworks)" >/dev/null || break; sleep 0.5; done
env THCAD_QA=1 "${mode[@]}" "${ui[@]}" THCAD_PROFILE="${THCAD_PROFILE:-offline-qa}" THCAD_SPLASH=0 \
  http_proxy=$dead https_proxy=$dead HTTP_PROXY=$dead HTTPS_PROXY=$dead ALL_PROXY=$dead all_proxy=$dead \
  no_proxy=127.0.0.1,localhost NO_PROXY=127.0.0.1,localhost \
  QTWEBENGINE_CHROMIUM_FLAGS="--proxy-server=$dead --proxy-bypass-list=127.0.0.1;localhost --disable-background-networking --disable-component-update --disable-domain-reliability --no-pings --disable-sync --disable-features=OptimizationHints,MediaRouter" \
  "$app" > "$log" 2>&1 &
pid=$!
descendants() { local p=$1; echo "$p"; for c in $(pgrep -P "$p"); do descendants "$c"; done; }
samples=0
for i in $(seq 1 $((to * 2))); do
  pids=$(descendants $pid | paste -sd, -)
  lsof -nP -a -i -p "$pids" 2>/dev/null | tail -n +2 | sed "s/^/$(date +%H:%M:%S) /" >> "$conns"
  samples=$((samples + 1))
  grep -qE "SELFTEST DONE|E2E DONE" "$log" && break
  sleep 0.5
done
kill $pid 2>/dev/null; wait $pid 2>/dev/null
# a connected socket is "local->remote": outbound = a remote that is not loopback
outbound=$(grep -- '->' "$conns" | awk '{ for (i = 1; i <= NF; i++) if ($i ~ /->/) { split($i, a, "->"); if (a[2] !~ /^(127\.0\.0\.1|\[::1\]|localhost):/) print } }' | sort -u)
# sockets bound to every interface (listening / UDP), no remote end
wide=$(grep -E '\*:[0-9*]+' "$conns" | awk '{print $2, $3, $(NF-1), $NF}' | sort -u)
echo "samples: $samples  (every 0.5 s)" > "$out/summary.txt"
echo "sockets seen: $(grep -cE 'TCP|UDP' "$conns")" >> "$out/summary.txt"
echo "outbound (not loopback): $(printf '%s' "$outbound" | grep -c . )" >> "$out/summary.txt"
printf '%s\n' "$outbound" | sed '/^$/d' | sed 's/^/  /' >> "$out/summary.txt"
echo "bound to all interfaces (no remote end): $(printf '%s' "$wide" | grep -c . )" >> "$out/summary.txt"
printf '%s\n' "$wide" | sed '/^$/d' | sed 's/^/  /' >> "$out/summary.txt"
grep -E "SELFTEST (PASS|FAIL|DONE)|E2E (PASS|FAIL|DONE)" "$log" >> "$out/summary.txt"
grep -E "SELFTEST (localAi|info) " "$log" | cut -c1-400 >> "$out/summary.txt"
cat "$out/summary.txt"
