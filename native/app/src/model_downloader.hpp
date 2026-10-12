#pragma once
// Settings → "Download AI model": fetches the local LLM (Qwen2.5 GGUF, pinned size + sha256) into the
// models folder the runtime reads (ai::modelsDir(), the user's chosen folder included), only when the user
// presses Download. Built to never leave a half-written model where the app would try to load it:
//   - every shard is written as "<name>.part" in that same folder (same volume: the final rename is atomic);
//     ".part" files are invisible to ai::listModels();
//   - free space and write access are checked before the first byte;
//   - interrupted downloads resume (HTTP Range) — after a network error (automatic retries with back-off),
//     after Cancel, or after the app was closed;
//   - each shard is checked for its exact size and sha256; a mismatch deletes it;
//   - the final names appear only once every shard of the model is verified, the first shard last (the one
//     the runtime lists), so the app never sees a model with a missing shard.
#include <QElapsedTimer>
#include <QFile>
#include <QJsonArray>
#include <QJsonObject>
#include <QObject>
#include <QPointer>
#include <QString>
#include <QStringList>
#include <QVector>
#include <atomic>

class QNetworkAccessManager;
class QNetworkReply;

namespace thcad::app {

class ModelDownloader : public QObject {
  Q_OBJECT
 public:
  struct Shard {
    QString name;
    qint64 size;
    const char* sha256;
  };
  struct Entry {
    QString id, label, repo;
    QVector<Shard> shards;
    qint64 total() const;
  };
  static const QVector<Entry>& catalogue();

  explicit ModelDownloader(QObject* parent = nullptr);
  ~ModelDownloader() override;

  /** {dir, freeBytes, ramBytes, recommended, running, models:[{id, label, bytes, installed, partialBytes,
   *  fits}]} — what the Settings card shows (installed = every shard present with its exact size). */
  QJsonObject state() const;
  /** Starts (or resumes) a download; false + error when it cannot start (busy, unknown id, no space…). */
  QJsonObject start(const QString& id);
  void cancel();

 signals:
  /** {id, phase:'download', received, total, bytesPerSecond, etaSeconds, shard, shards}
   *  {id, phase:'verify', received, total} · {id, phase:'retry', attempt, inSeconds, error}
   *  {id, phase:'installed', path} · {id, done:true, ok:false, error, cancelled?} */
  void progress(const QJsonObject& p);

 private:
  void fetchShard();
  void verifyShard();
  void install();
  void fail(const QString& error, bool keepPart = true);
  void retryLater(const QString& error);
  QString partPath(int i) const;
  QString finalPath(int i) const;
  qint64 before() const;  // bytes of the shards before the current one

  QNetworkAccessManager* nam_;
  QPointer<QNetworkReply> reply_;
  const Entry* entry_ = nullptr;
  QString dir_;
  int shard_ = 0;
  int attempt_ = 0;
  bool running_ = false;
  std::atomic<bool> cancelled_{false};
  bool verifying_ = false;
  int gen_ = 0;  // bumps on every start / cancel: stale timers and threads of an earlier run do nothing
  bool statusChecked_ = false;
  QFile out_;
  QString writeError_;
  QElapsedTimer clock_, tick_;
  qint64 speedBase_ = 0;  // bytes at the previous progress tick
  qint64 lastTickMs_ = 0;
  double speed_ = 0;
};

}  // namespace thcad::app
