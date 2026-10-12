#include "whisper_runner.hpp"

#include <QCoreApplication>
#include <QCryptographicHash>
#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QSaveFile>
#include <QDir>
#include <QElapsedTimer>
#include <QFile>
#include <QFileInfo>
#include <QProcess>
#include <QRegularExpression>
#include <QTemporaryDir>
#include <QThread>

#include "thcad/ai/runtime.hpp"

namespace thcad::app {

QString WhisperRunner::helperPath() {
  if (const QString env = qEnvironmentVariable("THCAD_WHISPER_CLI"); !env.isEmpty() && QFileInfo(env).isExecutable()) return env;
  const QString dir = QCoreApplication::applicationDirPath();
#ifdef Q_OS_WIN
  const QStringList candidates{dir + "/whisper/whisper-cli.exe"};
#else
  // bundled helper first; the source build only serves development builds
  const QStringList candidates{dir + "/../Helpers/whisper-cli",
                               QStringLiteral(THCAD_SOURCE_DIR "/third_party/downloads/whisper-src/whisper.cpp-1.9.4/build/bin/whisper-cli")};
#endif
  for (const QString& c : candidates)
    if (QFileInfo(c).isExecutable()) return QFileInfo(c).canonicalFilePath();
  return {};
}

QString WhisperRunner::modelPath() {
  if (const QString env = qEnvironmentVariable("THCAD_WHISPER_MODEL"); !env.isEmpty() && QFileInfo::exists(env)) return env;
  const QDir d(QString::fromStdString((ai::modelsDir() / "whisper").string()));
  QFileInfoList models = d.entryInfoList({QStringLiteral("ggml-*.bin")}, QDir::Files, QDir::Size);  // largest first
  // large-v3-turbo is the best multilingual (Vietnamese) model for its size: prefer it when present
  for (const QFileInfo& f : models)
    if (f.fileName().contains(QStringLiteral("large-v3-turbo"))) return f.absoluteFilePath();
  return models.isEmpty() ? QString() : models.first().absoluteFilePath();
}

QJsonObject WhisperRunner::status() {
  const QString helper = helperPath(), model = modelPath();
  QJsonObject r{{"available", !helper.isEmpty() && !model.isEmpty()}, {"helper", helper}, {"model", QFileInfo(model).fileName()},
                {"modelBytes", static_cast<double>(model.isEmpty() ? 0 : QFileInfo(model).size())}};
  if (helper.isEmpty()) r["reason"] = QStringLiteral("whisper-cli helper not found");
  else if (model.isEmpty()) r["reason"] = QStringLiteral("no Whisper model in ") + QString::fromStdString((ai::modelsDir() / "whisper").string());
  return r;
}

void WhisperRunner::transcribe(const QByteArray& wav, const QString& lang, std::function<void(QJsonObject)> done) {
  const QString helper = helperPath(), model = modelPath();
  if (helper.isEmpty() || model.isEmpty()) return done({{"ok", false}, {"error", status().value("reason").toString()}});
  auto* tmp = new QTemporaryDir();
  const QString wavPath = tmp->filePath(QStringLiteral("speech.wav"));
  QFile f(wavPath);
  if (!f.open(QIODevice::WriteOnly) || f.write(wav) != wav.size()) {
    delete tmp;
    return done({{"ok", false}, {"error", QStringLiteral("cannot write the audio file")}});
  }
  f.close();
  auto* p = new QProcess();
  auto* clock = new QElapsedTimer();
  clock->start();
  const QString l = lang == QStringLiteral("vi") || lang == QStringLiteral("en") ? lang : QStringLiteral("auto");
  // a short domain prompt keeps CAD words (tường, cửa sổ, milimét…) spelled the way drafters say them
  const QString prompt = l == QStringLiteral("vi") ? QStringLiteral("Lệnh vẽ CAD: tường, cửa đi, cửa sổ, cột, dầm, sàn, mái, cầu thang, mét, milimét, cao độ, tầng.")
                                                   : QStringLiteral("CAD drawing commands: wall, door, window, column, beam, slab, roof, stair, metres, millimetres, level.");
  const int threads = std::max(2, std::min(8, QThread::idealThreadCount() / 2));
  QObject::connect(p, &QProcess::finished, p, [p, tmp, clock, done](int code, QProcess::ExitStatus st) {
    QString text = QString::fromUtf8(p->readAllStandardOutput());
    const QString err = QString::fromUtf8(p->readAllStandardError());
    // drop non-speech markers ([BLANK_AUDIO], (music)…) and join the lines
    text.remove(QRegularExpression(QStringLiteral("\\[[^\\]]*\\]|\\([^)]*\\)")));
    text = text.split('\n', Qt::SkipEmptyParts).join(' ').simplified();
    QJsonObject r{{"ok", code == 0 && st == QProcess::NormalExit}, {"text", text}, {"ms", static_cast<double>(clock->elapsed())}};
    if (!r["ok"].toBool()) r["error"] = err.right(300).trimmed();
    done(r);
    p->deleteLater();
    delete tmp;
    delete clock;
  });
  p->start(helper, {QStringLiteral("-m"), model, QStringLiteral("-l"), l, QStringLiteral("-t"), QString::number(threads), QStringLiteral("-nt"),
                    QStringLiteral("-np"), QStringLiteral("-sns"), QStringLiteral("--prompt"), prompt, QStringLiteral("-f"), wavPath});
}

void WhisperRunner::download(std::function<void(QJsonObject)> progress) {
  static const char* kUrl = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin";
  static const char* kSha = "394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2";
  const QString dir = QString::fromStdString((ai::modelsDir() / "whisper").string());
  if (!QDir().mkpath(dir)) return progress({{"done", true}, {"ok", false}, {"error", "cannot create " + dir}});
  const QString path = dir + QStringLiteral("/ggml-large-v3-turbo-q5_0.bin");
  auto* nam = new QNetworkAccessManager();
  QNetworkRequest req{QUrl(QString::fromLatin1(kUrl))};
  req.setAttribute(QNetworkRequest::RedirectPolicyAttribute, QNetworkRequest::NoLessSafeRedirectPolicy);
  QNetworkReply* reply = nam->get(req);
  auto* out = new QFile(path + QStringLiteral(".part"));
  auto* hash = new QCryptographicHash(QCryptographicHash::Sha256);
  if (!out->open(QIODevice::WriteOnly)) {
    reply->abort();
    return progress({{"done", true}, {"ok", false}, {"error", "cannot write " + out->fileName()}});
  }
  auto* last = new qint64(0);
  QObject::connect(reply, &QNetworkReply::readyRead, reply, [reply, out, hash] {
    const QByteArray b = reply->readAll();
    hash->addData(b);
    out->write(b);
  });
  QObject::connect(reply, &QNetworkReply::downloadProgress, reply, [progress, last](qint64 got, qint64 total) {
    if (got - *last < 4 * 1024 * 1024 && got != total) return;  // every 4 MB
    *last = got;
    progress({{"received", static_cast<double>(got)}, {"total", static_cast<double>(total)}});
  });
  QObject::connect(reply, &QNetworkReply::finished, reply, [=] {
    const QByteArray rest = reply->readAll();
    hash->addData(rest);
    out->write(rest);
    out->close();
    QJsonObject r{{"done", true}};
    if (reply->error() != QNetworkReply::NoError) r = QJsonObject{{"done", true}, {"ok", false}, {"error", reply->errorString()}};
    else if (hash->result().toHex() != kSha) r = QJsonObject{{"done", true}, {"ok", false}, {"error", QStringLiteral("checksum mismatch — file discarded")}};
    else {
      QFile::remove(path);
      r = QJsonObject{{"done", true}, {"ok", out->rename(path)}, {"path", path}};
    }
    if (!r["ok"].toBool()) QFile::remove(out->fileName());
    progress(r);
    reply->deleteLater();
    nam->deleteLater();
    delete out;
    delete hash;
    delete last;
  });
}

}  // namespace thcad::app
