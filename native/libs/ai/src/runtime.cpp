#include "thcad/ai/runtime.hpp"

namespace thcad::ai {

#ifdef THCAD_HAS_LLAMA
std::unique_ptr<Runtime> createLlamaRuntime();
#endif

namespace {
class NoBackend final : public Runtime {
 public:
  RuntimeStatus status() const override {
    RuntimeStatus s;
    s.backend = "none";
    s.memoryTotalBytes = physicalMemoryBytes();
    s.error = "no local AI backend compiled in";
    return s;
  }
  bool load(const std::string&) override { return false; }
  std::string generate(const std::string&, const GenerateOptions&, const std::function<bool(const std::string&)>&) override { return {}; }
};
}  // namespace

std::unique_ptr<Runtime> createRuntime() {
#ifdef THCAD_HAS_LLAMA
  return createLlamaRuntime();
#else
  return std::make_unique<NoBackend>();
#endif
}

}  // namespace thcad::ai
