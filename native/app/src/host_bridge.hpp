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
namespace thcad::app { class VideoWriter; class SpeechInput; }
#include <QImage>
#include <QList>

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
  /** Generic structured generation for the discipline assistants (the UI builds prompt + GBNF and
   *  validates / applies the result as a proposal): {id, system, prompt, grammar?, maxTokens?}.
   *  Runs off the UI thread; the result arrives on 'aiTaskResult' {id, ok, text, seconds, tokens,
   *  tokensPerSecond, error?}. Returns false when no model is ready (nothing is generated). */
  Q_INVOKABLE bool aiTask(const QString& taskJson);
  /** Voice CAD (on-device only): {available, onDevice, reason} for a locale ("vi-VN", "en-US"). */
  Q_INVOKABLE QJsonObject voiceAvailability(const QString& locale);
  /** Starts listening; text arrives on 'voiceText' {text, final, error?}. */
  Q_INVOKABLE void voiceStart(const QString& locale);
  Q_INVOKABLE void voiceStop();
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
  /** View commands: {cmd:'hide', ids, keep} (keep: isolate) → {visible} | {cmd:'section', on, around, top} | {cmd:'clip', planes:[[a,b,c,d]]} | {cmd:'window', x0,y0,x1,y1} |
   *  {cmd:'camera', eye, at, fov} | {cmd:'walk', forward, right, yaw, pitch} | {cmd:'bounds', ids} |
   *  {cmd:'snapshot', w, h, mode} → {ok, url: data:image/png…}. */
  Q_INVOKABLE QJsonObject scene3dCommand(const QString& key, const QString& json);
  /** Scene `key` = the BIM building (walls with openings and glazing, floor slabs) plus `extrasJson`
   *  ({items:[…]} as scene3dLoad: columns, stairs, roofs… built from primitives): {ok, items, failures, ms}. */
  Q_INVOKABLE QJsonObject scene3dLoadBim(const QString& key, const QString& modelJson, const QString& extrasJson);
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
  /** Writes a DWG (AutoCAD 2000) from a LibreDWG dwgadd script (built by ui/src/cad/dwgWrite.ts) and
   *  verifies it by reading it back: {ok, path, bytes, entities, layers, warnings?, error?}. */
  Q_INVOKABLE QJsonObject dwgWrite(const QString& script, const QString& suggestedName);
  /** Vector PDF of a plotted page (ui/src/cad/plot.ts: {name, w, h, scale, prims}) via QPdfWriter. */
  Q_INVOKABLE QJsonObject cadExportPdf(const QString& pageJson, const QString& suggestedName);
  /** Settings: models folder, installed models (size, active), disk of the models volume, versions. */
  Q_INVOKABLE QJsonObject systemInfo() const;
  /** Settings: switches the models folder and loads its preferred model. */
  Q_INVOKABLE QJsonObject setModelsDir(const QString& dir);
  /** Settings: GPU offload for the local model (reloads the model). */
  Q_INVOKABLE bool setAiGpu(bool on);
  /** Opens a folder in Finder / Explorer. */
  Q_INVOKABLE bool revealFolder(const QString& path);
  /** Native folder chooser; empty string when cancelled. The chosen folder may then be written by
   *  writeFileTo / cadExportPdfTo / dwgWriteTo (batch jobs) — no other folder can. */
  Q_INVOKABLE QString pickFolder(const QString& title, const QString& start);
  /** Batch output into a folder picked with pickFolder: {ok, path, bytes} or {ok:false, error}. */
  Q_INVOKABLE QJsonObject writeFileTo(const QString& dir, const QString& name, const QString& base64);
  Q_INVOKABLE QJsonObject cadExportPdfTo(const QString& pageJson, const QString& dir, const QString& name);
  Q_INVOKABLE QJsonObject dwgWriteTo(const QString& script, const QString& dir, const QString& name);
  /** QA only (THCAD_QA=1): bytes of $THCAD_DWG_SAMPLE as base64 (the page cannot read files). */
  Q_INVOKABLE QString qaSampleDwg() const;
  /** QA only (THCAD_QA=1): saves a Qt grab of the window. */
  Q_INVOKABLE bool qaGrab(const QString& path);
  /** Option A: the UI reports where its viewport slot is; the native viewer is placed there. */
  Q_INVOKABLE void setViewportSlot(const QString& kind, double x, double y, double w, double h, bool visible);

 signals:
  void aiResult(const QJsonObject& result);
  void aiTaskResult(const QJsonObject& result);
  void voiceText(const QJsonObject& result);
  void documentChanged(const QJsonObject& document);
  void dwgResult(const QJsonObject& result);
  /** {id, samples, total, ms, preview?} while running; {id, done:true, ok, path?, error?, …} at the end. */
  void renderProgress(const QJsonObject& progress);

 private:
  QJsonObject proposalJson(const Proposal& p) const;
  QJsonObject result(std::optional<ValidationError> err) const;
  /** Free path for `name` inside a folder the user picked (never an existing file), or empty. */
  QString pickedPath(const QString& dir, const QString& name) const;
  static QJsonObject writePdf(const QJsonObject& doc, const QString& path);
  QStringList pickedDirs_;

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
  // multi-view jobs: panorama (6 cube faces → equirectangular) and video (one render per frame)
  QJsonArray seq_;
  int seqIndex_ = 0;
  QList<QImage> seqImages_;
  std::unique_ptr<VideoWriter> video_;
  std::unique_ptr<SpeechInput> speech_;
  void renderTick();
  void renderFinish(bool ok, const QString& error);
};

}  // namespace thcad::app
