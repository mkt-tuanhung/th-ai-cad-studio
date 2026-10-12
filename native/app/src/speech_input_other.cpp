#include "speech_input.hpp"

namespace thcad::app {
struct SpeechInput::Impl {};
SpeechInput::SpeechInput() : d(std::make_unique<Impl>()) {}
SpeechInput::~SpeechInput() = default;
bool SpeechInput::listening() const { return false; }
QString SpeechInput::availability(const QString&, bool* available, bool* onDevice) {
  *available = *onDevice = false;
  return QStringLiteral("no on-device speech recognizer on this platform");
}
void SpeechInput::start(const QString&, Callback cb) { cb({}, true, QStringLiteral("no on-device speech recognizer on this platform")); }
void SpeechInput::stop() {}
}  // namespace thcad::app
