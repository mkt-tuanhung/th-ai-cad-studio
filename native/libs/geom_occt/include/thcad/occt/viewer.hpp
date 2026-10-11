#pragma once
// Native OCCT 3D viewer (V3d/AIS on OpenGL: Cocoa on macOS, WNT on Windows). Toolkit-agnostic: the host
// passes the native view handle and forwards input; the Qt widget lives in app/.
#include <memory>
#include <string>

#include "thcad/occt/geometry.hpp"

namespace thcad::occt {

class Viewer {
 public:
  Viewer();
  ~Viewer();
  /** `nsView` = native handle of the hosting widget (NSView* / HWND). Returns false if OpenGL init failed. */
  bool attach(void* nsView);
  void display(const Solid& s, bool fit = true);
  void resized();
  void redraw();
  void fitAll();
  enum class Preset { Top, Front, Right, Iso };
  void setView(Preset p);
  /** Writes the current frame to an image file (PNG). */
  bool dump(const std::string& path);

  enum Buttons { Left = 1, Middle = 2, Right = 4 };
  /** Mouse in device pixels. Left = orbit, Middle / Shift+Left = pan, wheel = zoom (OCCT defaults). */
  void mouseDown(int x, int y, int buttons, bool shift);
  void mouseMove(int x, int y, int buttons, bool shift);
  void mouseUp(int x, int y, int buttons, bool shift);
  void wheel(int x, int y, double delta);

 private:
  struct Impl;
  std::unique_ptr<Impl> d;
};

}  // namespace thcad::occt
