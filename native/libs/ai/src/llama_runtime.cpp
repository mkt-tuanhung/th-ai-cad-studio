// llama.cpp backend (Metal on Apple Silicon). Loads a local GGUF file — no network access.
#include <ggml-backend.h>
#include <llama.h>
#if defined(_WIN32)
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#elif defined(__APPLE__)
#include <mach-o/dyld.h>
#endif

#include <climits>
#include <cstdlib>

#include <atomic>
#include <chrono>
#include <filesystem>
#include <mutex>
#include <algorithm>
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
    // the first GPU the backends found (Metal on a Mac, Vulkan on Windows); CPU when there is none
    for (size_t i = 0; i < ggml_backend_dev_count(); ++i) {
      ggml_backend_dev_t d = ggml_backend_dev_get(i);
      const auto t = ggml_backend_dev_type(d);
      if (t == GGML_BACKEND_DEVICE_TYPE_CPU || t == GGML_BACKEND_DEVICE_TYPE_ACCEL) continue;
      std::string api = ggml_backend_reg_name(ggml_backend_dev_backend_reg(d));
      if (api == "MTL") api = "Metal";
      gpu_ = std::string(ggml_backend_dev_description(d)) + " (" + api + ")";
      break;
    }
  }
  ~LlamaRuntime() override {
    if (ctx_) llama_free(ctx_);
    if (model_) llama_model_free(model_);
    llama_backend_free();
  }

  RuntimeStatus status() const override {
    std::lock_guard lock(mu_);
    RuntimeStatus s;
    s.backend = "llama.cpp";
    const char* useGpu = std::getenv("THCAD_AI_GPU");
    s.device = gpu_.empty() || (useGpu && std::string(useGpu) == "0") ? "CPU" : gpu_;
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
    // genMu_ keeps generations off the model while it is swapped; mu_ is held only for the field updates
    // (status() is polled from the GUI thread and must never wait for a multi-GB load)
    std::lock_guard gen(genMu_);
    {
      std::lock_guard lock(mu_);
      if (ctx_) { llama_free(ctx_); ctx_ = nullptr; ctxSize_ = 0; cached_.clear(); }
      if (model_) { llama_model_free(model_); model_ = nullptr; }
      path_ = p;
      error_.clear();
      if (abort_) { error_ = "shutting down"; return false; }
      if (!std::filesystem::exists(p)) { error_ = "model file not found"; return false; }
    }
    llama_model_params mp = llama_model_default_params();
    // Settings → Performance → "Use GPU for AI inference" (THCAD_AI_GPU=0 keeps the model on the CPU)
    const char* gpu = std::getenv("THCAD_AI_GPU");
    mp.n_gpu_layers = gpu && std::string(gpu) == "0" ? 0 : -1;  // -1: offload everything (Metal / CUDA / Vulkan)
    mp.progress_callback = [](float, void* self) { return !static_cast<LlamaRuntime*>(self)->abort_.load(); };
    mp.progress_callback_user_data = this;
    llama_model* m = llama_model_load_from_file(p.c_str(), mp);
    std::lock_guard lock(mu_);
    model_ = m;
    if (!model_) error_ = abort_ ? "shutting down" : "failed to load GGUF";
    return model_ != nullptr;
  }

  void abort() override { abort_ = true; }
  bool aborted() const override { return abort_; }

  std::string generate(const std::string& prompt, const GenerateOptions& opt,
                       const std::function<bool(const std::string&)>& onToken) override {
    // genMu_ serialises generations; mu_ only guards the status fields so status() never blocks
    // behind a running generation (the UI polls it).
    std::lock_guard gen(genMu_);
    if (!model_ || abort_) return {};
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

    // one persistent context: the KV cache of the previous prompt is reused up to the first token that
    // differs (system prompt + model context stay the same between requests on the same model)
    const uint32_t needed = static_cast<uint32_t>(tokens.size() + opt.maxTokens + 16);
    if (!ctx_ || needed > ctxSize_) {
      if (ctx_) llama_free(ctx_);
      llama_context_params cp = llama_context_default_params();
      // headroom: a warm-up (prefill only) and the request that follows must fit the same context
      cp.n_ctx = std::max<uint32_t>(needed + 2048, 12288);
      cp.n_batch = 2048;
      // a long prefill stops at the next graph node once the app shuts down (abort())
      cp.abort_callback = [](void* self) { return static_cast<LlamaRuntime*>(self)->abort_.load(); };
      cp.abort_callback_data = this;
      ctx_ = llama_init_from_model(model_, cp);
      ctxSize_ = ctx_ ? cp.n_ctx : 0;
      cached_.clear();
    }
    llama_context* ctx = ctx_;
    if (!ctx) {
      std::lock_guard lock(mu_);
      error_ = "failed to create context";
      return {};
    }
    size_t keep = 0;
    while (keep < cached_.size() && keep < tokens.size() && cached_[keep] == tokens[keep]) ++keep;
    if (keep == tokens.size()) --keep;  // at least one token must be decoded to sample from
    llama_memory_seq_rm(llama_get_memory(ctx), -1, static_cast<llama_pos>(keep), -1);
    cached_.assign(tokens.begin(), tokens.begin() + static_cast<std::ptrdiff_t>(keep));
    {
      std::lock_guard lock(mu_);
      lastReused_ = keep;
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
    // prefill the new part of the prompt in batch-sized chunks
    bool ok = true;
    for (size_t i = keep; i < tokens.size() && ok && !abort_; i += 2048) {
      const int32_t n = static_cast<int32_t>(std::min<size_t>(2048, tokens.size() - i));
      ok = llama_decode(ctx, llama_batch_get_one(tokens.data() + i, n)) == 0;
      if (ok) cached_.insert(cached_.end(), tokens.begin() + static_cast<std::ptrdiff_t>(i), tokens.begin() + static_cast<std::ptrdiff_t>(i + n));
    }
    llama_token tok = 0;
    int produced = 0;
    double firstTokenAt = 0;
    if (abort_) ok = false;
    for (; ok && produced < opt.maxTokens && !abort_; ++produced) {
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
      if (llama_decode(ctx, llama_batch_get_one(&tok, 1)) != 0) break;
      cached_.push_back(tok);
    }
    if (!ok) cached_.clear();
    const double total = std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
    opt.producedTokens = produced;
    {
      std::lock_guard lock(mu_);
      latency_ = firstTokenAt;
      tps_ = total > firstTokenAt && produced > 1 ? (produced - 1) / (total - firstTokenAt) : 0;
    }
    llama_sampler_free(smpl);
    return out;
  }

 private:
  mutable std::mutex mu_;
  std::mutex genMu_;
  std::atomic<bool> abort_{false};
  llama_model* model_ = nullptr;
  llama_context* ctx_ = nullptr;
  uint32_t ctxSize_ = 0;
  std::vector<llama_token> cached_;
  size_t lastReused_ = 0;
  std::string path_, error_;
  std::string gpu_;  // set once in the constructor
  double tps_ = 0, latency_ = 0;
};

}  // namespace

std::unique_ptr<Runtime> createLlamaRuntime() { return std::make_unique<LlamaRuntime>(); }

}  // namespace thcad::ai
