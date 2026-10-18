#include "vision_runner.hpp"

#include <QCoreApplication>
#include <algorithm>
#include <QDir>
#include <QElapsedTimer>
#include <QFile>
#include <QFileInfo>
#include <QPointer>
#include <QProcess>
#include <QRegularExpression>
#include <QTemporaryDir>
#include <QThread>
#include <QTimer>

#include "thcad/ai/runtime.hpp"

namespace thcad::app {

namespace {
constexpr int kMaxImages = 5;
constexpr qint64 kMaxImageBytes = 20ll * 1024 * 1024;
constexpr int kTimeoutMs = 300000;  // a stuck helper (driver problem, swapped-out model) never blocks the feature
QPointer<QProcess> running;
QString runningId;
bool cancelled = false;
QString lastDevice;

/** The device the helper computed on, from its log (Metal / Vulkan / CUDA / CPU), when the log names it. */
QString deviceOf(const QString& log) {
  for (const char* re : {"ggml_metal_init: found device: ([^\\n]+)", "ggml_vulkan: 0 = ([^|\\n(]+)", "using device (\\S+)", "Device 0: ([^,\\n]+)"}) {
    const auto m = QRegularExpression(QString::fromLatin1(re)).match(log);
    if (m.hasMatch()) return m.captured(1).trimmed();
  }
#ifdef Q_OS_MACOS
  return QStringLiteral("Metal");  // the macOS helper is built with Metal and offloads every layer (-ngl default)
#else
  return {};
#endif
}

bool isImage(const QByteArray& b) {
  return (b.size() > 3 && uchar(b[0]) == 0xFF && uchar(b[1]) == 0xD8 && uchar(b[2]) == 0xFF) || b.startsWith("\x89PNG\r\n\x1a\n");
}
}  // namespace

QString VisionRunner::helperPath() {
  if (const QString env = qEnvironmentVariable("THCAD_MTMD_CLI"); !env.isEmpty() && QFileInfo(env).isExecutable()) return env;
  const QString dir = QCoreApplication::applicationDirPath();
#ifdef Q_OS_WIN
  const QStringList candidates{dir + "/vision/llama-mtmd-cli.exe"};
#else
  // the bundled helper first; the pinned source build and Homebrew's llama.cpp serve development machines
  const QStringList candidates{dir + "/../Helpers/llama-mtmd-cli",
                               QStringLiteral(THCAD_SOURCE_DIR "/third_party/downloads/llama-src/llama.cpp-b11429/build/bin/llama-mtmd-cli"),
                               QStringLiteral("/opt/homebrew/bin/llama-mtmd-cli"), QStringLiteral("/usr/local/bin/llama-mtmd-cli")};
#endif
  for (const QString& c : candidates)
    if (QFileInfo(c).isExecutable()) return QFileInfo(c).canonicalFilePath();
  return {};
}

QString VisionRunner::modelDir() { return QString::fromStdString((ai::modelsDir() / "vision").string()); }

QString VisionRunner::modelPath() {
  if (const QString env = qEnvironmentVariable("THCAD_VISION_MODEL"); !env.isEmpty() && QFileInfo::exists(env)) return env;
  // the largest *.gguf that is not a projector (".part" files of a download in progress do not match)
  for (const QFileInfo& f : QDir(modelDir()).entryInfoList({QStringLiteral("*.gguf")}, QDir::Files, QDir::Size))
    if (!f.fileName().startsWith(QStringLiteral("mmproj"), Qt::CaseInsensitive)) return f.absoluteFilePath();
  return {};
}

QString VisionRunner::projectorPath() {
  if (const QString env = qEnvironmentVariable("THCAD_VISION_MMPROJ"); !env.isEmpty() && QFileInfo::exists(env)) return env;
  const QFileInfoList l = QDir(modelDir()).entryInfoList({QStringLiteral("mmproj*.gguf")}, QDir::Files, QDir::Size);
  return l.isEmpty() ? QString() : l.first().absoluteFilePath();
}

QJsonObject VisionRunner::status() {
  const QString helper = helperPath(), model = modelPath(), proj = projectorPath();
  const qint64 bytes = (model.isEmpty() ? 0 : QFileInfo(model).size()) + (proj.isEmpty() ? 0 : QFileInfo(proj).size());
  QJsonObject r{{"available", !helper.isEmpty() && !model.isEmpty() && !proj.isEmpty()}, {"helper", helper}, {"model", QFileInfo(model).fileName()},
                {"mmproj", QFileInfo(proj).fileName()}, {"modelBytes", static_cast<double>(bytes)}, {"dir", modelDir()}, {"busy", !running.isNull()}};
  if (!lastDevice.isEmpty()) r["device"] = lastDevice;
  if (helper.isEmpty()) r["reason"] = QStringLiteral("llama-mtmd-cli helper not found");
  else if (model.isEmpty()) r["reason"] = QStringLiteral("no vision model in ") + modelDir();
  else if (proj.isEmpty()) r["reason"] = QStringLiteral("no mmproj (vision projector) in ") + modelDir();
  return r;
}

QJsonObject VisionRunner::analyze(const Task& task, std::function<void(QJsonObject)> done) {
  if (running) return {{"ok", false}, {"error", QStringLiteral("busy")}};
  const QString helper = helperPath(), model = modelPath(), proj = projectorPath();
  if (helper.isEmpty() || model.isEmpty() || proj.isEmpty()) return {{"ok", false}, {"error", status().value("reason").toString()}, {"code", "no-model"}};
  if (task.images.isEmpty() || task.images.size() > kMaxImages) return {{"ok", false}, {"error", QStringLiteral("1 to 5 images")}};
  for (const QByteArray& b : task.images)
    if (!isImage(b) || b.size() > kMaxImageBytes) return {{"ok", false}, {"error", QStringLiteral("not a JPEG / PNG image (or larger than 20 MB)")}};
  auto* tmp = new QTemporaryDir();
  if (!tmp->isValid()) {
    delete tmp;
    return {{"ok", false}, {"error", QStringLiteral("cannot create a temporary folder")}};
  }
  QStringList args{QStringLiteral("-m"), model, QStringLiteral("--mmproj"), proj};
  for (int i = 0; i < task.images.size(); ++i) {
    const QByteArray& b = task.images[i];
    const QString path = tmp->filePath(QStringLiteral("ref%1.%2").arg(i + 1).arg(b.startsWith("\x89PNG") ? "png" : "jpg"));
    QFile f(path);
    if (!f.open(QIODevice::WriteOnly) || f.write(b) != b.size()) {
      delete tmp;
      return {{"ok", false}, {"error", QStringLiteral("cannot write the image file")}};
    }
    args << QStringLiteral("--image") << path;
  }
  if (!task.grammar.isEmpty()) {
    QFile g(tmp->filePath(QStringLiteral("answer.gbnf")));
    if (!g.open(QIODevice::WriteOnly) || g.write(task.grammar.toUtf8()) < 0) {
      delete tmp;
      return {{"ok", false}, {"error", QStringLiteral("cannot write the grammar file")}};
    }
    args << QStringLiteral("--grammar-file") << g.fileName();
  }
  const int threads = std::max(2, std::min(8, QThread::idealThreadCount() / 2));
  if (!task.system.isEmpty()) args << QStringLiteral("-sys") << task.system;
  args << QStringLiteral("-p") << task.prompt << QStringLiteral("--temp") << QStringLiteral("0") << QStringLiteral("-n")
       << QString::number(std::clamp(task.maxTokens, 32, 2048)) << QStringLiteral("-c") << QStringLiteral("8192") << QStringLiteral("-t") << QString::number(threads);

  auto* p = new QProcess();
  auto* clock = new QElapsedTimer();
  clock->start();
  running = p;
  runningId = task.id;
  cancelled = false;
  const QString id = task.id;
  auto* timer = new QTimer(p);
  timer->setSingleShot(true);
  QObject::connect(timer, &QTimer::timeout, p, [p] { p->kill(); });
  timer->start(kTimeoutMs);
  QObject::connect(p, &QProcess::finished, p, [p, tmp, clock, done, id, timer](int code, QProcess::ExitStatus st) {
    const bool timedOut = !timer->isActive() && st != QProcess::NormalExit && !cancelled;
    timer->stop();
    const QString out = QString::fromUtf8(p->readAllStandardOutput());
    const QString err = QString::fromUtf8(p->readAllStandardError());
    lastDevice = deviceOf(err);
    // the answer is the JSON object the grammar forced: from the first '{' to the last '}'
    const int a = out.indexOf('{'), b = out.lastIndexOf('}');
    const QString text = a >= 0 && b > a ? out.mid(a, b - a + 1) : out.trimmed();
    QJsonObject r{{"id", id}, {"ok", code == 0 && st == QProcess::NormalExit && !text.isEmpty()}, {"text", text}, {"ms", static_cast<double>(clock->elapsed())},
                  {"device", lastDevice}};
    if (cancelled) r["cancelled"] = true;
    if (!r["ok"].toBool()) r["error"] = cancelled ? QStringLiteral("cancelled") : timedOut ? QStringLiteral("timed out") : err.right(400).trimmed();
    running = nullptr;
    runningId.clear();
    cancelled = false;
    done(r);
    p->deleteLater();
    delete tmp;
    delete clock;
  });
  QObject::connect(p, &QProcess::errorOccurred, p, [p](QProcess::ProcessError e) {
    if (e == QProcess::FailedToStart) emit p->finished(-1, QProcess::CrashExit);
  });
  p->start(helper, args);
  return {{"ok", true}, {"id", id}};
}

bool VisionRunner::cancel(const QString& id) {
  if (!running || (id != runningId && !id.isEmpty())) return false;
  cancelled = true;
  running->kill();
  return true;
}

}  // namespace thcad::app
