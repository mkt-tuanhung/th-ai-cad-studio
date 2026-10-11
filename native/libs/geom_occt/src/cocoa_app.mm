// Offscreen GL needs an NSApplication (present in the Qt app, absent in tests / CLI tools).
#import <AppKit/AppKit.h>

namespace thcad::occt {
void ensureCocoaApplication() { [NSApplication sharedApplication]; }
}  // namespace thcad::occt
