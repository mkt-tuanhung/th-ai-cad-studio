# LOCAL-FIRST INTEGRATIONS — Engineering evaluation, not a license clearance

Use or adapt what Claude has already integrated; do not install duplicate competing CAD/3D engines blindly. Evaluate Apple Silicon build compatibility, embedded vs process license requirements, memory and offline behavior. Research references: Blender docs GPU Metal https://docs.blender.org/manual/en/4.2/render/cycles/gpu_rendering.html ; Blender docs EEVEE https://docs.staging.blender.org/manual/en/latest/render/eevee/index.html ; Godot license https://godotengine.org/license/ ; Diffusers offline https://huggingface.co/docs/diffusers/en/installation ; diffusers license https://github.com/huggingface/diffusers/blob/main/LICENSE

| Candidate | Use | Cost/license caveat | Decision |
|---|---|---|---|
| **Existing 3D renderer/QtQuick3D/Metal pipeline** | real-time linked 3D, selection, orbit/pan, cutaway | Reuse existing engine. Profile CPU/GPU. | **First choice** |
| **Open CASCADE** | exact B-rep, face dimensions, tessellation | Existing license requirements and third-party notices; verify in actual repo. | Reuse existing |
| **Blender (headless Cycles/EEVEE)** | local presentation render, cameras/materials, final video/stills | Blender GPL and distribution/integration obligations; external process boundary doesn't by itself remove all legal review, consult counsel. Apple Metal support documented. | Local optional renderer worker |
| **OpenImageIO / OpenColorIO** | image/color transforms, physically based color pipeline | Check build/redistribution licenses. | Optional |
| **OpenCV** | image detection and perspective correction | License/version check; never infer unseen wall thickness. | Existing import enhancement |
| **Tesseract/PaddleOCR** | text/dimension recognition | Check bundled models/fonts/data licenses. | Optional import branch |
| **IfcOpenShell** | BIM IFC exchange | GPL/LGPL/available licensing depends components; audit before embedding. | Conditional |
| **ezdxf** | DXF vector exchange | Verify package license and import fidelity. | Adapter |
| **llama.cpp / MLX** | offline language planning and geometry-command arguments | Model weight licenses separate from inference runtime; benchmark RAM budget. | Existing AI local engine |
| **Hugging Face diffusers** | optional local concept-image generation | Library Apache 2.0 but model license separate, and memory demand can be large. | Optional concept-only, not manufacturing |
| **Godot** | alternative for stand-alone real-time viewer if existing engine is inadequate | MIT; integrating a second renderer can increase maintenance/serialization burden. | Not default / only after gap audit |
| **Clipper2 / libnest2d / CAM workbench** | CNC nesting/offset/CAM | Retain verified v2.3 architecture; check each library's license and post-processors. | Maintain existing |

## Engine design
- One model, two projections: precise semantic CAD model and 3D viewport cache.
- Realtime shading workbench (no photographic geometry claims); Blender local batch worker for final physically based scene render. Track scene/camera+geometry revision.
- Optional diffusion generates **presentation concepts** from 3D depth/segmentation, not mathematically reliable construction plans; approval, label and provenance required.
- No mandatory third-party API: install and run local models/render processes as managed app resources. Downloads for optional model assets only after explicit consent and license check.

## Rollout on Mac
- Probe platform Metal capability, unified RAM, disk; provide quality presets and fail-safe CPU path.
- Package helper processes, resources with signed/notarized distribution (when production), version pinning and integrity verification.
- Verify offline by network-disabled test; avoid telemetry or user geometry uploads.
- All commercial licenses, model weights, scanned furniture content and textures audited in software bill of materials (SBOM). Do not assert free-of-cost redistribution without checking.
