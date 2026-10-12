#if defined(_WIN32)
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#elif defined(__APPLE__)
#include <sys/sysctl.h>
#else
#include <unistd.h>
#endif

#include <cstdlib>
#include <algorithm>
#include <filesystem>
#include <fstream>

#include "thcad/ai/runtime.hpp"

namespace thcad::ai {

uint64_t physicalMemoryBytes() {
#if defined(_WIN32)
  MEMORYSTATUSEX st{};
  st.dwLength = sizeof st;
  return GlobalMemoryStatusEx(&st) ? st.ullTotalPhys : 0;
#elif defined(__APPLE__)
  uint64_t mem = 0;
  size_t len = sizeof mem;
  if (sysctlbyname("hw.memsize", &mem, &len, nullptr, 0) != 0) return 0;
  return mem;
#else
  return uint64_t(sysconf(_SC_PHYS_PAGES)) * uint64_t(sysconf(_SC_PAGE_SIZE));
#endif
}

std::filesystem::path modelsDir() {
  // Settings → AI Models → Model Storage Folder (set by the host)
  if (const char* dir = std::getenv("THCAD_MODELS_DIR"); dir && *dir) return std::filesystem::path(dir);
  // <app data>/MD CAD AI STUDIO/models; models downloaded before the rename stay in "TH AI CAD Studio" and
  // are used from there until a new folder exists (nothing is moved behind the user's back)
#if defined(_WIN32)
  // %LOCALAPPDATA% (models are large; keep them out of the roaming profile)
  const wchar_t* b = _wgetenv(L"LOCALAPPDATA");
  if (!b) return {};
  const std::filesystem::path base(b);
  const auto now = base / L"MD CAD AI STUDIO" / L"models", before = base / L"TH AI CAD Studio" / L"models";
#else
  const char* home = std::getenv("HOME");
  if (!home) return {};
  const auto base = std::filesystem::path(home) / "Library/Application Support";
  const auto now = base / "MD CAD AI STUDIO/models", before = base / "TH AI CAD Studio/models";
#endif
  std::error_code ec;
  return !std::filesystem::exists(now, ec) && std::filesystem::exists(before, ec) ? before : now;
}

std::vector<std::string> listModels() {
  namespace fs = std::filesystem;
  std::vector<std::string> out;
  std::error_code ec;
  for (const auto& e : fs::directory_iterator(modelsDir(), ec)) {
    const std::string name = e.path().filename().string();
    if (!e.is_regular_file() || e.path().extension() != ".gguf") continue;
    // split GGUF: llama.cpp loads all shards from the first one; list only "-00001-of-"
    if (const auto pos = name.find("-of-"); pos != std::string::npos && name.substr(pos - 5, 5) != "00001") continue;
    out.push_back(e.path().string());
  }
  std::sort(out.begin(), out.end());
  return out;
}

std::string discoverModel() {
  namespace fs = std::filesystem;
  if (const char* env = std::getenv("THCAD_MODEL"); env && fs::exists(env)) return env;
  // models/default.txt may name the preferred file
  if (std::ifstream f(modelsDir() / "default.txt"); f) {
    std::string name;
    std::getline(f, name);
    if (!name.empty() && fs::exists(modelsDir() / name)) return (modelsDir() / name).string();
  }
  // Largest model whose weights fit in ~35% of unified memory (leaves room for the app, OCCT, WebEngine).
  const uint64_t budget = physicalMemoryBytes() * 35 / 100;
  std::string best;
  uint64_t bestSize = 0;
  for (const auto& m : listModels()) {
    uint64_t size = 0;
    const std::string stem = m.substr(0, m.find("-00001-of-") == std::string::npos ? m.size() : m.find("-00001-of-"));
    std::error_code ec;
    for (const auto& e : fs::directory_iterator(modelsDir(), ec))
      if (e.path().string().rfind(stem, 0) == 0 && e.path().extension() == ".gguf") size += e.file_size();
    if (size <= budget && size > bestSize) { best = m; bestSize = size; }
  }
  if (best.empty() && !listModels().empty()) best = listModels().front();
  return best;
}

}  // namespace thcad::ai
