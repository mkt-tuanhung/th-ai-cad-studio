#pragma once
// Local photoreal render worker (SP42 / SP43 / SP63): the Blender the user installed, run as a separate
// background process (`blender -b --factory-startup --offline-mode -P md_render.py -- job.json`). Blender is
// never bundled with or linked into the app; when it is not found the UI keeps the OCCT path tracer.
// The process runs outside the GUI thread by construction (QProcess, async signals), so a render never
// freezes the UI; cancel kills the process and deletes everything it wrote.
#include <QJsonObject>
#include <QObject>
#include <QProcess>
#include <QString>

namespace thcad::app {

class BlenderWorker : public QObject {
  Q_OBJECT
 public:
  explicit BlenderWorker(QObject* parent = nullptr);
  ~BlenderWorker() override;

  /** Detected Blender: {found, path, version, source, script, scriptFound, sandbox}. Cached; `refresh` probes again.
   *  THCAD_BLENDER = an executable path, or "none" to behave as if Blender were not installed (QA). */
  static QJsonObject probe(bool refresh = false);
  /** md_render.py shipped with the app (bundle Resources, next to the exe, or the source tree in dev builds). */
  static QString scriptPath();
  /** Where queued scene snapshots (GLB + 3D frame) and worker jobs live (THCAD_RENDER_CACHE overrides). */
  static QString cacheDir();

  bool running() const;
  QString jobId() const { return id_; }
  /** Starts a job (spec = the job.json object md_render.py reads; its "output" is set here). Empty = started. */
  QString start(const QString& id, QJsonObject spec);
  /** Kills the process; the result is reported as cancelled and the partial output deleted. */
  void cancel();
  /** Removes the job folder (job.json, the worker's PNG) once the receiver moved the image away. */
  void cleanup();

 signals:
  /** {id, samples, total, ms, stage?} */
  void progress(const QJsonObject& p);
  /** {id, ok, cancelled, output (temp PNG on success), device, blender, ms, log, error?} — output must be moved away by the receiver. */
  void finished(const QJsonObject& r);

 private:
  void onOutput();
  void onFinished(int code, QProcess::ExitStatus status);
  QProcess* proc_ = nullptr;
  QString id_, dir_, out_, device_, error_, buf_, log_;
  int samples_ = 0, total_ = 0;
  qint64 t0_ = 0, lastEmit_ = 0;
  bool cancelled_ = false;
};

}  // namespace thcad::app
