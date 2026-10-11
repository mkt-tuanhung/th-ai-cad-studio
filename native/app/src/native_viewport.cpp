#include "native_viewport.hpp"

#include <QMouseEvent>
#include <QTimer>
#include <QWheelEvent>

#ifdef THCAD_HAS_OCCT
#include "thcad/bim/model.hpp"
#include "thcad/occt/viewer.hpp"
#endif

namespace thcad::app {

NativeViewport::NativeViewport(QWidget* parent) : QWidget(parent) {
  setAttribute(Qt::WA_NativeWindow);
  setAttribute(Qt::WA_PaintOnScreen);
  setAttribute(Qt::WA_NoSystemBackground);
  setMouseTracking(true);
  hide();
}

NativeViewport::~NativeViewport() = default;

void NativeViewport::placeSlot(const QString& kind, const QRectF& r, bool visible) {
#ifndef THCAD_HAS_OCCT
  visible = false;
#endif
  if (kind != QLatin1String("bim-3d")) visible = false;  // only the 3D slot is native for now
  kind_ = kind;
  if (!visible || r.width() < 4 || r.height() < 4) {
    hide();
    return;
  }
  setGeometry(r.toAlignedRect());
  show();
  raise();
  ensureViewer();
}

void NativeViewport::ensureViewer() {
#ifdef THCAD_HAS_OCCT
  if (!viewer_) {
    viewer_ = std::make_unique<occt::Viewer>();
    viewer_->attach(reinterpret_cast<void*>(winId()));
  }
  if (!loaded_) {
    viewer_->display(occt::buildingSolid(bim::villaRiverside()));
    loaded_ = true;
  }
  viewer_->resized();
  // QA hook: THCAD_OCCT_DUMP=/path.png writes the native 3D frame (screen capture cannot see GL).
  if (const QString dump = qEnvironmentVariable("THCAD_OCCT_DUMP"); !dump.isEmpty())
    QTimer::singleShot(1500, this, [this, dump] { if (viewer_) viewer_->dump(dump.toStdString()); });
#endif
}

void NativeViewport::showEvent(QShowEvent*) {
  if (viewer_) viewer_->resized();
}
void NativeViewport::resizeEvent(QResizeEvent*) {
#ifdef THCAD_HAS_OCCT
  if (viewer_) viewer_->resized();
#endif
}
void NativeViewport::paintEvent(QPaintEvent*) {
#ifdef THCAD_HAS_OCCT
  if (viewer_) viewer_->redraw();
#endif
}

namespace {
int buttons(Qt::MouseButtons b) {
  return (b & Qt::LeftButton ? 1 : 0) | (b & Qt::MiddleButton ? 2 : 0) | (b & Qt::RightButton ? 4 : 0);
}
}  // namespace

#ifdef THCAD_HAS_OCCT
#define DPR(v) static_cast<int>((v) * devicePixelRatioF())
void NativeViewport::mousePressEvent(QMouseEvent* e) {
  if (viewer_) viewer_->mouseDown(DPR(e->position().x()), DPR(e->position().y()), buttons(e->buttons()), e->modifiers() & Qt::ShiftModifier);
}
void NativeViewport::mouseMoveEvent(QMouseEvent* e) {
  if (viewer_) viewer_->mouseMove(DPR(e->position().x()), DPR(e->position().y()), buttons(e->buttons()), e->modifiers() & Qt::ShiftModifier);
}
void NativeViewport::mouseReleaseEvent(QMouseEvent* e) {
  if (viewer_) viewer_->mouseUp(DPR(e->position().x()), DPR(e->position().y()), buttons(e->buttons()), e->modifiers() & Qt::ShiftModifier);
}
void NativeViewport::wheelEvent(QWheelEvent* e) {
  if (viewer_) viewer_->wheel(DPR(e->position().x()), DPR(e->position().y()), e->angleDelta().y() / 120.0);
}
void NativeViewport::mouseDoubleClickEvent(QMouseEvent*) {
  if (viewer_) viewer_->fitAll();
}
#else
void NativeViewport::mousePressEvent(QMouseEvent*) {}
void NativeViewport::mouseMoveEvent(QMouseEvent*) {}
void NativeViewport::mouseReleaseEvent(QMouseEvent*) {}
void NativeViewport::wheelEvent(QWheelEvent*) {}
void NativeViewport::mouseDoubleClickEvent(QMouseEvent*) {}
#endif

}  // namespace thcad::app
