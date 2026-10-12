// H.264 MP4 through AVFoundation (macOS system encoder, VideoToolbox).
#include "video_writer.hpp"

#import <AVFoundation/AVFoundation.h>
#import <CoreVideo/CoreVideo.h>

#include <unistd.h>

namespace thcad::app {

namespace {
class MacH264 final : public H264Encoder {
 public:
  AVAssetWriter* writer = nil;
  AVAssetWriterInput* input = nil;
  AVAssetWriterInputPixelBufferAdaptor* adaptor = nil;
  int w = 0, h = 0, fps = 24;
  int64_t frame = 0;

  bool add(const QImage& rgba) override {
    @autoreleasepool {
      for (int i = 0; i < 4000 && !input.readyForMoreMediaData; ++i) usleep(1000);
      if (!input.readyForMoreMediaData) return false;
      CVPixelBufferRef pb = nullptr;
      if (CVPixelBufferPoolCreatePixelBuffer(nullptr, adaptor.pixelBufferPool, &pb) != kCVReturnSuccess || !pb) return false;
      CVPixelBufferLockBaseAddress(pb, 0);
      auto* dst = static_cast<uint8_t*>(CVPixelBufferGetBaseAddress(pb));
      const size_t stride = CVPixelBufferGetBytesPerRow(pb);
      for (int y = 0; y < h; ++y) {
        const uchar* s = rgba.constScanLine(y);
        uint8_t* o = dst + y * stride;
        for (int x = 0; x < w; ++x) {  // RGBA → BGRA
          o[4 * x + 0] = s[4 * x + 2];
          o[4 * x + 1] = s[4 * x + 1];
          o[4 * x + 2] = s[4 * x + 0];
          o[4 * x + 3] = 255;
        }
      }
      CVPixelBufferUnlockBaseAddress(pb, 0);
      const BOOL ok = [adaptor appendPixelBuffer:pb withPresentationTime:CMTimeMake(frame++, fps)];
      CVPixelBufferRelease(pb);
      return ok;
    }
  }
  bool finish() override {
    [input markAsFinished];
    dispatch_semaphore_t done = dispatch_semaphore_create(0);
    [writer finishWritingWithCompletionHandler:^{
      dispatch_semaphore_signal(done);
    }];
    dispatch_semaphore_wait(done, dispatch_time(DISPATCH_TIME_NOW, 60 * NSEC_PER_SEC));
    return writer.status == AVAssetWriterStatusCompleted;
  }
};
}  // namespace

std::unique_ptr<H264Encoder> openH264(const QString& path, int w, int h, int fps, QString* error) {
  @autoreleasepool {
    auto enc = std::make_unique<MacH264>();
    enc->w = w, enc->h = h, enc->fps = fps;
    NSError* err = nil;
    NSURL* url = [NSURL fileURLWithPath:path.toNSString()];
    enc->writer = [[AVAssetWriter alloc] initWithURL:url fileType:AVFileTypeMPEG4 error:&err];
    if (!enc->writer) {
      if (error) *error = QString::fromNSString((err.localizedDescription ? err.localizedDescription : @"AVAssetWriter"));
      return nullptr;
    }
    NSDictionary* settings = @{
      AVVideoCodecKey : AVVideoCodecTypeH264,
      AVVideoWidthKey : @(w),
      AVVideoHeightKey : @(h),
      AVVideoCompressionPropertiesKey : @{AVVideoAverageBitRateKey : @(std::max(2000000, w * h * 6)), AVVideoProfileLevelKey : AVVideoProfileLevelH264HighAutoLevel},
    };
    enc->input = [AVAssetWriterInput assetWriterInputWithMediaType:AVMediaTypeVideo outputSettings:settings];
    enc->input.expectsMediaDataInRealTime = NO;
    NSDictionary* attrs = @{(id)kCVPixelBufferPixelFormatTypeKey : @(kCVPixelFormatType_32BGRA), (id)kCVPixelBufferWidthKey : @(w), (id)kCVPixelBufferHeightKey : @(h)};
    enc->adaptor = [AVAssetWriterInputPixelBufferAdaptor assetWriterInputPixelBufferAdaptorWithAssetWriterInput:enc->input sourcePixelBufferAttributes:attrs];
    if (![enc->writer canAddInput:enc->input]) {
      if (error) *error = "AVAssetWriter cannot take an H.264 input";
      return nullptr;
    }
    [enc->writer addInput:enc->input];
    if (![enc->writer startWriting]) {
      if (error) *error = QString::fromNSString((enc->writer.error.localizedDescription ? enc->writer.error.localizedDescription : @"startWriting"));
      return nullptr;
    }
    [enc->writer startSessionAtSourceTime:kCMTimeZero];
    return enc;
  }
}

}  // namespace thcad::app
