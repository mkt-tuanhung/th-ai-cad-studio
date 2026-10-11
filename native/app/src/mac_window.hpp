#pragma once
class QWidget;
namespace thcad::app {
/** Full-size content view with a transparent title bar: the web UI draws edge to edge and the
 *  system traffic lights float over it, as in the approved mockups. */
void applyUnifiedTitlebar(QWidget* window);
/** CGWindowID of the top-level window (for QA screenshots via `screencapture -l`). */
long windowNumber(QWidget* window);
}  // namespace thcad::app
