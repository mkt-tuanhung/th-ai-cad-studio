#pragma once
// DWG → DXF through LibreDWG's `dwg2dxf`, shipped inside the app as a separate GPL-3.0 program
// (macOS: Contents/Helpers, Windows: <app>\libredwg). It is only ever run as a child process — the
// app does not link LibreDWG. The DXF bytes go back to the UI, which imports them like any DXF.
#include <QJsonObject>
#include <QObject>
#include <QString>

namespace thcad::app {

class DwgReader : public QObject {
  Q_OBJECT
 public:
  using QObject::QObject;
  /** Absolute path of the helper, or empty when it is not installed. */
  static QString helperPath();
  /** "LibreDWG 0.14" or empty (cached after the first call). */
  static QString version();
  /** Starts a conversion; emits finished({id, ok, dxf (base64), ms, error, warnings}). Returns id. */
  QString convert(const QByteArray& dwg, const QString& name);

 signals:
  void finished(const QJsonObject& result);

 private:
  int seq_ = 0;
};

}  // namespace thcad::app
