// H.264 MP4 through Media Foundation (Windows system encoder).
#include "video_writer.hpp"

#include <windows.h>
#include <mfapi.h>
#include <mferror.h>
#include <mfidl.h>
#include <mfreadwrite.h>

namespace thcad::app {

namespace {
template <class T>
void release(T*& p) {
  if (p) p->Release(), p = nullptr;
}

class WinH264 final : public H264Encoder {
 public:
  IMFSinkWriter* writer = nullptr;
  DWORD stream = 0;
  int w = 0, h = 0, fps = 24;
  LONGLONG frame = 0;
  bool started = false;
  ~WinH264() override {
    release(writer);
    if (started) MFShutdown();
  }
  bool add(const QImage& rgba) override {
    const DWORD bytes = DWORD(w) * DWORD(h) * 4;
    IMFMediaBuffer* buf = nullptr;
    IMFSample* sample = nullptr;
    if (FAILED(MFCreateMemoryBuffer(bytes, &buf))) return false;
    BYTE* dst = nullptr;
    buf->Lock(&dst, nullptr, nullptr);
    for (int y = 0; y < h; ++y) {
      const uchar* s = rgba.constScanLine(y);
      BYTE* o = dst + size_t(y) * w * 4;
      for (int x = 0; x < w; ++x) {  // RGBA → BGRA (RGB32)
        o[4 * x + 0] = s[4 * x + 2];
        o[4 * x + 1] = s[4 * x + 1];
        o[4 * x + 2] = s[4 * x + 0];
        o[4 * x + 3] = 255;
      }
    }
    buf->Unlock();
    buf->SetCurrentLength(bytes);
    bool ok = SUCCEEDED(MFCreateSample(&sample)) && SUCCEEDED(sample->AddBuffer(buf));
    const LONGLONG dur = 10000000LL / fps;
    if (ok) ok = SUCCEEDED(sample->SetSampleTime(frame * dur)) && SUCCEEDED(sample->SetSampleDuration(dur)) && SUCCEEDED(writer->WriteSample(stream, sample));
    ++frame;
    release(sample);
    release(buf);
    return ok;
  }
  bool finish() override { return writer && SUCCEEDED(writer->Finalize()); }
};
}  // namespace

std::unique_ptr<H264Encoder> openH264(const QString& path, int w, int h, int fps, QString* error) {
  auto enc = std::make_unique<WinH264>();
  enc->w = w, enc->h = h, enc->fps = fps;
  if (FAILED(MFStartup(MF_VERSION))) {
    if (error) *error = "Media Foundation is not available";
    return nullptr;
  }
  enc->started = true;
  IMFMediaType *out = nullptr, *in = nullptr;
  auto fail = [&](const char* why) {
    if (error) *error = why;
    release(out);
    release(in);
    return std::unique_ptr<H264Encoder>();
  };
  if (FAILED(MFCreateSinkWriterFromURL(reinterpret_cast<LPCWSTR>(path.utf16()), nullptr, nullptr, &enc->writer))) return fail("MFCreateSinkWriterFromURL failed");
  MFCreateMediaType(&out);
  out->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Video);
  out->SetGUID(MF_MT_SUBTYPE, MFVideoFormat_H264);
  out->SetUINT32(MF_MT_AVG_BITRATE, UINT32(std::max(2000000, w * h * 6)));
  out->SetUINT32(MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive);
  MFSetAttributeSize(out, MF_MT_FRAME_SIZE, UINT32(w), UINT32(h));
  MFSetAttributeRatio(out, MF_MT_FRAME_RATE, UINT32(fps), 1);
  MFSetAttributeRatio(out, MF_MT_PIXEL_ASPECT_RATIO, 1, 1);
  if (FAILED(enc->writer->AddStream(out, &enc->stream))) return fail("no H.264 encoder");
  MFCreateMediaType(&in);
  in->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Video);
  in->SetGUID(MF_MT_SUBTYPE, MFVideoFormat_RGB32);
  in->SetUINT32(MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive);
  in->SetUINT32(MF_MT_DEFAULT_STRIDE, UINT32(w * 4));  // top-down rows
  MFSetAttributeSize(in, MF_MT_FRAME_SIZE, UINT32(w), UINT32(h));
  MFSetAttributeRatio(in, MF_MT_FRAME_RATE, UINT32(fps), 1);
  MFSetAttributeRatio(in, MF_MT_PIXEL_ASPECT_RATIO, 1, 1);
  if (FAILED(enc->writer->SetInputMediaType(enc->stream, in, nullptr))) return fail("the H.264 encoder rejects RGB32 input");
  if (FAILED(enc->writer->BeginWriting())) return fail("BeginWriting failed");
  release(out);
  release(in);
  return enc;
}

}  // namespace thcad::app
