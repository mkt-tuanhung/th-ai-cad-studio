#pragma once
// 3D asset library on disk (v2.4 interior render + user furniture library): furniture / decor models, PBR materials
// and HDRIs in <app data>/library/ (next to the AI models folder, never in the repo or the installer), described by
// library/library.json. See ui/src/library/assets.ts for the manifest format.
//
//  - Downloads (Poly Haven, CC0) happen ONLY when the user presses a download / search button: allow-listed https
//    hosts, files written as "<name>.part" and resumed (HTTP Range), every file checked for its exact size and md5
//    (from the Poly Haven API) before its final name appears; an asset enters the manifest once all its files are in.
//  - Imports ("Thêm từ file"): the user's GLB / glTF / OBJ / FBX / STL / .blend is converted by the user's own Blender
//    (background process, md_library.py) into one GLB with its real size and a thumbnail, under library/user/<id>/.
//  - Every path is confined to the library folder (no traversal); Export / Import moves the user's own items between
//    computers as a .zip (stored entries).
#include <QByteArray>
#include <QElapsedTimer>
#include <QFile>
#include <QJsonArray>
#include <QJsonObject>
#include <QObject>
#include <QPointer>
#include <QString>

class QNetworkAccessManager;
class QNetworkReply;
class QProcess;

namespace thcad::app {

class LibraryStore : public QObject {
  Q_OBJECT
 public:
  explicit LibraryStore(QObject* parent = nullptr);
  ~LibraryStore() override;

  /** THCAD_LIBRARY_DIR, else <app data>/library (the folder the AI models' "MD CAD AI STUDIO" / "TH AI CAD Studio" sits in). */
  static QString dir();
  /** `rel` inside the library (canonical absolute path), or empty when it would leave it. */
  static QString resolve(const QString& rel);

  /** {ok, dir, manifest:{version, items}, bytes, freeBytes, running} */
  QJsonObject list() const;
  /** GET an allow-listed Poly Haven API URL (user action); the text arrives as event {type:'fetch', id, ok, status, text}. */
  QJsonObject fetch(const QString& id, const QString& url);
  /** Starts (or resumes) downloading plan = [{id, files:[{url, path, size, md5?}], entry}]; events {type:'download', …}. */
  QJsonObject download(const QJsonArray& plan);
  void cancel();
  /** Writes / replaces one manifest entry (user items, edits): its folder must exist in the library or be "presets". */
  QJsonObject put(QJsonObject entry, const QString& thumbDataUrl);
  /** Deletes an entry and its folder. */
  QJsonObject remove(const QString& id);
  /** {id: data URL} of the entries' thumbnails. */
  QJsonObject thumbs(const QJsonArray& ids) const;
  /** "Thêm từ file": copy-free import through Blender (md_library.py) into user/<id>/; result event {type:'import', id, ok, dims, unit, …}. */
  QJsonObject importFile(const QString& path, const QString& blender, const QString& script);
  /** Export / import the user's own items (user-import / user-drawn) as a .zip. */
  QJsonObject exportZip(const QString& path) const;
  QJsonObject importZip(const QString& path);
  /** After a download: real bounding boxes of the new models through Blender (probe), written into the manifest. */
  void probeModels(const QStringList& ids, const QString& blender, const QString& script);

 signals:
  void event(const QJsonObject& e);

 private:
  QJsonObject readManifest() const;
  bool writeManifest(const QJsonObject& m) const;
  void upsert(const QJsonObject& entry);
  void nextFile();
  void finishAsset();
  void fail(const QString& error);
  void done();

  QNetworkAccessManager* nam_;
  QPointer<QNetworkReply> reply_;
  QJsonArray plan_;
  int asset_ = 0, file_ = 0, attempt_ = 0, added_ = 0;
  QStringList failed_, newModels_;
  bool running_ = false, cancelled_ = false;
  QFile out_;
  QString writeError_;
  qint64 total_ = 0, doneBytes_ = 0, lastBytes_ = 0;
  double bps_ = 0;
  QElapsedTimer tick_;
  QProcess* proc_ = nullptr;
};

}  // namespace thcad::app
