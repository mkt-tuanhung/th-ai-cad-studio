// llama.cpp backend (Metal on Apple Silicon). Loads a local GGUF file — no network access.
#include <ggml-backend.h>
#include <llama.h>
#if defined(_WIN32)
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#elif defined(__APPLE__)
#include <mach-o/dyld.h>
#endif

#include <climits>
#include <cstdlib>

#include <chrono>
#include <filesystem>
#include <mutex>
#include <vector>

#include "thcad/ai/runtime.hpp"

namespace thcad::ai {

namespace {

std::string backendDir() {
  if (const char* env = std::getenv("THCAD_GGML_DIR")) return env;
#if defined(_WIN32)
  // Windows install layout: <app>\ggml\ggml-*.dll next to the .exe
  wchar_t buf[MAX_PATH];
  if (GetModuleFileNameW(nullptr, buf, MAX_PATH) == 0) return {};
  const auto dir = std::filesystem::path(buf).parent_path() / "ggml";
#elif defined(__APPLE__)
  char buf[PATH_MAX];
  uint32_t size = sizeof buf;
  if (_NSGetExecutablePath(buf, &size) != 0) return {};
  const auto dir = std::filesystem::path(buf).parent_path() / "../PlugIns/ggml";
#else
  return {};  // other platforms: ggml's default search path
#endif
  std::error_code ec;
  return std::filesystem::is_directory(dir, ec) ? std::filesystem::weakly_canonical(dir).string() : std::string();
}

class LlamaRuntime final : public Runtime {
 public:
  LlamaRuntime() {
    llama_log_set([](ggml_log_level, const char*, void*) {}, nullptr);  // keep stdout clean
    ggml_log_set([](ggml_log_level, const char*, void*) {}, nullptr);
    // Compute backends (Metal/CPU/BLAS) ship inside the app bundle: Contents/PlugIns/ggml.
    if (const std::string dir = backendDir(); !dir.empty()) ggml_backend_load_all_from_path(dir.c_str());
    else ggml_backend_load_all();
    llama_backend_init();
  }
  ~LlamaRuntime() override {
    if (model_) llama_model_free(model_);
    llama_backend_free();
  }

  RuntimeStatus status() const override {
    std::lock_guard lock(mu_);
    RuntimeStatus s;
    s.backend = "llama.cpp";
    s.memoryTotalBytes = physicalMemoryBytes();
    s.modelPath = path_;
    s.loaded = model_ != nullptr;
    s.ready = s.loaded;
    s.error = error_;
    if (model_) {
      char desc[256] = {};
      llama_model_desc(model_, desc, sizeof desc);
      std::string stem = std::filesystem::path(path_).stem().string();
      if (const auto p = stem.find("-00001-of-"); p != std::string::npos) stem.resize(p);  // split GGUF
      s.modelName = stem + " (" + desc + ")";
      s.modelBytes = llama_model_size(model_);
    }
    s.lastTokensPerSecond = tps_;
    s.lastLatencySeconds = latency_;
    return s;
  }

  bool load(const std::string& p) override {
    std::lock_guard gen(genMu_);
    std::lock_guard lock(mu_);
    if (model_) { llama_model_free(model_); model_ = nullptr; }
    path_ = p;
    error_.clear();
    if (!std::filesystem::exists(p)) { error_ = "model file not found"; return false; }
    llama_model_params mp = llama_model_default_params();
    mp.n_gpu_layers = -1;  // offload everything to Metal
    model_ = llama_model_load_from_file(p.c_str(), mp);
    if (!model_) error_ = "failed to load GGUF";
    return model_ != nullptr;
  }

  std::string generate(const std::string& prompt, const GenerateOptions& opt,
                       const std::function<bool(const std::string&)>& onToken) override {
    // genMu_ serialises generations; mu_ only guards the status fields so status() never blocks
    // behind a running generation (the UI polls it).
    std::lock_guard gen(genMu_);
    if (!model_) return {};
    const llama_vocab* vocab = llama_model_get_vocab(model_);

    // chat template from the model (falls back to raw prompt)
    std::vector<llama_chat_message> msgs;
    if (!opt.system.empty()) msgs.push_back({"system", opt.system.c_str()});
    msgs.push_back({"user", prompt.c_str()});
    std::string formatted = prompt;
    if (const char* tmpl = llama_model_chat_template(model_, nullptr)) {
      std::vector<char> buf(prompt.size() * 2 + opt.system.size() * 2 + 1024);
      int32_t n = llama_chat_apply_template(tmpl, msgs.data(), msgs.size(), true, buf.data(), static_cast<int32_t>(buf.size()));
      if (n > static_cast<int32_t>(buf.size())) {
        buf.resize(n);
        n = llama_chat_apply_template(tmpl, msgs.data(), msgs.size(), true, buf.data(), static_cast<int32_t>(buf.size()));
      }
      if (n > 0) formatted.assign(buf.data(), n);
    }

    int32_t nTok = -llama_tokenize(vocab, formatted.c_str(), static_cast<int32_t>(formatted.size()), nullptr, 0, true, true);
    std::vector<llama_token> tokens(nTok);
    if (llama_tokenize(vocab, formatted.c_str(), static_cast<int32_t>(formatted.size()), tokens.data(), nTok, true, true) < 0) return {};

    llama_context_params cp = llama_context_default_params();
    cp.n_ctx = static_cast<uint32_t>(tokens.size() + opt.maxTokens + 16);
    cp.n_batch = cp.n_ctx;
    llama_context* ctx = llama_init_from_model(model_, cp);
    if (!ctx) {
      std::lock_guard lock(mu_);
      error_ = "failed to create context";
      return {};
    }

    llama_sampler* smpl = llama_sampler_chain_init(llama_sampler_chain_default_params());
    opt.grammarError = false;
    if (!opt.grammar.empty()) {
      if (llama_sampler* g = llama_sampler_init_grammar(vocab, opt.grammar.c_str(), "root")) llama_sampler_chain_add(smpl, g);
      else opt.grammarError = true;
    }
    if (opt.temperature <= 0) llama_sampler_chain_add(smpl, llama_sampler_init_greedy());
    else {
      llama_sampler_chain_add(smpl, llama_sampler_init_temp(opt.temperature));
      llama_sampler_chain_add(smpl, llama_sampler_init_dist(LLAMA_DEFAULT_SEED));
    }

    const auto t0 = std::chrono::steady_clock::now();
    std::string out;
    llama_batch batch = llama_batch_get_one(tokens.data(), static_cast<int32_t>(tokens.size()));
    llama_token tok = 0;
    int produced = 0;
    double firstTokenAt = 0;
    for (; produced < opt.maxTokens; ++produced) {
      if (llama_decode(ctx, batch) != 0) break;
      tok = llama_sampler_sample(smpl, ctx, -1);
      if (produced == 0) firstTokenAt = std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
      if (llama_vocab_is_eog(vocab, tok)) break;
      char piece[256];
      const int n = llama_token_to_piece(vocab, tok, piece, sizeof piece, 0, true);
      if (n > 0) {
        std::string s(piece, n);
        out += s;
        if (onToken && !onToken(s)) break;
      }
      batch = llama_batch_get_one(&tok, 1);
    }
    const double total = std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
    opt.producedTokens = produced;
    {
      std::lock_guard lock(mu_);
      latency_ = firstTokenAt;
      tps_ = total > firstTokenAt && produced > 1 ? (produced - 1) / (total - firstTokenAt) : 0;
    }
    llama_sampler_free(smpl);
    llama_free(ctx);
    return out;
  }

 private:
  mutable std::mutex mu_;
  std::mutex genMu_;
  llama_model* model_ = nullptr;
  std::string path_, error_;
  double tps_ = 0, latency_ = 0;
};

}  // namespace

std::unique_ptr<Runtime> createLlamaRuntime() { return std::make_unique<LlamaRuntime>(); }

}  // namespace thcad::ai
