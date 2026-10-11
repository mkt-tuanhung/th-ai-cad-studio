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
#include <QThread>

#include <chrono>
#include <QSysInfo>
#include <QWidget>

#include "dwg_reader.hpp"
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
#include <QDateTime>
#include <QRegularExpression>
#include <QImageWriter>
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
  if (const std::string model = ai::discoverModel(); !model.empty()) runtime_->load(model);
}

HostBridge::~HostBridge() = default;  // offscreen_ complete type via offscreen.hpp

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
  };
}

QJsonObject HostBridge::localAiStatus() const {
  const ai::RuntimeStatus s = runtime_->status();
  // Same shape as LocalAiStatus in ui/src/services/localAi.ts, but every number is measured.
  return {
      {"source", "native"},
      {"backend", QString::fromStdString(s.backend)},
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
  QThread* t = QThread::create([this, request, snapshot] {
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
  connect(t, &QThread::finished, t, &QObject::deleteLater);
  t->start();
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
  return {{"ok", true}, {"items", static_cast<int>(items.size())}, {"failures", failures}, {"ms", v->lastBuildMs()}, {"volumes", volumes}};
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

QJsonObject HostBridge::renderStart(const QString& jobJson) {
  if (rendering_) return {{"ok", false}, {"error", "busy"}};
  const QJsonObject job = QJsonDocument::fromJson(jobJson.toUtf8()).object();
  const QString fmt = job.value("format").toString("png");
  if (fmt == "exr") return {{"ok", false}, {"error", "OpenEXR output is not included in this build (choose PNG 16-bit for high bit depth)"}};
  if (fmt == "tiff" && !QImageWriter::supportedImageFormats().contains("tiff")) return {{"ok", false}, {"error", "TIFF writer not available in this build"}};
  if (!renderer_) renderer_ = std::make_unique<occt::SceneView>(true);
  if (!renderer_->ok()) return {{"ok", false}, {"error", "OpenGL unavailable"}};
  auto parsed = json::parse(QJsonDocument(job.value("scene").toObject()).toJson(QJsonDocument::Compact).toStdString());
  if (auto* e = std::get_if<json::ParseError>(&parsed)) return {{"ok", false}, {"error", QString::fromStdString(e->message)}};
  int failures = renderer_->setItems(occt::sceneFromJson(std::get<json::Value>(parsed)));
  // exterior views: the BIM building held by the host (the same model the BIM workspace edits)
  if (job.value("scene").toObject().value("bim").toBool()) renderer_->addBuilding(bim_, job.value("scene").toObject().value("ground").toBool(true));
  const QJsonObject pj = job.value("params").toObject();
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
  if (rendering_ && renderJob_.value("id").toString() == id) renderFinish(false, QStringLiteral("cancelled"));
}

void HostBridge::renderTick() {
  if (!rendering_) return;
  const QJsonObject pj = renderJob_.value("params").toObject();
  const int total = pj.value("engine").toString() == "raytrace" ? std::min(pj.value("samples").toInt(64), 16) : pj.value("samples").toInt(64);
  // short slices (at least one pass) with idle gaps keep the UI — same thread as the GL context — responsive
  const int done = renderer_->renderPasses(25);
  const qint64 now = QDateTime::currentMSecsSinceEpoch();
  QJsonObject prog{{"id", renderJob_.value("id")}, {"samples", done}, {"total", total}, {"ms", static_cast<double>(now - renderStartMs_)}};
  if (done >= total) return renderFinish(true, {});
  if (now - renderPreviewMs_ > 1500) {
    renderPreviewMs_ = now;
    prog["preview"] = previewUrl(renderer_->renderedImage(false), pj.value("w").toInt(1920), pj.value("h").toInt(1080), renderJob_.value("fx").toObject());
  }
  emit renderProgress(prog);
  QTimer::singleShot(20, this, &HostBridge::renderTick);
}

void HostBridge::renderFinish(bool ok, const QString& error) {
  const QJsonObject job = renderJob_;
  const QJsonObject pj = job.value("params").toObject();
  const int w = std::clamp(pj.value("w").toInt(1920), 16, 8192), h = std::clamp(pj.value("h").toInt(1080), 16, 8192);
  QJsonObject res{{"id", job.value("id")}, {"done", true}, {"samples", renderer_->renderedSamples()}, {"ms", static_cast<double>(QDateTime::currentMSecsSinceEpoch() - renderStartMs_)}};
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
      if (dir.isEmpty()) dir = QStandardPaths::writableLocation(QStandardPaths::DocumentsLocation) + QStringLiteral("/TH AI CAD Studio/Renders");
      QDir().mkpath(dir);
      QString base = job.value("name").toString(QStringLiteral("Render"));
      base.replace(QRegularExpression(QStringLiteral("[\\\\/:*?\"<>|]")), QStringLiteral("-"));
      const QString ext = fmt == "jpg" ? QStringLiteral("jpg") : fmt == "tiff" ? QStringLiteral("tiff") : QStringLiteral("png");
      path = dir + "/" + base + "." + ext;
      for (int n = 2; QFileInfo::exists(path); ++n) path = dir + "/" + base + QStringLiteral(" (%1).").arg(n) + ext;
      QImageWriter wr(path);
      if (fmt == "jpg") wr.setQuality(95);
      if (!wr.write(img)) ok = false, res["error"] = wr.errorString();
      else res["path"] = path, res["bytes"] = static_cast<double>(QFileInfo(path).size());
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
QString HostBridge::scene3dPick(const QString&, int, int) { return {}; }
double HostBridge::scene3dCommon(const QString&, const QString&, const QString&) { return -1; }
QJsonArray HostBridge::scene3dOverlaps(const QString&) { return {}; }
QJsonObject HostBridge::renderStart(const QString&) { return {{"ok", false}, {"error", "no 3D engine in this build"}}; }
void HostBridge::renderCancel(const QString&) {}
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
  return QFileDialog::getExistingDirectory(qobject_cast<QWidget*>(parent()), title, start.isEmpty() ? QDir::homePath() : start);
}

QString HostBridge::dwgToDxf(const QString& base64, const QString& name) {
  return dwg_->convert(QByteArray::fromBase64(base64.toLatin1()), name);
}

QString HostBridge::qaSampleDwg() const {
  if (qEnvironmentVariableIntValue("THCAD_QA") != 1) return {};
  QFile f(qEnvironmentVariable("THCAD_DWG_SAMPLE"));
  return f.open(QIODevice::ReadOnly) ? QString::fromLatin1(f.readAll().toBase64()) : QString();
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
