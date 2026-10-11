#pragma once
// Native viewport placed over the web UI's viewport slot (architecture option A).
// Today it hosts the OCCT 3D viewer for the BIM "3D" slot; the 2D CAD slot stays in the web UI
// until the native 2D renderer exists.
#include <QPointer>
#include <QWidget>
#include <memory>

namespace thcad::occt { class Viewer; }

namespace thcad::app {

class NativeViewport : public QWidget {
  Q_OBJECT
 public:
  explicit NativeViewport(QWidget* parent);
  ~NativeViewport() override;
  /** Called from the bridge with CSS-pixel coordinates relative to the web view. */
  void placeSlot(const QString& kind, const QRectF& rect, bool visible);
  QPaintEngine* paintEngine() const override { return nullptr; }

 protected:
  void showEvent(QShowEvent*) override;
  void resizeEvent(QResizeEvent*) override;
  void paintEvent(QPaintEvent*) override;
  void mousePressEvent(QMouseEvent*) override;
  void mouseMoveEvent(QMouseEvent*) override;
  void mouseReleaseEvent(QMouseEvent*) override;
  void wheelEvent(QWheelEvent*) override;
  void mouseDoubleClickEvent(QMouseEvent*) override;

 private:
  void ensureViewer();
  std::unique_ptr<occt::Viewer> viewer_;
  QString kind_;
  bool loaded_ = false;
};

}  // namespace thcad::app
