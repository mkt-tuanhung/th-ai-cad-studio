// On-device speech recognition through the Speech framework (macOS 13+ on-device models).
#include "speech_input.hpp"

#import <AVFoundation/AVFoundation.h>
#import <Speech/Speech.h>

#include <QMetaObject>
#include <QCoreApplication>

namespace thcad::app {

struct SpeechInput::Impl {
  SFSpeechRecognizer* recognizer = nil;
  SFSpeechAudioBufferRecognitionRequest* request = nil;
  SFSpeechRecognitionTask* task = nil;
  AVAudioEngine* engine = nil;
  Callback cb;
  bool listening = false;

  /** Callbacks may come from Speech / audio threads: hop to the Qt main thread. */
  void send(const QString& text, bool final, const QString& error) {
    Callback c = cb;
    QMetaObject::invokeMethod(QCoreApplication::instance(), [c, text, final, error] {
      if (c) c(text, final, error);
    }, Qt::QueuedConnection);
  }
  void teardown() {
    if (engine) {
      [engine.inputNode removeTapOnBus:0];
      [engine stop];
    }
    [request endAudio];
    request = nil;
    task = nil;
    engine = nil;
    listening = false;
  }
};

SpeechInput::SpeechInput() : d(std::make_unique<Impl>()) {}
SpeechInput::~SpeechInput() {
  if (d->listening) d->teardown();
}
bool SpeechInput::listening() const { return d->listening; }

QString SpeechInput::availability(const QString& locale, bool* available, bool* onDevice) {
  SFSpeechRecognizer* r = [[SFSpeechRecognizer alloc] initWithLocale:[NSLocale localeWithLocaleIdentifier:locale.toNSString()]];
  *available = r != nil && r.isAvailable;
  *onDevice = r != nil && r.supportsOnDeviceRecognition;
  if (!r) return QStringLiteral("no recognizer for %1").arg(locale);
  if (!r.supportsOnDeviceRecognition) return QStringLiteral("no on-device speech model for %1 on this Mac (System Settings → Keyboard → Dictation can download it)").arg(locale);
  return QStringLiteral("ok");
}

void SpeechInput::start(const QString& locale, Callback cb) {
  if (d->listening) stop();
  d->cb = std::move(cb);
  NSString* loc = locale.toNSString();
  [SFSpeechRecognizer requestAuthorization:^(SFSpeechRecognizerAuthorizationStatus status) {
    if (status != SFSpeechRecognizerAuthorizationStatusAuthorized) {
      d->send({}, true, QStringLiteral("speech recognition permission was not granted (System Settings → Privacy & Security → Speech Recognition)"));
      return;
    }
    dispatch_async(dispatch_get_main_queue(), ^{
      d->recognizer = [[SFSpeechRecognizer alloc] initWithLocale:[NSLocale localeWithLocaleIdentifier:loc]];
      if (!d->recognizer || !d->recognizer.supportsOnDeviceRecognition) {
        d->send({}, true, QStringLiteral("no on-device speech model for %1 on this Mac — nothing is sent to a server, so voice input is unavailable for this language").arg(QString::fromNSString(loc)));
        return;
      }
      d->request = [[SFSpeechAudioBufferRecognitionRequest alloc] init];
      d->request.requiresOnDeviceRecognition = YES;
      d->request.shouldReportPartialResults = YES;
      d->engine = [[AVAudioEngine alloc] init];
      AVAudioInputNode* input = d->engine.inputNode;
      AVAudioFormat* fmt = [input outputFormatForBus:0];
      SFSpeechAudioBufferRecognitionRequest* req = d->request;
      [input installTapOnBus:0 bufferSize:1024 format:fmt block:^(AVAudioPCMBuffer* buffer, AVAudioTime*) {
        [req appendAudioPCMBuffer:buffer];
      }];
      NSError* err = nil;
      [d->engine prepare];
      if (![d->engine startAndReturnError:&err]) {
        d->send({}, true, QStringLiteral("microphone unavailable: %1").arg(QString::fromNSString(err.localizedDescription)));
        d->teardown();
        return;
      }
      d->listening = true;
      Impl* self = d.get();
      d->task = [d->recognizer recognitionTaskWithRequest:d->request resultHandler:^(SFSpeechRecognitionResult* result, NSError* error) {
        if (result) self->send(QString::fromNSString(result.bestTranscription.formattedString), result.isFinal, {});
        if (error && !result) self->send({}, true, QString::fromNSString(error.localizedDescription));
      }];
    });
  }];
}

void SpeechInput::stop() {
  if (!d->listening) return;
  if (d->engine) {
    [d->engine.inputNode removeTapOnBus:0];
    [d->engine stop];
  }
  [d->request endAudio];  // the task delivers the final transcription
  d->listening = false;
}

}  // namespace thcad::app
