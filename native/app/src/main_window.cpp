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
#include <QStackedLayout>

#include "host_bridge.hpp"
#include "licence_gate.hpp"
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
  // THCAD_PROFILE=<name> gives parallel QA runs (several worktrees) a profile each.
  // licence (licence_gate.hpp): a customer build without a valid key for this computer starts locked; customer
  // builds also ignore the QA hooks (UI from elsewhere, injected scripts) whether locked or not
  const licence::Status lic = licence::check();
  locked_ = licence::enforced() && !lic.licensed;
  const bool qaHooks = !licence::enforced();
  const QString profileName = qEnvironmentVariable("THCAD_PROFILE", qEnvironmentVariableIntValue("THCAD_QA") == 1 ? QStringLiteral("thcad-qa") : QStringLiteral("thcad"));
  auto* profile = new QWebEngineProfile(profileName, this);
  profile->installUrlSchemeHandler("thcad", new UiSchemeHandler(UiSchemeHandler::locateUi(qaHooks), profile));
  auto* page = new LoggingPage(profile, this);
  // Browser-style downloads (CSV, G-code, ZIP, PNG…): a save dialog, like a browser asking where to save.
  // THCAD_DOWNLOAD_DIR (QA) saves without asking.
  connect(profile, &QWebEngineProfile::downloadRequested, this, [this](QWebEngineDownloadRequest* d) {
    if (locked_) return d->cancel();
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

  if (!locked_) {
  QWebEngineScript boot;
  boot.setName(QStringLiteral("thcad-bootstrap"));
  boot.setInjectionPoint(QWebEngineScript::DocumentCreation);
  boot.setWorldId(QWebEngineScript::MainWorld);
  boot.setSourceCode(bootstrapScript());
  page->scripts().insert(boot);
  }

  auto* central = new QWidget(this);
  central->setAttribute(Qt::WA_ContentsMarginsRespectsSafeArea, false);
  auto* stack = new QStackedLayout(central);
  stack->setContentsMargins(0, 0, 0, 0);
  web_ = new QWebEngineView(central);
  web_->setAttribute(Qt::WA_ContentsMarginsRespectsSafeArea, false);
  web_->setPage(page);
  stack->addWidget(web_);
  setCentralWidget(central);

  const bool nativeVp = qaHooks && qEnvironmentVariableIntValue("THCAD_NATIVE_VIEWPORT") == 1;
  if (nativeVp) viewport_ = new NativeViewport(web_);
  if (locked_) {
    lock();
  } else {
    bridge_ = new HostBridge(viewport_, this);
    channel_ = new QWebChannel(this);
    channel_->registerObject(QStringLiteral("host"), bridge_);
    page->setWebChannel(channel_);
  }
  if (licence::enforced()) {
    // re-verified while running (a key removed, the clock past its expiry): lock again
    auto* recheck = new QTimer(this);
    connect(recheck, &QTimer::timeout, this, [this] {
      if (!locked_ && !licence::check().licensed) lock();
    });
    recheck->start(10 * 60 * 1000);
  }

  // Dev: THCAD_UI_URL=http://127.0.0.1:5173 (Vite). Otherwise the bundled build via thcad://.
  QString url = qaHooks ? qEnvironmentVariable("THCAD_UI_URL", QStringLiteral("thcad://app/index.html")) : QStringLiteral("thcad://app/index.html");
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
  if (qaHooks && (qEnvironmentVariableIntValue("THCAD_SELFTEST") == 1 || qEnvironmentVariableIsSet("THCAD_SCRIPT")))
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
  const bool qa = qaHooks && (qEnvironmentVariableIntValue("THCAD_SELFTEST") == 1 || qEnvironmentVariableIsSet("THCAD_SCRIPT"));
  const bool splash = !qa && qEnvironmentVariable("THCAD_SPLASH") != QStringLiteral("0");
  web_->load(QUrl(url + QStringLiteral("?shell=native") + (splash ? QString() : QStringLiteral("&splash=0")) + QStringLiteral("#/") + route));
}

void MainWindow::lock() {
  locked_ = true;
  if (channel_ && bridge_) channel_->deregisterObject(bridge_);
  web_->setEnabled(false);  // no click or key reaches the page
  if (!overlay_) overlay_ = new licence::TrialOverlay(centralWidget());
  overlay_->show();
  overlay_->raise();
}

void MainWindow::showEvent(QShowEvent* e) {
  QMainWindow::showEvent(e);
  if (qEnvironmentVariableIntValue("THCAD_NO_UNIFIED") != 1) applyUnifiedTitlebar(this);
}

}  // namespace thcad::app
