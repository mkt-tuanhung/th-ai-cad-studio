# QA — Renders: 360° panorama, video, AI variations, live camera view, scene stats

- **Panorama & VR** (native `HostBridge::renderStart` kind `panorama`): six square 90° path-traced cube faces
  from the camera position (+X −X +Y −Y +Z −Z, own up vectors), stitched to an equirectangular 2N × N JPG with
  bilinear sampling, longitude 0 = the camera's direction; GPano XMP (`ProjectionType="equirectangular"`)
  inserted after the JFIF header so photo apps open it as 360°. In-app viewer: drag to look around.
- **Video Render** (kind `video`): one path-traced render per frame (orbit 360° around the target — interior
  cameras turn in place — or a smooth fly-through of the cameras of the same scene), encoded by the OS:
  AVFoundation H.264 MP4 on macOS (`video_writer_mac.mm`, ARC), Media Foundation H.264 MP4 on Windows
  (`video_writer_win.cpp`); if the OS encoder is missing, Motion-JPEG AVI (`video_writer.cpp`). Cancelling
  deletes the half-written file.
- **AI Variations / Generate with AI / AI Enhancement tab**: the local model (Discipline `rendersAi`, typed op
  `addVariation`: sky, sun azimuth / elevation / intensity, exposure, contrast, saturation, temperature) proposes
  variations; approved ones join the strip; desktop queues 640 × 360 thumbnail renders of each. View all = gallery
  (apply / delete). Applying sets settings + post-processing (undoable); sun elevation now reaches the renderer.
- **Live camera view** (desktop, Wireframe / Clay / Shaded): the OCCT scene of the camera (interior model or BIM
  building) at the render camera; orbit / pan / zoom / fit / render region (zoom region) / section box; Focus
  point saves the current view into the camera; Safe frame shows the output aspect; Delete removes the camera.
- **Scene statistics** counted from the scene the camera renders (objects, lights, materials); panels collapse.

Results 2026-10-12 (desktop, `native/app/resources/e2e_panovideo.js`, `e2e_rendersai.js`): panorama 512 × 256 JPG
with GPano XMP; video `Cam 03 - orbit video.mp4` — ffprobe: h264 1280 × 720, 12 frames, 12 fps; live view PASS;
AI: "Golden hour" (clear, 255° / 8°, +0.3 EV, +45) and "Cool night" proposed by Qwen2.5-7B, approved, both got
rendered thumbnails. Browser: `smoke-renders.mjs` 11/11.
Note: the model's two variations closely follow the prompt's few-shot example values (honest observation).
