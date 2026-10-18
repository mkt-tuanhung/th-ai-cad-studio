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

#include <atomic>
#include <functional>
#include <map>
#include <QString>

class QThread;
namespace thcad::occt { class OffscreenView; class SceneView; }
namespace thcad::app { class VideoWriter; class SpeechInput; }
#include <QImage>
#include <QList>

namespace thcad::app {

class NativeViewport;
class DwgReader;
class ModelDownloader;
class BlenderWorker;
class LibraryStore;

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
  /** Whisper (whisper.cpp helper + model): {available, helper, model, modelBytes, reason?}. */
  Q_INVOKABLE QJsonObject whisperStatus();
  /** Transcribes a 16 kHz mono WAV recorded by the page; result on 'voiceTranscript' {id, ok, text, ms, error?}. */
  Q_INVOKABLE void voiceTranscribe(const QString& id, const QString& wavBase64, const QString& lang);
  /** Settings → Download the Whisper model (user action); progress on 'whisperProgress'. */
  Q_INVOKABLE void whisperDownload();
  /** Local AI model download (Settings): what is installed / partly downloaded, free space, the model
   *  recommended for this computer's memory (see ModelDownloader::state). */
  Q_INVOKABLE QJsonObject modelDownloadState();
  /** Starts or resumes downloading a catalogue model into the models folder the runtime reads; progress on
   *  'modelProgress'. Once verified the model is loaded and asked a one-word test question; the last event
   *  is {id, done:true, ok, loaded, test, seconds, tokensPerSecond, device, model, path} (or {ok:false, error}). */
  Q_INVOKABLE QJsonObject modelDownload(const QString& id);
  Q_INVOKABLE void modelDownloadCancel();
  /** Compiles Whisper's GPU kernels in the background (once per session). */
  Q_INVOKABLE void voiceWarmup();
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
  /** v2.4 incremental update of a BIM scene: replaces only the solids of `upsertsJson` = {model (the native
   *  building model, needed for walls), walls: [ids to rebuild with their openings and panes], items: [primitive
   *  items as scene3dLoad], levelSlabs: bool, guids: {id: guid}} and removes `removeIdsJson` = [ids]. Everything else
   *  keeps its solid. → {ok, rebuilt: [ids], removed: [ids], items, ms, built (solids built so far)}. */
  Q_INVOKABLE QJsonObject scene3dPatch(const QString& key, const QString& upsertsJson, const QString& removeIdsJson);
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
  /** Save dialog → glTF binary (GLB) of the scene (THCAD_GLB_OUT skips the dialog): {ok, path, bytes, nodes,
   *  triangles, materials, boundsMm} (see SceneView::writeGlb). */
  Q_INVOKABLE QJsonObject scene3dExportGlb(const QString& key, const QString& suggestedName);
  /** Local Blender (external process, never bundled): {found, path, version, script, sandbox, reason?}. */
  Q_INVOKABLE QJsonObject blenderInfo(bool refresh);
  /** Render memory pre-check (SP44): {ok, needBytes, budgetBytes, physicalBytes, reason?}. engine: occt | blender. */
  Q_INVOKABLE QJsonObject renderMemoryCheck(int w, int h, const QString& engine);
  /** A render output or queued 3D frame as a JPEG data URL (only files inside the Renders folder or the render
   *  cache): {ok, url, w, h}. */
  Q_INVOKABLE QJsonObject renderReadImage(const QString& path, int maxWidth);
  /** The provenance sidecar of a render in the Renders folder: {ok, sidecar}. */
  Q_INVOKABLE QJsonObject renderReadSidecar(const QString& imagePath);
  /** DWG bytes (base64) → DXF bytes via the bundled LibreDWG helper. Async: emits dwgResult
   *  ({id, ok, dxf: base64, ms, warnings, error}); returns the id. */
  Q_INVOKABLE QString dwgToDxf(const QString& base64, const QString& name);
  /** Writes a DWG (AutoCAD 2000) from a LibreDWG dwgadd script (built by ui/src/cad/dwgWrite.ts) and
   *  verifies it by reading it back: {ok, path, bytes, entities, layers, warnings?, error?}. */
  Q_INVOKABLE QJsonObject dwgWrite(const QString& script, const QString& suggestedName);
  /** DWG with paper-space layouts: from a DXF R2000 (ui/src/cad/dxf2000.ts) through LibreDWG dxf2dwg,
   *  verified by reading it back: {ok, path, bytes, entities, layers, layouts, error?, cancelled?}. */
  Q_INVOKABLE QJsonObject dwgWriteDxf(const QString& dxf, const QString& suggestedName);
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
  Q_INVOKABLE QJsonObject dwgWriteDxfTo(const QString& dxf, const QString& dir, const QString& name);
  /** QA only (THCAD_QA=1): bytes of $THCAD_DWG_SAMPLE as base64 (the page cannot read files). */
  Q_INVOKABLE QString qaSampleDwg() const;
  /** QA: file `index` of THCAD_DWG_SAMPLE ("a.dwg|b.dxf|…") as {"name", "base64"}; {} past the last one. */
  Q_INVOKABLE QString qaSampleFile(int index) const;
  /** QA only (THCAD_QA=1): saves a Qt grab of the window. */
  Q_INVOKABLE bool qaGrab(const QString& path);
  /** 3D asset library (host_library.cpp / library_store.hpp): {ok, dir, manifest, bytes, freeBytes, blender, …}. */
  Q_INVOKABLE QJsonObject libraryList();
  /** GET an allow-listed Poly Haven API URL (user action only); the text arrives on 'libraryEvent' {type:'fetch', id, ok, text}. */
  Q_INVOKABLE QJsonObject libraryFetch(const QString& id, const QString& url);
  /** Download plan (ui/src/library/polyhaven.ts) → files verified (size + md5) into the library; 'libraryEvent' {type:'download', …}. */
  Q_INVOKABLE QJsonObject libraryDownload(const QString& planJson);
  Q_INVOKABLE void libraryCancel();
  /** Writes one manifest entry (user items, edits); thumbDataUrl (optional) becomes its thumb.png. */
  Q_INVOKABLE QJsonObject libraryPut(const QString& entryJson, const QString& thumbDataUrl);
  Q_INVOKABLE QJsonObject libraryRemove(const QString& id);
  /** {id: data URL} of the thumbnails of the given ids (JSON array). */
  Q_INVOKABLE QJsonObject libraryThumbs(const QString& idsJson);
  /** "Thêm từ file": a 3D file (open dialog when path is empty; THCAD_PICK_FILE in QA) → Blender → library/user/<id>/model.glb
   *  + thumbnail; the result (real size, unit guess) arrives on 'libraryEvent' {type:'import', …}; libraryPut commits it. */
  Q_INVOKABLE QJsonObject libraryImport(const QString& path);
  /** The user's own items as a .zip (save / open dialog; THCAD_LIBRARY_ZIP in QA). */
  Q_INVOKABLE QJsonObject libraryExport();
  Q_INVOKABLE QJsonObject libraryImportZip();
  Q_INVOKABLE bool libraryReveal();
  /** Option A: the UI reports where its viewport slot is; the native viewer is placed there. */
  Q_INVOKABLE void setViewportSlot(const QString& kind, double x, double y, double w, double h, bool visible);

 signals:
  void aiResult(const QJsonObject& result);
  void aiTaskResult(const QJsonObject& result);
  void voiceText(const QJsonObject& result);
  void voiceTranscript(const QJsonObject& result);
  void whisperProgress(const QJsonObject& progress);
  void modelProgress(const QJsonObject& progress);
  void documentChanged(const QJsonObject& document);
  void dwgResult(const QJsonObject& result);
  /** {id, samples, total, ms, preview?} while running; {id, done:true, ok, path?, error?, …} at the end. */
  void renderProgress(const QJsonObject& progress);
  /** Asset library: {type:'fetch'|'download'|'import'|'probe', …} (see LibraryStore). */
  void libraryEvent(const QJsonObject& e);

 private:
  QJsonObject proposalJson(const Proposal& p) const;
  QJsonObject result(std::optional<ValidationError> err) const;
  /** Free path for `name` inside a folder the user picked (never an existing file), or empty. */
  QString pickedPath(const QString& dir, const QString& name) const;
  static QJsonObject writePdf(const QJsonObject& doc, const QString& path);
  QStringList pickedDirs_;

  NativeViewport* viewport_;
  DwgReader* dwg_;
  ModelDownloader* downloader_;
  bool modelInstalling_ = false;  // between 'installed' and the final event (load + test question)
  std::atomic<bool> modelLoading_{false};  // a downloaded model is being loaded on a worker thread
  /** AI worker threads (generation, model load + test question): owned, so ~HostBridge can stop the runtime
   *  and join them before runtime_ and the queues they use are destroyed. GUI thread only. */
  QList<QThread*> workers_;
  void runWorker(std::function<void()> fn);
  QJsonObject modelLast_;         // the last final event, for the UI to catch up after a missed signal
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
  // 3D asset library
  LibraryStore* library_ = nullptr;
  void initLibrary();
  QString libraryDir() const;
  // Blender Cycles worker (separate process)
  BlenderWorker* blender_ = nullptr;
  QJsonObject renderStartBlender(const QJsonObject& job);
  void blenderDone(const QJsonObject& r);
};

}  // namespace thcad::app
