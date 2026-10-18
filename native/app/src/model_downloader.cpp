#include "model_downloader.hpp"

#include <QCryptographicHash>
#include <algorithm>
#include <QDir>
#include <QFileInfo>
#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QStorageInfo>
#include <QThread>
#include <QTimer>

#include "thcad/ai/runtime.hpp"

namespace thcad::app {

namespace {
constexpr qint64 kMargin = 512ll * 1024 * 1024;  // free space kept after the download
constexpr int kMaxAttempts = 6;                  // per shard, network errors only
}  // namespace

qint64 ModelDownloader::Entry::total() const {
  qint64 t = 0;
  for (const Shard& s : shards) t += s.size;
  return t;
}

// Sizes and sha256 from the Hugging Face repositories (official Qwen GGUF builds), pinned.
const QVector<ModelDownloader::Entry>& ModelDownloader::catalogue() {
  static const QVector<Entry> c{
      {QStringLiteral("qwen2.5-7b-instruct-q4_k_m"), QStringLiteral("Qwen2.5-7B Instruct (Q4_K_M)"), QStringLiteral("Qwen/Qwen2.5-7B-Instruct-GGUF"),
       {{QStringLiteral("qwen2.5-7b-instruct-q4_k_m-00001-of-00002.gguf"), 3993201344ll, "dfce12e3862a5283ccfb88221b48480e58745165de856439950d0f22590580db"},
        {QStringLiteral("qwen2.5-7b-instruct-q4_k_m-00002-of-00002.gguf"), 689872288ll, "539cf93f78e887edea1c04e2d7d8cdaca9d01dae9c9025bcb8accbe29df3d72a"}}},
      {QStringLiteral("qwen2.5-3b-instruct-q4_k_m"), QStringLiteral("Qwen2.5-3B Instruct (Q4_K_M)"), QStringLiteral("Qwen/Qwen2.5-3B-Instruct-GGUF"),
       {{QStringLiteral("qwen2.5-3b-instruct-q4_k_m.gguf"), 2104932768ll, "626b4a6678b86442240e33df819e00132d3ba7dddfe1cdc4fbb18e0a9615c62d"}}},
  };
  return c;
}

ModelDownloader::ModelDownloader(QObject* parent) : QObject(parent), nam_(new QNetworkAccessManager(this)) {}

ModelDownloader::~ModelDownloader() {
  // quitting mid-download: the .part stays for a resume. Nothing may run on `this` once it is gone:
  //   - the transfer is aborted with its handlers disconnected first (abort() emits finished synchronously);
  //   - the sha256 thread sees cancelled_ and stops within one 8 MB read, and is joined here; the results it
  //     queued to `this` are dropped with the object (QObject removes its posted events).
  cancelled_ = true;
  ++gen_;
  if (reply_) {
    reply_->disconnect(this);
    reply_->abort();
  }
  if (verifyThread_) {
    verifyThread_->wait();
    delete verifyThread_;
    verifyThread_ = nullptr;
  }
}

QString ModelDownloader::partPath(int i) const { return dir_ + '/' + entry_->shards[i].name + QStringLiteral(".part"); }
QString ModelDownloader::finalPath(int i) const { return dir_ + '/' + entry_->shards[i].name; }

qint64 ModelDownloader::before() const {
  qint64 b = 0;
  for (int i = 0; i < shard_; ++i) b += entry_->shards[i].size;
  return b;
}

QJsonObject ModelDownloader::state() const {
  const QString dir = QString::fromStdString(ai::modelsDir().string());
  const QStorageInfo vol(QDir(dir).exists() ? dir : QDir::homePath());
  // the runtime picks the largest model whose weights fit in ~35 % of the memory (ai::discoverModel)
  const qint64 budget = static_cast<qint64>(ai::physicalMemoryBytes() * 35 / 100);
  QJsonArray models;
  QString recommended;
  for (const Entry& e : catalogue()) {
    bool installed = true;
    qint64 partial = 0;
    for (const Shard& s : e.shards) {
      const QFileInfo f(dir + '/' + s.name), p(dir + '/' + s.name + QStringLiteral(".part"));
      if (!(f.exists() && f.size() == s.size)) installed = false;
      partial += f.exists() && f.size() == s.size ? s.size : p.exists() ? std::min(p.size(), s.size) : 0;
    }
    const bool fits = e.total() <= budget;
    if (fits && recommended.isEmpty()) recommended = e.id;  // the catalogue is ordered largest first
    models.append(QJsonObject{{"id", e.id}, {"label", e.label}, {"bytes", static_cast<double>(e.total())}, {"installed", installed},
                              {"partialBytes", static_cast<double>(installed ? 0 : partial)}, {"fits", fits}});
  }
  if (recommended.isEmpty()) recommended = catalogue().back().id;
  return {{"dir", dir}, {"freeBytes", static_cast<double>(vol.bytesAvailable())}, {"ramBytes", static_cast<double>(ai::physicalMemoryBytes())},
          {"recommended", recommended}, {"running", running_}, {"current", running_ && entry_ ? entry_->id : QString()}, {"models", models}};
}

QJsonObject ModelDownloader::start(const QString& id) {
  if (running_) return {{"ok", false}, {"error", QStringLiteral("a download is already running")}};
  entry_ = nullptr;
  for (const Entry& e : catalogue())
    if (e.id == id) entry_ = &e;
  if (!entry_) return {{"ok", false}, {"error", QStringLiteral("unknown model ") + id}};
  // the folder the runtime reads now — the user's chosen models folder or the default one
  dir_ = QString::fromStdString(ai::modelsDir().string());
  if (dir_.isEmpty() || !QDir().mkpath(dir_)) return {{"ok", false}, {"error", QStringLiteral("cannot create the models folder ") + dir_}};
  {
    QFile probe(dir_ + QStringLiteral("/.write-test"));
    const bool ok = probe.open(QIODevice::WriteOnly) && probe.write("ok", 2) == 2;
    probe.close();
    probe.remove();
    if (!ok) return {{"ok", false}, {"error", QStringLiteral("the models folder is not writable: ") + dir_}};
  }
  qint64 need = 0;
  for (const Shard& s : entry_->shards) {
    const QFileInfo f(dir_ + '/' + s.name), p(dir_ + '/' + s.name + QStringLiteral(".part"));
    if (f.exists() && f.size() == s.size) continue;
    need += s.size - (p.exists() ? std::min(p.size(), s.size) : 0);
  }
  const qint64 free = QStorageInfo(dir_).bytesAvailable();
  if (free >= 0 && free < need + kMargin)
    return {{"ok", false}, {"error", QStringLiteral("not enough disk space"), }, {"needBytes", static_cast<double>(need + kMargin)}, {"freeBytes", static_cast<double>(free)}};
  running_ = true;
  cancelled_ = false;
  ++gen_;
  shard_ = 0;
  attempt_ = 0;
  // a Cancel before this fires bumps gen_ and reports the cancel itself: the stale timer then does nothing
  QTimer::singleShot(0, this, [this, gen = gen_] {
    if (gen == gen_ && running_) fetchShard();
  });
  return {{"ok", true}, {"dir", dir_}, {"bytes", static_cast<double>(entry_->total())}};
}

void ModelDownloader::cancel() {
  if (!running_) return;
  cancelled_ = true;
  // the .part stays for a resume; a running transfer / check reports the cancel itself
  if (reply_) return reply_->abort();
  if (verifying_) return;
  ++gen_;  // waiting for the start or a retry: that timer must not restart anything
  fail(QStringLiteral("cancelled"));
}

void ModelDownloader::fetchShard() {
  if (!running_ || reply_ || verifying_) return;  // never two transfers on the same .part
  if (cancelled_) return fail(QStringLiteral("cancelled"));
  if (shard_ >= entry_->shards.size()) return install();
  const Shard& s = entry_->shards[shard_];
  // already in place (an earlier download, or copied by hand with the exact size)
  if (QFileInfo f(finalPath(shard_)); f.exists() && f.size() == s.size) {
    ++shard_;
    return fetchShard();
  }
  qint64 have = QFileInfo(partPath(shard_)).size();
  if (have > s.size) {
    QFile::remove(partPath(shard_));
    have = 0;
  }
  if (have == s.size) return verifyShard();
  out_.setFileName(partPath(shard_));
  if (!out_.open(QIODevice::ReadWrite)) return fail(QStringLiteral("cannot write ") + out_.fileName());
  out_.seek(have);
  writeError_.clear();
  statusChecked_ = false;
  const QString base = qEnvironmentVariable("THCAD_MODEL_MIRROR", QStringLiteral("https://huggingface.co"));  // QA: a local server
  QNetworkRequest req(QUrl(base + '/' + entry_->repo + QStringLiteral("/resolve/main/") + s.name));
  req.setAttribute(QNetworkRequest::RedirectPolicyAttribute, QNetworkRequest::NoLessSafeRedirectPolicy);
  req.setTransferTimeout(60000);  // a stalled connection counts as a network error (then resumes)
  req.setHeader(QNetworkRequest::UserAgentHeader, QStringLiteral("MD-CAD-AI-STUDIO"));
  if (have > 0) req.setRawHeader("Range", "bytes=" + QByteArray::number(have) + '-');
  speedBase_ = before() + have;
  speed_ = 0;
  lastTickMs_ = 0;
  clock_.start();
  tick_.start();
  reply_ = nam_->get(req);
  connect(reply_, &QNetworkReply::readyRead, this, [this] {
    QNetworkReply* r = reply_;
    if (!r || !writeError_.isEmpty()) return;
    if (!statusChecked_) {
      statusChecked_ = true;
      const int code = r->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
      if (code == 200 && out_.pos() > 0) {  // the server ignored the Range: start this shard over
        out_.resize(0);
        out_.seek(0);
      } else if (code != 200 && code != 206) {
        writeError_ = QStringLiteral("HTTP ") + QString::number(code);
        r->abort();
        return;
      }
    }
    const QByteArray b = r->readAll();
    if (out_.write(b) != b.size()) {
      writeError_ = QStringLiteral("cannot write to the disk (full?): ") + out_.errorString();
      r->abort();
      return;
    }
    if (tick_.elapsed() < 500) return;
    tick_.restart();
    const qint64 got = before() + out_.pos();
    // speed over the last ~0.5 s, smoothed; none for the first 2 s (connection set-up and redirects would
    // give a tiny speed and an absurd time left)
    const double dt = (clock_.elapsed() - lastTickMs_) / 1000.0;
    const double inst = dt > 0 ? (got - speedBase_) / dt : 0;
    speedBase_ = got;
    lastTickMs_ = clock_.elapsed();
    if (clock_.elapsed() >= 2000) speed_ = speed_ > 0 ? 0.8 * speed_ + 0.2 * inst : inst;
    const qint64 total = entry_->total();
    emit progress({{"id", entry_->id}, {"phase", "download"}, {"received", static_cast<double>(got)}, {"total", static_cast<double>(total)},
                   {"bytesPerSecond", speed_}, {"etaSeconds", speed_ > 0 ? (total - got) / speed_ : -1}, {"shard", shard_ + 1},
                   {"shards", static_cast<int>(entry_->shards.size())}});
  });
  connect(reply_, &QNetworkReply::finished, this, [this] {
    QNetworkReply* r = reply_;
    if (!r) return;
    if (writeError_.isEmpty() && r->error() == QNetworkReply::NoError) {
      const QByteArray rest = r->readAll();
      if (out_.write(rest) != rest.size()) writeError_ = QStringLiteral("cannot write to the disk (full?): ") + out_.errorString();
    }
    out_.flush();
    const qint64 have = out_.size();
    out_.close();
    const QNetworkReply::NetworkError err = r->error();
    const QString errText = r->errorString();
    const int code = r->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
    r->deleteLater();
    reply_ = nullptr;
    if (cancelled_) return fail(QStringLiteral("cancelled"));
    if (code == 416) {  // the .part does not match what the server has: fetch this shard again
      QFile::remove(partPath(shard_));
      return retryLater(QStringLiteral("HTTP 416"));
    }
    // a missing / forbidden file will not come back by retrying
    if (code >= 400 && code < 500 && code != 408 && code != 429)
      return fail(QStringLiteral("HTTP %1 %2 — %3").arg(code).arg(r->attribute(QNetworkRequest::HttpReasonPhraseAttribute).toString(), r->url().toString()));
    if (!writeError_.isEmpty()) return writeError_.startsWith(QStringLiteral("HTTP")) ? retryLater(writeError_) : fail(writeError_);
    if (err != QNetworkReply::NoError) return retryLater(code ? QStringLiteral("HTTP %1: %2").arg(code).arg(errText) : errText);
    const qint64 want = entry_->shards[shard_].size;
    if (have < want) return retryLater(QStringLiteral("connection closed early"));
    if (have > want) {
      QFile::remove(partPath(shard_));
      return fail(QStringLiteral("the server sent a file of the wrong size — discarded"), false);
    }
    attempt_ = 0;
    verifyShard();
  });
}

void ModelDownloader::retryLater(const QString& error) {
  if (++attempt_ >= kMaxAttempts) return fail(error + QStringLiteral(" (gave up after %1 attempts; press Download again to resume)").arg(kMaxAttempts));
  const int wait = std::min(30, 2 << (attempt_ - 1));  // 2, 4, 8, 16, 30 s
  emit progress({{"id", entry_->id}, {"phase", "retry"}, {"attempt", attempt_}, {"inSeconds", wait}, {"error", error}});
  QTimer::singleShot(wait * 1000, this, [this, gen = gen_] {
    if (gen == gen_ && running_) fetchShard();
  });
}

void ModelDownloader::verifyShard() {
  const QString path = partPath(shard_);
  const QByteArray want(entry_->shards[shard_].sha256);
  const qint64 before = this->before();
  const QString id = entry_->id;
  const qint64 total = entry_->total();
  verifying_ = true;
  if (verifyThread_) {  // the previous shard's thread has finished (verifying_ was false): reap it
    verifyThread_->wait();
    delete verifyThread_;
  }
  // sha256 of a multi-GB file takes seconds: off the GUI thread, progress every 64 MB
  QThread* t = QThread::create([this, path, want, before, id, total] {
    QFile f(path);
    QCryptographicHash h(QCryptographicHash::Sha256);
    bool ok = f.open(QIODevice::ReadOnly);
    qint64 done = 0, mark = 0;
    while (ok && !f.atEnd() && !cancelled_) {
      const QByteArray b = f.read(8 << 20);
      if (b.isEmpty()) { ok = false; break; }
      h.addData(b);
      done += b.size();
      if (done - mark >= (64 << 20)) {
        mark = done;
        QMetaObject::invokeMethod(this, [this, id, before, done, total] {
          emit progress({{"id", id}, {"phase", "verify"}, {"received", static_cast<double>(before + done)}, {"total", static_cast<double>(total)}});
        }, Qt::QueuedConnection);
      }
    }
    const bool match = ok && !cancelled_ && h.result().toHex() == want;
    QMetaObject::invokeMethod(this, [this, match, ok, path] {
      verifying_ = false;
      if (!running_) return;
      if (cancelled_) return fail(QStringLiteral("cancelled"));
      if (!ok) return fail(QStringLiteral("cannot read ") + path);
      if (!match) {
        QFile::remove(path);
        return fail(QStringLiteral("checksum mismatch — the damaged file was deleted; press Download to fetch it again"), false);
      }
      ++shard_;
      fetchShard();
    }, Qt::QueuedConnection);
  });
  verifyThread_ = t;
  t->start();
}

void ModelDownloader::install() {
  // every shard verified: the final names appear now, the first shard (the one the runtime lists) last
  for (int i = entry_->shards.size() - 1; i >= 0; --i) {
    const QString part = partPath(i), fin = finalPath(i);
    if (!QFileInfo::exists(part)) continue;  // already in place
    QFile::remove(fin);
    if (!QFile::rename(part, fin)) return fail(QStringLiteral("cannot rename ") + part);
  }
  running_ = false;
  emit progress({{"id", entry_->id}, {"phase", "installed"}, {"path", finalPath(0)}, {"dir", dir_}});
}

void ModelDownloader::fail(const QString& error, bool keepPart) {
  if (out_.isOpen()) out_.close();
  // a damaged part goes; an empty one (nothing received) is not worth keeping either
  if (entry_ && shard_ < entry_->shards.size() && (!keepPart || QFileInfo(partPath(shard_)).size() == 0)) QFile::remove(partPath(shard_));
  const bool wasCancel = cancelled_.load();
  running_ = false;
  cancelled_ = false;
  QJsonObject r{{"id", entry_ ? entry_->id : QString()}, {"done", true}, {"ok", false}, {"error", error}};
  if (wasCancel) r["cancelled"] = true;
  emit progress(r);
}

}  // namespace thcad::app
