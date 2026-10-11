// TH AI CAD Studio — desktop host for macOS and Windows (Qt 6 + WebEngine UI + native engine).
#include <QApplication>
#include <QProcess>
#include <QTimer>

#include "mac_window.hpp"

#include "main_window.hpp"
#include "ui_scheme.hpp"

int main(int argc, char** argv) {
  thcad::app::UiSchemeHandler::registerScheme();  // must precede QApplication
  QApplication::setApplicationName(QStringLiteral("TH AI CAD Studio"));
  QApplication::setOrganizationName(QStringLiteral("TH"));
  QApplication::setApplicationVersion(QStringLiteral("0.1.0"));
  QApplication app(argc, argv);

  thcad::app::MainWindow w;
  w.show();

  // QA hook: THCAD_SNAPSHOT=/path.png [THCAD_SNAPSHOT_MS=4000] captures the real window (incl. the
  // native OCCT view) with macOS `screencapture`.
#ifdef Q_OS_MACOS
  if (const QString shot = qEnvironmentVariable("THCAD_SNAPSHOT"); !shot.isEmpty()) {
    const int ms = qEnvironmentVariableIntValue("THCAD_SNAPSHOT_MS") > 0 ? qEnvironmentVariableIntValue("THCAD_SNAPSHOT_MS") : 4000;
    QTimer::singleShot(ms, &w, [&w, shot] {
      QProcess::execute(QStringLiteral("/usr/sbin/screencapture"), {QStringLiteral("-x"), QStringLiteral("-o"), QStringLiteral("-l%1").arg(thcad::app::windowNumber(&w)), shot});
    });
  }
#endif
  // QA hook: THCAD_GRAB=/path.png renders the window through Qt (web UI only, no native GL view).
  if (const QString grab = qEnvironmentVariable("THCAD_GRAB"); !grab.isEmpty()) {
    const int ms = qEnvironmentVariableIntValue("THCAD_SNAPSHOT_MS") > 0 ? qEnvironmentVariableIntValue("THCAD_SNAPSHOT_MS") : 4000;
    QTimer::singleShot(ms, &w, [&w, grab] { w.grab().save(grab); });
  }
  // Automation hook for QA: THCAD_QUIT_AFTER_MS=n quits after n ms.
  if (const int ms = qEnvironmentVariableIntValue("THCAD_QUIT_AFTER_MS"); ms > 0) QTimer::singleShot(ms, &app, &QApplication::quit);
  return app.exec();
}
