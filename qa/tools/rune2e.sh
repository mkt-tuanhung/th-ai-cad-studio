#!/bin/bash
# Runs one desktop e2e script in the dev app and prints PASS/FAIL counts.
# usage: qa/tools/rune2e.sh <script.js> <timeout-s> [ENV=VAL ...]   (THCAD_QA=1 → separate "thcad-qa" web profile)
here=$(cd "$(dirname "$0")/../.." && pwd)
script=$1; to=$2; shift 2
log=$(mktemp)
# a previous run's app (and its web engine helpers) must be gone: they hold the QA profile's storage locks
for i in $(seq 1 20); do pgrep -f "MD CAD AI STUDIO.app/Contents/(MacOS|Frameworks)" >/dev/null || break; sleep 0.5; done
env THCAD_QA=1 THCAD_SCRIPT=$script "$@" "$here/native/build/app/MD CAD AI STUDIO.app/Contents/MacOS/MD CAD AI STUDIO" >$log 2>&1 &
pid=$!
for i in $(seq 1 $to); do sleep 1; grep -q "E2E DONE" $log && break; done
kill $pid 2>/dev/null; wait $pid 2>/dev/null
for i in $(seq 1 20); do pgrep -f "MD CAD AI STUDIO.app/Contents/(MacOS|Frameworks)" >/dev/null || break; sleep 0.5; done
p=$(grep -c "E2E PASS" $log); f=$(grep -c "E2E FAIL" $log); d=$(grep -o "E2E DONE.*" $log | sed 's/ (:.*//')
echo "$(basename $script): PASS=$p FAIL=$f ${d:-NO DONE (timeout)}"
grep "E2E FAIL" $log | sed 's/^/   /' | cut -c1-220
rm $log
