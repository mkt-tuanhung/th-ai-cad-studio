#!/usr/bin/env python3
"""Rewrites any leftover absolute Homebrew install names in a .app bundle to @rpath (macdeployqt
misses the QtWebEngineProcess helper and some self-ids). Usage: fix_bundle_paths.py <App.app>"""
import os, re, subprocess, sys

app = sys.argv[1]
fixed = 0
for root, _, files in os.walk(app):
    for f in files:
        p = os.path.join(root, f)
        if os.path.islink(p):
            continue
        try:
            out = subprocess.run(['otool', '-L', p], capture_output=True, text=True).stdout
        except Exception:
            continue
        lines = out.splitlines()[1:]
        if not lines or 'is not an object file' in out:
            continue
        for line in lines:
            # Homebrew paths, and @executable_path refs (which break inside QtWebEngineProcess.app)
            m = re.match(r'\s+(/opt/homebrew/\S+|@executable_path/\.\./Frameworks/\S+)', line)
            if not m:
                continue
            old = m.group(1)
            fw = re.search(r'([^/]+\.framework/.*)$', old)
            new = '@rpath/' + (fw.group(1) if fw else os.path.basename(old))
            is_id = os.path.basename(old) == f
            cmd = ['install_name_tool', '-id', new, p] if is_id else ['install_name_tool', '-change', old, new, p]
            subprocess.run(cmd, check=True, stderr=subprocess.DEVNULL)
            fixed += 1

# Drop absolute Homebrew LC_RPATHs and make sure binaries search inside the bundle.
fw_dir = os.path.join(app, 'Contents', 'Frameworks')
rp_removed = 0
for root, _, files in os.walk(app):
    for f in files:
        p = os.path.join(root, f)
        if os.path.islink(p):
            continue
        out = subprocess.run(['otool', '-l', p], capture_output=True, text=True).stdout
        if 'LC_RPATH' not in out and 'cmd LC_' not in out:
            continue
        rpaths = re.findall(r'cmd LC_RPATH\n\s+cmdsize \d+\n\s+path (\S+)', out)
        for r in rpaths:
            if r.startswith('/opt/homebrew'):
                subprocess.run(['install_name_tool', '-delete_rpath', r, p], stderr=subprocess.DEVNULL)
                rp_removed += 1
main = os.path.join(app, 'Contents', 'MacOS')
for f in os.listdir(main):
    p = os.path.join(main, f)
    out = subprocess.run(['otool', '-l', p], capture_output=True, text=True).stdout
    if '@executable_path/../Frameworks' not in out:
        subprocess.run(['install_name_tool', '-add_rpath', '@executable_path/../Frameworks', p], check=True)
for f in os.listdir(fw_dir):
    p = os.path.join(fw_dir, f)
    if f.endswith('.dylib') and not os.path.islink(p):
        out = subprocess.run(['otool', '-l', p], capture_output=True, text=True).stdout
        if 'path @loader_path ' not in out:
            subprocess.run(['install_name_tool', '-add_rpath', '@loader_path', p], stderr=subprocess.DEVNULL)
print(f'rewrote {fixed} install names, removed {rp_removed} Homebrew rpaths')
