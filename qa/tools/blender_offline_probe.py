# V24-041 offline proof: run inside Blender under the same macOS sandbox profile the app uses for renders
#   /usr/bin/sandbox-exec -p '(version 1)(allow default)(deny network*)' \
#     /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --offline-mode -noaudio \
#     --python-exit-code 3 -P qa/tools/blender_offline_probe.py
# Every outbound attempt must fail (OFFLINE-PROBE BLOCKED …); the probe exits 0 only when all are blocked.
import socket
import sys

import bpy

targets = [('1.1.1.1', 443), ('8.8.8.8', 53), ('api.blender.org', 443)]
blocked = 0
for host, port in targets:
    try:
        s = socket.create_connection((host, port), timeout=4)
        s.close()
        print('OFFLINE-PROBE OPEN', host, port, flush=True)
    except Exception as e:  # PermissionError (sandbox) / gaierror (DNS denied)
        blocked += 1
        print('OFFLINE-PROBE BLOCKED', host, port, type(e).__name__, e, flush=True)
print('OFFLINE-PROBE online_access_pref', bpy.app.online_access, flush=True)
print('OFFLINE-PROBE RESULT', 'all-blocked' if blocked == len(targets) else 'NETWORK-REACHABLE', flush=True)
sys.exit(0 if blocked == len(targets) else 4)
