#pragma once
// QWebChannel object exposed to the web UI as `window.thcadHost` (see ui/src/services/host.ts).
// Every drawing mutation goes through the native CommandBus; AI output only ever becomes a proposal.
#include <QJsonArray>
#include <QJsonObject>
#include <QObject>
#include <memory>

#include "thcad/ai/runtime.hpp"
#include "thcad/bim/model.hpp"
#include "thcad/core/command_bus.hpp"
#include "thcad/core/proposal.hpp"

#include <map>
#include <QString>

namespace thcad::occt { class OffscreenView; class SceneView; }

namespace thcad::app {

class NativeViewport;
class DwgReader;

class HostBridge : public QObject {
  Q_OBJECT
  Q_PROPERTY(bool nativeViewport READ nativeViewport CONSTANT)
 public:
  HostBridge(NativeViewport* viewport, QObject* parent = nullptr);
  ~HostBridge() override;
  bool nativeViewport() const;

  Q_INVOKABLE QJsonObject info() const;
  Q_INVOKABLE QJsonObject localAiStatus() const;
  Q_INVOKABLE bool loadModel(const QString& path);
  /** Async: emits aiResult({ok, message, proposal?}). */
  Q_INVOKABLE void aiRequest(const QString& request);
  /** Replaces the engine document with the UI's open drawing (JSON, see documentToJson). */
  Q_INVOKABLE QJsonObject cadLoad(const QString& documentJson);

  Q_INVOKABLE QJsonObject cadDocument() const;
  Q_INVOKABLE QJsonObject cadExecute(const QString& opsJson);
  Q_INVOKABLE QJsonObject cadUndo();
  Q_INVOKABLE QJsonObject cadRedo();
  Q_INVOKABLE QJsonObject proposeOps(const QString& title, const QString& opsJson);
  Q_INVOKABLE QJsonObject approveProposal(const QString& id);
  Q_INVOKABLE bool rejectProposal(const QString& id);

  Q_INVOKABLE QJsonObject bimSummary() const;
  /** BIM 3D (offscreen OCCT, unified with the web overlays). */
  Q_INVOKABLE QJsonObject bim3dLoad(const QString& modelJson);
  /** Renders w×h device pixels; returns {url: data:image/jpeg…, ms}. */
  Q_INVOKABLE QJsonObject bim3dFrame(int w, int h, const QString& mode, const QString& selectedWall);
  /** action: orbitStart | orbit | pan | zoom | fit | home | top | front | right */
  Q_INVOKABLE void bim3dCamera(const QString& action, double a, double b, double c, double d);
  /** Discipline 3D scenes (Interior, MEP, Mechanical): exact OCCT solids from UI primitives.
   *  key names the scene; json = {items:[{id, rgb:[r,g,b], transparency, fuse, parts:[prim], cuts:[prim]}]}.
   *  Returns {ok, items, failures, ms, volumes:{id: m³}}. */
  Q_INVOKABLE QJsonObject scene3dLoad(const QString& key, const QString& json);
  /** Renders w×h device pixels: {ok, url, ms}. mode: shaded | wireframe | hidden | clay. */
  Q_INVOKABLE QJsonObject scene3dFrame(const QString& key, int w, int h, const QString& mode, const QString& selected, const QString& highlightedCsv);
  Q_INVOKABLE void scene3dCamera(const QString& key, const QString& action, double a, double b, double c);
  /** Item id under device pixel (x, y) of the last frame ("" if none). */
  Q_INVOKABLE QString scene3dPick(const QString& key, int x, int y);
  /** Boolean common volume of two items in m³ (0 = no overlap, −1 = unknown). */
  Q_INVOKABLE double scene3dCommon(const QString& key, const QString& a, const QString& b);
  /** All intersecting item pairs of a scene: [{a, b, m3}]. */
  Q_INVOKABLE QJsonArray scene3dOverlaps(const QString& key);
  /** Save dialog → STEP AP214 of the scene. {ok, path, error}. */
  Q_INVOKABLE QJsonObject scene3dExportStep(const QString& key, const QString& suggestedName);
  /** Final render of one job (OCCT path tracing, progressive, on the GUI thread in short slices):
   *  {id, name, scene:{items}, params:{w,h,samples,bounces,engine,exposure,sun,sunIntensity,
   *  sunAzimuth,sunElevation,sky,camera:{eye,at,fov}}, fx:{contrast,saturation,temperature,vignette},
   *  format:'png'|'png16'|'jpg'|'tiff', dpi}. Progress and the result arrive on 'renderProgress'. */
  Q_INVOKABLE QJsonObject renderStart(const QString& jobJson);
  Q_INVOKABLE void renderCancel(const QString& id);
  /** DWG bytes (base64) → DXF bytes via the bundled LibreDWG helper. Async: emits dwgResult
   *  ({id, ok, dxf: base64, ms, warnings, error}); returns the id. */
  Q_INVOKABLE QString dwgToDxf(const QString& base64, const QString& name);
  /** Settings: models folder, installed models (size, active), disk of the models volume, versions. */
  Q_INVOKABLE QJsonObject systemInfo() const;
  /** Settings: switches the models folder and loads its preferred model. */
  Q_INVOKABLE QJsonObject setModelsDir(const QString& dir);
  /** Settings: GPU offload for the local model (reloads the model). */
  Q_INVOKABLE bool setAiGpu(bool on);
  /** Opens a folder in Finder / Explorer. */
  Q_INVOKABLE bool revealFolder(const QString& path);
  /** Native folder chooser; empty string when cancelled. */
  Q_INVOKABLE QString pickFolder(const QString& title, const QString& start);
  /** QA only (THCAD_QA=1): bytes of $THCAD_DWG_SAMPLE as base64 (the page cannot read files). */
  Q_INVOKABLE QString qaSampleDwg() const;
  /** QA only (THCAD_QA=1): saves a Qt grab of the window. */
  Q_INVOKABLE bool qaGrab(const QString& path);
  /** Option A: the UI reports where its viewport slot is; the native viewer is placed there. */
  Q_INVOKABLE void setViewportSlot(const QString& kind, double x, double y, double w, double h, bool visible);

 signals:
  void aiResult(const QJsonObject& result);
  void documentChanged(const QJsonObject& document);
  void dwgResult(const QJsonObject& result);
  /** {id, samples, total, ms, preview?} while running; {id, done:true, ok, path?, error?, …} at the end. */
  void renderProgress(const QJsonObject& progress);

 private:
  QJsonObject proposalJson(const Proposal& p) const;
  QJsonObject result(std::optional<ValidationError> err) const;

  NativeViewport* viewport_;
  DwgReader* dwg_;
  std::unique_ptr<ai::Runtime> runtime_;
  std::unique_ptr<CommandBus> bus_;
  std::unique_ptr<ProposalQueue> proposals_;
  bim::Model bim_;
  std::unique_ptr<occt::OffscreenView> offscreen_;
  bool offscreenLoaded_ = false;
  occt::OffscreenView* offscreen();
  std::map<QString, std::unique_ptr<occt::SceneView>> scenes_;
  occt::SceneView* scene(const QString& key);
  // final render job
  std::unique_ptr<occt::SceneView> renderer_;
  QJsonObject renderJob_;
  qint64 renderStartMs_ = 0, renderPreviewMs_ = 0;
  bool rendering_ = false;
  void renderTick();
  void renderFinish(bool ok, const QString& error);
};

}  // namespace thcad::app
