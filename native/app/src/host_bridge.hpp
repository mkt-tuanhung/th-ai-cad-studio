#pragma once
// QWebChannel object exposed to the web UI as `window.thcadHost` (see ui/src/services/host.ts).
// Every drawing mutation goes through the native CommandBus; AI output only ever becomes a proposal.
#include <QJsonObject>
#include <QObject>
#include <memory>

#include "thcad/ai/runtime.hpp"
#include "thcad/bim/model.hpp"
#include "thcad/core/command_bus.hpp"
#include "thcad/core/proposal.hpp"

namespace thcad::occt { class OffscreenView; }

namespace thcad::app {

class NativeViewport;

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
  /** QA only (THCAD_QA=1): saves a Qt grab of the window. */
  Q_INVOKABLE bool qaGrab(const QString& path);
  /** Option A: the UI reports where its viewport slot is; the native viewer is placed there. */
  Q_INVOKABLE void setViewportSlot(const QString& kind, double x, double y, double w, double h, bool visible);

 signals:
  void aiResult(const QJsonObject& result);
  void documentChanged(const QJsonObject& document);

 private:
  QJsonObject proposalJson(const Proposal& p) const;
  QJsonObject result(std::optional<ValidationError> err) const;

  NativeViewport* viewport_;
  std::unique_ptr<ai::Runtime> runtime_;
  std::unique_ptr<CommandBus> bus_;
  std::unique_ptr<ProposalQueue> proposals_;
  bim::Model bim_;
  std::unique_ptr<occt::OffscreenView> offscreen_;
  bool offscreenLoaded_ = false;
  occt::OffscreenView* offscreen();
};

}  // namespace thcad::app
