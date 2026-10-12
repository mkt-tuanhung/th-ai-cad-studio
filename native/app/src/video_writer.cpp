#include "video_writer.hpp"

#include <QBuffer>
#include <QFile>
#include <QFileInfo>

#include <vector>

namespace thcad::app {

namespace {
void u32(QByteArray& b, quint32 v) {
  for (int i = 0; i < 4; ++i) b.append(char((v >> (8 * i)) & 0xff));
}
void u16(QByteArray& b, quint16 v) {
  b.append(char(v & 0xff));
  b.append(char(v >> 8));
}
void fourcc(QByteArray& b, const char* c) { b.append(c, 4); }

/** Minimal RIFF AVI with one Motion-JPEG video stream (OpenDML not needed below 1 GB). */
class MjpegAvi {
 public:
  bool open(const QString& path, int w, int h, int fps) {
    f_.setFileName(path);
    if (!f_.open(QIODevice::WriteOnly | QIODevice::Truncate)) return false;
    w_ = w, h_ = h, fps_ = fps;
    f_.write(header(0, 0));  // rewritten in close()
    moviStart_ = f_.pos();
    f_.write("LIST");
    f_.write(QByteArray(4, 0));
    f_.write("movi");
    return true;
  }
  bool add(const QImage& img) {
    QByteArray jpg;
    QBuffer buf(&jpg);
    buf.open(QIODevice::WriteOnly);
    if (!img.convertToFormat(QImage::Format_RGB888).save(&buf, "JPG", 90)) return false;
    if (jpg.size() % 2) jpg.append('\0');
    QByteArray chunk;
    fourcc(chunk, "00dc");
    u32(chunk, quint32(jpg.size()));
    chunk.append(jpg);
    index_.push_back({quint32(f_.pos() - moviStart_ - 8), quint32(jpg.size())});
    maxSize_ = std::max(maxSize_, quint32(jpg.size()));
    return f_.write(chunk) == chunk.size();
  }
  bool close() {
    const qint64 moviEnd = f_.pos();
    QByteArray idx;
    fourcc(idx, "idx1");
    u32(idx, quint32(index_.size() * 16));
    for (const auto& [off, size] : index_) {
      fourcc(idx, "00dc");
      u32(idx, 0x10);  // keyframe
      u32(idx, off);
      u32(idx, size);
    }
    f_.write(idx);
    const qint64 end = f_.pos();
    // patch sizes: movi list, RIFF, header with frame count
    f_.seek(moviStart_ + 4);
    QByteArray s;
    u32(s, quint32(moviEnd - moviStart_ - 8));
    f_.write(s);
    f_.seek(0);
    f_.write(header(int(index_.size()), quint32(end - 8)));
    f_.close();
    return !index_.empty();
  }

 private:
  QByteArray header(int frames, quint32 riffSize) {
    QByteArray hdrl, avih, strl, strh, strf;
    // main header
    u32(avih, quint32(1000000 / fps_));
    u32(avih, maxSize_ * fps_);
    u32(avih, 0);
    u32(avih, 0x10);  // AVIF_HASINDEX
    u32(avih, quint32(frames));
    u32(avih, 0);
    u32(avih, 1);
    u32(avih, maxSize_);
    u32(avih, quint32(w_));
    u32(avih, quint32(h_));
    for (int i = 0; i < 4; ++i) u32(avih, 0);
    // stream header
    fourcc(strh, "vids");
    fourcc(strh, "MJPG");
    u32(strh, 0);
    u16(strh, 0);
    u16(strh, 0);
    u32(strh, 0);
    u32(strh, 1);
    u32(strh, quint32(fps_));
    u32(strh, 0);
    u32(strh, quint32(frames));
    u32(strh, maxSize_);
    u32(strh, quint32(-1));
    u32(strh, 0);
    u16(strh, 0), u16(strh, 0), u16(strh, quint16(w_)), u16(strh, quint16(h_));
    // BITMAPINFOHEADER
    u32(strf, 40);
    u32(strf, quint32(w_));
    u32(strf, quint32(h_));
    u16(strf, 1);
    u16(strf, 24);
    fourcc(strf, "MJPG");
    u32(strf, quint32(w_ * h_ * 3));
    for (int i = 0; i < 4; ++i) u32(strf, 0);
    auto chunk = [](const char* id, const QByteArray& body) {
      QByteArray c;
      fourcc(c, id);
      u32(c, quint32(body.size()));
      c.append(body);
      return c;
    };
    auto list = [](const char* type, const QByteArray& body) {
      QByteArray c;
      fourcc(c, "LIST");
      u32(c, quint32(body.size() + 4));
      fourcc(c, type);
      c.append(body);
      return c;
    };
    strl = list("strl", chunk("strh", strh) + chunk("strf", strf));
    hdrl = list("hdrl", chunk("avih", avih) + strl);
    QByteArray riff;
    fourcc(riff, "RIFF");
    u32(riff, riffSize);
    fourcc(riff, "AVI ");
    riff.append(hdrl);
    return riff;
  }
  QFile f_;
  int w_ = 0, h_ = 0, fps_ = 24;
  qint64 moviStart_ = 0;
  quint32 maxSize_ = 0;
  std::vector<std::pair<quint32, quint32>> index_;
};
}  // namespace

struct VideoWriter::Impl {
  std::unique_ptr<H264Encoder> h264;
  std::unique_ptr<MjpegAvi> avi;
  QString path, codec, error;
  int w = 0, h = 0;
  int frames = 0;
};

VideoWriter::VideoWriter() : d(std::make_unique<Impl>()) {}
VideoWriter::~VideoWriter() = default;

bool VideoWriter::open(const QString& basePath, int w, int h, int fps) {
  d->w = w & ~1, d->h = h & ~1;  // H.264 needs even sizes
  d->path = basePath + ".mp4";
  QFile::remove(d->path);
  d->h264 = openH264(d->path, d->w, d->h, fps, &d->error);
  if (d->h264) {
    d->codec = "h264";
    return true;
  }
  d->path = basePath + ".avi";
  d->avi = std::make_unique<MjpegAvi>();
  if (!d->avi->open(d->path, d->w, d->h, fps)) return d->error = "cannot write " + d->path, false;
  d->codec = "mjpeg";
  return true;
}

bool VideoWriter::add(const QImage& frame) {
  const QImage f = frame.width() == d->w && frame.height() == d->h ? frame : frame.copy(0, 0, d->w, d->h);
  ++d->frames;
  if (d->h264) return d->h264->add(f.convertToFormat(QImage::Format_RGBA8888));
  return d->avi && d->avi->add(f);
}

bool VideoWriter::close() {
  bool ok = false;
  if (d->h264) ok = d->h264->finish(), d->h264.reset();
  else if (d->avi) ok = d->avi->close(), d->avi.reset();
  return ok && d->frames > 0 && QFileInfo(d->path).size() > 0;
}

QString VideoWriter::path() const { return d->path; }
QString VideoWriter::codec() const { return d->codec; }
QString VideoWriter::error() const { return d->error; }

#if !defined(__APPLE__) && !defined(_WIN32)
std::unique_ptr<H264Encoder> openH264(const QString&, int, int, int, QString* error) {
  if (error) *error = "no platform H.264 encoder";
  return nullptr;
}
#endif

}  // namespace thcad::app
