#pragma once
// Speech to text with whisper.cpp, run as a separate helper program (whisper-cli) so its ggml never meets
// the one llama.cpp links into the app. The model (ggml-*.bin) lives in <models>/whisper/. Everything runs
// on this computer: the audio is a temporary WAV file that is deleted after the run.
#include <QJsonObject>
#include <QString>
#include <functional>

namespace thcad::app {

class WhisperRunner {
 public:
  static QString helperPath();
  static QString modelPath();
  /** {available, helper, model, modelBytes, reason?} */
  static QJsonObject status();
  /** 16 kHz mono PCM16 WAV → text. `lang`: "vi", "en" or "auto". Calls `done` on the GUI thread with
   *  {ok, text, ms, error?}. */
  static void transcribe(const QByteArray& wav, const QString& lang, std::function<void(QJsonObject)> done);
  /** Downloads the default model (ggml-large-v3-turbo-q5_0, 547 MB, sha256-pinned) into <models>/whisper —
   *  only when the user presses Download. `progress` gets {received, total} then {done, ok, error?}. */
  static void download(std::function<void(QJsonObject)> progress);
  /** Once per session: a short silent run so the GPU kernels are compiled (first run of a new binary can
   *  take tens of seconds) while the user is still speaking. */
  static void warmup();

 private:
  static void run(const QByteArray& wav, const QString& lang, std::function<void(QJsonObject)> done);
};

}  // namespace thcad::app
