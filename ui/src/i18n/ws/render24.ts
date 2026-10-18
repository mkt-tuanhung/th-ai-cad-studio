// v2.4 local render pipeline strings (GLB export, Blender worker, bookmarks, Day / Golden / Night, compare, material options).
export const render24En = {
  engines: { 'Path Tracing (Physically Based)': 'OCCT Path Tracing (Physically Based)', 'Rasterized Preview': 'OCCT Rasterized Preview', 'Hybrid (Path Traced GI)': 'OCCT Hybrid (Path Traced GI)', 'Blender Cycles (local)': 'Blender Cycles (local)' } as Record<string, string>,
  presentationOnly: 'Presentation only — not for dimensions, BOM or CNC',
  blender: {
    rendering: 'Blender Cycles · {s} / {n} samples · {time}',
    rendered: 'Blender render · {s} samples · {time} · {file}',
    missing: 'Blender not found — rendered with the OCCT path tracer instead',
    stillsOnly: 'Blender renders still images — this panorama / video uses the OCCT path tracer',
    noSnapshot: 'No Blender scene snapshot for this job — rendered with the OCCT path tracer',
    started: 'Rendering {n} job(s) with Blender Cycles (separate process)',
    stale: 'The scene changed since this job was queued — queue it again',
    memory: 'Not enough memory: {why}',
  },
  estimateMem: 'render memory ≈ {gb} GB',
  glb: { export: 'Export GLB (3D, presentation)', saved: 'Saved {file} · {n} objects · {m} materials (presentation geometry, not for BOM / CNC)', failed: 'GLB export failed: {why}', desktop: 'GLB export runs in the desktop app (OCCT).' },
  bookmarks: {
    save: '★ Save camera bookmark', item: '★ {name}', saved: 'Bookmark “{name}” saved (also a Renders camera)', restored: 'Bookmark “{name}” restored', newName: 'View {n}', none: 'No bookmarks yet',
    stale: 'Bookmark “{name}” was saved at scene revision {rev}; the model has changed since', desktop: 'Bookmarks need the live 3D model (desktop app, Shaded / Wireframe / Hidden Line).',
  },
  lighting: { label: 'Lighting: {name}', names: { standard: 'Standard', day: 'Day', golden: 'Golden hour', night: 'Night' } as Record<string, string>, applied: 'Lighting “{name}” — the geometry is unchanged' },
  compare: {
    open: 'Compare live 3D ↔ render…', title: 'Before / after — live 3D vs render', live: 'Live 3D (OCCT) · rev {rev}', render: '{engine} · rev {rev}', same: 'Same camera and scene revision {rev}', differ: 'Revisions differ ({a} ≠ {b})',
    none: 'No finished render with a queued 3D frame for this camera yet — render it first.', slider: 'Comparison position', engineBlender: 'Blender Cycles', engineOcct: 'OCCT path tracing',
  },
  materials: { batch: 'Render material options ({n})', queued: '{n} material option render(s) queued — same model, materials only', names: { design: 'As designed', timber: 'Warm timber', concrete: 'Concrete & steel', marble: 'White marble' } as Record<string, string> },
  settingsCard: { blender: 'Blender (photoreal renders)', notFound: 'Not found — the OCCT path tracer is used', value: '{version} · {path}', browser: 'Desktop app only' },
}

export const render24Vi: typeof render24En = {
  engines: { 'Path Tracing (Physically Based)': 'OCCT Path Tracing (vật lý)', 'Rasterized Preview': 'OCCT xem nhanh (raster)', 'Hybrid (Path Traced GI)': 'OCCT lai (GI path tracing)', 'Blender Cycles (local)': 'Blender Cycles (trên máy)' },
  presentationOnly: 'Chỉ để trình bày — không dùng cho kích thước, BOM hay CNC',
  blender: {
    rendering: 'Blender Cycles · {s} / {n} mẫu · {time}',
    rendered: 'Ảnh Blender · {s} mẫu · {time} · {file}',
    missing: 'Không tìm thấy Blender — đã kết xuất bằng OCCT path tracing',
    stillsOnly: 'Blender chỉ kết xuất ảnh tĩnh — panorama / video này dùng OCCT path tracing',
    noSnapshot: 'Việc này không có bản chụp cảnh cho Blender — đã kết xuất bằng OCCT path tracing',
    started: 'Đang kết xuất {n} việc bằng Blender Cycles (tiến trình riêng)',
    stale: 'Cảnh đã thay đổi từ lúc xếp hàng — hãy xếp hàng lại',
    memory: 'Không đủ bộ nhớ: {why}',
  },
  estimateMem: 'bộ nhớ kết xuất ≈ {gb} GB',
  glb: { export: 'Xuất GLB (3D, trình bày)', saved: 'Đã lưu {file} · {n} đối tượng · {m} vật liệu (hình học trình bày, không dùng cho BOM / CNC)', failed: 'Xuất GLB lỗi: {why}', desktop: 'Xuất GLB chạy trong app desktop (OCCT).' },
  bookmarks: {
    save: '★ Lưu điểm nhìn camera', item: '★ {name}', saved: 'Đã lưu điểm nhìn “{name}” (cũng là một camera trong Kết xuất)', restored: 'Đã khôi phục điểm nhìn “{name}”', newName: 'Góc nhìn {n}', none: 'Chưa có điểm nhìn nào',
    stale: 'Điểm nhìn “{name}” lưu ở revision {rev}; mô hình đã thay đổi từ đó', desktop: 'Điểm nhìn cần mô hình 3D trực tiếp (app desktop, chế độ Tô bóng / Khung dây / Nét khuất).',
  },
  lighting: { label: 'Ánh sáng: {name}', names: { standard: 'Tiêu chuẩn', day: 'Ban ngày', golden: 'Hoàng hôn', night: 'Ban đêm' }, applied: 'Ánh sáng “{name}” — hình học không đổi' },
  compare: {
    open: 'So sánh 3D trực tiếp ↔ ảnh render…', title: 'Trước / sau — 3D trực tiếp và ảnh render', live: '3D trực tiếp (OCCT) · rev {rev}', render: '{engine} · rev {rev}', same: 'Cùng camera và revision cảnh {rev}', differ: 'Revision khác nhau ({a} ≠ {b})',
    none: 'Camera này chưa có ảnh render kèm khung 3D lúc xếp hàng — hãy kết xuất trước.', slider: 'Vị trí so sánh', engineBlender: 'Blender Cycles', engineOcct: 'OCCT path tracing',
  },
  materials: { batch: 'Kết xuất các phương án vật liệu ({n})', queued: 'Đã xếp hàng {n} ảnh phương án vật liệu — cùng mô hình, chỉ khác vật liệu', names: { design: 'Theo thiết kế', timber: 'Gỗ ấm', concrete: 'Bê tông & thép', marble: 'Đá cẩm thạch trắng' } },
  settingsCard: { blender: 'Blender (render như thật)', notFound: 'Không tìm thấy — dùng OCCT path tracing', value: '{version} · {path}', browser: 'Chỉ có trong app desktop' },
}
