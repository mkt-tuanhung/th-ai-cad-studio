#include "dwg_reader.hpp"

#include <QCoreApplication>
#include <QDir>
#include <QElapsedTimer>
#include <QFile>
#include <QFileInfo>
#include <QProcess>
#include <QRegularExpression>
#include <QTemporaryDir>
#include <QTimer>

namespace thcad::app {

QString DwgReader::helperPath() {
  if (const QString env = qEnvironmentVariable("THCAD_DWG2DXF"); !env.isEmpty() && QFileInfo(env).isExecutable()) return env;
  const QString dir = QCoreApplication::applicationDirPath();
#ifdef Q_OS_WIN
  const QStringList candidates{dir + "/libredwg/dwg2dxf.exe"};
#else
  // bundled helper first; a Homebrew install only serves development builds
  const QStringList candidates{dir + "/../Helpers/dwg2dxf", "/opt/homebrew/bin/dwg2dxf"};
#endif
  for (const QString& c : candidates)
    if (QFileInfo(c).isExecutable()) return QFileInfo(c).canonicalFilePath();
  return {};
}

QString DwgReader::version() {
  static const QString v = [] {
    const QString exe = helperPath();
    if (exe.isEmpty()) return QString();
    QProcess p;
    p.start(exe, {"--version"});
    if (!p.waitForFinished(5000)) return QStringLiteral("LibreDWG");
    // "dwg2dxf 0.14" (first line); keep the version number only
    const QString out = QString::fromUtf8(p.readAllStandardOutput() + p.readAllStandardError());
    const auto m = QRegularExpression(R"((\d+\.\d+(?:\.\d+)*))").match(out);
    return m.hasMatch() ? QStringLiteral("LibreDWG ") + m.captured(1) : QStringLiteral("LibreDWG");
  }();
  return v;
}

QString DwgReader::convert(const QByteArray& dwg, const QString& name) {
  const QString id = QStringLiteral("dwg-%1").arg(++seq_);
  auto fail = [this, id](const QString& error) {
    // queued: callers always receive the id before the result
    QMetaObject::invokeMethod(this, [this, id, error] { emit finished({{"id", id}, {"ok", false}, {"error", error}}); }, Qt::QueuedConnection);
    return id;
  };
  const QString exe = helperPath();
  if (exe.isEmpty()) return fail(QStringLiteral("no-reader"));
  auto* tmp = new QTemporaryDir();
  if (!tmp->isValid()) { delete tmp; return fail(QStringLiteral("temp directory unavailable")); }
  const QString in = tmp->filePath("in.dwg"), out = tmp->filePath("out.dxf");
  QFile f(in);
  if (!f.open(QIODevice::WriteOnly) || f.write(dwg) != dwg.size()) { delete tmp; return fail(QStringLiteral("cannot write temp file")); }
  f.close();

  auto* p = new QProcess(this);
  auto* timer = new QElapsedTimer();
  timer->start();
  // -y overwrite, -o output; the DXF keeps the drawing's own version
  connect(p, &QProcess::finished, this, [this, p, tmp, timer, out, id, name](int code, QProcess::ExitStatus status) {
    QJsonObject r{{"id", id}, {"name", name}, {"ms", static_cast<double>(timer->elapsed())}};
    const QString log = QString::fromUtf8(p->readAllStandardError());
    // LibreDWG prints recoverable issues as "Warning:" lines; count them, keep the first few
    const QStringList warnings = log.split('\n').filter(QRegularExpression("^(Warning|ERROR)"));
    r["warnings"] = static_cast<int>(warnings.size());
    QFile o(out);
    if (status == QProcess::NormalExit && o.exists() && o.size() > 0 && o.open(QIODevice::ReadOnly)) {
      r["ok"] = true;
      r["dxf"] = QString::fromLatin1(o.readAll().toBase64());
      r["exitCode"] = code;  // non-zero with a complete DXF = recovered with warnings
    } else {
      r["ok"] = false;
      r["error"] = status == QProcess::CrashExit ? QStringLiteral("reader crashed") : log.right(400).trimmed();
    }
    p->deleteLater();
    delete timer;
    delete tmp;
    emit finished(r);
  });
  connect(p, &QProcess::errorOccurred, this, [p](QProcess::ProcessError e) {
    if (e == QProcess::FailedToStart) emit p->finished(-1, QProcess::CrashExit);
  });
  p->start(exe, {"-y", "-o", out, in});
  // a hung reader must not leave the UI waiting forever
  QTimer::singleShot(120000, p, [p] { if (p->state() != QProcess::NotRunning) p->kill(); });
  return id;
}

}  // namespace thcad::app
