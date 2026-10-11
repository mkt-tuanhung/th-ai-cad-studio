#pragma once
// Offscreen OCCT renderer for the BIM 3D slot (architecture option A, unified with the web UI):
// OCCT renders into an FBO, the frame is shipped to the web view as PNG, and every web overlay
// (display modes, plan preview, level bar…) stays on top. Interaction arrives as camera commands.
#include <memory>
#include <string>
#include <vector>

#include "thcad/bim/model.hpp"

namespace thcad::occt {

class OffscreenView {
 public:
  OffscreenView();
  ~OffscreenView();
  bool ok() const;
  void setModel(const bim::Model& m);
  /** "shaded" | "wireframe" | "hidden" */
  void setMode(const std::string& mode);
  void setSelected(const std::string& wallId);
  void orbit(int x0, int y0, int x1, int y1, bool start);
  void pan(int dx, int dy);
  void zoom(int x, int y, double delta);
  void fit();
  void preset(const std::string& name);  // "home" | "top" | "front" | "right"
  /** Renders a w×h frame (device pixels) as top-down RGBA8 (empty on failure). The host encodes
   *  it (OCCT on macOS has no PNG/JPEG writer without FreeImage). */
  std::vector<unsigned char> renderRgba(int w, int h);
  /** Last frame's render time in milliseconds. */
  double lastRenderMs() const;

 private:
  struct Impl;
  std::unique_ptr<Impl> d;
};

}  // namespace thcad::occt
