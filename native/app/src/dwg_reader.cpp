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

QString DwgReader::writerPath() {
  if (const QString env = qEnvironmentVariable("THCAD_DWGADD"); !env.isEmpty() && QFileInfo(env).isExecutable()) return env;
  const QString dir = QCoreApplication::applicationDirPath();
#ifdef Q_OS_WIN
  const QStringList candidates{dir + "/libredwg/dwgadd.exe"};
#else
  const QStringList candidates{dir + "/../Helpers/dwgadd", "/opt/homebrew/bin/dwgadd"};
#endif
  for (const QString& c : candidates)
    if (QFileInfo(c).isExecutable()) return QFileInfo(c).canonicalFilePath();
  return {};
}

QJsonObject DwgReader::write(const QString& script, const QString& path) {
  const QString add = writerPath(), reader = helperPath();
  if (add.isEmpty()) return {{"ok", false}, {"error", "no-writer"}};
  QTemporaryDir tmp;
  if (!tmp.isValid()) return {{"ok", false}, {"error", "temp directory unavailable"}};
  const QString scriptFile = tmp.filePath("drawing.add");
  {
    QFile f(scriptFile);
    if (!f.open(QIODevice::WriteOnly)) return {{"ok", false}, {"error", "cannot write the script"}};
    f.write(script.toUtf8());
  }
  QFile::remove(path);
  QProcess p;
  p.start(add, {"-o", path, scriptFile});
  if (!p.waitForFinished(60000)) {
    p.kill();
    return {{"ok", false}, {"error", "dwgadd timed out"}};
  }
  const QString log = QString::fromUtf8(p.readAllStandardError() + p.readAllStandardOutput()).trimmed();
  if (p.exitCode() != 0 || !QFileInfo::exists(path)) return {{"ok", false}, {"error", "dwgadd failed: " + log.right(400)}};
  QJsonObject r{{"ok", true}, {"path", path}, {"bytes", static_cast<double>(QFileInfo(path).size())}};
  const QStringList warnings = log.split('\n', Qt::SkipEmptyParts).filter(QRegularExpression("^(Warning|ERROR)", QRegularExpression::CaseInsensitiveOption));
  if (!warnings.isEmpty()) r["warnings"] = warnings.mid(0, 20).join('\n');
  // verify: read the new DWG back and count what it contains
  if (!reader.isEmpty()) {
    const QString back = tmp.filePath("back.dxf");
    QProcess v;
    v.start(reader, {"-y", "-o", back, path});
    if (v.waitForFinished(60000) && QFileInfo::exists(back)) {
      QFile f(back);
      f.open(QIODevice::ReadOnly);
      const QList<QByteArray> lines = f.readAll().split('\n');
      int entities = 0, layers = 0;
      QString section;
      for (int k = 0; k + 1 < lines.size(); k += 2) {
        const QByteArray code = lines[k].trimmed(), val = lines[k + 1].trimmed();
        if (code != "0") continue;
        if (val == "SECTION" && k + 3 < lines.size()) section = QString::fromLatin1(lines[k + 3].trimmed());
        else if (val == "ENDSEC") section.clear();
        else if (section == "ENTITIES") ++entities;
        else if (section == "TABLES" && val == "LAYER") ++layers;
      }
      r["entities"] = entities;
      r["layers"] = layers - 1;  // the LAYER table record itself
    }
  }
  return r;
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
