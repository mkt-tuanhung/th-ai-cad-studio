#pragma once
// Voice input for Voice CAD: on-device speech recognition only (macOS Speech framework with
// requiresOnDeviceRecognition; Windows SAPI dictation). Nothing is sent over the network: a language without
// an on-device model is reported as unavailable instead of falling back to a server.
#include <QObject>
#include <QString>
#include <functional>
#include <memory>

namespace thcad::app {

class SpeechInput {
 public:
  /** Partial / final text, or an error (text empty, error set). */
  using Callback = std::function<void(const QString& text, bool final, const QString& error)>;
  SpeechInput();
  ~SpeechInput();
  /** Starts listening (asks for microphone / speech permission the first time); locale like "vi-VN", "en-US". */
  void start(const QString& locale, Callback cb);
  void stop();
  bool listening() const;
  /** {available, onDevice, locale, reason} for a locale. */
  static QString availability(const QString& locale, bool* available, bool* onDevice);

 private:
  struct Impl;
  std::unique_ptr<Impl> d;
};

}  // namespace thcad::app
