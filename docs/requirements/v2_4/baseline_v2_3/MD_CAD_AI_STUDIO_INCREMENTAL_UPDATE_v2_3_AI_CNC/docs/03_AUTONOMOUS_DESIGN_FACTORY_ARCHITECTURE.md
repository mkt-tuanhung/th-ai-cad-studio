# AUTONOMOUS DESIGN FACTORY — PRIORITY P0

## One command → verified deliverables

```
User + Files + Measurement + Constraints
                 ↓
Input Intake / Units / Provenance / Missing Data Gate
                 ↓
Local AI Project Director / Planner / Task DAG
                 ↓
Task workers (rules first, LLM when needed):
  Survey → Layout → Architecture/Interior → CAD2D → BIM/3D
  → Documentation → Quantities → Production CAM (interior)
                 ↓
Native CAD/BIM/CAM Geometry + Validators (deterministic)
                 ↓
Self-correction loop with retry limit + trace
                 ↓
Review Package: previews + diffs + warnings + files
                 ↓
Qualified engineer approval / CNC machine validation
```

## Mandatory components

- `ProjectDirector`: parse brief Vietnamese/English; extract constraints, goals, assumptions; ask only for missing inputs critical to geometry/safety; create work breakdown/task DAG.
- `SurveyInterpreter`: ingest dimensioned drawings, photos/scans, point data; require human scale calibration; trust hierarchy direct measurement > calibrated references > AI inference.
- `DesignConstraintGraph`: rooms, adjacencies, dimensions, structural keep-outs, clearances, furniture modules, material catalogue; supports constraint solver and conflict explanation.
- `InteriorAgent`: cabinets and joinery, board thickness actual, hardware catalogue, assembly joinery; output parametric 3D + 2D manufacturing plans.
- `ArchitectureAgent`: floor plans/elevations/sections, BIM families, cross-reference dimensions, schedules and documents.
- `CADOperator`: emits only schema-validated commands (typed, namespaced, versioned) to underlying native engine. No arbitrary eval, OS scripts, network or untrusted plugin tool calling.
- `ModelBuilder`: B-Rep/BIM objects for production and construction; polygon mesh for presentation/advanced 3D; maintain ID mapping.
- `ProductionAgent`: cut list + nesting + toolpaths + machine postprocess; default draft and simulation mode. Production NC disabled until machine profile verified, tool/path safety validated, trial/first article completed.
- `QualityController`: geometry integrity, topological consistency, dimension audit, units, BOM cross-checks, clashes, manufacturability and missing notes. Code/rule validation deterministic, not self-grading LLM text.
- `ReviewGate`: compare before/after; approve/reject/partial accept; rollback; highlight unverified assumptions. Human sign-off remains mandatory for construction safety and physical machine use.
- `JobService`: offline queued tasks, persistence and resumes after crashes, cancel, time/resource budgets, GPU model memory management, reproducible logs and artifacts.

## Autonomy behavior

- When user orders one design, AI may iterate multiple safe internal steps without interruption.
- Never silently invent measurements or certify compliance with regulations.
- For ambiguous layout preferences, generate 2–3 variants using declared assumptions; mark as proposal.
- Enforce stop gates for structural load/design approvals, electrical safety and CNC machine operation.
- Run local-only, user may leave the app computing; status, notifications and audit trail visible when they return.
- Return actual `.thcad/.dxf` (DWG as supported), BIM/IFC where implemented, PDF sheets, cut list CSV/XLSX, 3D editable model, CAM simulation/postprocessor output, and source metadata. No static mockup posing as engineering file.
- A local model is one component, not mathematical authority. For precision, call deterministic tools + test outputs.

## P0 end-to-end demos

### Interior Factory 01 — Kitchen cabinet
Input: verified plan + height/width/depth constraints + board thickness + grain + edge-banding + hardware.
Output: editable 2D & 3D with identical dimensions, BOM cut list, labeled panels, nesting preview, toolpaths/simulation; export NC only after machine gate. Tests: units, fit, hole coordinates, material consumption, edge labels, errors, undo, export/reopen.

### Construction Factory 01 — 3-level building
Input: surveyed plot + brief + constraints + architect-supplied code rules.
Output: 3 layout options, an editable canonical BIM model, plans/elevations/sections, basic clash/quantity sheets, PDF/DXF and review report. Approval mandatory; not a substitute for licensed engineer's structural sign-off.

### Manual Rescue 01
Open either generated model, enter AutoCAD profile, modify wall dimensions using keyboard command alias with correct OS/workspace behavior; switch to SketchUp profile, push/pull a module precisely; switch to Advanced 3D profile, alter mesh and modifiers; regenerate dependent drawings/cut list and compare changes. Demonstrate no geometry drift, semantic corruption or unit mismatch.

## Native technology outline

- C++20 / Qt6 desktop; native CAD2D + Open CASCADE B-Rep; BIM document semantics.
- For 3ds Max-style tools, independently implement or embed a properly licensed mesh/edit/UV/scene system; evaluate external permissive libraries only after license audit.
- llama.cpp/Metal or MLX for on-device AI where supported; smaller offline rules-based fallback.
- Orchestrator is job- and tool-centric; UI is a client, not the location where CAD state is stored.
- Versioned typed command schema + audit logs and deterministic acceptance tests.

## Gating / release

1. **P0 spike**: small end-to-end real geometry demo, not another aesthetic mockup.
2. Reliable save/load + undo + exact input/units + AI plan/preview.
3. Interior parametric + manufacturing pipeline verified with sample materials.
4. Construction BIM + 2D drawing documentation pipeline.
5. Expand manual parity registry and advanced 3D in parallel, never falsely mark 100%.
6. Add deferred domains only when P0 can pass actual user projects.
