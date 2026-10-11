#pragma once
// The OCCT window type per platform: Cocoa (macOS) / WNT (Windows) / Xw (Linux).
#include <Aspect_Window.hxx>

#if defined(_WIN32)
#include <WNT_WClass.hxx>
#include <WNT_Window.hxx>
#elif defined(__APPLE__)
#include <Cocoa_Window.hxx>
#else
#include <Aspect_DisplayConnection.hxx>
#include <Xw_Window.hxx>
#endif

namespace thcad::occt {

#if defined(__APPLE__)
void ensureCocoaApplication();  // cocoa_app.mm
#else
inline void ensureCocoaApplication() {}
#endif

/** Hidden, never-mapped window that only provides the GL context (frames render into an FBO). */
inline Handle(Aspect_Window) makeOffscreenWindow(const Handle(Aspect_DisplayConnection)& disp) {
#if defined(_WIN32)
  (void)disp;
  static Handle(WNT_WClass) cls = new WNT_WClass("thcad_offscreen", nullptr, 0);
  // WS_POPUP: OCCT's Standard_Macro.hxx defines NOUSER, which hides the WS_* macros from <windows.h>
  constexpr unsigned long kWsPopup = 0x80000000UL;
  Handle(WNT_Window) w = new WNT_Window("thcad-offscreen", cls, kWsPopup, 0, 0, 64, 64, Quantity_NOC_BLACK);
#elif defined(__APPLE__)
  (void)disp;
  Handle(Cocoa_Window) w = new Cocoa_Window("thcad-offscreen", 0, 0, 64, 64);
#else
  Handle(Xw_Window) w = new Xw_Window(disp, "thcad-offscreen", 0, 0, 64, 64);
#endif
  w->SetVirtual(true);
  return w;
}

/** Wraps the host widget's native handle (NSView* / HWND / X11 Window). */
inline Handle(Aspect_Window) wrapNativeWindow(void* handle, const Handle(Aspect_DisplayConnection)& disp) {
#if defined(_WIN32)
  (void)disp;
  return new WNT_Window(reinterpret_cast<Aspect_Handle>(handle));
#elif defined(__APPLE__)
  (void)disp;
  return new Cocoa_Window(static_cast<NSView*>(handle));
#else
  return new Xw_Window(disp, reinterpret_cast<Aspect_Drawable>(handle));
#endif
}

}  // namespace thcad::occt
