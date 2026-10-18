#pragma once
// Local AI runtime boundary (llama.cpp today; MLX can implement the same interface).
// No cloud API, no Python, no API key: models are GGUF files on disk, inference runs in-process
// on Metal. Mirrors the UI contract in ui/src/services/localAi.ts.
#include <cstdint>
#include <filesystem>
#include <functional>
#include <memory>
#include <string>
#include <vector>

namespace thcad::ai {

struct RuntimeStatus {
  std::string backend;     // "llama.cpp" / "none"
  std::string modelName;   // human-readable, empty when no model
  std::string modelPath;
  bool loaded = false;
  bool ready = false;
  uint64_t modelBytes = 0;          // weights resident (unified memory on Apple Silicon)
  uint64_t memoryTotalBytes = 0;    // physical unified memory
  double lastTokensPerSecond = 0;   // measured on the last generation, 0 if none
  double lastLatencySeconds = 0;    // time to first token on the last generation
  /** Where the model runs: "<GPU description> (Metal | Vulkan | CUDA)" or "CPU". */
  std::string device;
  std::string error;
};

struct GenerateOptions {
  int maxTokens = 512;
  float temperature = 0.2f;
  std::string system;
  /** Optional GBNF grammar (root rule "root"): output is constrained to it during sampling. */
  std::string grammar;
  /** Filled by generate(): tokens produced and whether the grammar failed to compile. */
  mutable int producedTokens = 0;
  mutable bool grammarError = false;
};

class Runtime {
 public:
  virtual ~Runtime() = default;
  virtual RuntimeStatus status() const = 0;
  virtual bool load(const std::string& ggufPath) = 0;
  /** Blocking generation. `onToken` may return false to stop. Returns the full text. */
  virtual std::string generate(const std::string& prompt, const GenerateOptions& opt,
                               const std::function<bool(const std::string&)>& onToken = {}) = 0;
  /** App shutdown: the running load / generation stops as soon as it can (any thread may call this) and
   *  every later load() / generate() returns at once (false / empty). Sticky. */
  virtual void abort() {}
  virtual bool aborted() const { return false; }
};

/** llama.cpp runtime if compiled in, otherwise a runtime that reports "no backend". */
std::unique_ptr<Runtime> createRuntime();
/** First *.gguf in $THCAD_MODEL or ~/Library/Application Support/MD CAD AI STUDIO/models (or the pre-rename TH AI CAD Studio folder). */
std::string discoverModel();
/** The models folder: $THCAD_MODELS_DIR, else the per-user default. */
std::filesystem::path modelsDir();
/** All loadable models in the models folder (first shard only for split GGUF). */
std::vector<std::string> listModels();
uint64_t physicalMemoryBytes();

}  // namespace thcad::ai
