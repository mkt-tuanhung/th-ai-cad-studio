// Offline dictation through SAPI 5 (the in-process recognizer of the installed Windows speech language).
#include "speech_input.hpp"

#include <QCoreApplication>
#include <QMetaObject>

#include <atomic>
#include <thread>

#include <windows.h>
#include <sapi.h>
#include <sphelper.h>

namespace thcad::app {

namespace {
const wchar_t* lcidOf(const QString& locale) {
  if (locale.startsWith("vi")) return L"Language=42A";
  if (locale.startsWith("en-GB")) return L"Language=809";
  return L"Language=409";  // en-US
}
}  // namespace

struct SpeechInput::Impl {
  std::thread worker;
  std::atomic<bool> run{false};
  Callback cb;
  void send(const QString& text, bool final, const QString& error) {
    Callback c = cb;
    QMetaObject::invokeMethod(QCoreApplication::instance(), [c, text, final, error] {
      if (c) c(text, final, error);
    }, Qt::QueuedConnection);
  }
};

SpeechInput::SpeechInput() : d(std::make_unique<Impl>()) {}
SpeechInput::~SpeechInput() { stop(); }
bool SpeechInput::listening() const { return d->run; }

QString SpeechInput::availability(const QString& locale, bool* available, bool* onDevice) {
  CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  ISpObjectToken* token = nullptr;
  const bool ok = SUCCEEDED(SpFindBestToken(SPCAT_RECOGNIZERS, lcidOf(locale), nullptr, &token)) && token;
  if (token) token->Release();
  *available = *onDevice = ok;
  return ok ? QStringLiteral("ok") : QStringLiteral("no Windows speech recognizer for %1 is installed (Settings → Time & language → Speech)").arg(locale);
}

void SpeechInput::start(const QString& locale, Callback cb) {
  stop();
  d->cb = std::move(cb);
  d->run = true;
  const std::wstring lang = lcidOf(locale);
  d->worker = std::thread([this, lang] {
    CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    ISpRecognizer* rec = nullptr;
    ISpObjectToken *engine = nullptr, *audio = nullptr;
    ISpRecoContext* ctx = nullptr;
    ISpRecoGrammar* gram = nullptr;
    auto fail = [&](const char* why) {
      d->send({}, true, QString::fromLatin1(why));
      d->run = false;
    };
    if (FAILED(CoCreateInstance(CLSID_SpInprocRecognizer, nullptr, CLSCTX_ALL, IID_ISpRecognizer, reinterpret_cast<void**>(&rec)))) fail("SAPI recognizer unavailable");
    else if (FAILED(SpFindBestToken(SPCAT_RECOGNIZERS, lang.c_str(), nullptr, &engine)) || !engine) fail("no Windows speech recognizer for this language is installed");
    else if (FAILED(rec->SetRecognizer(engine)) || FAILED(SpGetDefaultTokenFromCategoryId(SPCAT_AUDIOIN, &audio)) || FAILED(rec->SetInput(audio, TRUE))) fail("microphone unavailable");
    else if (FAILED(rec->CreateRecoContext(&ctx)) || FAILED(ctx->SetNotifyWin32Event()) || FAILED(ctx->SetInterest(SPFEI(SPEI_RECOGNITION) | SPFEI(SPEI_HYPOTHESIS), SPFEI(SPEI_RECOGNITION) | SPFEI(SPEI_HYPOTHESIS)))) fail("SAPI context failed");
    else if (FAILED(ctx->CreateGrammar(0, &gram)) || FAILED(gram->LoadDictation(nullptr, SPLO_STATIC)) || FAILED(gram->SetDictationState(SPRS_ACTIVE))) fail("dictation grammar failed");
    QString text;
    while (d->run) {
      if (ctx->WaitForNotifyEvent(100) != S_OK) continue;
      CSpEvent ev;
      while (ev.GetFrom(ctx) == S_OK) {
        ISpRecoResult* r = ev.RecoResult();
        LPWSTR w = nullptr;
        if (r && SUCCEEDED(r->GetText(SP_GETWHOLEPHRASE, SP_GETWHOLEPHRASE, TRUE, &w, nullptr)) && w) {
          const QString part = QString::fromWCharArray(w);
          CoTaskMemFree(w);
          if (ev.eEventId == SPEI_RECOGNITION) text = (text.isEmpty() ? part : text + " " + part), d->send(text, false, {});
          else d->send(text.isEmpty() ? part : text + " " + part, false, {});
        }
      }
    }
    if (gram) gram->SetDictationState(SPRS_INACTIVE), gram->Release();
    if (ctx) ctx->Release();
    if (audio) audio->Release();
    if (engine) engine->Release();
    if (rec) rec->Release();
    d->send(text, true, {});
    CoUninitialize();
  });
}

void SpeechInput::stop() {
  d->run = false;
  if (d->worker.joinable()) d->worker.join();
}

}  // namespace thcad::app
