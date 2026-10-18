#pragma once
// Licence gate of the desktop app (qa/v2_4/QA_LICENSE.md). A customer build (THCAD_LICENSE_ENFORCE) starts
// LOCKED until a key signed by the owner for THIS computer's machine code is activated:
//  - no HostBridge on the web channel (the UI gets no native function at all), the web view takes no input;
//  - a native, Qt-painted watermark over the window and the activation dialog (machine code, key, .mdkey file);
//  - QA hooks (THCAD_SCRIPT, THCAD_SELFTEST, THCAD_UI_URL, THCAD_UI_DIR) and remote debugging are ignored.
// Dev / QA builds (enforce off) never lock; they still read and show a stored licence.
#include <QDialog>
#include <QJsonObject>
#include <QString>
#include <QWidget>

class QLabel;
class QPlainTextEdit;
class QLineEdit;

namespace thcad::app::licence {

/** Compile-time: true in customer builds. */
constexpr bool enforced() {
#ifdef THCAD_LICENSE_ENFORCE
  return true;
#else
  return false;
#endif
}

struct Status {
  bool licensed = false;
  QString reason;       // "ok" | "missing" | license::reasonCode(…)
  QString machineCode;  // this computer
  QString customer;
  quint32 serial = 0;
  QString issued, expires;  // ISO dates ("" = perpetual)
};

/** Re-verifies the stored key against this computer, every call (cheap: one Ed25519 verification). */
Status check();
/** Verifies `keyText` (pasted text or a .mdkey file) for this computer and stores it when valid. */
Status activate(const QString& keyText);
/** {enforced, licensed, reason, machineCode, customer, serial, issued, expires} for Settings. */
QJsonObject toJson(const Status& s);
/** Vietnamese message for a reason code. */
QString message(const QString& reason);
/** The exact trial notice (owner's text). */
QString trialNotice();
/** Where the activated key is kept (per user, per machine). */
QString storedKeyPath();
/** Before QApplication in customer builds: drops remote-debugging switches / env so the locked page cannot be
 *  driven from outside. Returns the filtered argument count (argv is compacted in place). */
int sanitiseArguments(int argc, char** argv);
/** CLI: `--licence-info` → prints "enforce=… licensed=… reason=… machine=…" and returns the exit code;
 *  `--licence-activate=<file>` → activates a .mdkey file. Returns -1 when no licence switch was given. */
int handleCommandLine(int argc, char** argv);

/** Watermark painted natively over the locked window; it takes every mouse / key event (nothing reaches the
 *  web view) and opens the activation dialog. */
class TrialOverlay : public QWidget {
  Q_OBJECT
 public:
  explicit TrialOverlay(QWidget* parent);
  void showActivation();

 protected:
  void paintEvent(QPaintEvent*) override;
  void mousePressEvent(QMouseEvent*) override;
  void keyPressEvent(QKeyEvent*) override;
  bool eventFilter(QObject*, QEvent*) override;

 private:
  class ActivationDialog* dialog_ = nullptr;
};

class ActivationDialog : public QDialog {
  Q_OBJECT
 public:
  explicit ActivationDialog(QWidget* parent);
  void shake();

 private:
  void tryActivate(const QString& text);
  QLabel* error_ = nullptr;
  QPlainTextEdit* key_ = nullptr;
  QLineEdit* code_ = nullptr;
};

}  // namespace thcad::app::licence
