// MD CAD AI STUDIO — desktop host for macOS and Windows (Qt 6 + WebEngine UI + native engine).
#include <QApplication>
#include <QProcess>
#include <QTimer>
#ifdef Q_OS_UNIX
#include <QSocketNotifier>
#include <csignal>
#include <sys/socket.h>
#include <unistd.h>
#endif

#include "mac_window.hpp"

#include "licence_gate.hpp"
#include "main_window.hpp"
#include "ui_scheme.hpp"

#ifdef Q_OS_UNIX
namespace {
int sigFd[2] = {-1, -1};
/** SIGTERM / SIGINT (logout, `kill`, Ctrl-C in a terminal) quit like the menu does: the event loop ends and the
 *  window, the bridge and their worker threads shut down in order (a model check or AI task is stopped and
 *  joined, a download keeps its .part). The handler only writes a byte (async-signal-safe). */
void installQuitOnSignal(QApplication& app) {
  if (::socketpair(AF_UNIX, SOCK_STREAM, 0, sigFd) != 0) return;
  auto* n = new QSocketNotifier(sigFd[1], QSocketNotifier::Read, &app);
  QObject::connect(n, &QSocketNotifier::activated, &app, [n] {
    n->setEnabled(false);
    char c = 0;
    [[maybe_unused]] const ssize_t r = ::read(sigFd[1], &c, 1);
    QApplication::quit();
  });
  struct sigaction sa {};
  sa.sa_handler = [](int) {
    const char c = 1;
    [[maybe_unused]] const ssize_t r = ::write(sigFd[0], &c, 1);
  };
  sigemptyset(&sa.sa_mask);
  sa.sa_flags = SA_RESTART | SA_RESETHAND;  // a second signal kills as before, should shutdown ever hang
  ::sigaction(SIGTERM, &sa, nullptr);
  ::sigaction(SIGINT, &sa, nullptr);
}
}  // namespace
#endif

int main(int argc, char** argv) {
  thcad::app::UiSchemeHandler::registerScheme();  // must precede QApplication
  // the internal name keeps the data folders of earlier versions (web storage: projects, drawings, settings);
  // what people see is the display name
  QApplication::setApplicationName(QStringLiteral("TH AI CAD Studio"));
  QApplication::setApplicationDisplayName(QStringLiteral("MD CAD AI STUDIO"));
  QApplication::setOrganizationName(QStringLiteral("TH"));
  QApplication::setApplicationVersion(QStringLiteral("0.1.0"));
  // licence CLI (--licence-info, --licence-activate=<file>) answers without opening a window
  if (const int rc = thcad::app::licence::handleCommandLine(argc, argv); rc >= 0) return rc;
  argc = thcad::app::licence::sanitiseArguments(argc, argv);
  QApplication app(argc, argv);
#ifdef Q_OS_UNIX
  installQuitOnSignal(app);
#endif

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
