#include "blender_worker.hpp"

#include <algorithm>

#include <QCoreApplication>
#include <QDateTime>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QJsonDocument>
#include <QProcessEnvironment>
#include <QRegularExpression>
#include <QSettings>
#include <QStandardPaths>
#include <QTimer>

namespace thcad::app {

namespace {

/** Candidate Blender executables, most specific first. */
QStringList candidates() {
  QStringList c;
#if defined(Q_OS_MACOS)
  c << QStringLiteral("/Applications/Blender.app/Contents/MacOS/Blender") << QDir::homePath() + QStringLiteral("/Applications/Blender.app/Contents/MacOS/Blender")
    << QStringLiteral("/opt/homebrew/bin/blender") << QStringLiteral("/usr/local/bin/blender");
#elif defined(Q_OS_WIN)
  for (const QString& root : {qEnvironmentVariable("ProgramFiles"), qEnvironmentVariable("ProgramW6432")}) {
    if (root.isEmpty()) continue;
    QDir d(root + QStringLiteral("/Blender Foundation"));
    // newest version folder first ("Blender 5.2", "Blender 4.2" …)
    QStringList vers = d.entryList({QStringLiteral("Blender*")}, QDir::Dirs, QDir::Name | QDir::Reversed);
    for (const QString& v : vers) c << d.absoluteFilePath(v + QStringLiteral("/blender.exe"));
  }
#else
  c << QStringLiteral("/usr/bin/blender") << QStringLiteral("/snap/bin/blender");
#endif
  const QString onPath = QStandardPaths::findExecutable(QStringLiteral("blender"));
  if (!onPath.isEmpty()) c << onPath;
  return c;
}

/** Version without starting Blender when the executable is inside a macOS bundle (Info.plist). */
QString bundleVersion(const QString& exe) {
  const int at = exe.indexOf(QStringLiteral(".app/Contents/MacOS/"));
  if (at < 0) return {};
  const QString plist = exe.left(at + 4) + QStringLiteral("/Contents/Info.plist");
  if (!QFileInfo::exists(plist)) return {};
  QSettings s(plist, QSettings::NativeFormat);
  return s.value(QStringLiteral("CFBundleShortVersionString")).toString();
}

QString askVersion(const QString& exe) {
  QProcess p;
  p.start(exe, {QStringLiteral("--version")});
  if (!p.waitForFinished(15000)) {
    p.kill();
    return {};
  }
  const QString out = QString::fromUtf8(p.readAllStandardOutput());
  const auto m = QRegularExpression(QStringLiteral("Blender\\s+([0-9][0-9.]*[^\\n\\r]*)")).match(out);
  return m.hasMatch() ? m.captured(1).trimmed() : QString();
}

bool sandboxed() {
#if defined(Q_OS_MACOS)
  // outbound network denied for the render process (macOS sandbox profile); THCAD_BLENDER_SANDBOX=0 turns it off
  return qEnvironmentVariable("THCAD_BLENDER_SANDBOX") != QStringLiteral("0") && QFileInfo::exists(QStringLiteral("/usr/bin/sandbox-exec"));
#else
  return false;
#endif
}

}  // namespace

QString BlenderWorker::scriptPath() {
  const QString dir = QCoreApplication::applicationDirPath();
  for (const QString& p : {dir + QStringLiteral("/../Resources/md_render.py"), dir + QStringLiteral("/resources/md_render.py"), dir + QStringLiteral("/md_render.py"),
                           QStringLiteral(THCAD_SOURCE_DIR "/app/resources/md_render.py")})
    if (QFileInfo::exists(p)) return QFileInfo(p).canonicalFilePath();
  return {};
}

QString BlenderWorker::cacheDir() {
  QString d = qEnvironmentVariable("THCAD_RENDER_CACHE");
  if (d.isEmpty()) d = QStandardPaths::writableLocation(QStandardPaths::CacheLocation) + QStringLiteral("/render-snapshots");
  QDir().mkpath(d);
  return QDir(d).canonicalPath().isEmpty() ? d : QDir(d).canonicalPath();
}

QJsonObject BlenderWorker::probe(bool refresh) {
  static QJsonObject cached;
  static bool done = false;
  if (done && !refresh) return cached;
  done = true;
  const QString script = scriptPath();
  QJsonObject r{{"found", false}, {"script", script}, {"scriptFound", !script.isEmpty()}, {"sandbox", sandboxed()}, {"bundled", false}};
  const QString env = qEnvironmentVariable("THCAD_BLENDER");
  if (env == QStringLiteral("none") || env == QStringLiteral("0")) {
    r["reason"] = QStringLiteral("disabled (THCAD_BLENDER=none)");
    return cached = r;
  }
  QStringList list = candidates();
  if (!env.isEmpty()) list.prepend(env);
  for (const QString& exe : list) {
    const QFileInfo fi(exe);
    if (!fi.exists() || !fi.isExecutable()) continue;
    QString ver = bundleVersion(fi.absoluteFilePath());
    if (ver.isEmpty()) ver = askVersion(fi.absoluteFilePath());
    if (ver.isEmpty()) continue;
    r["found"] = true;
    r["path"] = fi.absoluteFilePath();
    r["version"] = ver;
    r["source"] = !env.isEmpty() && exe == env ? QStringLiteral("THCAD_BLENDER") : QStringLiteral("installed");
    return cached = r;
  }
  r["reason"] = QStringLiteral("Blender not found");
  return cached = r;
}

BlenderWorker::BlenderWorker(QObject* parent) : QObject(parent) {}

BlenderWorker::~BlenderWorker() {
  if (proc_ && proc_->state() != QProcess::NotRunning) {
    proc_->disconnect(this);
    proc_->kill();
    proc_->waitForFinished(3000);
  }
  if (!dir_.isEmpty()) QDir(dir_).removeRecursively();
}

bool BlenderWorker::running() const { return proc_ && proc_->state() != QProcess::NotRunning; }

QString BlenderWorker::start(const QString& id, QJsonObject spec) {
  if (running()) return QStringLiteral("busy");
  const QJsonObject info = probe();
  if (!info.value("found").toBool()) return QStringLiteral("blender-not-found");
  const QString script = scriptPath();
  if (script.isEmpty()) return QStringLiteral("md_render.py missing from the app resources");
  QString safe = id;
  safe.replace(QRegularExpression(QStringLiteral("[^A-Za-z0-9_-]")), QStringLiteral("_"));
  dir_ = cacheDir() + QStringLiteral("/jobs/") + safe;
  QDir(dir_).removeRecursively();
  if (!QDir().mkpath(dir_)) return QStringLiteral("cannot create ") + dir_;
  out_ = dir_ + QStringLiteral("/render.png");
  spec["output"] = out_;
  QFile jf(dir_ + QStringLiteral("/job.json"));
  if (!jf.open(QIODevice::WriteOnly) || jf.write(QJsonDocument(spec).toJson()) <= 0) return QStringLiteral("cannot write job.json");
  jf.close();
  id_ = id;
  samples_ = 0, total_ = spec.value("samples").toInt(64);
  device_.clear(), error_.clear(), buf_.clear(), log_.clear();
  cancelled_ = false;
  t0_ = QDateTime::currentMSecsSinceEpoch(), lastEmit_ = 0;
  proc_ = new QProcess(this);
  proc_->setProcessChannelMode(QProcess::MergedChannels);
  proc_->setWorkingDirectory(dir_);
  QProcessEnvironment env = QProcessEnvironment::systemEnvironment();
  for (const char* k : {"PYTHONPATH", "PYTHONHOME", "PYTHONSTARTUP", "BLENDER_USER_SCRIPTS", "BLENDER_SYSTEM_SCRIPTS"}) env.remove(QString::fromLatin1(k));
  proc_->setProcessEnvironment(env);
  connect(proc_, &QProcess::readyReadStandardOutput, this, &BlenderWorker::onOutput);
  connect(proc_, &QProcess::finished, this, &BlenderWorker::onFinished);
  connect(proc_, &QProcess::errorOccurred, this, [this](QProcess::ProcessError e) {
    if (e == QProcess::FailedToStart) {
      error_ = QStringLiteral("Blender failed to start: ") + proc_->errorString();
      onFinished(-1, QProcess::CrashExit);
    }
  });
  const QString exe = info.value("path").toString();
  QStringList args{QStringLiteral("-b"), QStringLiteral("--factory-startup"), QStringLiteral("--offline-mode"), QStringLiteral("-noaudio"),
                   QStringLiteral("--python-exit-code"), QStringLiteral("3"), QStringLiteral("-P"), script, QStringLiteral("--"), jf.fileName()};
  if (sandboxed()) {
    args.prepend(exe);
    args.prepend(QStringLiteral("(version 1)(allow default)(deny network*)"));
    args.prepend(QStringLiteral("-p"));
    proc_->start(QStringLiteral("/usr/bin/sandbox-exec"), args);
  } else {
    proc_->start(exe, args);
  }
  return {};
}

void BlenderWorker::cancel() {
  if (!running()) return;
  cancelled_ = true;
  proc_->kill();
}

void BlenderWorker::cleanup() {
  if (running() || dir_.isEmpty()) return;
  QDir(dir_).removeRecursively();
  dir_.clear();
}

void BlenderWorker::onOutput() {
  if (!proc_) return;
  buf_ += QString::fromUtf8(proc_->readAllStandardOutput());
  int nl;
  bool changed = false;
  QString stage;
  static const QRegularExpression sample(QStringLiteral("Sample (\\d+)/(\\d+)"));
  while ((nl = buf_.indexOf('\n')) >= 0) {
    const QString line = buf_.left(nl).trimmed();
    buf_.remove(0, nl + 1);
    if (line.isEmpty()) continue;
    log_ += line + '\n';
    if (log_.size() > 20000) log_ = log_.right(12000);
    if (line.startsWith(QStringLiteral("MDDEVICE "))) device_ = line.mid(9);
    else if (line.startsWith(QStringLiteral("MDERROR "))) error_ = line.mid(8);
    else if (line.startsWith(QStringLiteral("MDSTAGE "))) stage = line.mid(8), changed = true;
    else if (const auto m = sample.match(line); m.hasMatch()) {
      samples_ = m.captured(1).toInt();
      total_ = std::max(1, m.captured(2).toInt());
      changed = true;
    }
  }
  const qint64 now = QDateTime::currentMSecsSinceEpoch();
  if (changed && (now - lastEmit_ > 250 || !stage.isEmpty())) {
    lastEmit_ = now;
    QJsonObject p{{"id", id_}, {"samples", samples_}, {"total", total_}, {"ms", static_cast<double>(now - t0_)}, {"engine", "blender"}};
    if (!stage.isEmpty()) p["stage"] = stage;
    emit progress(p);
  }
}

void BlenderWorker::onFinished(int code, QProcess::ExitStatus status) {
  if (!proc_) return;
  onOutput();
  QProcess* p = proc_;
  proc_ = nullptr;
  p->deleteLater();
  const bool produced = QFileInfo(out_).isFile() && QFileInfo(out_).size() > 0;
  const bool ok = !cancelled_ && status == QProcess::NormalExit && code == 0 && produced;
  QJsonObject r{{"id", id_}, {"ok", ok}, {"cancelled", cancelled_}, {"device", device_}, {"samples", samples_}, {"total", total_},
                {"ms", static_cast<double>(QDateTime::currentMSecsSinceEpoch() - t0_)}, {"blender", probe().value("version")}, {"log", log_.right(4000)}};
  if (ok) {
    r["output"] = out_;
  } else {
    r["error"] = cancelled_ ? QStringLiteral("cancelled")
                 : !error_.isEmpty() ? error_
                 : status == QProcess::CrashExit ? QStringLiteral("Blender crashed")
                 : QStringLiteral("Blender exited with code %1 without an image").arg(code);
    // a cancelled or failed job leaves nothing behind
    QDir(dir_).removeRecursively();
    dir_.clear();
  }
  emit finished(r);
}

}  // namespace thcad::app
