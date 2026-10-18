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
  /** allowEnv: honour $THCAD_UI_DIR (dev / QA builds only). */
  static QDir locateUi(bool allowEnv = true);

 private:
  QDir root_;
};

}  // namespace thcad::app
