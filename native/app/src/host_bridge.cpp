#include "host_bridge.hpp"

#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonArray>
#include <QThread>

#include <chrono>
#include <QSysInfo>
#include <QWidget>

#include "native_viewport.hpp"
#include "thcad/ai/assistant.hpp"
#include "thcad/core/commands.hpp"
#include "thcad/core/ops_json.hpp"
#ifdef THCAD_HAS_OCCT
#include "thcad/bim/model_json.hpp"
#include "thcad/occt/geometry.hpp"
#include "thcad/occt/offscreen.hpp"
#endif
#include <QBuffer>
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
#else
QJsonObject HostBridge::bim3dLoad(const QString&) { return {{"ok", false}}; }
QJsonObject HostBridge::bim3dFrame(int, int, const QString&, const QString&) { return {{"ok", false}}; }
void HostBridge::bim3dCamera(const QString&, double, double, double, double) {}
#endif

bool HostBridge::qaGrab(const QString& path) {
  if (qEnvironmentVariableIntValue("THCAD_QA") != 1) return false;
  auto* w = qobject_cast<QWidget*>(parent());
  return w && w->grab().save(path);
}

void HostBridge::setViewportSlot(const QString& kind, double x, double y, double w, double h, bool visible) {
  if (viewport_) viewport_->placeSlot(kind, QRectF(x, y, w, h), visible);
}

}  // namespace thcad::app
