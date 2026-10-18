# Brief for every v2.4 implementation agent (read fully before coding)

## Product and rules
MD CAD AI STUDIO: offline CAD + BIM + interior + CNC desktop app.
- **Stack:** React/TS (Vite) UI in a Qt 6 WebEngine host; C++20 + Open CASCADE + llama.cpp native; macOS Apple Silicon + Windows.
- **Owner:** Minh Dũng. UI strings exist in both EN and VI.

Owner's change request: `docs/requirements/v2_4/` (read `docs/02_V2_4_PRODUCT_ARCHITECTURE_DELTA.md`, `docs/03_UX_INTEGRATION_MAP.md`, `qa/ACCEPTANCE_TESTS_V2_4.csv`, and the v2.3 CNC docs for CNC work).
Our audit and design: `docs/v2_4/AUDIT_AND_DELTA.md` and `qa/v2_4/FEATURE_CROSSWALK_V2_4_AUDITED.csv`. Follow that design.

**Non-negotiable:**
- **Update in place.** No rebuild, no new framework, no new store when an existing one fits. Never remove or disable an existing feature; if something is wrong, repair it.
- **Keep the 12 pixel-locked screens.** New UI goes into existing screens as tabs, drawers, popovers or dialogs, reusing the existing components (`ui/src/components/*`, workspace kit). Never paint screenshots as UI. If something truly needs a layout change, do not do it: describe it as a UI_CHANGE_REQUEST in your report.
- **The semantic mm model is the source of truth.** A render or AI image is "presentation only" and never feeds dimensions, BOM or CNC.
- **CNC safety:**
  - no production NC unless the machine profile is VERIFIED and the release gate passes;
  - previews are watermarked NOT FOR MACHINE USE;
  - any upstream change marks downstream STALE;
  - never auto-start or stream to a machine.
- **Locked AI rule:** AI never writes a model directly (validate → preview → user approves → one undo step), and calculations are done by code.
- **Offline, no paid services.**
- **Every new user-visible string in EN and VI.** Put strings in a namespace file under `ui/src/i18n/ws/<area>.ts` where possible, to avoid merge conflicts in `en.ts`/`vi.ts`.
- **Honesty.** Never mark a test passed unless you ran it. Report each task as Implemented / Tested / Failed / Blocked.

## Working in your worktree
You are in an isolated git worktree. The main checkout is at `/Users/mac/Downloads/TH_AI_CAD_Studio_UI_Handoff_v1/th-ai-cad-studio`; never edit files there.

Setup (run once):
```bash
M=/Users/mac/Downloads/TH_AI_CAD_Studio_UI_Handoff_v1/th-ai-cad-studio
ln -s $M/ui/node_modules ui/node_modules
[ -e ui/public/ocr ] || ln -s $M/ui/public/ocr ui/public/ocr
[ -e native/third_party/downloads ] || ln -s $M/native/third_party/downloads native/third_party/downloads
# only if you change or need to run native code (takes a while):
cmake -S native -B native/build -G Ninja -DCMAKE_BUILD_TYPE=Release && cmake --build native/build
```

Checks:
- **Type check (the real one):** `cd ui && npx tsc --noEmit -p tsconfig.app.json`. Note that `-p .` checks NOTHING.
- **Unit tests:** `cd ui && UNIT=<name> node tools/test-cam.mjs <exportedFn>`. Test files live in `ui/tools/unit/<name>.test.ts`; make new ones assert and return `{all: boolean, ...}`.
- **Smoke tests:** start your OWN dev server on a free port, e.g. `cd ui && npx vite --port 52XX --strictPort --host 127.0.0.1 &`, then `THCAD_UI=http://127.0.0.1:52XX node tools/smoke-<x>.mjs`. Kill the server when done. Port 5173 belongs to the main checkout.
- **Desktop e2e:** `qa/tools/rune2e.sh $PWD/native/app/resources/<script>.js <timeout> THCAD_PROFILE=<unique-name> THCAD_UI_URL=http://127.0.0.1:52XX THCAD_SPLASH=0 [other env]`. Use a unique THCAD_PROFILE per agent so parallel runs don't share browser storage.

Commit on your worktree branch, only your files, in small logical commits. English messages ending with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Do not push.

Final report (English, concise):
- each task: status, changed files, proving test(s) with results;
- acceptance test ids (V24-xxx / CNC-xxx) covered and whether they were executed;
- UI_CHANGE_REQUESTs;
- cross-scope needs;
- branch and commit hashes.
