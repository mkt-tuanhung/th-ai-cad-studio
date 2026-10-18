#pragma once
// Reading reference photos with a local vision-language model (Qwen2.5-VL GGUF + its mmproj projector), run as a
// separate helper program: llama.cpp's `llama-mtmd-cli`, like whisper-cli for speech. Why a helper and not libmtmd
// in the app:
//   - the 7B VL model needs ~5.5 GB while it runs: a child process gives it back to the system as soon as the photo
//     is read, and the app's own text model (in-process llama.cpp) stays loaded and untouched;
//   - a crash or a GPU driver problem in the vision path cannot take the app (and the user's drawing) down;
//   - on Windows the app links vcpkg's llama.cpp (no multimodal library); the helper is built from a pinned
//     llama.cpp source with the Vulkan + CPU backends and ships in its own folder with its own ggml DLLs.
// Everything runs on this computer: the photos are temporary files deleted after the run; the helper is never
// given a URL (no -hf / -mu options), so it does not touch the network.
//
// The model files live in <models>/vision/: the model (*.gguf) and its projector (mmproj*.gguf). The download is the
// regular model downloader (Settings → Manage Models), entry "qwen2.5-vl-7b-instruct-q4_k_m".
#include <QByteArray>
#include <QJsonObject>
#include <QList>
#include <QString>
#include <functional>

namespace thcad::app {

class VisionRunner {
 public:
  struct Task {
    QString id;
    QList<QByteArray> images;  // JPEG / PNG bytes, 1–5
    QString system, prompt;
    QString grammar;           // GBNF (root rule "root"), optional
    int maxTokens = 700;
  };
  static QString helperPath();
  static QString modelDir();
  static QString modelPath();
  static QString projectorPath();
  /** {available, helper, model, mmproj, modelBytes, device?, reason?} */
  static QJsonObject status();
  /** Starts a run; false + error when it cannot (busy, no model, bad image). `done` is called on the GUI thread
   *  with {id, ok, text, ms, device, error?}. */
  static QJsonObject analyze(const Task& task, std::function<void(QJsonObject)> done);
  /** Stops the running analysis of `id` (its result arrives with ok:false, cancelled:true). */
  static bool cancel(const QString& id);
};

}  // namespace thcad::app
