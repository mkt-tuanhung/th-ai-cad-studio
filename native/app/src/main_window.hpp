#pragma once
#include <QMainWindow>

class QWebEngineView;
class QWebChannel;

namespace thcad::app {

class HostBridge;
class NativeViewport;

class MainWindow : public QMainWindow {
  Q_OBJECT
 public:
  explicit MainWindow(QWidget* parent = nullptr);

 protected:
  void showEvent(QShowEvent*) override;

 private:
  QWebEngineView* web_ = nullptr;
  QWebChannel* channel_ = nullptr;
  HostBridge* bridge_ = nullptr;
  NativeViewport* viewport_ = nullptr;
};

}  // namespace thcad::app
