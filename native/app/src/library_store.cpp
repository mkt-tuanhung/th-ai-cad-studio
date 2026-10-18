#include "library_store.hpp"

#include <QCryptographicHash>
#include <QDateTime>
#include <QDir>
#include <QDirIterator>
#include <QFileInfo>
#include <QHash>
#include <QImage>
#include <QJsonDocument>
#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QProcess>
#include <QProcessEnvironment>
#include <QRandomGenerator>
#include <QRegularExpression>
#include <QSaveFile>
#include <QStandardPaths>
#include <QStorageInfo>
#include <QTimer>
#include <QUrl>

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>

namespace thcad::app {

namespace {

constexpr int kMaxAttempts = 5;
constexpr qint64 kMargin = 256ll * 1024 * 1024;
const QStringList kHosts{QStringLiteral("api.polyhaven.com"), QStringLiteral("dl.polyhaven.org"), QStringLiteral("cdn.polyhaven.com")};

bool allowedUrl(const QString& u) {
  const QUrl url(u);
  return url.isValid() && url.scheme() == QStringLiteral("https") && kHosts.contains(url.host()) && url.userInfo().isEmpty() && url.port(-1) == -1;
}

bool safeRel(const QString& p) {
  if (p.isEmpty() || p.size() > 300 || p.startsWith('/') || p.contains('\\') || p.contains(':')) return false;
  for (const QString& part : p.split('/'))
    if (part.isEmpty() || part == QStringLiteral("..") || part == QStringLiteral(".")) return false;
  return true;
}

bool safeId(const QString& id) { return QRegularExpression(QStringLiteral("^[A-Za-z0-9_.-]{1,80}$")).match(id).hasMatch(); }

QString md5Of(const QString& path) {
  QFile f(path);
  if (!f.open(QIODevice::ReadOnly)) return {};
  QCryptographicHash h(QCryptographicHash::Md5);
  h.addData(&f);
  return QString::fromLatin1(h.result().toHex());
}

qint64 folderBytes(const QString& d) {
  qint64 n = 0;
  QDirIterator it(d, QDir::Files | QDir::Hidden, QDirIterator::Subdirectories);
  while (it.hasNext()) n += QFileInfo(it.next()).size();
  return n;
}

/** CRC-32 (zip). */
uint32_t crc32(const QByteArray& b) {
  static const std::array<uint32_t, 256> table = [] {
    std::array<uint32_t, 256> t{};
    for (uint32_t i = 0; i < 256; ++i) {
      uint32_t c = i;
      for (int k = 0; k < 8; ++k) c = c & 1 ? 0xEDB88320u ^ (c >> 1) : c >> 1;
      t[i] = c;
    }
    return t;
  }();
  uint32_t c = 0xFFFFFFFFu;
  for (unsigned char x : b) c = table[(c ^ x) & 0xFF] ^ (c >> 8);
  return c ^ 0xFFFFFFFFu;
}

void le16(QByteArray& o, uint16_t v) { o.append(char(v & 0xFF)).append(char(v >> 8)); }
void le32(QByteArray& o, uint32_t v) { for (int i = 0; i < 4; ++i) o.append(char((v >> (8 * i)) & 0xFF)); }
uint16_t rd16(const QByteArray& b, qint64 at) { return uint16_t(uint8_t(b[at])) | uint16_t(uint8_t(b[at + 1])) << 8; }
uint32_t rd32(const QByteArray& b, qint64 at) { return uint32_t(rd16(b, at)) | uint32_t(rd16(b, at + 2)) << 16; }

/** Starts Blender in the background (macOS: outbound network denied by the sandbox profile, like the render worker). */
void startBlender(QProcess* p, const QString& exe, const QString& script, const QString& job) {
  QProcessEnvironment env = QProcessEnvironment::systemEnvironment();
  for (const char* k : {"PYTHONPATH", "PYTHONHOME", "PYTHONSTARTUP", "BLENDER_USER_SCRIPTS", "BLENDER_SYSTEM_SCRIPTS"}) env.remove(QString::fromLatin1(k));
  p->setProcessEnvironment(env);
  p->setProcessChannelMode(QProcess::MergedChannels);
  QStringList args{QStringLiteral("-b"), QStringLiteral("--factory-startup"), QStringLiteral("--offline-mode"), QStringLiteral("-noaudio"),
                   QStringLiteral("--python-exit-code"), QStringLiteral("3"), QStringLiteral("-P"), script, QStringLiteral("--"), job};
#if defined(Q_OS_MACOS)
  if (qEnvironmentVariable("THCAD_BLENDER_SANDBOX") != QStringLiteral("0") && QFileInfo::exists(QStringLiteral("/usr/bin/sandbox-exec"))) {
    args.prepend(exe);
    args.prepend(QStringLiteral("(version 1)(allow default)(deny network*)"));
    args.prepend(QStringLiteral("-p"));
    p->start(QStringLiteral("/usr/bin/sandbox-exec"), args);
    return;
  }
#endif
  p->start(exe, args);
}

/** MDLIB {json} lines of a Blender run. */
QList<QJsonObject> mdlib(const QString& log, QString* error) {
  QList<QJsonObject> out;
  for (const QString& line : log.split('\n')) {
    const QString l = line.trimmed();
    if (l.startsWith(QStringLiteral("MDLIB "))) out << QJsonDocument::fromJson(l.mid(6).toUtf8()).object();
    else if (l.startsWith(QStringLiteral("MDERROR ")) && error) *error = l.mid(8);
  }
  return out;
}

}  // namespace

LibraryStore::LibraryStore(QObject* parent) : QObject(parent), nam_(new QNetworkAccessManager(this)) {}

LibraryStore::~LibraryStore() {
  cancelled_ = true;
  if (reply_) {
    reply_->disconnect(this);
    reply_->abort();
  }
  if (proc_) {
    proc_->disconnect(this);
    proc_->kill();
    proc_->waitForFinished(3000);
  }
}

QString LibraryStore::dir() {
  QString d = qEnvironmentVariable("THCAD_LIBRARY_DIR");
  if (d.isEmpty()) {
    QString base;
#if defined(Q_OS_WIN)
    base = qEnvironmentVariable("LOCALAPPDATA");
    if (base.isEmpty()) base = QStandardPaths::writableLocation(QStandardPaths::GenericDataLocation);
#elif defined(Q_OS_MACOS)
    base = QDir::homePath() + QStringLiteral("/Library/Application Support");
#else
    base = QStandardPaths::writableLocation(QStandardPaths::GenericDataLocation);
#endif
    // next to the AI models: "MD CAD AI STUDIO" once it exists, else a "TH AI CAD Studio" from before the rename
    const QString now = base + QStringLiteral("/MD CAD AI STUDIO"), before = base + QStringLiteral("/TH AI CAD Studio");
    d = (QDir(now).exists() || !QDir(before).exists() ? now : before) + QStringLiteral("/library");
  }
  QDir().mkpath(d);
  const QString c = QDir(d).canonicalPath();
  return c.isEmpty() ? QDir::cleanPath(d) : c;
}

QString LibraryStore::resolve(const QString& rel) {
  if (!safeRel(rel)) return {};
  const QString root = dir();
  const QString p = QDir::cleanPath(root + '/' + rel);
  if (!p.startsWith(root + '/')) return {};
  // a symlink inside the library must not lead out of it
  const QFileInfo fi(p);
  if (fi.exists()) {
    const QString c = fi.canonicalFilePath();
    if (!c.startsWith(root + '/')) return {};
  }
  return p;
}

QJsonObject LibraryStore::readManifest() const {
  QFile f(dir() + QStringLiteral("/library.json"));
  QJsonObject m;
  if (f.open(QIODevice::ReadOnly)) m = QJsonDocument::fromJson(f.readAll()).object();
  if (!m.value("items").isArray()) m["items"] = QJsonArray();
  m["version"] = 1;
  return m;
}

bool LibraryStore::writeManifest(const QJsonObject& m) const {
  QSaveFile f(dir() + QStringLiteral("/library.json"));
  if (!f.open(QIODevice::WriteOnly)) return false;
  f.write(QJsonDocument(m).toJson(QJsonDocument::Indented));
  return f.commit();
}

void LibraryStore::upsert(const QJsonObject& entry) {
  QJsonObject m = readManifest();
  QJsonArray items = m.value("items").toArray(), out;
  bool replaced = false;
  for (const auto& v : items) {
    if (v.toObject().value("id").toString() == entry.value("id").toString()) {
      out.append(entry);
      replaced = true;
    } else {
      out.append(v);
    }
  }
  if (!replaced) out.append(entry);
  m["items"] = out;
  writeManifest(m);
}

QJsonObject LibraryStore::list() const {
  const QString d = dir();
  const QStorageInfo vol(d);
  return {{"ok", true}, {"dir", d}, {"manifest", readManifest()}, {"bytes", static_cast<double>(folderBytes(d))}, {"freeBytes", static_cast<double>(vol.bytesAvailable())},
          {"running", running_}, {"busy", proc_ != nullptr}};
}

QJsonObject LibraryStore::fetch(const QString& id, const QString& url) {
  if (!allowedUrl(url)) return {{"ok", false}, {"error", QStringLiteral("only Poly Haven (https://api.polyhaven.com …) may be fetched")}};
  QNetworkRequest req{QUrl(url)};
  req.setAttribute(QNetworkRequest::RedirectPolicyAttribute, QNetworkRequest::NoLessSafeRedirectPolicy);
  req.setTransferTimeout(60000);
  req.setHeader(QNetworkRequest::UserAgentHeader, QStringLiteral("MD-CAD-AI-STUDIO"));
  QNetworkReply* r = nam_->get(req);
  connect(r, &QNetworkReply::finished, this, [this, r, id] {
    r->deleteLater();
    const int code = r->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
    const QByteArray body = r->readAll().left(40 << 20);
    const bool ok = r->error() == QNetworkReply::NoError && code == 200 && allowedUrl(r->url().toString());
    QJsonObject e{{"type", "fetch"}, {"id", id}, {"ok", ok}, {"status", code}};
    if (ok) e["text"] = QString::fromUtf8(body);
    else e["error"] = r->error() != QNetworkReply::NoError ? r->errorString() : QStringLiteral("HTTP %1").arg(code);
    emit event(e);
  });
  return {{"ok", true}, {"id", id}};
}

QJsonObject LibraryStore::download(const QJsonArray& plan) {
  if (running_) return {{"ok", false}, {"error", QStringLiteral("a download is already running")}};
  QJsonArray clean;
  qint64 need = 0;
  for (const auto& v : plan) {
    const QJsonObject a = v.toObject();
    const QJsonObject entry = a.value("entry").toObject();
    const QString id = a.value("id").toString(), d = entry.value("dir").toString();
    if (!safeId(id) || entry.value("id").toString() != id || !safeRel(d)) return {{"ok", false}, {"error", QStringLiteral("bad plan entry ") + id}};
    for (const auto& fv : a.value("files").toArray()) {
      const QJsonObject f = fv.toObject();
      const QString path = f.value("path").toString();
      if (!allowedUrl(f.value("url").toString())) return {{"ok", false}, {"error", QStringLiteral("not an allowed download URL: ") + f.value("url").toString()}};
      if (resolve(path).isEmpty() || !path.startsWith(d + '/')) return {{"ok", false}, {"error", QStringLiteral("file outside its asset folder: ") + path}};
      const qint64 size = static_cast<qint64>(f.value("size").toDouble());
      const QFileInfo fin(resolve(path)), part(resolve(path) + QStringLiteral(".part"));
      if (!(fin.exists() && (size <= 0 ? fin.size() > 0 : fin.size() == size))) need += size - (part.exists() ? std::min(part.size(), size) : 0);
    }
    clean.append(a);
  }
  const qint64 free = QStorageInfo(dir()).bytesAvailable();
  if (free >= 0 && free < need + kMargin) return {{"ok", false}, {"error", QStringLiteral("not enough disk space")}, {"needBytes", static_cast<double>(need + kMargin)}, {"freeBytes", static_cast<double>(free)}};
  plan_ = clean;
  asset_ = file_ = attempt_ = added_ = 0;
  failed_.clear();
  newModels_.clear();
  total_ = need;
  doneBytes_ = lastBytes_ = 0;
  bps_ = 0;
  running_ = true;
  cancelled_ = false;
  tick_.start();
  QTimer::singleShot(0, this, [this] { nextFile(); });
  return {{"ok", true}, {"assets", static_cast<int>(clean.size())}, {"bytes", static_cast<double>(need)}, {"dir", dir()}};
}

void LibraryStore::cancel() {
  if (!running_) return;
  cancelled_ = true;
  if (reply_) reply_->abort();
}

void LibraryStore::fail(const QString& error) {
  // this asset is skipped (its .part stays for a resume); the others go on
  const QString id = plan_.at(asset_).toObject().value("id").toString();
  failed_ << id;
  emit event({{"type", "download"}, {"phase", "asset"}, {"id", id}, {"ok", false}, {"error", error}});
  ++asset_;
  file_ = attempt_ = 0;
  QTimer::singleShot(0, this, [this] { nextFile(); });
}

void LibraryStore::done() {
  running_ = false;
  QJsonArray failed;
  for (const QString& f : failed_) failed.append(f);
  emit event({{"type", "download"}, {"done", true}, {"ok", failed_.isEmpty() && !cancelled_}, {"added", added_}, {"failed", failed}, {"cancelled", cancelled_},
              {"bytes", static_cast<double>(folderBytes(dir()))}, {"models", QJsonArray::fromStringList(newModels_)}});
}

void LibraryStore::finishAsset() {
  QJsonObject a = plan_.at(asset_).toObject();
  QJsonObject entry = a.value("entry").toObject();
  qint64 bytes = 0;
  bool thumb = false;
  for (const auto& fv : a.value("files").toArray()) {
    const QString p = resolve(fv.toObject().value("path").toString());
    bytes += QFileInfo(p).size();
    if (p.endsWith(QStringLiteral("/thumb.png")) && QFileInfo::exists(p)) thumb = true;
  }
  if (!thumb) entry.remove("thumb");
  entry["bytes"] = static_cast<double>(bytes);
  upsert(entry);
  ++added_;
  if (entry.value("kind").toString() == QStringLiteral("model")) newModels_ << entry.value("id").toString();
  emit event({{"type", "download"}, {"phase", "asset"}, {"id", entry.value("id")}, {"ok", true}, {"index", asset_ + 1}, {"assets", static_cast<int>(plan_.size())}});
  ++asset_;
  file_ = attempt_ = 0;
}

void LibraryStore::nextFile() {
  if (!running_ || reply_) return;
  if (cancelled_) return done();
  if (asset_ >= plan_.size()) return done();
  const QJsonObject a = plan_.at(asset_).toObject();
  const QJsonArray files = a.value("files").toArray();
  if (file_ >= files.size()) {
    finishAsset();
    return nextFile();
  }
  const QJsonObject f = files.at(file_).toObject();
  const QString path = resolve(f.value("path").toString());
  const qint64 size = static_cast<qint64>(f.value("size").toDouble());
  const bool isThumb = size <= 0;
  if (const QFileInfo fin(path); fin.exists() && (isThumb ? fin.size() > 0 : fin.size() == size)) {
    ++file_;
    return nextFile();
  }
  QDir().mkpath(QFileInfo(path).absolutePath());
  const QString part = path + QStringLiteral(".part");
  qint64 have = QFileInfo(part).size();
  if (isThumb || have > size) {
    QFile::remove(part);
    have = 0;
  }
  out_.setFileName(part);
  if (!out_.open(QIODevice::ReadWrite)) return fail(QStringLiteral("cannot write ") + part);
  out_.seek(have);
  writeError_.clear();
  QNetworkRequest req{QUrl(f.value("url").toString())};
  req.setAttribute(QNetworkRequest::RedirectPolicyAttribute, QNetworkRequest::NoLessSafeRedirectPolicy);
  req.setTransferTimeout(60000);
  req.setHeader(QNetworkRequest::UserAgentHeader, QStringLiteral("MD-CAD-AI-STUDIO"));
  if (have > 0) req.setRawHeader("Range", "bytes=" + QByteArray::number(have) + '-');
  reply_ = nam_->get(req);
  connect(reply_, &QNetworkReply::readyRead, this, [this] {
    QNetworkReply* r = reply_;
    if (!r || !writeError_.isEmpty()) return;
    const int code = r->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
    // first bytes of this response: a server that ignored the Range header sends the whole file (200) — start over
    if (!r->property("checked").toBool()) {
      r->setProperty("checked", true);
      if (code == 200 && out_.pos() > 0) {
        out_.resize(0);
        out_.seek(0);
      }
    }
    if (code != 200 && code != 206) return;
    const QByteArray b = r->readAll();
    if (out_.write(b) != b.size()) {
      writeError_ = QStringLiteral("cannot write to the disk (full?)");
      r->abort();
      return;
    }
    doneBytes_ += b.size();
    if (tick_.elapsed() >= 400) {
      const double secs = std::max(0.001, tick_.elapsed() / 1000.0);
      const double inst = (doneBytes_ - lastBytes_) / secs;
      bps_ = bps_ > 0 ? 0.7 * bps_ + 0.3 * inst : inst;
      lastBytes_ = doneBytes_;
      tick_.restart();
      emit event({{"type", "download"}, {"phase", "download"}, {"asset", plan_.at(asset_).toObject().value("id")}, {"index", asset_ + 1}, {"assets", static_cast<int>(plan_.size())},
                  {"received", static_cast<double>(doneBytes_)}, {"total", static_cast<double>(total_)}, {"bytesPerSecond", bps_}});
    }
  });
  connect(reply_, &QNetworkReply::finished, this, [this, path, part, size, isThumb, md5 = f.value("md5").toString()] {
    QNetworkReply* r = reply_;
    if (!r) return;
    const int code = r->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
    if (writeError_.isEmpty() && r->error() == QNetworkReply::NoError && (code == 200 || code == 206)) {
      const QByteArray rest = r->readAll();
      if (out_.write(rest) != rest.size()) writeError_ = QStringLiteral("cannot write to the disk (full?)");
      doneBytes_ += rest.size();
    }
    out_.flush();
    const qint64 have = out_.size();
    out_.close();
    const QNetworkReply::NetworkError err = r->error();
    const QString errText = r->errorString();
    r->deleteLater();
    reply_ = nullptr;
    if (cancelled_) return done();
    if (!writeError_.isEmpty()) return fail(writeError_);
    if (code >= 400 && code < 500 && code != 408 && code != 429 && code != 416) {
      QFile::remove(part);
      if (isThumb) {  // a thumbnail is optional
        ++file_;
        return nextFile();
      }
      return fail(QStringLiteral("HTTP %1").arg(code));
    }
    if (code == 416) QFile::remove(part);
    if (err != QNetworkReply::NoError || code == 416 || (!isThumb && have < size)) {
      if (++attempt_ >= kMaxAttempts) return fail(code ? QStringLiteral("HTTP %1: %2").arg(code).arg(errText) : errText);
      const int wait = std::min(20, 2 << (attempt_ - 1));
      emit event({{"type", "download"}, {"phase", "retry"}, {"attempt", attempt_}, {"inSeconds", wait}, {"error", errText}});
      QTimer::singleShot(wait * 1000, this, [this] { nextFile(); });
      return;
    }
    if (!isThumb && have != size) {
      // more bytes than the API's size (a stale .part from an interrupted run): start this file over once
      QFile::remove(part);
      if (++attempt_ >= 2) return fail(QStringLiteral("wrong size — discarded"));
      QTimer::singleShot(500, this, [this] { nextFile(); });
      return;
    }
    if (!md5.isEmpty() && md5Of(part) != md5.toLower()) {
      QFile::remove(part);
      return fail(QStringLiteral("checksum (md5) mismatch — the damaged file was deleted"));
    }
    if (isThumb && QImage(part).isNull()) {
      QFile::remove(part);
      ++file_;
      return nextFile();
    }
    QFile::remove(path);
    if (!QFile::rename(part, path)) return fail(QStringLiteral("cannot rename ") + part);
    attempt_ = 0;
    ++file_;
    nextFile();
  });
}

QJsonObject LibraryStore::put(QJsonObject entry, const QString& thumbDataUrl) {
  const QString id = entry.value("id").toString(), d = entry.value("dir").toString();
  if (!safeId(id) || !safeRel(d)) return {{"ok", false}, {"error", QStringLiteral("bad library entry")}};
  const QString folder = resolve(d);
  if (folder.isEmpty()) return {{"ok", false}, {"error", QStringLiteral("folder outside the library")}};
  QDir().mkpath(folder);
  if (thumbDataUrl.startsWith(QStringLiteral("data:image/"))) {
    const int comma = thumbDataUrl.indexOf(',');
    const QImage img = QImage::fromData(QByteArray::fromBase64(thumbDataUrl.mid(comma + 1).toLatin1()));
    if (!img.isNull() && img.scaled(256, 256, Qt::KeepAspectRatio, Qt::SmoothTransformation).save(folder + QStringLiteral("/thumb.png"))) entry["thumb"] = QStringLiteral("thumb.png");
  }
  // the main file of a model must be in its folder
  const QString main = entry.value("files").toObject().value("main").toString();
  if (!main.isEmpty() && resolve(d + '/' + main).isEmpty()) return {{"ok", false}, {"error", QStringLiteral("model file outside the library")}};
  entry["bytes"] = static_cast<double>(folderBytes(folder));
  upsert(entry);
  return {{"ok", true}, {"id", id}};
}

QJsonObject LibraryStore::remove(const QString& id) {
  QJsonObject m = readManifest();
  QJsonArray out;
  QString d;
  for (const auto& v : m.value("items").toArray()) {
    if (v.toObject().value("id").toString() == id) d = v.toObject().value("dir").toString();
    else out.append(v);
  }
  // a folder of its own (models/<id>, user/<id> …), never the library root or a shared folder
  if (!d.isEmpty() && d.count('/') >= 1) {
    const QString folder = resolve(d);
    if (!folder.isEmpty()) QDir(folder).removeRecursively();
  }
  m["items"] = out;
  writeManifest(m);
  return {{"ok", true}, {"removed", !d.isEmpty()}};
}

QJsonObject LibraryStore::thumbs(const QJsonArray& ids) const {
  QJsonObject out;
  const QJsonArray items = readManifest().value("items").toArray();
  for (const auto& idv : ids) {
    const QString id = idv.toString();
    for (const auto& v : items) {
      const QJsonObject e = v.toObject();
      if (e.value("id").toString() != id || !e.contains("thumb")) continue;
      const QString p = resolve(e.value("dir").toString() + '/' + e.value("thumb").toString());
      QFile f(p);
      if (p.isEmpty() || !f.open(QIODevice::ReadOnly) || f.size() > 4 * 1024 * 1024) break;
      const QString mime = p.endsWith(QStringLiteral(".jpg")) || p.endsWith(QStringLiteral(".jpeg")) ? QStringLiteral("image/jpeg") : QStringLiteral("image/png");
      out[id] = QStringLiteral("data:") + mime + QStringLiteral(";base64,") + QString::fromLatin1(f.readAll().toBase64());
      break;
    }
  }
  return out;
}

QJsonObject LibraryStore::importFile(const QString& path, const QString& blender, const QString& script) {
  if (proc_) return {{"ok", false}, {"error", QStringLiteral("Blender is busy with another library job")}};
  const QFileInfo src(path);
  if (!src.isFile()) return {{"ok", false}, {"error", QStringLiteral("file not found")}};
  const QString ext = src.suffix().toLower();
  if (!QStringList{"glb", "gltf", "obj", "fbx", "stl", "blend", "dae"}.contains(ext)) return {{"ok", false}, {"error", QStringLiteral("unsupported file type .") + ext}};
  if (blender.isEmpty() || script.isEmpty()) return {{"ok", false}, {"error", QStringLiteral("Blender is needed to read 3D model files (install Blender, then try again)")}, {"code", "blender-not-found"}};
  const QString id = QStringLiteral("u-%1-%2").arg(QDateTime::currentMSecsSinceEpoch(), 0, 36).arg(QRandomGenerator::global()->bounded(1 << 20), 0, 36);
  const QString rel = QStringLiteral("user/") + id;
  const QString folder = resolve(rel);
  if (folder.isEmpty() || !QDir().mkpath(folder)) return {{"ok", false}, {"error", QStringLiteral("cannot create ") + rel}};
  const QString job = folder + QStringLiteral("/.import.json");
  QFile jf(job);
  if (!jf.open(QIODevice::WriteOnly)) return {{"ok", false}, {"error", QStringLiteral("cannot write the import job")}};
  jf.write(QJsonDocument(QJsonObject{{"mode", "import"}, {"src", src.absoluteFilePath()}, {"glb", folder + QStringLiteral("/model.glb")}, {"thumb", folder + QStringLiteral("/thumb.png")}}).toJson());
  jf.close();
  proc_ = new QProcess(this);
  const QString srcName = src.fileName();
  const qint64 srcBytes = src.size();
  connect(proc_, &QProcess::finished, this, [this, id, rel, folder, job, srcName, srcBytes](int code, QProcess::ExitStatus st) {
    const QString log = QString::fromUtf8(proc_->readAll());
    proc_->deleteLater();
    proc_ = nullptr;
    QFile::remove(job);
    QString err;
    const QList<QJsonObject> res = mdlib(log, &err);
    const bool ok = st == QProcess::NormalExit && code == 0 && !res.isEmpty() && res.first().value("ok").toBool() && QFileInfo::exists(folder + QStringLiteral("/model.glb"));
    if (!ok) {
      QDir(folder).removeRecursively();
      emit event({{"type", "import"}, {"id", id}, {"ok", false}, {"error", err.isEmpty() ? QStringLiteral("Blender could not read the file") : err}, {"log", log.right(1500)}});
      return;
    }
    QJsonObject r = res.first();
    r["type"] = "import";
    r["id"] = id;
    r["dir"] = rel;
    r["file"] = QStringLiteral("model.glb");
    r["srcName"] = srcName;
    r["srcBytes"] = static_cast<double>(srcBytes);
    r["bytes"] = static_cast<double>(folderBytes(folder));
    if (QFileInfo::exists(folder + QStringLiteral("/thumb.png"))) r["thumbUrl"] = QStringLiteral("data:image/png;base64,") + [&] { QFile t(folder + QStringLiteral("/thumb.png")); t.open(QIODevice::ReadOnly); return QString::fromLatin1(t.readAll().toBase64()); }();
    emit event(r);
  });
  startBlender(proc_, blender, script, job);
  return {{"ok", true}, {"id", id}, {"dir", rel}};
}

void LibraryStore::probeModels(const QStringList& ids, const QString& blender, const QString& script) {
  if (proc_ || ids.isEmpty() || blender.isEmpty() || script.isEmpty()) return;
  QJsonArray models;
  for (const auto& v : readManifest().value("items").toArray()) {
    const QJsonObject e = v.toObject();
    if (!ids.contains(e.value("id").toString())) continue;
    const QString p = resolve(e.value("dir").toString() + '/' + e.value("files").toObject().value("main").toString());
    if (!p.isEmpty() && QFileInfo::exists(p)) models.append(QJsonObject{{"id", e.value("id")}, {"file", p}});
  }
  if (models.isEmpty()) return;
  QDir().mkpath(dir() + QStringLiteral("/.work"));
  const QString job = dir() + QStringLiteral("/.work/probe.json");
  QFile jf(job);
  if (!jf.open(QIODevice::WriteOnly)) return;
  jf.write(QJsonDocument(QJsonObject{{"mode", "probe"}, {"models", models}}).toJson());
  jf.close();
  proc_ = new QProcess(this);
  connect(proc_, &QProcess::finished, this, [this, job](int, QProcess::ExitStatus) {
    const QString log = QString::fromUtf8(proc_->readAll());
    proc_->deleteLater();
    proc_ = nullptr;
    QFile::remove(job);
    int n = 0;
    QJsonObject m = readManifest();
    QJsonArray items = m.value("items").toArray();
    for (const QJsonObject& r : mdlib(log, nullptr)) {
      if (!r.value("ok").toBool()) continue;
      for (int i = 0; i < items.size(); ++i) {
        QJsonObject e = items[i].toObject();
        if (e.value("id") != r.value("id")) continue;
        // the file's bounding box gives the orientation; a file modelled in other units (10× / 100×) keeps the
        // catalogue's real size, scaled from the file's proportions
        QJsonObject dims = r.value("dims").toObject();
        const double fh = dims.value("h").toDouble(), ah = e.value("dims").toObject().value("h").toDouble();
        if (fh > 0 && ah > 0 && (ah / fh > 3 || ah / fh < 1.0 / 3)) {
          const double k = ah / fh;
          dims = {{"w", std::round(dims.value("w").toDouble() * k)}, {"d", std::round(dims.value("d").toDouble() * k)}, {"h", std::round(ah)}};
          e["fileScale"] = 1.0 / k;
        }
        e["dims"] = dims;
        e["tris"] = r.value("tris");
        items[i] = e;
        ++n;
      }
    }
    m["items"] = items;
    writeManifest(m);
    emit event({{"type", "probe"}, {"done", true}, {"updated", n}});
  });
  emit event({{"type", "probe"}, {"models", static_cast<int>(models.size())}});
  startBlender(proc_, blender, script, job);
}

QJsonObject LibraryStore::exportZip(const QString& path) const {
  QJsonArray mine;
  QStringList files;
  for (const auto& v : readManifest().value("items").toArray()) {
    const QJsonObject e = v.toObject();
    const QString o = e.value("origin").toString();
    if (o != QStringLiteral("user-import") && o != QStringLiteral("user-drawn")) continue;
    mine.append(e);
    const QString folder = resolve(e.value("dir").toString());
    if (folder.isEmpty()) continue;
    QDirIterator it(folder, QDir::Files, QDirIterator::Subdirectories);
    while (it.hasNext()) {
      const QString f = it.next();
      if (!QFileInfo(f).fileName().startsWith('.')) files << f;
    }
  }
  if (mine.isEmpty()) return {{"ok", false}, {"error", QStringLiteral("the user library is empty")}};
  QSaveFile out(path);
  if (!out.open(QIODevice::WriteOnly)) return {{"ok", false}, {"error", QStringLiteral("cannot write ") + path}};
  QByteArray central;
  quint32 offset = 0, count = 0;
  const QDateTime now = QDateTime::currentDateTime();
  const uint16_t dt = uint16_t(((now.date().year() - 1980) << 9) | (now.date().month() << 5) | now.date().day());
  const uint16_t tm = uint16_t((now.time().hour() << 11) | (now.time().minute() << 5) | (now.time().second() / 2));
  auto add = [&](const QString& name, const QByteArray& data) -> bool {
    if (data.size() > 0x7fffffff || offset > 0x7fffffffu) return false;
    const QByteArray n = name.toUtf8();
    const uint32_t c = crc32(data);
    QByteArray h;
    le32(h, 0x04034b50), le16(h, 20), le16(h, 0x0800), le16(h, 0), le16(h, tm), le16(h, dt), le32(h, c), le32(h, uint32_t(data.size())), le32(h, uint32_t(data.size())), le16(h, uint16_t(n.size())), le16(h, 0);
    h += n;
    if (out.write(h) != h.size() || out.write(data) != data.size()) return false;
    QByteArray cd;
    le32(cd, 0x02014b50), le16(cd, 20), le16(cd, 20), le16(cd, 0x0800), le16(cd, 0), le16(cd, tm), le16(cd, dt), le32(cd, c), le32(cd, uint32_t(data.size())), le32(cd, uint32_t(data.size()));
    le16(cd, uint16_t(n.size())), le16(cd, 0), le16(cd, 0), le16(cd, 0), le16(cd, 0), le32(cd, 0), le32(cd, offset);
    cd += n;
    central += cd;
    offset += quint32(h.size() + data.size());
    ++count;
    return true;
  };
  if (!add(QStringLiteral("library.json"), QJsonDocument(QJsonObject{{"version", 1}, {"items", mine}}).toJson())) return {{"ok", false}, {"error", QStringLiteral("write failed")}};
  const QString root = dir();
  for (const QString& f : files) {
    QFile in(f);
    if (!in.open(QIODevice::ReadOnly)) continue;
    if (!add(f.mid(root.size() + 1), in.readAll())) return {{"ok", false}, {"error", QStringLiteral("the library is too large for one zip")}};
  }
  QByteArray end;
  le32(end, 0x06054b50), le16(end, 0), le16(end, 0), le16(end, uint16_t(count)), le16(end, uint16_t(count)), le32(end, uint32_t(central.size())), le32(end, offset), le16(end, 0);
  out.write(central);
  out.write(end);
  if (!out.commit()) return {{"ok", false}, {"error", QStringLiteral("cannot write ") + path}};
  return {{"ok", true}, {"path", path}, {"items", static_cast<int>(mine.size())}, {"files", static_cast<int>(count)}, {"bytes", static_cast<double>(QFileInfo(path).size())}};
}

QJsonObject LibraryStore::importZip(const QString& path) {
  QFile f(path);
  if (!f.open(QIODevice::ReadOnly)) return {{"ok", false}, {"error", QStringLiteral("cannot read ") + path}};
  if (f.size() > (qint64(3) << 30)) return {{"ok", false}, {"error", QStringLiteral("the zip is too large")}};
  const QByteArray z = f.readAll();
  qint64 eocd = -1;
  for (qint64 i = z.size() - 22; i >= std::max<qint64>(0, z.size() - 65557); --i)
    if (rd32(z, i) == 0x06054b50) {
      eocd = i;
      break;
    }
  if (eocd < 0) return {{"ok", false}, {"error", QStringLiteral("not a zip file")}};
  const int n = rd16(z, eocd + 10);
  qint64 at = rd32(z, eocd + 16);
  QHash<QString, QByteArray> entries;
  for (int k = 0; k < n; ++k) {
    if (at + 46 > z.size() || rd32(z, at) != 0x02014b50) return {{"ok", false}, {"error", QStringLiteral("damaged zip")}};
    const int method = rd16(z, at + 10);
    const qint64 csize = rd32(z, at + 20), nlen = rd16(z, at + 28), xlen = rd16(z, at + 30), clen = rd16(z, at + 32), local = rd32(z, at + 42);
    const QString name = QString::fromUtf8(z.mid(at + 46, nlen));
    at += 46 + nlen + xlen + clen;
    if (name.endsWith('/')) continue;
    if (method != 0) return {{"ok", false}, {"error", QStringLiteral("compressed zip entries are not supported — use a zip exported by MD CAD AI STUDIO")}};
    if (local + 30 > z.size() || rd32(z, local) != 0x04034b50) return {{"ok", false}, {"error", QStringLiteral("damaged zip")}};
    const qint64 data = local + 30 + rd16(z, local + 26) + rd16(z, local + 28);
    if (data + csize > z.size()) return {{"ok", false}, {"error", QStringLiteral("damaged zip")}};
    entries.insert(name, z.mid(data, csize));
  }
  const QJsonArray items = QJsonDocument::fromJson(entries.value(QStringLiteral("library.json"))).object().value("items").toArray();
  if (items.isEmpty()) return {{"ok", false}, {"error", QStringLiteral("no library.json with items in the zip")}};
  int added = 0, written = 0;
  for (const auto& v : items) {
    QJsonObject e = v.toObject();
    const QString id = e.value("id").toString(), d = e.value("dir").toString(), o = e.value("origin").toString();
    // only the user's own items, each in its own user/<id> folder
    if (!safeId(id) || d != QStringLiteral("user/") + id || (o != QStringLiteral("user-import") && o != QStringLiteral("user-drawn"))) continue;
    const QString folder = resolve(d);
    if (folder.isEmpty()) continue;
    QDir().mkpath(folder);
    for (auto it = entries.cbegin(); it != entries.cend(); ++it) {
      if (!it.key().startsWith(d + '/')) continue;
      const QString p = resolve(it.key());
      if (p.isEmpty()) continue;
      QDir().mkpath(QFileInfo(p).absolutePath());
      QSaveFile out(p);
      if (out.open(QIODevice::WriteOnly) && out.write(it.value()) == it.value().size() && out.commit()) ++written;
    }
    e["bytes"] = static_cast<double>(folderBytes(folder));
    upsert(e);
    ++added;
  }
  return {{"ok", added > 0}, {"items", added}, {"files", written}, {"error", added ? QString() : QStringLiteral("no user items in the zip")}};
}

}  // namespace thcad::app
