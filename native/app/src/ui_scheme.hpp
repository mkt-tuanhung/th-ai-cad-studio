#pragma once
#include <QDir>
#include <QWebEngineUrlSchemeHandler>

namespace thcad::app {

/** Serves the bundled UI under thcad://app/… so absolute asset paths ("/assets/x.png") resolve
 *  and localStorage persists per origin. Must be registered before QApplication is created. */
class UiSchemeHandler : public QWebEngineUrlSchemeHandler {
  Q_OBJECT
 public:
  explicit UiSchemeHandler(QDir root, QObject* parent = nullptr);
  void requestStarted(QWebEngineUrlRequestJob* job) override;
  static void registerScheme();
  static QDir locateUi();

 private:
  QDir root_;
};

}  // namespace thcad::app
