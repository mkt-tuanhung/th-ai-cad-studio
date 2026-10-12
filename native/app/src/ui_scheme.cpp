#include "ui_scheme.hpp"

#include <QBuffer>
#include <QCoreApplication>
#include <QFile>
#include <QMimeDatabase>
#include <QWebEngineUrlRequestJob>
#include <QWebEngineUrlScheme>

namespace thcad::app {

UiSchemeHandler::UiSchemeHandler(QDir root, QObject* parent) : QWebEngineUrlSchemeHandler(parent), root_(std::move(root)) {}

void UiSchemeHandler::registerScheme() {
  QWebEngineUrlScheme s("thcad");
  s.setSyntax(QWebEngineUrlScheme::Syntax::Host);
  // FetchApiAllowed: fetch() of the app's own files (OCR models loaded by a web worker) works on thcad://
  s.setFlags(QWebEngineUrlScheme::SecureScheme | QWebEngineUrlScheme::LocalAccessAllowed | QWebEngineUrlScheme::CorsEnabled |
             QWebEngineUrlScheme::ContentSecurityPolicyIgnored | QWebEngineUrlScheme::FetchApiAllowed);
  QWebEngineUrlScheme::registerScheme(s);
}

QDir UiSchemeHandler::locateUi() {
  // 1) $THCAD_UI_DIR  2) macOS bundle Contents/Resources/ui  3) Windows <exe dir>/ui
  // 4) ../ui/dist next to the source tree (dev)
  if (const QByteArray env = qgetenv("THCAD_UI_DIR"); !env.isEmpty()) return QDir(QString::fromUtf8(env));
  QDir bundle(QCoreApplication::applicationDirPath() + "/../Resources/ui");
  if (bundle.exists("index.html")) return bundle;
  QDir beside(QCoreApplication::applicationDirPath() + "/ui");
  if (beside.exists("index.html")) return beside;
  return QDir(QStringLiteral(THCAD_SOURCE_DIR "/../ui/dist"));
}

void UiSchemeHandler::requestStarted(QWebEngineUrlRequestJob* job) {
  QString path = job->requestUrl().path();
  if (path.isEmpty() || path == "/") path = "/index.html";
  const QString file = QDir::cleanPath(root_.absolutePath() + path);
  if (!file.startsWith(root_.absolutePath())) {  // no path traversal
    job->fail(QWebEngineUrlRequestJob::RequestDenied);
    return;
  }
  auto* f = new QFile(file, job);
  if (!f->open(QIODevice::ReadOnly)) {
    job->fail(QWebEngineUrlRequestJob::UrlNotFound);
    return;
  }
  static QMimeDatabase mimes;
  QByteArray mime = mimes.mimeTypeForFile(file, QMimeDatabase::MatchExtension).name().toUtf8();
  if (file.endsWith(".js") || file.endsWith(".mjs")) mime = "text/javascript";
  job->reply(mime, f);
}

}  // namespace thcad::app
