#pragma once
// Video file from rendered frames. macOS: H.264 MP4 through AVFoundation; Windows: H.264 MP4 through Media
// Foundation (both OS encoders, no extra codecs shipped). If the OS encoder is unavailable the frames go to
// a Motion-JPEG AVI instead (plays in VLC / most players). Frames are RGBA8, all the same size.
#include <QImage>
#include <QString>
#include <memory>

namespace thcad::app {

class VideoWriter {
 public:
  VideoWriter();
  ~VideoWriter();
  /** Opens `basePath` + ".mp4" (or ".avi" when falling back); the final path is path(). */
  bool open(const QString& basePath, int w, int h, int fps);
  bool add(const QImage& frame);
  /** Finishes the file; false when nothing could be written. */
  bool close();
  QString path() const;
  /** "h264" or "mjpeg". */
  QString codec() const;
  QString error() const;

 private:
  struct Impl;
  std::unique_ptr<Impl> d;
};

/** Platform H.264 encoder (video_writer_mac.mm / video_writer_win.cpp); null when not available. */
struct H264Encoder {
  virtual ~H264Encoder() = default;
  virtual bool add(const QImage& rgba) = 0;
  virtual bool finish() = 0;
};
std::unique_ptr<H264Encoder> openH264(const QString& path, int w, int h, int fps, QString* error);

}  // namespace thcad::app
