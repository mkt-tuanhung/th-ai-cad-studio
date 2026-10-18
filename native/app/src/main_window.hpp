#pragma once
#include <QMainWindow>

class QWebEngineView;
class QWebChannel;

namespace thcad::app {

class HostBridge;
namespace licence { class TrialOverlay; }
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
  bool locked_ = false;
  licence::TrialOverlay* overlay_ = nullptr;
  void lock();
};

}  // namespace thcad::app
