// Non-macOS builds (Windows): the OS draws the standard title bar above the web UI.
#include "mac_window.hpp"

namespace thcad::app {
void applyUnifiedTitlebar(QWidget*) {}
long windowNumber(QWidget*) { return 0; }
}  // namespace thcad::app
