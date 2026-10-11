#include "mac_window.hpp"

#import <AppKit/AppKit.h>
#include <QWidget>

namespace thcad::app {

void applyUnifiedTitlebar(QWidget* w) {
  NSView* view = reinterpret_cast<NSView*>(w->winId());
  NSWindow* win = view.window;
  if (!win) return;
  win.titlebarAppearsTransparent = YES;
  win.titleVisibility = NSWindowTitleHidden;
  win.styleMask |= NSWindowStyleMaskFullSizeContentView;
  win.backgroundColor = [NSColor colorWithSRGBRed:0.945 green:0.957 blue:0.969 alpha:1.0];
}

long windowNumber(QWidget* w) {
  NSView* view = reinterpret_cast<NSView*>(w->winId());
  return view.window ? static_cast<long>(view.window.windowNumber) : 0;
}

}  // namespace thcad::app
