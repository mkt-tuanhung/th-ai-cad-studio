#include "licence_gate.hpp"

#include <QApplication>
#include <QClipboard>
#include <QDir>
#include <QFile>
#include <QFileDialog>
#include <QFileInfo>
#include <QHBoxLayout>
#include <QKeyEvent>
#include <QLabel>
#include <QLineEdit>
#include <QMessageBox>
#include <QPainter>
#include <QPlainTextEdit>
#include <QProcess>
#include <QPropertyAnimation>
#include <QPushButton>
#include <QSaveFile>
#include <QStandardPaths>
#include <QTimer>
#include <QVBoxLayout>

#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>

#include "thcad/license/license.hpp"

namespace thcad::app::licence {

namespace {

#include "licence_data.inc"

/** The owner's public key, rebuilt from its two halves for each verification (never kept as one array). */
struct PublicKey {
  unsigned char k[32];
  PublicKey() {
    for (int i = 0; i < 32; ++i) k[i] = static_cast<unsigned char>(kPkA[i] ^ kPkB[i]);
  }
  ~PublicKey() {
    volatile unsigned char* p = k;
    for (int i = 0; i < 32; ++i) p[i] = 0;
  }
};

Status fromResult(const license::VerifyResult& r, const QString& machine) {
  Status s;
  s.machineCode = machine;
  s.licensed = r.ok && r.reason == license::Reason::Ok;
  s.reason = QString::fromLatin1(license::reasonCode(r.reason));
  if (r.reason == license::Reason::Ok || r.reason == license::Reason::Expired || r.reason == license::Reason::WrongMachine) {
    s.customer = QString::fromStdString(r.info.customer);
    s.serial = r.info.serial;
    s.issued = QString::fromStdString(license::dayToIso(r.info.issuedDay));
    s.expires = r.info.expiryDay ? QString::fromStdString(license::dayToIso(r.info.expiryDay)) : QString();
  }
  return s;
}

Status verifyText(const QByteArray& text) {
  license::init();
  const QString machine = QString::fromStdString(license::machineCode());
  if (machine.isEmpty()) {
    Status s;
    s.reason = QStringLiteral("no-machine-code");
    return s;
  }
  const PublicKey pk;
  const auto r = license::verifyKey(std::string_view(text.constData(), std::size_t(text.size())), machine.toStdString(), pk.k, license::todayDay());
  return fromResult(r, machine);
}

}  // namespace

QString trialNotice() {
  QByteArray b(int(sizeof kWmA), '\0');
  for (int i = 0; i < int(sizeof kWmA); ++i) b[i] = char(kWmA[i] ^ kWmB[i]);
  return QString::fromUtf8(b);
}

QString storedKeyPath() {
  return QStandardPaths::writableLocation(QStandardPaths::AppDataLocation) + QStringLiteral("/licence.mdkey");
}

Status check() {
  QFile f(storedKeyPath());
  if (!f.open(QIODevice::ReadOnly)) {
    license::init();
    Status s;
    s.machineCode = QString::fromStdString(license::machineCode());
    s.reason = QStringLiteral("missing");
    return s;
  }
  return verifyText(f.read(64 * 1024));
}

Status activate(const QString& keyText) {
  const QByteArray text = keyText.toUtf8();
  Status s = verifyText(text);
  if (!s.licensed) return s;
  QDir().mkpath(QFileInfo(storedKeyPath()).absolutePath());
  QSaveFile out(storedKeyPath());
  if (!out.open(QIODevice::WriteOnly) || out.write(text) != text.size() || !out.commit()) {
    s.licensed = false;
    s.reason = QStringLiteral("save");
    return s;
  }
  return check();  // read back what was stored
}

QJsonObject toJson(const Status& s) {
  return {{"enforced", enforced()}, {"licensed", s.licensed}, {"reason", s.reason}, {"machineCode", s.machineCode},
          {"customer", s.customer}, {"serial", qint64(s.serial)}, {"issued", s.issued}, {"expires", s.expires}};
}

QString message(const QString& reason) {
  if (reason == QLatin1String("ok")) return QStringLiteral("Đã kích hoạt bản quyền cho máy này.");
  if (reason == QLatin1String("missing") || reason == QLatin1String("empty")) return QStringLiteral("Chưa nhập KEY.");
  if (reason == QLatin1String("machine")) return QStringLiteral("KEY này được cấp cho máy khác. Mỗi máy cần một KEY riêng — hãy gửi đúng mã máy bên trên.");
  if (reason == QLatin1String("signature")) return QStringLiteral("Sai KEY: KEY không do Minh Dũng cấp.");
  if (reason == QLatin1String("corrupted")) return QStringLiteral("KEY bị hỏng hoặc thiếu ký tự. Hãy dán lại đủ cả KEY, hoặc chọn file .mdkey.");
  if (reason == QLatin1String("malformed")) return QStringLiteral("Đây không phải KEY của MD CAD AI STUDIO.");
  if (reason == QLatin1String("expired")) return QStringLiteral("KEY đã hết hạn. Vui lòng liên hệ để gia hạn.");
  if (reason == QLatin1String("version")) return QStringLiteral("KEY dành cho phiên bản khác của phần mềm.");
  if (reason == QLatin1String("no-machine-code")) return QStringLiteral("Không đọc được mã máy của máy tính này.");
  if (reason == QLatin1String("save")) return QStringLiteral("Không lưu được KEY vào máy (quyền ghi thư mục người dùng).");
  return QStringLiteral("KEY không hợp lệ.");
}

int sanitiseArguments(int argc, char** argv) {
  if (!enforced()) return argc;
  qunsetenv("QTWEBENGINE_REMOTE_DEBUGGING");
  qunsetenv("QTWEBENGINE_CHROMIUM_FLAGS");
  qunsetenv("QTWEBENGINE_DISABLE_SANDBOX");
  int out = 0;
  for (int i = 0; i < argc; ++i) {
    const char* a = argv[i];
    if (i > 0 && (std::strncmp(a, "--remote-debugging", 18) == 0 || std::strncmp(a, "--remote-allow-origins", 22) == 0 ||
                  std::strncmp(a, "--inspect", 9) == 0 || std::strncmp(a, "--webEngineArgs", 15) == 0 || std::strncmp(a, "--js-flags", 10) == 0))
      continue;
    argv[out++] = argv[i];
  }
  argv[out] = nullptr;
  return out;
}

int handleCommandLine(int argc, char** argv) {
  for (int i = 1; i < argc; ++i) {
    const QString a = QString::fromLocal8Bit(argv[i]);
    if (a == QLatin1String("--licence-info")) {
      const Status s = check();
      std::printf("enforce=%d licensed=%d reason=%s machine=%s\n", enforced() ? 1 : 0, s.licensed ? 1 : 0, qPrintable(s.reason), qPrintable(s.machineCode));
      std::fflush(stdout);
      return 0;
    }
    if (a.startsWith(QLatin1String("--licence-activate="))) {
      QFile f(a.mid(19));
      if (!f.open(QIODevice::ReadOnly)) {
        std::printf("licensed=0 reason=file\n");
        std::fflush(stdout);
        return 2;
      }
      const Status s = activate(QString::fromUtf8(f.read(64 * 1024)));
      std::printf("licensed=%d reason=%s machine=%s serial=%u\n", s.licensed ? 1 : 0, qPrintable(s.reason), qPrintable(s.machineCode), s.serial);
      std::fflush(stdout);
      return s.licensed ? 0 : 1;
    }
  }
  return -1;
}

// ---------------------------------------------------------------- overlay
TrialOverlay::TrialOverlay(QWidget* parent) : QWidget(parent) {
  setAttribute(Qt::WA_NoSystemBackground);
  setFocusPolicy(Qt::StrongFocus);
  setCursor(Qt::ForbiddenCursor);
  parent->installEventFilter(this);
  setGeometry(parent->rect());
  raise();
  // stay on top of whatever the web view creates later (its render widget is a child too)
  auto* keepOnTop = new QTimer(this);
  connect(keepOnTop, &QTimer::timeout, this, [this] {
    raise();
    if (geometry() != parentWidget()->rect()) setGeometry(parentWidget()->rect());
  });
  keepOnTop->start(500);
  QTimer::singleShot(900, this, &TrialOverlay::showActivation);
}

bool TrialOverlay::eventFilter(QObject* o, QEvent* e) {
  if (o == parentWidget() && e->type() == QEvent::Resize) setGeometry(parentWidget()->rect());
  return QWidget::eventFilter(o, e);
}

void TrialOverlay::paintEvent(QPaintEvent*) {
  QPainter p(this);
  p.setRenderHint(QPainter::Antialiasing);
  p.setRenderHint(QPainter::TextAntialiasing);
  p.fillRect(rect(), QColor(5, 8, 11, 150));
  const QString notice = trialNotice();
  // diagonal repeated watermark
  p.save();
  p.translate(width() / 2.0, height() / 2.0);
  p.rotate(-28);
  QFont f = font();
  f.setPixelSize(26);
  f.setBold(true);
  p.setFont(f);
  p.setPen(QColor(255, 255, 255, 46));
  const int step = 120;
  const int span = int(std::hypot(width(), height()));
  for (int y = -span; y < span; y += step) {
    const int shift = ((y / step) % 2) * 380;
    for (int x = -span - shift; x < span; x += 1500) p.drawText(QPoint(x, y), notice);
  }
  p.restore();
  // bottom banner
  const int bh = 54;
  const QRect banner(0, height() - bh, width(), bh);
  p.fillRect(banner, QColor(150, 20, 24, 235));
  QFont bf = font();
  bf.setPixelSize(17);
  bf.setBold(true);
  p.setFont(bf);
  p.setPen(Qt::white);
  p.drawText(banner.adjusted(16, 0, -16, 0), Qt::AlignCenter | Qt::TextSingleLine, notice);
}

void TrialOverlay::mousePressEvent(QMouseEvent*) { showActivation(); }
void TrialOverlay::keyPressEvent(QKeyEvent*) { showActivation(); }

void TrialOverlay::showActivation() {
  if (!dialog_) dialog_ = new ActivationDialog(window());
  if (dialog_->isVisible()) {
    dialog_->raise();
    dialog_->activateWindow();
    dialog_->shake();
    return;
  }
  dialog_->show();
  dialog_->raise();
  dialog_->activateWindow();
}

// ---------------------------------------------------------------- activation dialog
ActivationDialog::ActivationDialog(QWidget* parent) : QDialog(parent) {
  setWindowTitle(QStringLiteral("Kích hoạt bản quyền — MD CAD AI STUDIO"));
  setModal(true);
  setMinimumWidth(620);
  setStyleSheet(QStringLiteral(
      "QDialog{background:#0d1319;color:#e6edf3;} QLabel{color:#e6edf3;} QLabel#notice{color:#ff8a80;font-weight:700;font-size:15px;}"
      "QLabel#err{color:#ffb4ab;} QLabel#ok{color:#7ee2a8;} QLineEdit,QPlainTextEdit{background:#05080b;color:#e6edf3;border:1px solid #2b3946;"
      "border-radius:6px;padding:6px;font-family:Menlo,Consolas,monospace;font-size:13px;} QPushButton{background:#1b2732;color:#e6edf3;"
      "border:1px solid #2b3946;border-radius:6px;padding:7px 14px;} QPushButton:hover{background:#243443;} QPushButton#primary{background:#1f6feb;"
      "border-color:#1f6feb;font-weight:700;} QPushButton#primary:hover{background:#388bfd;}"));
  auto* v = new QVBoxLayout(this);
  v->setSpacing(10);
  auto* title = new QLabel(QStringLiteral("<b style='font-size:18px'>MD CAD AI STUDIO — BẢN DÙNG THỬ BỊ KHOÁ</b>"));
  v->addWidget(title);
  auto* notice = new QLabel(trialNotice());
  notice->setObjectName(QStringLiteral("notice"));
  notice->setWordWrap(true);
  v->addWidget(notice);
  v->addWidget(new QLabel(QStringLiteral("Mọi chức năng đang bị khoá. Gửi <b>mã máy</b> dưới đây cho Minh Dũng (HOTLINE <b>0879232666</b>) để nhận KEY. "
                                         "Mỗi máy một KEY; KEY của máy khác sẽ không dùng được trên máy này.")));
  qobject_cast<QLabel*>(v->itemAt(v->count() - 1)->widget())->setWordWrap(true);

  v->addWidget(new QLabel(QStringLiteral("Mã máy của máy này:")));
  auto* row = new QHBoxLayout;
  code_ = new QLineEdit(check().machineCode);
  code_->setReadOnly(true);
  code_->setObjectName(QStringLiteral("machineCode"));
  auto* copy = new QPushButton(QStringLiteral("Sao chép mã máy"));
  row->addWidget(code_, 1);
  row->addWidget(copy);
  v->addLayout(row);
  connect(copy, &QPushButton::clicked, this, [this, copy] {
    QApplication::clipboard()->setText(code_->text());
    copy->setText(QStringLiteral("Đã sao chép ✓"));
    QTimer::singleShot(1800, copy, [copy] { copy->setText(QStringLiteral("Sao chép mã máy")); });
  });

  v->addWidget(new QLabel(QStringLiteral("Dán KEY vào đây:")));
  key_ = new QPlainTextEdit;
  key_->setPlaceholderText(QStringLiteral("MDK1-XXXXX-XXXXX-…"));
  key_->setFixedHeight(96);
  v->addWidget(key_);
  error_ = new QLabel;
  error_->setObjectName(QStringLiteral("err"));
  error_->setWordWrap(true);
  v->addWidget(error_);

  auto* buttons = new QHBoxLayout;
  auto* file = new QPushButton(QStringLiteral("Chọn file key (.mdkey)…"));
  auto* quit = new QPushButton(QStringLiteral("Thoát phần mềm"));
  auto* go = new QPushButton(QStringLiteral("Kích hoạt"));
  go->setObjectName(QStringLiteral("primary"));
  go->setDefault(true);
  buttons->addWidget(file);
  buttons->addStretch(1);
  buttons->addWidget(quit);
  buttons->addWidget(go);
  v->addLayout(buttons);
  v->addWidget(new QLabel(QStringLiteral("<span style='color:#8b98a5'>Xây dựng và phát triển bởi Minh Dũng</span>")));

  connect(go, &QPushButton::clicked, this, [this] { tryActivate(key_->toPlainText()); });
  connect(quit, &QPushButton::clicked, qApp, &QApplication::quit);
  connect(file, &QPushButton::clicked, this, [this] {
    const QString path = QFileDialog::getOpenFileName(this, QStringLiteral("Chọn file KEY"), QStandardPaths::writableLocation(QStandardPaths::DownloadLocation),
                                                      QStringLiteral("KEY MD CAD AI STUDIO (*.mdkey *.txt);;Tất cả (*)"));
    if (path.isEmpty()) return;
    QFile f(path);
    if (!f.open(QIODevice::ReadOnly) || f.size() > 64 * 1024) {
      error_->setText(QStringLiteral("Không đọc được file KEY."));
      return shake();
    }
    const QString text = QString::fromUtf8(f.readAll());
    key_->setPlainText(text);
    tryActivate(text);
  });
}

void ActivationDialog::tryActivate(const QString& text) {
  const Status s = activate(text);
  if (!s.licensed) {
    error_->setText(message(s.reason));
    return shake();
  }
  error_->setText(QString());
  QMessageBox::information(this, QStringLiteral("Kích hoạt thành công"),
                           QStringLiteral("Đã kích hoạt bản quyền%1 cho máy này.\nPhần mềm sẽ khởi động lại để mở đầy đủ chức năng.")
                               .arg(s.customer.isEmpty() ? QString() : QStringLiteral(" (") + s.customer + QStringLiteral(")")));
  // restart into full mode: a fresh process registers the native bridge from the start
  QStringList args = QCoreApplication::arguments();
  args.removeFirst();
  QProcess::startDetached(QCoreApplication::applicationFilePath(), args);
  QApplication::quit();
}

void ActivationDialog::shake() {
  auto* a = new QPropertyAnimation(this, "pos", this);
  const QPoint p = pos();
  a->setDuration(360);
  a->setKeyValueAt(0, p);
  for (int i = 1; i < 6; ++i) a->setKeyValueAt(i / 6.0, p + QPoint(i % 2 ? 12 : -12, 0));
  a->setKeyValueAt(1, p);
  a->start(QAbstractAnimation::DeleteWhenStopped);
  QApplication::beep();
}

}  // namespace thcad::app::licence
