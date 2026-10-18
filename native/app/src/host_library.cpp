// HostBridge: the 3D asset library (library_store.hpp) — thin wrappers for the web UI (ui/src/library/assets.ts,
// screens/interior/AssetLibraryDialog.tsx). Network only on the user's explicit download / search actions.
#include <QDesktopServices>
#include <QDir>
#include <QFileDialog>
#include <QFileInfo>
#include <QJsonDocument>
#include <QStandardPaths>
#include <QUrl>

#include "blender_worker.hpp"
#include "host_bridge.hpp"
#include "library_store.hpp"

namespace thcad::app {

namespace {
/** md_library.py next to md_render.py (bundle Resources, beside the exe, or the source tree in dev builds). */
QString libraryScript() {
  const QString r = BlenderWorker::scriptPath();
  if (r.isEmpty()) return {};
  const QString p = QFileInfo(r).dir().filePath(QStringLiteral("md_library.py"));
  return QFileInfo::exists(p) ? p : QString();
}
QString blenderExe() {
  const QJsonObject b = BlenderWorker::probe();
  return b.value("found").toBool() ? b.value("path").toString() : QString();
}
}  // namespace

void HostBridge::initLibrary() {
  library_ = new LibraryStore(this);
  connect(library_, &LibraryStore::event, this, [this](const QJsonObject& e) {
    emit libraryEvent(e);
    // new models: their real bounding boxes through Blender (the API's sizes are only a hint)
    if (e.value("type").toString() == QStringLiteral("download") && e.value("done").toBool()) {
      QStringList ids;
      for (const auto& v : e.value("models").toArray()) ids << v.toString();
      library_->probeModels(ids, blenderExe(), libraryScript());
    }
  });
}

QJsonObject HostBridge::libraryList() {
  QJsonObject r = library_->list();
  r["blender"] = !blenderExe().isEmpty();
  r["script"] = !libraryScript().isEmpty();
  return r;
}

QJsonObject HostBridge::libraryFetch(const QString& id, const QString& url) { return library_->fetch(id, url); }

QJsonObject HostBridge::libraryDownload(const QString& planJson) { return library_->download(QJsonDocument::fromJson(planJson.toUtf8()).array()); }

void HostBridge::libraryCancel() { library_->cancel(); }

QJsonObject HostBridge::libraryPut(const QString& entryJson, const QString& thumbDataUrl) {
  return library_->put(QJsonDocument::fromJson(entryJson.toUtf8()).object(), thumbDataUrl);
}

QJsonObject HostBridge::libraryRemove(const QString& id) { return library_->remove(id); }

QJsonObject HostBridge::libraryThumbs(const QString& idsJson) { return library_->thumbs(QJsonDocument::fromJson(idsJson.toUtf8()).array()); }

QJsonObject HostBridge::libraryImport(const QString& path) {
  QString p = path;
  if (p.isEmpty()) p = qEnvironmentVariable("THCAD_PICK_FILE");  // QA: skip the dialog
  if (p.isEmpty())
    p = QFileDialog::getOpenFileName(nullptr, QStringLiteral("3D model"), QStandardPaths::writableLocation(QStandardPaths::DownloadLocation),
                                     QStringLiteral("3D models (*.glb *.gltf *.obj *.fbx *.blend *.stl *.dae)"));
  if (p.isEmpty()) return {{"ok", false}, {"cancelled", true}};
  return library_->importFile(p, blenderExe(), libraryScript());
}

QJsonObject HostBridge::libraryExport() {
  QString p = qEnvironmentVariable("THCAD_LIBRARY_ZIP");  // QA
  if (p.isEmpty())
    p = QFileDialog::getSaveFileName(nullptr, QStringLiteral("Export library"), QStandardPaths::writableLocation(QStandardPaths::DocumentsLocation) + QStringLiteral("/MD CAD library.zip"),
                                     QStringLiteral("Zip (*.zip)"));
  if (p.isEmpty()) return {{"ok", false}, {"cancelled", true}};
  return library_->exportZip(p);
}

QJsonObject HostBridge::libraryImportZip() {
  QString p = qEnvironmentVariable("THCAD_LIBRARY_ZIP");  // QA
  if (p.isEmpty()) p = QFileDialog::getOpenFileName(nullptr, QStringLiteral("Import library"), QStandardPaths::writableLocation(QStandardPaths::DocumentsLocation), QStringLiteral("Zip (*.zip)"));
  if (p.isEmpty()) return {{"ok", false}, {"cancelled", true}};
  return library_->importZip(p);
}

bool HostBridge::libraryReveal() { return QDesktopServices::openUrl(QUrl::fromLocalFile(LibraryStore::dir())); }

QString HostBridge::libraryDir() const { return LibraryStore::dir(); }

}  // namespace thcad::app
