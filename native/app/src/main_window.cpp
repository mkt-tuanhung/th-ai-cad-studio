#include "main_window.hpp"

#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QFileDialog>
#include <QStandardPaths>
#include <QWebEngineDownloadRequest>
#include <QTimer>
#include <QWebChannel>
#include <QWebEnginePage>
#include <QWebEnginePermission>
#include <QWebEngineProfile>
#include <QWebEngineScript>
#include <QWebEngineScriptCollection>
#include <QWebEngineSettings>
#include <QWebEngineView>

#include "host_bridge.hpp"
#include "mac_window.hpp"
#include "native_viewport.hpp"
#include "ui_scheme.hpp"

namespace thcad::app {

namespace {

/** Forwards JS console output to stderr when THCAD_DEBUG=1. */
class LoggingPage : public QWebEnginePage {
 public:
  using QWebEnginePage::QWebEnginePage;

 protected:
  void javaScriptConsoleMessage(JavaScriptConsoleMessageLevel level, const QString& msg, int line, const QString& src) override {
    if (msg.startsWith(QLatin1String("SELFTEST")) || msg.startsWith(QLatin1String("E2E")) || qEnvironmentVariableIntValue("THCAD_DEBUG") == 1 || level == ErrorMessageLevel)
      qWarning("[js:%d] %s (%s:%d)", int(level), qPrintable(msg), qPrintable(src), line);
  }
};

/** Runs before any page script: exposes window.thcadHostReady → promise-based host API. */
QString bootstrapScript() {
  QFile f(QStringLiteral(":/qtwebchannel/qwebchannel.js"));
  f.open(QIODevice::ReadOnly);
  QString js = QString::fromUtf8(f.readAll());
  js += QStringLiteral(R"JS(
;(function () {
  window.thcadHostReady = new Promise(function (resolve) {
    function connect() {
      if (!window.qt || !qt.webChannelTransport) return setTimeout(connect, 10);
      new QWebChannel(qt.webChannelTransport, function (ch) {
        var raw = ch.objects.host, api = { raw: raw, nativeViewport: raw.nativeViewport };
        Object.keys(raw).forEach(function (k) {
          if (typeof raw[k] === 'function') api[k] = function () {
            var args = Array.prototype.slice.call(arguments);
            return new Promise(function (r) { raw[k].apply(raw, args.concat([r])); });
          };
        });
        api.on = function (signal, fn) { raw[signal].connect(fn); };
        window.thcadHost = api;
        resolve(api);
      });
    }
    connect();
  });
})();
)JS");
  return js;
}

}  // namespace

MainWindow::MainWindow(QWidget* parent) : QMainWindow(parent) {
  setWindowTitle(QStringLiteral("MD CAD AI STUDIO"));
  resize(1528, 957);  // the approved mockup window size
  // Web UI draws under the (transparent) title bar; traffic lights float over the sidebar.
#ifdef Q_OS_MACOS
  // macOS: content under a transparent title bar, the system traffic lights float over the UI.
  // Windows keeps its standard caption (min / max / close) — the web UI does not draw one.
  setWindowFlag(Qt::ExpandedClientAreaHint, true);
  setWindowFlag(Qt::NoTitleBarBackgroundHint, true);
#endif
  setAttribute(Qt::WA_ContentsMarginsRespectsSafeArea, false);
  setMinimumSize(1180, 720);

  // persistent: localStorage / IndexedDB survive restarts. Automated QA (THCAD_QA=1) gets its own profile so a
  // test run never edits or opens the user's drawings and settings.
  auto* profile = new QWebEngineProfile(qEnvironmentVariableIntValue("THCAD_QA") == 1 ? QStringLiteral("thcad-qa") : QStringLiteral("thcad"), this);
  profile->installUrlSchemeHandler("thcad", new UiSchemeHandler(UiSchemeHandler::locateUi(), profile));
  auto* page = new LoggingPage(profile, this);
  // Browser-style downloads (CSV, G-code, ZIP, PNG…): a save dialog, like a browser asking where to save.
  // THCAD_DOWNLOAD_DIR (QA) saves without asking.
  connect(profile, &QWebEngineProfile::downloadRequested, this, [this](QWebEngineDownloadRequest* d) {
    const QString qaDir = qEnvironmentVariable("THCAD_DOWNLOAD_DIR");
    QString path;
    if (!qaDir.isEmpty()) path = QDir(qaDir).filePath(d->suggestedFileName());
    else {
      const QString start = QStandardPaths::writableLocation(QStandardPaths::DownloadLocation) + "/" + d->suggestedFileName();
      path = QFileDialog::getSaveFileName(this, tr("Save file"), start);
    }
    if (path.isEmpty()) return d->cancel();
    const QFileInfo fi(path);
    d->setDownloadDirectory(fi.absolutePath());
    d->setDownloadFileName(fi.fileName());
    connect(d, &QWebEngineDownloadRequest::isFinishedChanged, this, [d, path] {
      if (d->isFinished()) qInfo().noquote() << "DOWNLOAD" << (d->state() == QWebEngineDownloadRequest::DownloadCompleted ? "saved" : "failed") << path << QFileInfo(path).size();
    });
    d->accept();
  });
  page->settings()->setAttribute(QWebEngineSettings::LocalStorageEnabled, true);
  page->setBackgroundColor(QColor(0x05, 0x08, 0x0b));  // the intro's background: no light flash at launch

  QWebEngineScript boot;
  boot.setName(QStringLiteral("thcad-bootstrap"));
  boot.setInjectionPoint(QWebEngineScript::DocumentCreation);
  boot.setWorldId(QWebEngineScript::MainWorld);
  boot.setSourceCode(bootstrapScript());
  page->scripts().insert(boot);

  web_ = new QWebEngineView(this);
  web_->setAttribute(Qt::WA_ContentsMarginsRespectsSafeArea, false);
  web_->setPage(page);
  setCentralWidget(web_);

  const bool nativeVp = qEnvironmentVariableIntValue("THCAD_NATIVE_VIEWPORT") == 1;
  if (nativeVp) viewport_ = new NativeViewport(web_);
  bridge_ = new HostBridge(viewport_, this);
  channel_ = new QWebChannel(this);
  channel_->registerObject(QStringLiteral("host"), bridge_);
  page->setWebChannel(channel_);

  // Dev: THCAD_UI_URL=http://127.0.0.1:5173 (Vite). Otherwise the bundled build via thcad://.
  QString url = qEnvironmentVariable("THCAD_UI_URL", QStringLiteral("thcad://app/index.html"));
  // Microphone (Voice CAD → local Whisper): granted to the app's own UI only; any other origin is refused.
  // The operating system still asks the user once (macOS: NSMicrophoneUsageDescription).
  const QUrl uiUrl(url);
  connect(page, &QWebEnginePage::permissionRequested, this, [uiUrl](QWebEnginePermission p) {
    const QUrl o = p.origin();
    const bool own = o.scheme() == uiUrl.scheme() && o.host() == uiUrl.host() && o.port() == uiUrl.port();
    if (own && p.permissionType() == QWebEnginePermission::PermissionType::MediaAudioCapture) p.grant();
    else p.deny();
  });
  const QString route = qEnvironmentVariable("THCAD_ROUTE", QStringLiteral("dashboard"));
  // QA: THCAD_SELFTEST=1 exercises the bridge from the page (same calls the UI makes) and quits.
  // THCAD_SCRIPT=/path.js runs any QA script the same way.
  if (qEnvironmentVariableIntValue("THCAD_SELFTEST") == 1 || qEnvironmentVariableIsSet("THCAD_SCRIPT"))
    connect(page, &QWebEnginePage::loadFinished, this, [page](bool) {
      QFile f(qEnvironmentVariableIsSet("THCAD_SCRIPT") ? qEnvironmentVariable("THCAD_SCRIPT") : QStringLiteral(THCAD_SOURCE_DIR "/app/resources/selftest.js"));
      f.open(QIODevice::ReadOnly);
      page->runJavaScript(QString::fromUtf8(f.readAll()));
    });
  connect(page, &QWebEnginePage::loadFinished, this, [page](bool ok) {
    if (!ok || qEnvironmentVariableIntValue("THCAD_DEBUG") == 1) qWarning("UI load finished: %s", ok ? "ok" : "FAILED");
    if (qEnvironmentVariableIntValue("THCAD_DEBUG") == 1)
      QTimer::singleShot(1500, page, [page] {
        page->runJavaScript(QStringLiteral("JSON.stringify({url: location.href, root: document.getElementById('root')?.innerHTML.length, scripts: [...document.scripts].map(s => s.src), host: typeof window.thcadHostReady})"),
                            [](const QVariant& v) { qWarning("UI state: %s", qPrintable(v.toString())); });
      });
  });
  // the brand intro plays at launch, except for automated QA runs (THCAD_SCRIPT / SELFTEST) or THCAD_SPLASH=0
  const bool qa = qEnvironmentVariableIntValue("THCAD_SELFTEST") == 1 || qEnvironmentVariableIsSet("THCAD_SCRIPT");
  const bool splash = !qa && qEnvironmentVariable("THCAD_SPLASH") != QStringLiteral("0");
  web_->load(QUrl(url + QStringLiteral("?shell=native") + (splash ? QString() : QStringLiteral("&splash=0")) + QStringLiteral("#/") + route));
}

void MainWindow::showEvent(QShowEvent* e) {
  QMainWindow::showEvent(e);
  if (qEnvironmentVariableIntValue("THCAD_NO_UNIFIED") != 1) applyUnifiedTitlebar(this);
}

}  // namespace thcad::app
