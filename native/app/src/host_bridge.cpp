#include "host_bridge.hpp"

#include <QDesktopServices>
#include <QDir>
#include <QUrl>
#include <QFile>
#include <QFileDialog>
#include <QFileInfo>
#include <QStandardPaths>
#include <QStorageInfo>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QThread>
#include <utility>

#include <algorithm>
#include <optional>
#include <chrono>
#include <QSysInfo>
#include <QWidget>

#include "blender_worker.hpp"
#include "dwg_reader.hpp"
#include "video_writer.hpp"
#include "speech_input.hpp"
#include "whisper_runner.hpp"
#include "model_downloader.hpp"
#include "native_viewport.hpp"
#include "thcad/ai/assistant.hpp"
#include "thcad/core/commands.hpp"
#include "thcad/core/ops_json.hpp"
#ifdef THCAD_HAS_OCCT
#include "thcad/bim/model_json.hpp"
#include "thcad/occt/geometry.hpp"
#include "thcad/occt/offscreen.hpp"
#include "thcad/occt/scene.hpp"
#endif
#include <QBuffer>
#include <QFontMetricsF>
#include <QPageSize>
#include <QPainter>
#include <QPdfWriter>
#include <QPen>
#include <QDateTime>
#include <QRegularExpression>
#include <QImageWriter>
#include <QImageReader>
#include <QCryptographicHash>
#include <QRandomGenerator>
#include <QTimer>
#include <cmath>
#include <QImage>

namespace thcad::app {

namespace {
QJsonObject toQt(const json::Value& v) { return QJsonDocument::fromJson(QByteArray::fromStdString(json::stringify(v))).object(); }
constexpr double kGiB = 1073741824.0;
}  // namespace

HostBridge::HostBridge(NativeViewport* viewport, QObject* parent)
    : QObject(parent),
      viewport_(viewport),
      runtime_(ai::createRuntime()),
      bus_(std::make_unique<CommandBus>(Document::blank("Drawing1.dwg"))),
      proposals_(std::make_unique<ProposalQueue>(*bus_)),
      bim_(bim::villaRiverside()) {
  dwg_ = new DwgReader(this);
  connect(dwg_, &DwgReader::finished, this, &HostBridge::dwgResult);
  blender_ = new BlenderWorker(this);
  connect(blender_, &BlenderWorker::progress, this, &HostBridge::renderProgress);
#ifdef THCAD_HAS_OCCT
  connect(blender_, &BlenderWorker::finished, this, &HostBridge::blenderDone);
#endif
  downloader_ = new ModelDownloader(this);
  connect(this, &HostBridge::modelProgress, this, [this](const QJsonObject& p) {
    if (!p.value("done").toBool()) return;
    modelInstalling_ = false;
    modelLast_ = p;
  });
  connect(downloader_, &ModelDownloader::progress, this, [this](const QJsonObject& p) {
    if (p.value("phase").toString() != QStringLiteral("installed")) return emit modelProgress(p);
    modelInstalling_ = true;
    // verified and in place: load it now and ask a one-word question, so "ready" means the app can call it.
    // Loading maps 2–5 GB (and uploads it to the GPU): on a worker, never the GUI thread. The runtime holds its
    // generation lock while the model is swapped, so a running aiTask finishes first and none runs on a
    // half-loaded model; status() stays responsive (ready = false until the new model is in).
    const QString id = p.value("id").toString(), path = p.value("path").toString();
    emit modelProgress({{"id", id}, {"phase", "load"}});
    modelLoading_ = true;
    runWorker([this, id, path] {
      const bool loaded = runtime_->load(path.toStdString());
      modelLoading_ = false;
      if (!loaded) {
        const QString err = QString::fromStdString(runtime_->status().error);
        QMetaObject::invokeMethod(this, [this, id, path, err] {
          emit modelProgress({{"id", id}, {"done", true}, {"ok", false}, {"loaded", false}, {"path", path},
                              {"error", QStringLiteral("downloaded and verified, but the AI runtime could not load it: ") + err}});
        }, Qt::QueuedConnection);
        return;
      }
      QMetaObject::invokeMethod(this, [this, id] { emit modelProgress({{"id", id}, {"phase", "test"}}); }, Qt::QueuedConnection);
      ai::GenerateOptions opt;
      opt.maxTokens = 8;
      opt.temperature = 0;
      const auto t0 = std::chrono::steady_clock::now();
      const std::string text = runtime_->generate("Reply with the single word OK.", opt);
      const double secs = std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
      QMetaObject::invokeMethod(this, [this, id, path, text, secs] {
        const ai::RuntimeStatus st = runtime_->status();
        QJsonObject r{{"id", id}, {"done", true}, {"ok", st.ready && !text.empty()}, {"loaded", st.ready}, {"path", path},
                      {"test", QString::fromStdString(text).trimmed()}, {"seconds", secs}, {"tokensPerSecond", st.lastTokensPerSecond},
                      {"device", QString::fromStdString(st.device)}, {"model", QString::fromStdString(st.modelName)}};
        if (!r["ok"].toBool()) r["error"] = QStringLiteral("the model loaded but did not answer the test question");
        emit modelProgress(r);
      }, Qt::QueuedConnection);
    });
  });
  if (const std::string model = ai::discoverModel(); !model.empty()) runtime_->load(model);
}

HostBridge::~HostBridge() {
  // Quitting with work in flight (a model check, load, test question or AI task): stop it and join every
  // thread before the runtime, the queues and `this` go. Results they queued to `this` are dropped with it.
  delete downloader_;  // joins its sha256 thread
  downloader_ = nullptr;
  runtime_->abort();   // a load stops at its next progress tick, a generation at its next token / graph node
  const QList<QThread*> workers = std::exchange(workers_, {});
  for (QThread* t : workers) {
    t->wait();
    delete t;
  }
}  // offscreen_ complete type via offscreen.hpp

void HostBridge::runWorker(std::function<void()> fn) {
  QThread* t = QThread::create(std::move(fn));
  workers_.append(t);
  connect(t, &QThread::finished, this, [this, t] {
    workers_.removeOne(t);
    t->deleteLater();
  });
  t->start();
}

bool HostBridge::nativeViewport() const { return viewport_ != nullptr; }

QJsonObject HostBridge::info() const {
  return {
      {"engine", "0.1.0"},
      {"platform", QSysInfo::prettyProductName() + " " + QSysInfo::currentCpuArchitecture()},
      {"commands", static_cast<int>(commandTable().size())},
#ifdef THCAD_HAS_OCCT
      {"occt", QString::fromStdString(occt::version())},
#else
      {"occt", QJsonValue::Null},
#endif
      {"aiBackend", QString::fromStdString(runtime_->status().backend)},
      {"nativeViewport", nativeViewport()},
      {"dwgReader", DwgReader::version()},
      {"blender", BlenderWorker::probe()},
  };
}

QJsonObject HostBridge::localAiStatus() const {
  const ai::RuntimeStatus s = runtime_->status();
  // Same shape as LocalAiStatus in ui/src/services/localAi.ts, but every number is measured.
  return {
      {"source", "native"},
      {"backend", QString::fromStdString(s.backend)},
      {"device", QString::fromStdString(s.device)},
      {"online", s.ready},  // green "Online" only when a model is actually loaded
      {"ready", s.ready},
      {"modelName", s.modelName.empty() ? QJsonValue::Null : QJsonValue(QString::fromStdString(s.modelName))},
      {"modelPath", QString::fromStdString(s.modelPath)},
      {"vramUsedGb", s.modelBytes / kGiB},
      {"vramTotalGb", s.memoryTotalBytes / kGiB},
      {"responseSeconds", s.lastLatencySeconds > 0 ? QJsonValue(s.lastLatencySeconds) : QJsonValue::Null},
      {"tokensPerSecond", s.lastTokensPerSecond > 0 ? QJsonValue(s.lastTokensPerSecond) : QJsonValue::Null},
      {"error", QString::fromStdString(s.error)},
  };
}

bool HostBridge::loadModel(const QString& path) { return runtime_->load(path.toStdString()); }

void HostBridge::aiRequest(const QString& request) {
  // Generation runs off the UI thread; the resulting proposal is filed on the UI thread.
  const Document snapshot = bus_->document();
  runWorker([this, request, snapshot] {
    const ai::RuntimeStatus st = runtime_->status();
    // Generation + validation against a private queue on the snapshot; the proposal is re-filed on
    // the UI thread against the live document (and re-validated again at approval time).
    CommandBus scratch(snapshot);
    ProposalQueue scratchQ(scratch);
    const auto t0 = std::chrono::steady_clock::now();
    ai::AssistantResult gen = st.ready ? ai::requestEdit(*runtime_, scratchQ, snapshot, request.toStdString()) : ai::AssistantResult{};
    const double total = std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
    std::string opsJson;
    if (const Proposal* p = scratchQ.find(gen.proposalId)) opsJson = json::stringify(json::Object{{"title", p->title}, {"ops", opsToJson(p->ops)}});
    const std::string out = gen.rawOutput;
    QMetaObject::invokeMethod(this, [this, request, out, st, gen, opsJson, total] {
      QJsonObject r;
      if (!st.ready) {
        r = {{"ok", false}, {"message", st.modelPath.empty() ? "no local model installed" : QString::fromStdString("model not ready: " + st.error)}};
      } else {
        auto res = opsJson.empty() ? gen : ai::fileProposal(*proposals_, request.toStdString(), "ai:" + st.modelName, opsJson);
        if (opsJson.empty()) res.ok = false;
        const ai::RuntimeStatus after = runtime_->status();
        r = {{"ok", res.ok}, {"message", QString::fromStdString(res.message)}, {"raw", QString::fromStdString(out)},
             {"seconds", total}, {"retried", gen.retried}, {"tokensPerSecond", after.lastTokensPerSecond}};
        if (const Proposal* p = proposals_->find(res.proposalId)) r["proposal"] = proposalJson(*p);
      }
      emit aiResult(r);
    }, Qt::QueuedConnection);
  });
}

QJsonObject HostBridge::voiceAvailability(const QString& locale) {
  bool available = false, onDevice = false;
  const QString reason = SpeechInput::availability(locale, &available, &onDevice);
  return {{"available", available}, {"onDevice", onDevice}, {"reason", reason}, {"locale", locale}};
}

void HostBridge::voiceStart(const QString& locale) {
  if (!speech_) speech_ = std::make_unique<SpeechInput>();
  speech_->start(locale, [this](const QString& text, bool final, const QString& error) {
    QJsonObject r{{"text", text}, {"final", final}};
    if (!error.isEmpty()) r["error"] = error;
    emit voiceText(r);
  });
}

void HostBridge::voiceStop() {
  if (speech_) speech_->stop();
}

QJsonObject HostBridge::whisperStatus() { return WhisperRunner::status(); }

QJsonObject HostBridge::modelDownloadState() {
  QJsonObject s = downloader_->state();
  s["busy"] = s.value("running").toBool() || modelInstalling_;
  if (!modelLast_.isEmpty()) s["last"] = modelLast_;
  return s;
}
QJsonObject HostBridge::modelDownload(const QString& id) { return downloader_->start(id); }
void HostBridge::modelDownloadCancel() { downloader_->cancel(); }

void HostBridge::voiceWarmup() { WhisperRunner::warmup(); }

void HostBridge::whisperDownload() {
  WhisperRunner::download([this](const QJsonObject& p) { emit whisperProgress(p); });
}

void HostBridge::voiceTranscribe(const QString& id, const QString& wavBase64, const QString& lang) {
  WhisperRunner::transcribe(QByteArray::fromBase64(wavBase64.toLatin1()), lang, [this, id](QJsonObject r) {
    r["id"] = id;
    emit voiceTranscript(r);
  });
}

bool HostBridge::aiTask(const QString& taskJson) {
  const QJsonObject task = QJsonDocument::fromJson(taskJson.toUtf8()).object();
  const QString id = task.value("id").toString();
  // no model, or a downloaded one is being swapped in (the UI falls back as with no model)
  if (modelLoading_ || !runtime_->status().ready) return false;
  runWorker([this, task, id] {
    ai::GenerateOptions opt;
    opt.system = task.value("system").toString().toStdString();
    opt.grammar = task.value("grammar").toString().toStdString();
    opt.maxTokens = std::clamp(task.value("maxTokens").toInt(512), 16, 2048);
    opt.temperature = 0;
    const auto t0 = std::chrono::steady_clock::now();
    const std::string text = runtime_->generate(task.value("prompt").toString().toStdString(), opt);
    const double secs = std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
    const bool grammarError = opt.grammarError;
    const int tokens = opt.producedTokens;
    QMetaObject::invokeMethod(this, [this, id, text, secs, grammarError, tokens] {
      const ai::RuntimeStatus st = runtime_->status();
      QJsonObject r{{"id", id}, {"ok", !grammarError && !text.empty()}, {"text", QString::fromStdString(text)}, {"seconds", secs},
                    {"tokens", tokens}, {"tokensPerSecond", st.lastTokensPerSecond}, {"model", QString::fromStdString(st.modelName)}};
      if (grammarError) r["error"] = "grammar failed to compile";
      emit aiTaskResult(r);
    }, Qt::QueuedConnection);
  });
  return true;
}

QJsonObject HostBridge::cadLoad(const QString& documentJson) {
  auto parsed = json::parse(documentJson.toStdString());
  if (auto* e = std::get_if<json::ParseError>(&parsed)) return {{"ok", false}, {"error", QString::fromStdString(e->message)}};
  auto doc = documentFromJson(std::get<json::Value>(parsed));
  if (auto* e = std::get_if<OpsParseError>(&doc)) return {{"ok", false}, {"error", QString::fromStdString(e->message)}};
  bus_ = std::make_unique<CommandBus>(std::move(std::get<Document>(doc)));
  proposals_ = std::make_unique<ProposalQueue>(*bus_);
  return {{"ok", true}, {"entities", static_cast<int>(bus_->document().entities.size())}};
}

QJsonObject HostBridge::cadDocument() const { return toQt(documentToJson(bus_->document())); }

QJsonObject HostBridge::result(std::optional<ValidationError> err) const {
  QJsonObject r{{"ok", !err}, {"canUndo", bus_->canUndo()}, {"canRedo", bus_->canRedo()}, {"document", cadDocument()}};
  if (err) r["error"] = QJsonObject{{"code", toString(err->code)}, {"detail", QString::fromStdString(err->detail)}};
  return r;
}

QJsonObject HostBridge::cadExecute(const QString& opsJson) {
  auto parsed = json::parse(opsJson.toStdString());
  if (auto* e = std::get_if<json::ParseError>(&parsed)) return {{"ok", false}, {"error", QJsonObject{{"code", "json"}, {"detail", QString::fromStdString(e->message)}}}};
  auto ops = opsFromJson(std::get<json::Value>(parsed), "ui");
  if (auto* e = std::get_if<OpsParseError>(&ops)) return {{"ok", false}, {"error", QJsonObject{{"code", "ops"}, {"detail", QString::fromStdString(e->message)}}}};
  const auto& list = std::get<std::vector<CadOp>>(ops);
  auto err = bus_->executeBatch(list, list.front().label);
  if (!err) emit documentChanged(cadDocument());
  return result(err);
}

QJsonObject HostBridge::cadUndo() {
  QJsonObject r = result(std::nullopt);
  if (auto l = bus_->undo()) { r = result(std::nullopt); r["label"] = QString::fromStdString(*l); emit documentChanged(cadDocument()); }
  return r;
}

QJsonObject HostBridge::cadRedo() {
  QJsonObject r = result(std::nullopt);
  if (auto l = bus_->redo()) { r = result(std::nullopt); r["label"] = QString::fromStdString(*l); emit documentChanged(cadDocument()); }
  return r;
}

QJsonObject HostBridge::proposalJson(const Proposal& p) const {
  static const char* status[] = {"pending", "approved", "rejected", "invalid"};
  QJsonObject o{{"id", QString::fromStdString(p.id)},
                {"title", QString::fromStdString(p.title)},
                {"source", QString::fromStdString(p.source)},
                {"status", status[static_cast<int>(p.status)]},
                {"added", static_cast<int>(p.diff.added)},
                {"erased", static_cast<int>(p.diff.erased)},
                {"modified", static_cast<int>(p.diff.modified)},
                {"ops", QJsonDocument::fromJson(QByteArray::fromStdString(json::stringify(opsToJson(p.ops)))).array()}};
  if (p.error) o["error"] = QString::fromStdString(std::string(toString(p.error->code)) + " " + p.error->detail);
  return o;
}

QJsonObject HostBridge::proposeOps(const QString& title, const QString& opsJson) {
  auto r = ai::fileProposal(*proposals_, title.toStdString(), "ui", opsJson.toStdString());
  QJsonObject out{{"ok", r.ok}, {"message", QString::fromStdString(r.message)}};
  if (const Proposal* p = proposals_->find(r.proposalId)) out["proposal"] = proposalJson(*p);
  return out;
}

QJsonObject HostBridge::approveProposal(const QString& id) {
  auto err = proposals_->approve(id.toStdString());
  if (!err) emit documentChanged(cadDocument());
  QJsonObject r = result(err);
  if (const Proposal* p = proposals_->find(id.toStdString())) r["proposal"] = proposalJson(*p);
  return r;
}

bool HostBridge::rejectProposal(const QString& id) { return proposals_->reject(id.toStdString()); }

QJsonObject HostBridge::bimSummary() const {
  QJsonArray walls;
  for (const auto& w : bim_.walls) {
    QJsonObject o{{"mark", QString::fromStdString(w.mark)}, {"area", bim::wallArea(bim_, w)}, {"volume", bim::wallVolume(bim_, w)}};
#ifdef THCAD_HAS_OCCT
    o["netVolume"] = occt::wallWithOpenings(bim_, w).volumeM3();
#endif
    walls.append(o);
  }
  QJsonArray checks;
  for (const auto& c : bim::runModelChecks(bim_)) checks.append(static_cast<int>(c.count()));
  return {{"walls", walls}, {"checks", checks}};
}

#ifdef THCAD_HAS_OCCT
occt::OffscreenView* HostBridge::offscreen() {
  if (!offscreen_) offscreen_ = std::make_unique<occt::OffscreenView>();
  if (!offscreen_->ok()) return nullptr;
  if (!offscreenLoaded_) {
    offscreen_->setModel(bim_);
    offscreenLoaded_ = true;
  }
  return offscreen_.get();
}

QJsonObject HostBridge::bim3dLoad(const QString& modelJson) {
  auto parsed = json::parse(modelJson.toStdString());
  if (auto* e = std::get_if<json::ParseError>(&parsed)) return {{"ok", false}, {"error", QString::fromStdString(e->message)}};
  std::string err;
  auto m = bim::modelFromJson(std::get<json::Value>(parsed), bim::villaRiverside(), &err);
  if (!m) return {{"ok", false}, {"error", QString::fromStdString(err)}};
  bim_ = std::move(*m);
  if (auto* v = offscreen()) v->setModel(bim_);
  return {{"ok", true}, {"walls", static_cast<int>(bim_.walls.size())}};
}

QJsonObject HostBridge::bim3dFrame(int w, int h, const QString& mode, const QString& selectedWall) {
  auto* v = offscreen();
  if (!v || w < 8 || h < 8) return {{"ok", false}};
  static QString lastMode, lastSel;
  if (mode != lastMode) { v->setMode(mode.toStdString()); lastMode = mode; }
  if (selectedWall != lastSel) { v->setSelected(selectedWall.toStdString()); lastSel = selectedWall; }
  std::vector<unsigned char> px = v->renderRgba(w, h);
  if (px.empty()) return {{"ok", false}};
  QImage img(px.data(), w, h, w * 4, QImage::Format_RGBA8888);
  QByteArray bytes;
  QBuffer buf(&bytes);
  buf.open(QIODevice::WriteOnly);
  img.save(&buf, "JPG", 88);
  return {{"ok", true}, {"url", QStringLiteral("data:image/jpeg;base64,") + QString::fromLatin1(bytes.toBase64())}, {"ms", v->lastRenderMs()}};
}

void HostBridge::bim3dCamera(const QString& action, double a, double b, double c, double d) {
  auto* v = offscreen();
  if (!v) return;
  if (action == "orbitStart") v->orbit(int(a), int(b), int(a), int(b), true);
  else if (action == "orbit") v->orbit(0, 0, int(a), int(b), false);
  else if (action == "pan") v->pan(int(a), int(b));
  else if (action == "zoom") v->zoom(int(a), int(b), c);
  else if (action == "fit") v->fit();
  else v->preset(action.toStdString());
  (void)d;
}

namespace {
std::array<double, 3> arr3Of(const QJsonValue& v, std::array<double, 3> def) {
  const QJsonArray a = v.toArray();
  return a.size() == 3 ? std::array<double, 3>{a[0].toDouble(), a[1].toDouble(), a[2].toDouble()} : def;
}

QJsonObject glbStatsJson(const occt::GlbStats& st) {
  QJsonArray mats, b;
  for (const auto& m : st.materials) mats.append(QString::fromStdString(m));
  for (double x : st.boundsMm) b.append(x);
  return {{"bytes", static_cast<double>(st.bytes)}, {"nodes", st.nodes}, {"triangles", st.triangles}, {"vertices", st.vertices}, {"materials", mats}, {"boundsMm", b}};
}

QString fileSha256(const QString& path) {
  QFile f(path);
  if (!f.open(QIODevice::ReadOnly)) return {};
  QCryptographicHash h(QCryptographicHash::Sha256);
  h.addData(&f);
  return QString::fromLatin1(h.result().toHex());
}

/** `path` lies inside `dir` (both resolved; no ../ escapes). */
bool insideDir(const QString& path, const QString& dir) {
  const QString p = QFileInfo(path).canonicalFilePath(), d = QDir(dir).canonicalPath();
  return !p.isEmpty() && !d.isEmpty() && p.startsWith(d + "/");
}

/** Working memory of a final render (SP44), bytes. OCCT path tracer: float accumulation buffers on the GPU
 *  (unified memory on Apple Silicon) + read-back + post-processing copies; Blender: the Blender process,
 *  Cycles film / denoiser passes and the scene. Deliberately on the safe side. */
double renderMemoryBytes(int w, int h, const QString& engine) {
  const double px = double(w) * h;
  return engine == QStringLiteral("blender") ? 900.0 * 1024 * 1024 + px * 120 : 300.0 * 1024 * 1024 + px * 110;
}

/** Memory a render may use: THCAD_RENDER_MEM_LIMIT_MB (QA: simulate a small machine) or 60 % of physical RAM. */
double renderMemoryBudget() {
  const QString lim = qEnvironmentVariable("THCAD_RENDER_MEM_LIMIT_MB");
  if (!lim.isEmpty() && lim.toDouble() > 0) return lim.toDouble() * 1024 * 1024;
  return double(ai::physicalMemoryBytes()) * 0.6;
}

QJsonObject memoryCheck(int w, int h, const QString& engine) {
  const double need = renderMemoryBytes(w, h, engine), budget = renderMemoryBudget();
  QJsonObject r{{"ok", need <= budget}, {"needBytes", need}, {"budgetBytes", budget}, {"physicalBytes", static_cast<double>(ai::physicalMemoryBytes())}};
  if (need > budget)
    r["reason"] = QStringLiteral("not enough memory for %1 x %2: needs about %3 GB, %4 GB available for rendering — choose a lower resolution")
                      .arg(w).arg(h).arg(need / kGiB, 0, 'f', 1).arg(budget / kGiB, 0, 'f', 1);
  return r;
}
}  // namespace

occt::SceneView* HostBridge::scene(const QString& key) {
  auto& v = scenes_[key];
  if (!v) v = std::make_unique<occt::SceneView>();
  return v->ok() ? v.get() : nullptr;
}

QJsonObject HostBridge::scene3dLoad(const QString& key, const QString& json) {
  auto* v = scene(key);
  if (!v) return {{"ok", false}, {"error", "OpenGL unavailable"}};
  auto parsed = json::parse(json.toStdString());
  if (auto* e = std::get_if<json::ParseError>(&parsed)) return {{"ok", false}, {"error", QString::fromStdString(e->message)}};
  const json::Value& root = std::get<json::Value>(parsed);
  const std::vector<occt::SceneItem> items = occt::sceneFromJson(root);
  const int failures = v->setItems(items);
  QJsonObject volumes;
  const json::Value* wantVol = root.get("volumes");
  if (wantVol && wantVol->boolean() && *wantVol->boolean())
    for (const auto& it : items) volumes[QString::fromStdString(it.id)] = v->volumeM3(it.id);
  QJsonArray errors;
  for (const auto& e : v->buildErrors()) errors.append(QString::fromStdString(e));
  return {{"ok", true}, {"items", static_cast<int>(items.size())}, {"failures", failures}, {"ms", v->lastBuildMs()}, {"volumes", volumes}, {"errors", errors}};
}

QJsonObject HostBridge::scene3dFrame(const QString& key, int w, int h, const QString& mode, const QString& selected, const QString& highlightedCsv) {
  auto* v = scene(key);
  if (!v || w < 8 || h < 8) return {{"ok", false}};
  static std::map<QString, QString> lastMode, lastSel, lastHi;
  if (mode != lastMode[key]) { v->setMode(mode.toStdString()); lastMode[key] = mode; }
  if (selected != lastSel[key]) { v->setSelected(selected.toStdString()); lastSel[key] = selected; }
  if (highlightedCsv != lastHi[key]) {
    std::vector<std::string> ids;
    for (const auto& s : highlightedCsv.split(',', Qt::SkipEmptyParts)) ids.push_back(s.toStdString());
    v->setHighlighted(ids);
    lastHi[key] = highlightedCsv;
  }
  std::vector<unsigned char> px = v->renderRgba(w, h);
  if (px.empty()) return {{"ok", false}};
  QImage img(px.data(), w, h, w * 4, QImage::Format_RGBA8888);
  QByteArray bytes;
  QBuffer buf(&bytes);
  buf.open(QIODevice::WriteOnly);
  img.save(&buf, "JPG", 88);
  return {{"ok", true}, {"url", QStringLiteral("data:image/jpeg;base64,") + QString::fromLatin1(bytes.toBase64())}, {"ms", v->lastRenderMs()}};
}

void HostBridge::scene3dCamera(const QString& key, const QString& action, double a, double b, double c) {
  auto* v = scene(key);
  if (!v) return;
  if (action == "orbitStart") v->orbit(int(a), int(b), int(a), int(b), true);
  else if (action == "orbit") v->orbit(0, 0, int(a), int(b), false);
  else if (action == "pan") v->pan(int(a), int(b));
  else if (action == "zoom") v->zoom(int(a), int(b), c);
  else if (action == "fit") v->fit();
  else v->preset(action.toStdString());
}

QJsonObject HostBridge::scene3dLoadBim(const QString& key, const QString& modelJson, const QString& extrasJson) {
  auto* v = scene(key);
  if (!v) return {{"ok", false}, {"error", "OpenGL unavailable"}};
  auto parsed = json::parse(modelJson.toStdString());
  if (auto* e = std::get_if<json::ParseError>(&parsed)) return {{"ok", false}, {"error", QString::fromStdString(e->message)}};
  std::string err;
  auto m = bim::modelFromJson(std::get<json::Value>(parsed), bim::villaRiverside(), &err);
  if (!m) return {{"ok", false}, {"error", QString::fromStdString(err)}};
  std::vector<occt::SceneItem> extras;
  if (!extrasJson.isEmpty()) {
    auto px = json::parse(extrasJson.toStdString());
    if (auto* e = std::get_if<json::ParseError>(&px)) return {{"ok", false}, {"error", QString::fromStdString(e->message)}};
    extras = occt::sceneFromJson(std::get<json::Value>(px));
  }
  const auto t0 = std::chrono::steady_clock::now();
  const int failures = v->setItems(extras);
  const int n = v->addBuilding(*m, false);
  const double ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
  return {{"ok", true}, {"items", n + static_cast<int>(extras.size())}, {"failures", failures}, {"ms", ms}};
}

// ---- v2.4 linked model: incremental BIM patch and the view-only commands --------------------------------------
namespace {
std::vector<std::string> jsonIds(const json::Value* a) {
  std::vector<std::string> out;
  if (a && a->arr())
    for (const auto& x : *a->arr())
      if (x.str()) out.push_back(*x.str());
  return out;
}
/** {cmd:'tag', guids:{id:guid}} | {cmd:'itemInfo'} | {cmd:'alpha', items:{id:0…1}} | {cmd:'lowWalls', items:{id:z}} |
 *  {cmd:'project', p:[x,y,z]} | {cmd:'walkc', forward, right, yaw, pitch, radius} | {cmd:'camFull'} |
 *  {cmd:'setCamFull', eye, at, up, fov, ortho} | {cmd:'volume', ids} — handled here, else nullopt. */
std::optional<QJsonObject> linkedSceneCommand(occt::SceneView* v, const QJsonObject& o) {
  const QString cmd = o["cmd"].toString();
  auto vec3 = [&](const char* k) {
    const QJsonArray a = o[k].toArray();
    return std::array<double, 3>{a.at(0).toDouble(), a.at(1).toDouble(), a.at(2).toDouble()};
  };
  auto pairs = [&](const char* k) {
    std::vector<std::pair<std::string, double>> out;
    const QJsonObject m = o[k].toObject();
    for (auto it = m.begin(); it != m.end(); ++it) out.push_back({it.key().toStdString(), it.value().toDouble()});
    return out;
  };
  if (cmd == "tag") {
    std::vector<std::pair<std::string, std::string>> g;
    const QJsonObject m = o["guids"].toObject();
    for (auto it = m.begin(); it != m.end(); ++it) g.push_back({it.key().toStdString(), it.value().toString().toStdString()});
    v->setGuids(g);
    return QJsonObject{{"ok", true}, {"n", static_cast<int>(g.size())}};
  }
  if (cmd == "itemInfo") {
    QJsonObject items;
    for (const auto& i : v->itemInfo()) items[QString::fromStdString(i.id)] = QJsonObject{{"guid", QString::fromStdString(i.guid)}, {"owner", QString::fromStdString(i.owner)}, {"serial", static_cast<double>(i.serial)}, {"shape", QString::fromStdString(i.shape)}};
    return QJsonObject{{"ok", true}, {"items", items}, {"built", static_cast<double>(v->builtCount())}};
  }
  if (cmd == "alpha") {
    v->setViewAlpha(pairs("items"));
    return QJsonObject{{"ok", true}};
  }
  if (cmd == "lowWalls") {
    v->setLowWalls(pairs("items"));
    return QJsonObject{{"ok", true}};
  }
  if (cmd == "project") {
    const auto q = v->project(vec3("p"));
    return QJsonObject{{"ok", true}, {"x", q[0]}, {"y", q[1]}, {"z", q[2]}};
  }
  if (cmd == "walkc") {
    const std::string by = v->walkCollide(o["forward"].toDouble(), o["right"].toDouble(), o["yaw"].toDouble(), o["pitch"].toDouble(), o["radius"].toDouble(300));
    const auto c = v->cameraFull();
    return QJsonObject{{"ok", true}, {"blocked", QString::fromStdString(by)}, {"eye", QJsonArray{c[0], c[1], c[2]}}};
  }
  if (cmd == "camFull") {
    const auto c = v->cameraFull();
    return QJsonObject{{"ok", true}, {"eye", QJsonArray{c[0], c[1], c[2]}}, {"at", QJsonArray{c[3], c[4], c[5]}}, {"up", QJsonArray{c[6], c[7], c[8]}}, {"fov", c[9]}, {"ortho", c[10] > 0.5}};
  }
  if (cmd == "setCamFull") {
    v->setCameraFull(vec3("eye"), vec3("at"), vec3("up"), o["fov"].toDouble(45), o["ortho"].toBool());
    return QJsonObject{{"ok", true}};
  }
  if (cmd == "volume") {
    QJsonObject vols;
    for (const auto& x : o["ids"].toArray()) vols[x.toString()] = v->volumeM3(x.toString().toStdString());
    return QJsonObject{{"ok", true}, {"volumes", vols}};
  }
  return std::nullopt;
}
}  // namespace

QJsonObject HostBridge::scene3dPatch(const QString& key, const QString& upsertsJson, const QString& removeIdsJson) {
  auto* v = scene(key);
  if (!v) return {{"ok", false}, {"error", "no scene"}};
  auto parsed = json::parse(upsertsJson.toStdString());
  if (auto* e = std::get_if<json::ParseError>(&parsed)) return {{"ok", false}, {"error", QString::fromStdString(e->message)}};
  const json::Value& root = std::get<json::Value>(parsed);
  auto pr = json::parse(removeIdsJson.isEmpty() ? std::string("[]") : removeIdsJson.toStdString());
  if (auto* e = std::get_if<json::ParseError>(&pr)) return {{"ok", false}, {"error", QString::fromStdString(e->message)}};
  const std::vector<std::string> remove = jsonIds(&std::get<json::Value>(pr));
  std::optional<bim::Model> model;
  if (const json::Value* mv = root.get("model"); mv && mv->obj()) {
    std::string err;
    model = bim::modelFromJson(*mv, bim::villaRiverside(), &err);
    if (!model) return {{"ok", false}, {"error", QString::fromStdString(err)}};
  }
  const std::vector<std::string> walls = jsonIds(root.get("walls"));
  if (!walls.empty() && !model) return {{"ok", false}, {"error", "walls need the model"}};
  if (const json::Value* g = root.get("guids"); g && g->obj()) {
    std::vector<std::pair<std::string, std::string>> ids;
    for (const auto& [k, val] : *g->obj())
      if (val.str()) ids.push_back({k, *val.str()});
    v->setGuids(ids);
  }
  const std::vector<occt::SceneItem> items = occt::sceneFromJson(root);
  const json::Value* ls = root.get("levelSlabs");
  const auto r = v->patchBuilding(model ? &*model : nullptr, walls, items, remove, ls && ls->boolean() && *ls->boolean());
  QJsonArray rebuilt, removed;
  for (const auto& id : r.rebuilt) rebuilt.append(QString::fromStdString(id));
  for (const auto& id : r.removed) removed.append(QString::fromStdString(id));
  return {{"ok", true}, {"rebuilt", rebuilt}, {"removed", removed}, {"items", r.items}, {"ms", r.ms}, {"built", static_cast<double>(v->builtCount())}};
}
// ----------------------------------------------------------------------------------------------------------------

QJsonObject HostBridge::scene3dCommand(const QString& key, const QString& json) {
  auto* v = scene(key);
  if (!v) return {{"ok", false}, {"error", "no scene"}};
  const QJsonObject o = QJsonDocument::fromJson(json.toUtf8()).object();
  if (auto r = linkedSceneCommand(v, o)) return *r;
  const QString cmd = o["cmd"].toString();
  auto ids = [&](const char* k) {
    std::vector<std::string> out;
    for (const auto& x : o[k].toArray()) out.push_back(x.toString().toStdString());
    return out;
  };
  auto vec3 = [&](const char* k) {
    const QJsonArray a = o[k].toArray();
    return std::array<double, 3>{a.at(0).toDouble(), a.at(1).toDouble(), a.at(2).toDouble()};
  };
  if (cmd == "hide") {
    v->setHidden(ids("ids"), ids("keep"));
    return {{"ok", true}, {"visible", v->visibleCount()}};
  }
  else if (cmd == "clip") {
    std::vector<std::array<double, 4>> planes;
    for (const auto& q : o["planes"].toArray()) {
      const QJsonArray a = q.toArray();
      planes.push_back({a.at(0).toDouble(), a.at(1).toDouble(), a.at(2).toDouble(), a.at(3).toDouble()});
    }
    v->setClipPlanes(planes);
  } else if (cmd == "section") v->setSectionBox(o["on"].toBool(), ids("around"), o.contains("top") ? o["top"].toDouble() : std::numeric_limits<double>::quiet_NaN());
  else if (cmd == "window") v->windowFit(o["x0"].toInt(), o["y0"].toInt(), o["x1"].toInt(), o["y1"].toInt());
  else if (cmd == "camera") {
    if (o["up"].toArray().size() == 3) v->setCamera(vec3("eye"), vec3("at"), o["fov"].toDouble(55), vec3("up"));
    else v->setCamera(vec3("eye"), vec3("at"), o["fov"].toDouble(55));
  }
  else if (cmd == "walk") v->walk(o["forward"].toDouble(), o["right"].toDouble(), o["yaw"].toDouble(), o["pitch"].toDouble());
  else if (cmd == "drawing2d") {
    const std::array<double, 3> z = vec3("toViewer"), x = vec3("xDir");
    std::array<double, 4> plane{};
    const QJsonArray c = o["cut"].toArray();
    if (c.size() == 4) plane = {c[0].toDouble(), c[1].toDouble(), c[2].toDouble(), c[3].toDouble()};
    const auto dr = v->drawing2d(z, x, c.size() == 4 ? &plane : nullptr);
    if (!dr.error.empty()) return {{"ok", false}, {"error", QString::fromStdString(dr.error)}};
    auto polys = [](const std::vector<std::vector<std::array<double, 2>>>& ps) {
      QJsonArray a;
      for (const auto& p : ps) {
        QJsonArray flat;
        for (const auto& q : p) flat << std::round(q[0] * 10) / 10 << std::round(q[1] * 10) / 10;
        a.append(flat);
      }
      return a;
    };
    return {{"ok", true}, {"lines", polys(dr.lines)}, {"cut", polys(dr.cut)},
            {"bounds", QJsonArray{dr.bounds[0], dr.bounds[1], dr.bounds[2], dr.bounds[3]}}, {"ms", dr.ms}};
  }
  else if (cmd == "getCamera") {
    const auto c = v->camera();
    const auto u = v->cameraUp();
    return {{"ok", true}, {"eye", QJsonArray{c[0], c[1], c[2]}}, {"at", QJsonArray{c[3], c[4], c[5]}}, {"fov", c[6]}, {"up", QJsonArray{u[0], u[1], u[2]}}, {"lighting", QString::fromStdString(v->lighting())}};
  }
  else if (cmd == "lighting") {
    v->setLighting(o["preset"].toString().toStdString());
    return {{"ok", true}, {"lighting", QString::fromStdString(v->lighting())}};
  }
  else if (cmd == "geomHash") {
    int n = 0;
    double vol = 0;
    const std::string h = v->geometryHash(&n, &vol);
    return {{"ok", true}, {"hash", QString::fromStdString(h)}, {"items", n}, {"volumeM3", vol}};
  }
  else if (cmd == "overrides") {
    // presentation material variation: recolour groups, the geometry is untouched
    std::map<std::string, occt::MaterialOverride> by;
    const QJsonObject g = o["groups"].toObject();
    for (auto it = g.begin(); it != g.end(); ++it) {
      const QJsonObject x = it.value().toObject();
      by[it.key().toStdString()] = {arr3Of(x.value("rgb"), {0.8, 0.8, 0.8}), x.value("mat").toString("matte").toStdString()};
    }
    return {{"ok", true}, {"changed", v->applyOverrides(by)}};
  }
  else if (cmd == "exportGlb") {
    // render snapshot (queued job): written into the render cache under a fresh name, never a page-chosen path
    const QString dir = BlenderWorker::cacheDir() + QStringLiteral("/scenes");
    QDir().mkpath(dir);
    const QString path = dir + QStringLiteral("/scene-%1-%2.glb").arg(QDateTime::currentMSecsSinceEpoch()).arg(QString::number(QRandomGenerator::global()->generate(), 16));
    occt::GlbStats st;
    const std::string err = v->writeGlb(path.toStdString(), o["visibleOnly"].toBool(true), &st);
    if (!err.empty()) return {{"ok", false}, {"error", QString::fromStdString(err)}};
    QJsonObject r = glbStatsJson(st);
    r["ok"] = true, r["path"] = path, r["sha256"] = fileSha256(path);
    return r;
  }
  else if (cmd == "bounds") {
    const auto b = v->bounds(ids("ids"));
    QJsonArray a;
    for (double x : b) a.append(x);
    return {{"ok", true}, {"bounds", a}};
  } else if (cmd == "snapshot") {
    const int w = std::clamp(o["w"].toInt(1920), 64, 8192), h = std::clamp(o["h"].toInt(1080), 64, 8192);
    std::vector<unsigned char> px = v->renderRgba(w, h);
    if (px.empty()) return {{"ok", false}, {"error", "render failed"}};
    QImage img(px.data(), w, h, w * 4, QImage::Format_RGBA8888);
    QByteArray bytes;
    QBuffer buf(&bytes);
    buf.open(QIODevice::WriteOnly);
    img.convertToFormat(QImage::Format_RGB888).save(&buf, "PNG");
    QJsonObject r{{"ok", true}, {"url", QStringLiteral("data:image/png;base64,") + QString::fromLatin1(bytes.toBase64())}, {"w", w}, {"h", h}, {"bytes", static_cast<double>(bytes.size())}};
    if (o["save"].toBool()) {
      // the live 3D frame of a queued render (before / after comparison), kept next to its scene snapshot
      const QString dir = BlenderWorker::cacheDir() + QStringLiteral("/frames");
      QDir().mkpath(dir);
      const QString path = dir + QStringLiteral("/frame-%1-%2.png").arg(QDateTime::currentMSecsSinceEpoch()).arg(QString::number(QRandomGenerator::global()->generate(), 16));
      QFile f(path);
      if (f.open(QIODevice::WriteOnly) && f.write(bytes) == bytes.size()) r["path"] = path;
    }
    return r;
  } else return {{"ok", false}, {"error", "unknown command " + cmd}};
  return {{"ok", true}};
}

QString HostBridge::scene3dPick(const QString& key, int x, int y) {
  auto* v = scene(key);
  return v ? QString::fromStdString(v->pick(x, y)) : QString();
}

double HostBridge::scene3dCommon(const QString& key, const QString& a, const QString& b) {
  auto* v = scene(key);
  return v ? v->commonM3(a.toStdString(), b.toStdString()) : -1;
}

QJsonArray HostBridge::scene3dOverlaps(const QString& key) {
  QJsonArray out;
  auto* v = scene(key);
  if (!v) return out;
  for (const auto& o : v->overlaps()) out.append(QJsonObject{{"a", QString::fromStdString(o.a)}, {"b", QString::fromStdString(o.b)}, {"m3", o.volume}});
  return out;
}

QJsonObject HostBridge::scene3dExportStep(const QString& key, const QString& suggestedName) {
  auto* v = scene(key);
  if (!v) return {{"ok", false}, {"error", "no scene"}};
  QString path = qEnvironmentVariable("THCAD_STEP_OUT");  // QA: skip the dialog
  if (path.isEmpty()) {
    const QString start = QStandardPaths::writableLocation(QStandardPaths::DocumentsLocation) + "/" + suggestedName;
    path = QFileDialog::getSaveFileName(qobject_cast<QWidget*>(parent()), tr("Export STEP"), start, "STEP (*.step *.stp)");
  }
  if (path.isEmpty()) return {{"ok", false}, {"cancelled", true}};
  const std::string err = v->writeStep(path.toStdString());
  if (!err.empty()) return {{"ok", false}, {"error", QString::fromStdString(err)}};
  return {{"ok", true}, {"path", path}, {"bytes", static_cast<double>(QFileInfo(path).size())}};
}

QJsonObject HostBridge::scene3dExportGlb(const QString& key, const QString& suggestedName) {
  auto* v = scene(key);
  if (!v) return {{"ok", false}, {"error", "no scene"}};
  QString path = qEnvironmentVariable("THCAD_GLB_OUT");  // QA: skip the dialog
  if (path.isEmpty()) {
    const QString start = QStandardPaths::writableLocation(QStandardPaths::DocumentsLocation) + "/" + suggestedName;
    path = QFileDialog::getSaveFileName(qobject_cast<QWidget*>(parent()), tr("Export GLB"), start, "glTF binary (*.glb)");
  }
  if (path.isEmpty()) return {{"ok", false}, {"cancelled", true}};
  if (!path.endsWith(QStringLiteral(".glb"), Qt::CaseInsensitive)) path += QStringLiteral(".glb");
  occt::GlbStats st;
  const std::string err = v->writeGlb(path.toStdString(), false, &st);
  if (!err.empty()) return {{"ok", false}, {"error", QString::fromStdString(err)}};
  QJsonObject r = glbStatsJson(st);
  r["ok"] = true, r["path"] = path, r["sha256"] = fileSha256(path);
  return r;
}

QJsonObject HostBridge::renderMemoryCheck(int w, int h, const QString& engine) {
  return memoryCheck(std::clamp(w, 16, 16384), std::clamp(h, 16, 16384), engine == QStringLiteral("blender") ? engine : QStringLiteral("occt"));
}

QJsonObject HostBridge::renderReadSidecar(const QString& imagePath) {
  QString dir = qEnvironmentVariable("THCAD_RENDER_OUT");
  if (dir.isEmpty()) dir = QStandardPaths::writableLocation(QStandardPaths::DocumentsLocation) + QStringLiteral("/MD CAD AI STUDIO/Renders");
  const QFileInfo fi(imagePath);
  const QString side = fi.absolutePath() + "/" + fi.completeBaseName() + QStringLiteral(".provenance.json");
  if (!insideDir(side, dir)) return {{"ok", false}, {"error", "no sidecar"}};
  QFile f(side);
  if (!f.open(QIODevice::ReadOnly)) return {{"ok", false}, {"error", "no sidecar"}};
  return {{"ok", true}, {"path", side}, {"sidecar", QJsonDocument::fromJson(f.readAll()).object()}};
}

QJsonObject HostBridge::renderReadImage(const QString& path, int maxWidth) {
  QString dir = qEnvironmentVariable("THCAD_RENDER_OUT");
  if (dir.isEmpty()) dir = QStandardPaths::writableLocation(QStandardPaths::DocumentsLocation) + QStringLiteral("/MD CAD AI STUDIO/Renders");
  if (!insideDir(path, dir) && !insideDir(path, BlenderWorker::cacheDir())) return {{"ok", false}, {"error", "not a render file"}};
  QImageReader rd(path);
  QImage img = rd.read();
  if (img.isNull()) return {{"ok", false}, {"error", rd.errorString()}};
  if (maxWidth > 0 && img.width() > maxWidth) img = img.scaledToWidth(maxWidth, Qt::SmoothTransformation);
  QByteArray bytes;
  QBuffer buf(&bytes);
  buf.open(QIODevice::WriteOnly);
  img.convertToFormat(QImage::Format_RGB888).save(&buf, "JPG", 90);
  return {{"ok", true}, {"url", QStringLiteral("data:image/jpeg;base64,") + QString::fromLatin1(bytes.toBase64())}, {"w", img.width()}, {"h", img.height()}};
}
namespace {
/** Post-processing on the final image (the same controls as the UI's Post Production panel). */
template <typename T>
void postFx(T* px, int w, int h, const QJsonObject& fx) {
  const double maxv = sizeof(T) == 1 ? 255.0 : 65535.0;
  const double contrast = fx.value("contrast").toDouble(100) / 100, sat = fx.value("saturation").toDouble(100) / 100;
  const double temp = fx.value("temperature").toDouble(0) / 100, vig = fx.value("vignette").toDouble(0) / 100;
  if (contrast == 1 && sat == 1 && temp == 0 && vig == 0) return;
  for (int y = 0; y < h; ++y)
    for (int x = 0; x < w; ++x) {
      T* p = px + (static_cast<size_t>(y) * w + x) * 4;
      double r = p[0] / maxv, g = p[1] / maxv, b = p[2] / maxv;
      const double l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      r = l + (r - l) * sat, g = l + (g - l) * sat, b = l + (b - l) * sat;
      r = (r - 0.5) * contrast + 0.5, g = (g - 0.5) * contrast + 0.5, b = (b - 0.5) * contrast + 0.5;
      r *= 1 + 0.12 * temp, b *= 1 - 0.12 * temp;
      if (vig > 0) {
        const double dx = (x + 0.5) / w - 0.5, dy = (y + 0.5) / h - 0.5;
        const double k = 1 - vig * std::min(1.0, (dx * dx + dy * dy) * 1.6);
        r *= k, g *= k, b *= k;
      }
      p[0] = static_cast<T>(std::lround(std::clamp(r, 0.0, 1.0) * maxv));
      p[1] = static_cast<T>(std::lround(std::clamp(g, 0.0, 1.0) * maxv));
      p[2] = static_cast<T>(std::lround(std::clamp(b, 0.0, 1.0) * maxv));
    }
}

/** Edge-preserving denoise of the path-traced image (bilateral filter, 5 × 5): averages neighbours of
 *  similar colour, so Monte-Carlo grain is smoothed while edges stay sharp. Not an AI denoiser. */
template <typename T>
void denoise(T* px, int w, int h) {
  const double maxv = sizeof(T) == 1 ? 255.0 : 65535.0;
  std::vector<T> src(px, px + static_cast<size_t>(w) * h * 4);
  const double ss = 2 * 1.6 * 1.6, sr = 2 * 0.09 * 0.09;
  double ws[5][5];
  for (int j = -2; j <= 2; ++j)
    for (int i = -2; i <= 2; ++i) ws[j + 2][i + 2] = std::exp(-(i * i + j * j) / ss);
  for (int y = 0; y < h; ++y)
    for (int x = 0; x < w; ++x) {
      const T* c = &src[(static_cast<size_t>(y) * w + x) * 4];
      double acc[3] = {0, 0, 0}, wsum = 0;
      for (int j = -2; j <= 2; ++j) {
        const int yy = std::clamp(y + j, 0, h - 1);
        for (int i = -2; i <= 2; ++i) {
          const int xx = std::clamp(x + i, 0, w - 1);
          const T* q = &src[(static_cast<size_t>(yy) * w + xx) * 4];
          const double dr = (q[0] - c[0]) / maxv, dg = (q[1] - c[1]) / maxv, db = (q[2] - c[2]) / maxv;
          const double wt = ws[j + 2][i + 2] * std::exp(-(dr * dr + dg * dg + db * db) / sr);
          acc[0] += wt * q[0], acc[1] += wt * q[1], acc[2] += wt * q[2], wsum += wt;
        }
      }
      T* o = px + (static_cast<size_t>(y) * w + x) * 4;
      for (int k = 0; k < 3; ++k) o[k] = static_cast<T>(std::lround(acc[k] / wsum));
    }
}

std::array<double, 3> arr3(const QJsonValue& v, std::array<double, 3> def) {
  const QJsonArray a = v.toArray();
  return a.size() == 3 ? std::array<double, 3>{a[0].toDouble(), a[1].toDouble(), a[2].toDouble()} : def;
}

QString previewUrl(const QImage& img, const QJsonObject& fx) {
  QImage small = img.scaledToWidth(std::min(img.width(), 960), Qt::SmoothTransformation).convertToFormat(QImage::Format_RGBA8888);
  postFx(small.bits(), small.width(), small.height(), fx);
  QByteArray bytes;
  QBuffer buf(&bytes);
  buf.open(QIODevice::WriteOnly);
  small.save(&buf, "JPG", 88);
  return QStringLiteral("data:image/jpeg;base64,") + QString::fromLatin1(bytes.toBase64());
}

QString previewUrl(std::vector<unsigned char> rgba, int w, int h, const QJsonObject& fx) {
  return previewUrl(QImage(rgba.data(), w, h, w * 4, QImage::Format_RGBA8888), fx);
}
}  // namespace

namespace {
occt::RenderParams paramsOf(const QJsonObject& pj) {
  occt::RenderParams p;
  p.w = std::clamp(pj.value("w").toInt(1920), 16, 8192);
  p.h = std::clamp(pj.value("h").toInt(1080), 16, 8192);
  p.samples = std::clamp(pj.value("samples").toInt(64), 1, 16384);
  p.bounces = pj.value("bounces").toInt(4);
  p.engine = pj.value("engine").toString("path").toStdString();
  p.exposure = pj.value("exposure").toDouble(0);
  p.sun = pj.value("sun").toBool(true);
  p.sunIntensity = pj.value("sunIntensity").toDouble(1.2);
  p.sunAzimuthDeg = pj.value("sunAzimuth").toDouble(320);
  p.sunElevationDeg = pj.value("sunElevation").toDouble(40);
  p.sky = pj.value("sky").toString("clear").toStdString();
  if (pj.contains("camera")) {
    const QJsonObject c = pj.value("camera").toObject();
    p.hasCamera = true;
    p.eye = arr3(c.value("eye"), {0, 0, 0});
    p.at = arr3(c.value("at"), {0, 0, 0});
    p.fovDeg = c.value("fov").toDouble(55);
  }
  return p;
}

void applyCamera(occt::RenderParams& p, const QJsonObject& c) {
  p.hasCamera = true;
  p.eye = arr3(c.value("eye"), p.eye);
  p.at = arr3(c.value("at"), p.at);
  p.up = arr3(c.value("up"), {0, 0, 1});
  p.fovDeg = c.value("fov").toDouble(p.fovDeg);
}

/** Cube faces of a panorama at `eye`: +X −X +Y −Y +Z −Z (forward, up). */
const double kFaces[6][6] = {{1, 0, 0, 0, 0, 1}, {-1, 0, 0, 0, 0, 1}, {0, 1, 0, 0, 0, 1}, {0, -1, 0, 0, 0, 1}, {0, 0, 1, 0, -1, 0}, {0, 0, -1, 0, 1, 0}};

/** Equirectangular 2N × N image from the six faces; longitude 0 looks along `yaw` (radians from +X). */
QImage stitchEquirect(const QList<QImage>& f, double yaw) {
  const int N = f[0].width();
  QImage out(2 * N, N, QImage::Format_RGB888);
  double R[6][3];
  for (int k = 0; k < 6; ++k) {
    const double* F = kFaces[k];
    const double* U = kFaces[k] + 3;
    R[k][0] = F[1] * U[2] - F[2] * U[1], R[k][1] = F[2] * U[0] - F[0] * U[2], R[k][2] = F[0] * U[1] - F[1] * U[0];
  }
  for (int y = 0; y < N; ++y) {
    const double lat = M_PI / 2 - (y + 0.5) / N * M_PI;
    uchar* row = out.scanLine(y);
    for (int x = 0; x < 2 * N; ++x) {
      const double a = yaw - ((x + 0.5) / (2.0 * N) * 2 * M_PI - M_PI);
      const double d[3] = {std::cos(lat) * std::cos(a), std::cos(lat) * std::sin(a), std::sin(lat)};
      int k = 0;
      double best = -2;
      for (int i = 0; i < 6; ++i) {
        const double dot = d[0] * kFaces[i][0] + d[1] * kFaces[i][1] + d[2] * kFaces[i][2];
        if (dot > best) best = dot, k = i;
      }
      const double* U = kFaces[k] + 3;
      const double u = (d[0] * R[k][0] + d[1] * R[k][1] + d[2] * R[k][2]) / best, v = (d[0] * U[0] + d[1] * U[1] + d[2] * U[2]) / best;
      const double px = std::clamp((u + 1) / 2 * N - 0.5, 0.0, N - 1.0), py = std::clamp((1 - v) / 2 * N - 0.5, 0.0, N - 1.0);
      const int x0 = int(px), y0 = int(py), x1 = std::min(x0 + 1, N - 1), y1 = std::min(y0 + 1, N - 1);
      const double fx = px - x0, fy = py - y0;
      const QImage& src = f[k];
      const uchar *a0 = src.constScanLine(y0), *a1 = src.constScanLine(y1);
      for (int c = 0; c < 3; ++c) {
        const double top = a0[4 * x0 + c] * (1 - fx) + a0[4 * x1 + c] * fx, bot = a1[4 * x0 + c] * (1 - fx) + a1[4 * x1 + c] * fx;
        row[3 * x + c] = uchar(std::lround(top * (1 - fy) + bot * fy));
      }
    }
  }
  return out;
}

/** JPEG with GPano XMP (equirectangular) so photo apps open it in their 360° viewer. */
bool saveEquirect(const QImage& img, const QString& path) {
  QByteArray jpg;
  QBuffer buf(&jpg);
  buf.open(QIODevice::WriteOnly);
  if (!img.save(&buf, "JPG", 92) || jpg.size() < 4) return false;
  const QByteArray xmp = QStringLiteral(
      "http://ns.adobe.com/xap/1.0/%1<x:xmpmeta xmlns:x=\"adobe:ns:meta/\"><rdf:RDF xmlns:rdf=\"http://www.w3.org/1999/02/22-rdf-syntax-ns#\">"
      "<rdf:Description rdf:about=\"\" xmlns:GPano=\"http://ns.google.com/photos/1.0/panorama/\" GPano:ProjectionType=\"equirectangular\" GPano:UsePanoramaViewer=\"True\" "
      "GPano:FullPanoWidthPixels=\"%2\" GPano:FullPanoHeightPixels=\"%3\" GPano:CroppedAreaImageWidthPixels=\"%2\" GPano:CroppedAreaImageHeightPixels=\"%3\" "
      "GPano:CroppedAreaLeftPixels=\"0\" GPano:CroppedAreaTopPixels=\"0\"/></rdf:RDF></x:xmpmeta>")
                             .arg(QChar(0)).arg(img.width()).arg(img.height()).toUtf8();
  QByteArray seg("\xFF\xE1", 2);
  const int len = xmp.size() + 2;
  seg.append(char((len >> 8) & 0xff)).append(char(len & 0xff)).append(xmp);
  // after SOI and the JFIF APP0 segment
  int at = 2;
  if (uchar(jpg[2]) == 0xFF && uchar(jpg[3]) == 0xE0) at = 4 + ((uchar(jpg[4]) << 8) | uchar(jpg[5]));
  jpg.insert(at, seg);
  QFile f(path);
  return f.open(QIODevice::WriteOnly) && f.write(jpg) == jpg.size();
}

QString renderDir() {
  QString dir = qEnvironmentVariable("THCAD_RENDER_OUT");  // QA
  if (dir.isEmpty()) dir = QStandardPaths::writableLocation(QStandardPaths::DocumentsLocation) + QStringLiteral("/MD CAD AI STUDIO/Renders");
  QDir().mkpath(dir);
  return dir;
}
QString renderBase(const QJsonObject& job, const QString& ext) {
  QString base = job.value("name").toString(QStringLiteral("Render"));
  base.replace(QRegularExpression(QStringLiteral("[\\\\/:*?\"<>|]")), QStringLiteral("-"));
  const QString dir = renderDir();
  QString path = dir + "/" + base;
  for (int n = 2; QFileInfo::exists(path + ext); ++n) path = dir + "/" + base + QStringLiteral(" (%1)").arg(n);
  return path;
}

const char* kPresentationLabel = "PRESENTATION ONLY - not for dimensions, BOM, quantities or CNC (MD CAD AI STUDIO)";

/** Provenance sidecar next to a finished render (`<image base>.provenance.json`): what was rendered (scene id
 *  and revision captured when the job was queued, camera, settings) and that it is presentation only. */
QString writeProvenance(const QString& imagePath, const QJsonObject& job, const QJsonObject& engine, int w, int h, double ms) {
  const QFileInfo fi(imagePath);
  const QString side = fi.absolutePath() + "/" + fi.completeBaseName() + QStringLiteral(".provenance.json");
  QJsonObject p = job.value("provenance").toObject();
  p["schema"] = QStringLiteral("md-cad-ai-studio/render-provenance@1");
  p["presentationOnly"] = true;
  p["feedsBom"] = false;
  p["feedsCnc"] = false;
  p["label"] = QString::fromLatin1(kPresentationLabel);
  p["labelVi"] = QStringLiteral("CHỈ ĐỂ TRÌNH BÀY - không dùng cho kích thước, BOM, khối lượng hay CNC");
  p["image"] = QJsonObject{{"file", fi.fileName()}, {"sha256", fileSha256(imagePath)}, {"bytes", static_cast<double>(fi.size())}, {"w", w}, {"h", h}, {"format", job.value("format").toString("png")}};
  p["engine"] = engine;
  p["job"] = QJsonObject{{"id", job.value("id")}, {"name", job.value("name")}, {"kind", job.value("kind").toString("still")}};
  p["params"] = job.value("params").toObject();
  p["renderedAt"] = QDateTime::currentDateTimeUtc().toString(Qt::ISODate);
  p["ms"] = ms;
  QFile f(side);
  if (!f.open(QIODevice::WriteOnly) || f.write(QJsonDocument(p).toJson()) <= 0) return {};
  return side;
}
}  // namespace

QJsonObject HostBridge::renderStart(const QString& jobJson) {
  if (rendering_) return {{"ok", false}, {"error", "busy"}};
  const QJsonObject job = QJsonDocument::fromJson(jobJson.toUtf8()).object();
  const QString fmt = job.value("format").toString("png");
  if (fmt == "exr") return {{"ok", false}, {"error", "OpenEXR output is not included in this build (choose PNG 16-bit for high bit depth)"}};
  if (fmt == "tiff" && !QImageWriter::supportedImageFormats().contains("tiff")) return {{"ok", false}, {"error", "TIFF writer not available in this build"}};
  const bool useBlender = job.value("engine").toString() == QStringLiteral("blender");
  {
    // memory pre-check (SP44): refuse cleanly before allocating anything; the project is never touched
    const QJsonObject p0 = job.value("params").toObject();
    int mw = std::clamp(p0.value("w").toInt(1920), 16, 8192), mh = std::clamp(p0.value("h").toInt(1080), 16, 8192);
    if (job.value("kind").toString() == QStringLiteral("panorama")) mw = mh = std::clamp(p0.value("face").toInt(1024), 64, 4096);
    const QJsonObject mc = memoryCheck(mw, mh, useBlender ? QStringLiteral("blender") : QStringLiteral("occt"));
    if (!mc.value("ok").toBool())
      return {{"ok", false}, {"code", "memory"}, {"error", mc.value("reason")}, {"needBytes", mc.value("needBytes")}, {"budgetBytes", mc.value("budgetBytes")}};
  }
  if (useBlender) return renderStartBlender(job);
  if (!renderer_) renderer_ = std::make_unique<occt::SceneView>(true);
  if (!renderer_->ok()) return {{"ok", false}, {"error", "OpenGL unavailable"}};
  const QJsonObject sc = job.value("scene").toObject();
  auto parsed = json::parse(QJsonDocument(sc).toJson(QJsonDocument::Compact).toStdString());
  if (auto* e = std::get_if<json::ParseError>(&parsed)) return {{"ok", false}, {"error", QString::fromStdString(e->message)}};
  int failures = renderer_->setItems(occt::sceneFromJson(std::get<json::Value>(parsed)));
  if (sc.contains("bimModel")) {
    // exterior views queued with a snapshot of the BIM model (captured when the job was queued)
    auto pm = json::parse(QJsonDocument(sc.value("bimModel").toObject()).toJson(QJsonDocument::Compact).toStdString());
    if (auto* e = std::get_if<json::ParseError>(&pm)) return {{"ok", false}, {"error", QString::fromStdString(e->message)}};
    std::string err;
    auto m = bim::modelFromJson(std::get<json::Value>(pm), bim::villaRiverside(), &err);
    if (!m) return {{"ok", false}, {"error", QString::fromStdString(err)}};
    renderer_->addBuilding(*m, sc.value("ground").toBool(true));
  } else if (sc.value("bim").toBool()) {
    // exterior views: the BIM building held by the host (the same model the BIM workspace edits)
    renderer_->addBuilding(bim_, sc.value("ground").toBool(true));
  }
  if (sc.contains("overrides")) {
    std::map<std::string, occt::MaterialOverride> by;
    const QJsonObject g = sc.value("overrides").toObject();
    for (auto it = g.begin(); it != g.end(); ++it) {
      const QJsonObject x = it.value().toObject();
      by[it.key().toStdString()] = {arr3Of(x.value("rgb"), {0.8, 0.8, 0.8}), x.value("mat").toString("matte").toStdString()};
    }
    renderer_->applyOverrides(by);
  }
  const QJsonObject pj = job.value("params").toObject();
  occt::RenderParams p = paramsOf(pj);
  // panorama: six square 90° cube faces from the camera position; video: one render per frame camera
  const QString kind = job.value("kind").toString(QStringLiteral("still"));
  seq_ = {};
  seqIndex_ = 0;
  seqImages_.clear();
  video_.reset();
  if (kind == "panorama") {
    const int n = std::clamp(pj.value("face").toInt(1024), 64, 4096);
    p.w = p.h = n;
    for (const auto& f : kFaces) {
      const QJsonArray eye{p.eye[0], p.eye[1], p.eye[2]};
      seq_.append(QJsonObject{{"eye", eye}, {"at", QJsonArray{p.eye[0] + f[0] * 1000, p.eye[1] + f[1] * 1000, p.eye[2] + f[2] * 1000}}, {"up", QJsonArray{f[3], f[4], f[5]}}, {"fov", 90}});
    }
  } else if (kind == "video") {
    seq_ = pj.value("frames").toArray();
    if (seq_.isEmpty()) return {{"ok", false}, {"error", "a video needs at least one frame"}};
    p.w &= ~1, p.h &= ~1;
    video_ = std::make_unique<VideoWriter>();
    if (!video_->open(renderBase(job, ".mp4"), p.w, p.h, std::clamp(pj.value("fps").toInt(24), 1, 60))) return {{"ok", false}, {"error", video_->error()}};
  }
  if (!seq_.isEmpty()) applyCamera(p, seq_.at(0).toObject());
  const std::string err = renderer_->beginRender(p);
  if (!err.empty()) return {{"ok", false}, {"error", QString::fromStdString(err)}};
  renderJob_ = job;
  rendering_ = true;
  renderStartMs_ = QDateTime::currentMSecsSinceEpoch();
  renderPreviewMs_ = 0;
  QTimer::singleShot(0, this, &HostBridge::renderTick);
  return {{"ok", true}, {"failures", failures}, {"w", p.w}, {"h", p.h}, {"samples", p.samples}};
}

void HostBridge::renderCancel(const QString& id) {
  if (!rendering_ || renderJob_.value("id").toString() != id) return;
  // Blender: kill the worker process; the result (cancelled, partial output deleted) arrives on blenderDone
  if (blender_->running() && blender_->jobId() == id) return blender_->cancel();
  renderFinish(false, QStringLiteral("cancelled"));
}

QJsonObject HostBridge::renderStartBlender(const QJsonObject& job) {
  const QJsonObject b = job.value("blender").toObject();
  const QString glb = b.value("glb").toString();
  if (!insideDir(glb, BlenderWorker::cacheDir())) return {{"ok", false}, {"error", "the scene snapshot of this job is missing — queue the render again"}};
  if (job.value("kind").toString(QStringLiteral("still")) != QStringLiteral("still")) return {{"ok", false}, {"error", "Blender renders still images; panoramas and videos use the OCCT path tracer"}};
  const QJsonObject pj = job.value("params").toObject();
  const QJsonObject cam = b.contains("camera") ? b.value("camera").toObject() : pj.value("camera").toObject();
  QString device = qEnvironmentVariable("THCAD_BLENDER_DEVICE");
  if (device.isEmpty()) device = b.value("device").toString(QStringLiteral("auto"));
  const QJsonObject spec{{"glb", QFileInfo(glb).canonicalFilePath()},
                         {"w", std::clamp(pj.value("w").toInt(1920), 16, 8192)},
                         {"h", std::clamp(pj.value("h").toInt(1080), 16, 8192)},
                         {"samples", std::clamp(pj.value("samples").toInt(64), 1, 16384)},
                         {"bounces", std::clamp(pj.value("bounces").toInt(8), 1, 64)},
                         {"denoise", job.value("denoise").toBool(true)},
                         {"exposure", pj.value("exposure").toDouble(0)},
                         {"camera", cam},
                         {"lighting", b.value("lighting").toString(QStringLiteral("day"))},
                         {"sun", QJsonObject{{"on", pj.value("sun").toBool(true)}, {"azimuth", pj.value("sunAzimuth").toDouble(320)}, {"elevation", pj.value("sunElevation").toDouble(40)}, {"intensity", pj.value("sunIntensity").toDouble(1.2)}}},
                         {"overrides", b.value("overrides").toObject()},
                         {"ground", b.value("ground").toBool(false)},
                         {"depth16", job.value("format").toString() == QStringLiteral("png16")},
                         {"device", device}};
  const QString err = blender_->start(job.value("id").toString(), spec);
  if (!err.isEmpty()) return {{"ok", false}, {"error", err == QStringLiteral("blender-not-found") ? QStringLiteral("Blender is not installed — use the OCCT path tracer") : err}, {"code", err}};
  renderJob_ = job;
  rendering_ = true;
  renderStartMs_ = QDateTime::currentMSecsSinceEpoch();
  return {{"ok", true}, {"engine", "blender"}, {"w", spec.value("w")}, {"h", spec.value("h")}, {"samples", spec.value("samples")}, {"sandbox", BlenderWorker::probe().value("sandbox")}};
}

void HostBridge::blenderDone(const QJsonObject& r) {
  const QJsonObject job = renderJob_;
  rendering_ = false;
  renderJob_ = {};
  QJsonObject res{{"id", r.value("id")}, {"done", true}, {"engine", "blender"}, {"samples", r.value("samples")}, {"ms", r.value("ms")}, {"device", r.value("device")}, {"blender", r.value("blender")}};
  auto fail = [&](const QString& e) {
    res["ok"] = false;
    res["error"] = e;
    if (e != QStringLiteral("cancelled")) res["log"] = r.value("log").toString().right(1500);
    blender_->cleanup();
    emit renderProgress(res);
  };
  if (!r.value("ok").toBool()) return fail(r.value("error").toString());
  const QString fmt = job.value("format").toString(QStringLiteral("png"));
  const QJsonObject fx = job.value("fx").toObject();
  QImage img(r.value("output").toString());
  if (img.isNull()) return fail(QStringLiteral("could not read the image Blender wrote"));
  const int w = img.width(), h = img.height();
  QImage out;
  if (fmt == QStringLiteral("png16")) {
    out = img.convertToFormat(QImage::Format_RGBA64);
    postFx(reinterpret_cast<uint16_t*>(out.bits()), w, h, fx);
  } else {
    QImage rgba = img.convertToFormat(QImage::Format_RGBA8888);
    postFx(rgba.bits(), w, h, fx);
    out = rgba.convertToFormat(QImage::Format_RGB888);
  }
  res["preview"] = previewUrl(out.convertToFormat(QImage::Format_RGBA8888), {});
  const double dpm = job.value("dpi").toDouble(300) / 0.0254;
  out.setDotsPerMeterX(static_cast<int>(std::lround(dpm)));
  out.setDotsPerMeterY(static_cast<int>(std::lround(dpm)));
  out.setText(QStringLiteral("Comment"), QString::fromLatin1(kPresentationLabel));
  out.setText(QStringLiteral("Software"), QStringLiteral("MD CAD AI STUDIO + Blender ") + r.value("blender").toString());
  const QString ext = fmt == QStringLiteral("jpg") ? QStringLiteral("jpg") : fmt == QStringLiteral("tiff") ? QStringLiteral("tiff") : QStringLiteral("png");
  const QString path = renderBase(job, "." + ext) + "." + ext;
  QImageWriter wr(path);
  if (fmt == QStringLiteral("jpg")) wr.setQuality(95);
  if (!wr.write(out)) return fail(wr.errorString());
  res["ok"] = true;
  res["path"] = path;
  res["bytes"] = static_cast<double>(QFileInfo(path).size());
  res["w"] = w, res["h"] = h;
  const QJsonObject engine{{"name", "blender-cycles"}, {"blender", r.value("blender")}, {"device", r.value("device")}, {"path", BlenderWorker::probe().value("path")},
                           {"process", "external (QProcess)"}, {"offline", true}, {"sandboxNetworkDenied", BlenderWorker::probe().value("sandbox")}};
  res["sidecar"] = writeProvenance(path, job, engine, w, h, r.value("ms").toDouble());
  blender_->cleanup();
  emit renderProgress(res);
}

void HostBridge::renderTick() {
  if (!rendering_) return;
  const QJsonObject pj = renderJob_.value("params").toObject();
  const int total = pj.value("engine").toString() == "raytrace" ? std::min(pj.value("samples").toInt(64), 16) : pj.value("samples").toInt(64);
  // short slices (at least one pass) with idle gaps keep the UI — same thread as the GL context — responsive
  const int done = renderer_->renderPasses(25);
  const qint64 now = QDateTime::currentMSecsSinceEpoch();
  const int views = std::max<int>(1, static_cast<int>(seq_.size()));
  QJsonObject prog{{"id", renderJob_.value("id")}, {"samples", seqIndex_ * total + done}, {"total", total * views}, {"ms", static_cast<double>(now - renderStartMs_)}};
  if (views > 1) prog["view"] = seqIndex_ + 1, prog["views"] = views;
  if (done >= total) return renderFinish(true, {});
  if (now - renderPreviewMs_ > 1500) {
    renderPreviewMs_ = now;
    const occt::RenderParams cur = paramsOf(pj);
    const bool square = renderJob_.value("kind").toString() == "panorama";
    prog["preview"] = previewUrl(renderer_->renderedImage(false), square ? std::clamp(pj.value("face").toInt(1024), 64, 4096) : (cur.w & (seq_.isEmpty() ? ~0 : ~1)), square ? std::clamp(pj.value("face").toInt(1024), 64, 4096) : (cur.h & (seq_.isEmpty() ? ~0 : ~1)), renderJob_.value("fx").toObject());
  }
  emit renderProgress(prog);
  QTimer::singleShot(20, this, &HostBridge::renderTick);
}

void HostBridge::renderFinish(bool ok, const QString& error) {
  const QJsonObject job = renderJob_;
  const QJsonObject pj = job.value("params").toObject();
  const int w = std::clamp(pj.value("w").toInt(1920), 16, 8192), h = std::clamp(pj.value("h").toInt(1080), 16, 8192);
  QJsonObject res{{"id", job.value("id")}, {"done", true}, {"samples", renderer_->renderedSamples()}, {"ms", static_cast<double>(QDateTime::currentMSecsSinceEpoch() - renderStartMs_)}};
  if (!seq_.isEmpty()) {
    // panorama / video: keep this view, render the next one, assemble after the last
    const bool pano = job.value("kind").toString() == "panorama";
    const int fw = pano ? std::clamp(pj.value("face").toInt(1024), 64, 4096) : (w & ~1), fh = pano ? fw : (h & ~1);
    if (ok) {
      std::vector<unsigned char> px = renderer_->renderedImage(false);
      if (px.empty()) ok = false, res["error"] = QStringLiteral("could not read the rendered image back");
      else {
        if (job.value("denoise").toBool(false)) denoise(px.data(), fw, fh);
        postFx(px.data(), fw, fh, job.value("fx").toObject());
        const QImage frame = QImage(px.data(), fw, fh, fw * 4, QImage::Format_RGBA8888).copy();
        if (pano) seqImages_.push_back(frame);
        else {
          seqImages_ = {frame};  // the last frame previews the video
          if (!video_->add(frame)) ok = false, res["error"] = QStringLiteral("the video encoder rejected a frame");
        }
        if (ok && ++seqIndex_ < seq_.size()) {
          renderer_->endRender();
          occt::RenderParams p = paramsOf(pj);
          if (pano) p.w = p.h = fw;
          else p.w = fw, p.h = fh;
          applyCamera(p, seq_.at(seqIndex_).toObject());
          const std::string err = renderer_->beginRender(p);
          if (err.empty()) {
            emit renderProgress(QJsonObject{{"id", job.value("id")}, {"samples", seqIndex_ * p.samples}, {"total", p.samples * static_cast<int>(seq_.size())}, {"view", seqIndex_ + 1}, {"views", static_cast<int>(seq_.size())}, {"ms", static_cast<double>(QDateTime::currentMSecsSinceEpoch() - renderStartMs_)}, {"preview", previewUrl(frame, {})}});
            QTimer::singleShot(0, this, &HostBridge::renderTick);
            return;
          }
          ok = false, res["error"] = QString::fromStdString(err);
        }
      }
    }
    if (ok && pano) {
      // longitude 0 of the panorama looks where the camera looked
      const occt::RenderParams base = paramsOf(pj);
      const double yaw = std::atan2(base.at[1] - base.eye[1], base.at[0] - base.eye[0]);
      const QImage eq = stitchEquirect(seqImages_, yaw);
      const QString path = renderBase(job, ".jpg") + ".jpg";
      if (!saveEquirect(eq, path)) ok = false, res["error"] = QStringLiteral("could not write ") + path;
      else res["path"] = path, res["bytes"] = static_cast<double>(QFileInfo(path).size()), res["preview"] = previewUrl(eq.convertToFormat(QImage::Format_RGBA8888), {}), res["w"] = eq.width(), res["h"] = eq.height();
    } else if (video_) {
      const bool closed = video_->close();
      if (ok && closed) res["path"] = video_->path(), res["bytes"] = static_cast<double>(QFileInfo(video_->path()).size()), res["codec"] = video_->codec(), res["frames"] = static_cast<int>(seq_.size());
      else if (ok) ok = false, res["error"] = QStringLiteral("could not finish the video: ") + video_->error();
      if (!ok) QFile::remove(video_->path());  // no half-written videos left behind
      if (!seqImages_.isEmpty()) res["preview"] = previewUrl(seqImages_.back(), {});
    }
    seq_ = {};
    seqImages_.clear();
    video_.reset();
    if (!ok && !res.contains("error")) res["error"] = error;
    res["ok"] = ok;
    renderer_->endRender();
    rendering_ = false;
    renderJob_ = {};
    emit renderProgress(res);
    return;
  }
  if (ok) {
    const QString fmt = job.value("format").toString("png");
    const QJsonObject fx = job.value("fx").toObject();
    const bool sixteen = fmt == "png16";
    std::vector<unsigned char> px = renderer_->renderedImage(sixteen);
    const bool dn = job.value("denoise").toBool(false);
    QString path;
    if (px.empty()) ok = false, res["error"] = QStringLiteral("could not read the rendered image back");
    else {
      QImage img;
      if (sixteen) {
        auto* p16 = reinterpret_cast<uint16_t*>(px.data());
        if (dn) denoise(p16, w, h);
        postFx(p16, w, h, fx);
        img = QImage(px.data(), w, h, w * 8, QImage::Format_RGBA64).copy();
        res["preview"] = previewUrl(img.convertToFormat(QImage::Format_RGBA8888), {});
      } else {
        if (dn) denoise(px.data(), w, h);
        postFx(px.data(), w, h, fx);
        img = QImage(px.data(), w, h, w * 4, QImage::Format_RGBA8888).convertToFormat(QImage::Format_RGB888);
        res["preview"] = previewUrl(QImage(px.data(), w, h, w * 4, QImage::Format_RGBA8888), {});
      }
      res["denoised"] = dn;
      if (!job.value("save").toBool(true)) {
        res["ok"] = true;  // self-test: image produced and read back, nothing written
        renderer_->endRender();
        rendering_ = false;
        renderJob_ = {};
        emit renderProgress(res);
        return;
      }
      const double dpm = job.value("dpi").toDouble(300) / 0.0254;
      img.setDotsPerMeterX(static_cast<int>(std::lround(dpm)));
      img.setDotsPerMeterY(static_cast<int>(std::lround(dpm)));
      QString dir = qEnvironmentVariable("THCAD_RENDER_OUT");  // QA
      if (dir.isEmpty()) dir = QStandardPaths::writableLocation(QStandardPaths::DocumentsLocation) + QStringLiteral("/MD CAD AI STUDIO/Renders");
      QDir().mkpath(dir);
      QString base = job.value("name").toString(QStringLiteral("Render"));
      base.replace(QRegularExpression(QStringLiteral("[\\\\/:*?\"<>|]")), QStringLiteral("-"));
      const QString ext = fmt == "jpg" ? QStringLiteral("jpg") : fmt == "tiff" ? QStringLiteral("tiff") : QStringLiteral("png");
      path = dir + "/" + base + "." + ext;
      for (int n = 2; QFileInfo::exists(path); ++n) path = dir + "/" + base + QStringLiteral(" (%1).").arg(n) + ext;
      QImageWriter wr(path);
      if (fmt == "jpg") wr.setQuality(95);
      img.setText(QStringLiteral("Comment"), QString::fromLatin1(kPresentationLabel));
      if (!wr.write(img)) ok = false, res["error"] = wr.errorString();
      else {
        res["path"] = path, res["bytes"] = static_cast<double>(QFileInfo(path).size());
        if (job.contains("provenance"))
          res["sidecar"] = writeProvenance(path, job, QJsonObject{{"name", "occt-path-tracing"}, {"occt", QString::fromStdString(occt::version())}, {"process", "in-app (GUI thread, 25 ms slices)"}, {"offline", true}}, w, h, static_cast<double>(QDateTime::currentMSecsSinceEpoch() - renderStartMs_));
      }
    }
  } else {
    res["error"] = error;
  }
  res["ok"] = ok;
  renderer_->endRender();
  rendering_ = false;
  renderJob_ = {};
  emit renderProgress(res);
}

#else
QJsonObject HostBridge::scene3dLoad(const QString&, const QString&) { return {{"ok", false}}; }
QJsonObject HostBridge::scene3dFrame(const QString&, int, int, const QString&, const QString&, const QString&) { return {{"ok", false}}; }
void HostBridge::scene3dCamera(const QString&, const QString&, double, double, double) {}
QJsonObject HostBridge::scene3dCommand(const QString&, const QString&) { return {{"ok", false}}; }
QJsonObject HostBridge::scene3dLoadBim(const QString&, const QString&, const QString&) { return {{"ok", false}}; }
QJsonObject HostBridge::scene3dPatch(const QString&, const QString&, const QString&) { return {{"ok", false}, {"error", "no 3D engine in this build"}}; }
QString HostBridge::scene3dPick(const QString&, int, int) { return {}; }
double HostBridge::scene3dCommon(const QString&, const QString&, const QString&) { return -1; }
QJsonArray HostBridge::scene3dOverlaps(const QString&) { return {}; }
QJsonObject HostBridge::renderStart(const QString&) { return {{"ok", false}, {"error", "no 3D engine in this build"}}; }
void HostBridge::renderCancel(const QString&) {}
QJsonObject HostBridge::scene3dExportGlb(const QString&, const QString&) { return {{"ok", false}, {"error", "no 3D engine in this build"}}; }
QJsonObject HostBridge::renderMemoryCheck(int, int, const QString&) { return {{"ok", true}}; }
QJsonObject HostBridge::renderReadImage(const QString&, int) { return {{"ok", false}}; }
QJsonObject HostBridge::renderReadSidecar(const QString&) { return {{"ok", false}}; }
QJsonObject HostBridge::renderStartBlender(const QJsonObject&) { return {{"ok", false}}; }
void HostBridge::blenderDone(const QJsonObject&) {}
void HostBridge::renderTick() {}
void HostBridge::renderFinish(bool, const QString&) {}
QJsonObject HostBridge::scene3dExportStep(const QString&, const QString&) { return {{"ok", false}}; }
QJsonObject HostBridge::bim3dLoad(const QString&) { return {{"ok", false}}; }
QJsonObject HostBridge::bim3dFrame(int, int, const QString&, const QString&) { return {{"ok", false}}; }
void HostBridge::bim3dCamera(const QString&, double, double, double, double) {}
#endif

QJsonObject HostBridge::systemInfo() const {
  namespace fs = std::filesystem;
  const fs::path dir = ai::modelsDir();
  const ai::RuntimeStatus st = runtime_->status();
  QJsonArray models;
  qint64 modelBytes = 0;
  for (const std::string& first : ai::listModels()) {
    // split GGUF: count every shard of this model
    const QFileInfo fi(QString::fromStdString(first));
    QString stem = fi.completeBaseName();  // without .gguf
    if (const int at = stem.indexOf(QStringLiteral("-00001-of-")); at > 0) stem = stem.left(at);
    qint64 bytes = 0;
    for (const QFileInfo& f : QDir(fi.absolutePath()).entryInfoList({stem + QStringLiteral("*.gguf")}, QDir::Files)) bytes += f.size();
    modelBytes += bytes;
    models.append(QJsonObject{{"name", stem}, {"path", fi.absoluteFilePath()}, {"bytes", static_cast<double>(bytes)},
                              {"active", first == st.modelPath}});
  }
  const QString d = QString::fromStdString(dir.string());
  QStorageInfo vol(QDir(d).exists() ? d : QDir::homePath());
  return {
      {"modelsDir", d},
      {"models", models},
      {"modelBytes", static_cast<double>(modelBytes)},
      {"disk", QJsonObject{{"total", static_cast<double>(vol.bytesTotal())}, {"free", static_cast<double>(vol.bytesAvailable())}}},
      {"home", QDir::homePath()},
      {"documents", QStandardPaths::writableLocation(QStandardPaths::DocumentsLocation)},
      {"aiGpu", qEnvironmentVariable("THCAD_AI_GPU") != QStringLiteral("0")},
      {"backend", QString::fromStdString(st.backend)},
      {"dwgReader", DwgReader::version()},
  };
}

QJsonObject HostBridge::blenderInfo(bool refresh) { return BlenderWorker::probe(refresh); }

QJsonObject HostBridge::setModelsDir(const QString& dir) {
  if (!QDir(dir).exists()) return {{"ok", false}, {"error", "folder not found"}};
  qputenv("THCAD_MODELS_DIR", dir.toUtf8());
  const std::string model = ai::discoverModel();
  const bool loaded = !model.empty() && runtime_->load(model);
  return {{"ok", true}, {"model", QString::fromStdString(model)}, {"loaded", loaded}};
}

bool HostBridge::setAiGpu(bool on) {
  qputenv("THCAD_AI_GPU", on ? "1" : "0");
  const std::string path = runtime_->status().modelPath;
  return path.empty() || runtime_->load(path);
}

bool HostBridge::revealFolder(const QString& path) {
  return QDir(path).exists() && QDesktopServices::openUrl(QUrl::fromLocalFile(path));
}

QString HostBridge::pickFolder(const QString& title, const QString& start) {
  QString dir = qEnvironmentVariable("THCAD_PICK_DIR");  // QA: skip the dialog
  if (dir.isEmpty()) dir = QFileDialog::getExistingDirectory(qobject_cast<QWidget*>(parent()), title, start.isEmpty() ? QDir::homePath() : start);
  if (const QString c = QDir(dir).canonicalPath(); !dir.isEmpty() && !c.isEmpty() && !pickedDirs_.contains(c)) pickedDirs_ << c;
  return dir;
}

QJsonObject HostBridge::dwgWrite(const QString& script, const QString& suggestedName) {
  if (DwgReader::writerPath().isEmpty()) return {{"ok", false}, {"error", "no-writer"}};
  QString path = qEnvironmentVariable("THCAD_DWG_OUT");  // QA: skip the dialog
  if (path.isEmpty() && qEnvironmentVariableIntValue("THCAD_SELFTEST") == 1) path = QDir::tempPath() + "/thcad-selftest.dwg";
  if (path.isEmpty()) {
    const QString start = QStandardPaths::writableLocation(QStandardPaths::DocumentsLocation) + "/" + suggestedName;
    path = QFileDialog::getSaveFileName(qobject_cast<QWidget*>(parent()), tr("Save as DWG"), start, "AutoCAD DWG (*.dwg)");
  }
  if (path.isEmpty()) return {{"ok", false}, {"cancelled", true}};
  if (!path.endsWith(".dwg", Qt::CaseInsensitive)) path += ".dwg";
  return DwgReader::write(script, path);
}

QJsonObject HostBridge::dwgWriteDxf(const QString& dxf, const QString& suggestedName) {
  if (DwgReader::dxfWriterPath().isEmpty()) return {{"ok", false}, {"error", "no-writer"}};
  QString path = qEnvironmentVariable("THCAD_DWG_OUT");  // QA: skip the dialog
  if (path.isEmpty()) {
    const QString start = QStandardPaths::writableLocation(QStandardPaths::DocumentsLocation) + "/" + suggestedName;
    path = QFileDialog::getSaveFileName(qobject_cast<QWidget*>(parent()), tr("Save as DWG"), start, "AutoCAD DWG (*.dwg)");
  }
  if (path.isEmpty()) return {{"ok", false}, {"cancelled", true}};
  if (!path.endsWith(".dwg", Qt::CaseInsensitive)) path += ".dwg";
  return DwgReader::writeDxf(dxf, path);
}

QJsonObject HostBridge::dwgWriteDxfTo(const QString& dxf, const QString& dir, const QString& name) {
  if (DwgReader::dxfWriterPath().isEmpty()) return {{"ok", false}, {"error", "no-writer"}};
  const QString path = pickedPath(dir, name);
  if (path.isEmpty()) return {{"ok", false}, {"error", "folder not chosen in this session"}};
  return DwgReader::writeDxf(dxf, path);
}

QJsonObject HostBridge::cadExportPdf(const QString& pageJson, const QString& suggestedName) {
  // one page {w, h, prims} or a sheet set {name, pages: [page, …]} written as one multi-page PDF
  const QJsonObject doc = QJsonDocument::fromJson(pageJson.toUtf8()).object();
  QString path = qEnvironmentVariable("THCAD_PDF_OUT");  // QA: skip the dialog
  if (path.isEmpty()) {
    const QString start = QStandardPaths::writableLocation(QStandardPaths::DocumentsLocation) + "/" + suggestedName;
    path = QFileDialog::getSaveFileName(qobject_cast<QWidget*>(parent()), tr("Export PDF"), start, "PDF (*.pdf)");
  }
  if (path.isEmpty()) return {{"ok", false}, {"cancelled", true}};
  return writePdf(doc, path);
}

QString HostBridge::pickedPath(const QString& dir, const QString& name) const {
  const QString d = QDir(dir).canonicalPath();
  if (d.isEmpty() || !pickedDirs_.contains(d)) return {};
  if (name.isEmpty() || name.contains('/') || name.contains('\\') || name.startsWith('.')) return {};
  // never overwrite (a source drawing may live in this folder): "name (2).ext", "name (3).ext", …
  const QFileInfo fi(name);
  QString path = d + "/" + name;
  for (int n = 2; QFileInfo::exists(path); ++n) path = QStringLiteral("%1/%2 (%3).%4").arg(d, fi.completeBaseName()).arg(n).arg(fi.suffix());
  return path;
}

QJsonObject HostBridge::writeFileTo(const QString& dir, const QString& name, const QString& base64) {
  const QString path = pickedPath(dir, name);
  if (path.isEmpty()) return {{"ok", false}, {"error", "folder not chosen in this session"}};
  QFile f(path);
  if (!f.open(QIODevice::WriteOnly)) return {{"ok", false}, {"error", "cannot write " + path}};
  const qint64 n = f.write(QByteArray::fromBase64(base64.toLatin1()));
  return {{"ok", n >= 0}, {"path", path}, {"bytes", static_cast<double>(n)}};
}

QJsonObject HostBridge::cadExportPdfTo(const QString& pageJson, const QString& dir, const QString& name) {
  const QString path = pickedPath(dir, name);
  if (path.isEmpty()) return {{"ok", false}, {"error", "folder not chosen in this session"}};
  return writePdf(QJsonDocument::fromJson(pageJson.toUtf8()).object(), path);
}

QJsonObject HostBridge::dwgWriteTo(const QString& script, const QString& dir, const QString& name) {
  if (DwgReader::writerPath().isEmpty()) return {{"ok", false}, {"error", "no-writer"}};
  const QString path = pickedPath(dir, name);
  if (path.isEmpty()) return {{"ok", false}, {"error", "folder not chosen in this session"}};
  return DwgReader::write(script, path);
}

QJsonObject HostBridge::writePdf(const QJsonObject& doc, const QString& path) {
  QJsonArray pages = doc.value("pages").toArray();
  if (pages.isEmpty()) pages.append(doc);
  const QJsonObject first = pages.first().toObject();
  const auto sizeOf = [](const QJsonObject& pg) { return QPageSize(QSizeF(pg.value("w").toDouble(420), pg.value("h").toDouble(297)), QPageSize::Millimeter); };
  QPdfWriter pdf(path);
  pdf.setPageSize(sizeOf(first));
  pdf.setPageMargins(QMarginsF(0, 0, 0, 0));
  pdf.setResolution(1200);
  pdf.setTitle(doc.value("name").toString(first.value("name").toString()));
  pdf.setCreator(QStringLiteral("MD CAD AI STUDIO"));
  QPainter g(&pdf);
  if (!g.isActive()) return {{"ok", false}, {"error", "cannot write " + path}};
  g.setRenderHint(QPainter::Antialiasing);
  const double k = 1200 / 25.4;  // device units per mm
  auto pen = [&](const QJsonObject& q) {
    QPen p(QColor(q.value("color").toString("#111827")));
    const double w = std::max(0.1, q.value("w").toDouble(0.25));
    p.setWidthF(w * k);
    p.setCapStyle(Qt::RoundCap);
    p.setJoinStyle(Qt::RoundJoin);
    const QJsonArray d = q.value("dash").toArray();
    if (!d.isEmpty()) {
      QList<qreal> pat;
      for (const auto& v : d) pat << std::max(0.1, v.toDouble() / w);  // QPen dashes are in pen widths
      p.setDashPattern(pat);
    }
    return p;
  };
  for (int pi = 0; pi < pages.size(); ++pi) {
    const QJsonObject page = pages[pi].toObject();
    if (pi > 0) {
      pdf.setPageSize(sizeOf(page));
      pdf.newPage();
    }
    for (const auto& v : page.value("prims").toArray()) {
      const QJsonObject q = v.toObject();
      const QString t = q.value("t").toString();
      g.setBrush(Qt::NoBrush);
      if (t == "line") {
        g.setPen(pen(q));
        g.drawLine(QPointF(q["x1"].toDouble() * k, q["y1"].toDouble() * k), QPointF(q["x2"].toDouble() * k, q["y2"].toDouble() * k));
      } else if (t == "poly") {
        QPolygonF poly;
        for (const auto& pt : q["pts"].toArray()) poly << QPointF(pt.toArray()[0].toDouble() * k, pt.toArray()[1].toDouble() * k);
        g.setPen(pen(q));
        if (q["fill"].toBool()) g.setBrush(QColor(q.value("color").toString()));
        if (q["closed"].toBool()) g.drawPolygon(poly);
        else g.drawPolyline(poly);
      } else if (t == "circle") {
        g.setPen(pen(q));
        const double r = q["r"].toDouble() * k;
        g.drawEllipse(QPointF(q["cx"].toDouble() * k, q["cy"].toDouble() * k), r, r);
      } else if (t == "arc") {
        g.setPen(pen(q));
        const double r = q["r"].toDouble() * k, cx = q["cx"].toDouble() * k, cy = q["cy"].toDouble() * k;
        double a0 = q["a0"].toDouble(), sweep = q["a1"].toDouble() - a0;
        while (sweep <= 0) sweep += 360;
        g.drawArc(QRectF(cx - r, cy - r, 2 * r, 2 * r), static_cast<int>(std::lround(a0 * 16)), static_cast<int>(std::lround(sweep * 16)));
      } else if (t == "text") {
        QFont f(QStringLiteral("Arial"));
        f.setPixelSize(std::max(1, static_cast<int>(std::lround(q["h"].toDouble() / 0.711 * k))));
        f.setBold(q["bold"].toBool());
        g.setFont(f);
        g.setPen(QColor(q.value("color").toString("#111827")));
        g.save();
        g.translate(q["x"].toDouble() * k, q["y"].toDouble() * k);
        g.rotate(-q["rot"].toDouble());
        const QString s = q["value"].toString();
        const double tw = QFontMetricsF(f).horizontalAdvance(s);
        g.drawText(QPointF(q["anchor"].toString() == "middle" ? -tw / 2 : 0, 0), s);
        g.restore();
      }
    }
  }
  g.end();
  return {{"ok", true}, {"path", path}, {"pages", static_cast<int>(pages.size())}, {"bytes", static_cast<double>(QFileInfo(path).size())}};
}

QString HostBridge::dwgToDxf(const QString& base64, const QString& name) {
  return dwg_->convert(QByteArray::fromBase64(base64.toLatin1()), name);
}

QString HostBridge::qaSampleDwg() const {
  if (qEnvironmentVariableIntValue("THCAD_QA") != 1) return {};
  QFile f(qEnvironmentVariable("THCAD_DWG_SAMPLE"));
  return f.open(QIODevice::ReadOnly) ? QString::fromLatin1(f.readAll().toBase64()) : QString();
}

QString HostBridge::qaSampleFile(int index) const {
  if (qEnvironmentVariableIntValue("THCAD_QA") != 1) return QStringLiteral("{}");
  const QStringList paths = qEnvironmentVariable("THCAD_DWG_SAMPLE").split(QLatin1Char('|'), Qt::SkipEmptyParts);
  if (index < 0 || index >= paths.size()) return QStringLiteral("{}");
  QFile f(paths[index]);
  if (!f.open(QIODevice::ReadOnly)) return QStringLiteral("{}");
  QJsonObject o;
  o.insert(QStringLiteral("name"), QFileInfo(paths[index]).fileName());
  o.insert(QStringLiteral("base64"), QString::fromLatin1(f.readAll().toBase64()));
  return QString::fromUtf8(QJsonDocument(o).toJson(QJsonDocument::Compact));
}

bool HostBridge::qaGrab(const QString& path) {
  if (qEnvironmentVariableIntValue("THCAD_QA") != 1) return false;
  auto* w = qobject_cast<QWidget*>(parent());
  return w && w->grab().save(path);
}

void HostBridge::setViewportSlot(const QString& kind, double x, double y, double w, double h, bool visible) {
  if (viewport_) viewport_->placeSlot(kind, QRectF(x, y, w, h), visible);
}

}  // namespace thcad::app
