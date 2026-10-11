// thcad-cli — headless access to the native engine (scripted AutoCAD-style commands, BIM checks,
// OCCT solids/STEP, local AI proposals). Used for testing and batch processing.
#include <cstdio>
#include <fstream>
#include <iostream>
#include <sstream>

#include "thcad/ai/assistant.hpp"
#include "thcad/bim/model.hpp"
#include "thcad/core/checks.hpp"
#include "thcad/core/command_bus.hpp"
#include "thcad/core/commands.hpp"
#include "thcad/core/dxf.hpp"
#include "thcad/core/ops_json.hpp"
#ifdef THCAD_HAS_OCCT
#include "thcad/occt/geometry.hpp"
#include "thcad/occt/scene.hpp"
#endif

using namespace thcad;

int runAiEval(ai::Runtime& rt, bool constrainedToo, int set);

namespace {

int usage() {
  std::cerr << "usage:\n"
               "  thcad-cli info\n"
               "  thcad-cli run <script.txt> [out.dxf]      AutoCAD-style command script → DXF\n"
               "  thcad-cli bim-check                       Villa Riverside quantities + model checks\n"
               "  thcad-cli extrude <in.dxf> <layer> <height> <out.step>\n"
               "  thcad-cli ai \"<request>\" [--approve]     local model → proposal (approval explicit)\n"
               "  thcad-cli ai-eval [--compare]             evaluate the local model on checked CAD requests\n";
  return 2;
}

std::string readFile(const std::string& p) {
  std::ifstream f(p, std::ios::binary);
  std::stringstream ss;
  ss << f.rdbuf();
  return ss.str();
}

int cmdInfo() {
  auto rt = ai::createRuntime();
  auto st = rt->status();
  std::printf("TH AI CAD Studio native engine 0.1.0\n");
  std::printf("  commands in spec: %zu\n", commandTable().size());
#ifdef THCAD_HAS_OCCT
  std::printf("  Open CASCADE: %s\n", occt::version().c_str());
#else
  std::printf("  Open CASCADE: not built\n");
#endif
  std::printf("  AI backend: %s\n", st.backend.c_str());
  std::printf("  unified memory: %.1f GB\n", st.memoryTotalBytes / 1073741824.0);
  const std::string model = ai::discoverModel();
  std::printf("  local model: %s\n", model.empty() ? "(none installed)" : model.c_str());
  return 0;
}

int cmdRun(const std::string& script, const std::string& outDxf) {
  CommandBus bus(Document::blank("script.dwg"));
  std::istringstream in(readFile(script));
  std::string line;
  int n = 0, lineNo = 0;
  auto newId = [&] { return "e" + std::to_string(++n); };
  while (std::getline(in, line)) {
    ++lineNo;
    std::istringstream ls(line);
    std::string word;
    if (!(ls >> word) || word[0] == '#') continue;
    const CommandSpec* spec = resolveCommand(word);
    if (!spec) { std::fprintf(stderr, "%d: unknown command %s\n", lineNo, word.c_str()); return 1; }
    std::vector<std::string> args;
    for (std::string a; ls >> a;) args.push_back(a);
    std::optional<Vec2> last;
    auto pt = [&](size_t i) -> std::optional<Vec2> {
      if (i >= args.size()) return std::nullopt;
      auto p = parsePointInput(args[i], last);
      if (p) last = p;
      return p;
    };
    const std::string layer = bus.document().currentLayer;
    auto add = [&](Shape s) {
      Entity e{{newId(), layer}, std::move(s)};
      return bus.execute({OpAdd{{e}}, std::string(spec->name)});
    };
    std::optional<ValidationError> err;
    const std::string_view name = spec->name;
    if (spec->status == CommandStatus::Native && name != "TRIM") { std::fprintf(stderr, "%d: %s not implemented\n", lineNo, word.c_str()); return 1; }
    if (name == "LINE") {
      auto a = pt(0);
      for (size_t i = 1; a && i < args.size() && !err; ++i) {
        auto b = pt(i);
        if (!b) break;
        err = add(Line{*a, *b});
        a = b;
      }
    } else if (name == "PLINE") {
      Polyline p;
      for (size_t i = 0; i < args.size(); ++i)
        if (args[i] == "C" || args[i] == "c") p.closed = true;
        else if (auto q = pt(i)) p.points.push_back(*q);
      err = add(p);
    } else if (name == "RECTANG") {
      auto a = pt(0), b = pt(1);
      if (a && b) err = add(Polyline{{*a, {b->x, a->y}, *b, {a->x, b->y}}, true});
    } else if (name == "CIRCLE") {
      auto c = pt(0);
      if (c && args.size() > 1) err = add(CircleE{*c, std::atof(args[1].c_str())});
    } else if (name == "TEXT") {
      auto p = pt(0);
      std::string rest;
      for (size_t i = 1; i < args.size(); ++i) rest += (i > 1 ? " " : "") + args[i];
      if (p) err = add(Text{*p, 250, rest});
    } else if (name == "ERASE") {
      err = bus.execute({OpErase{std::vector<std::string>(args.begin(), args.end())}, "ERASE"});
    } else if (name == "UNDO") {
      bus.undo();
    } else if (name == "REDO") {
      bus.redo();
    } else if (name == "LAYER") {
      if (!args.empty()) err = bus.execute({OpSetCurrentLayer{args[0]}, "CLAYER"});
    } else {
      std::fprintf(stderr, "%d: %s is not scriptable in the CLI\n", lineNo, word.c_str());
      return 1;
    }
    if (err) { std::fprintf(stderr, "%d: %s: %s %s\n", lineNo, word.c_str(), toString(err->code), err->detail.c_str()); return 1; }
  }
  std::printf("%zu entities\n", bus.document().entities.size());
  for (const auto& f : runChecks(bus.document())) std::printf("finding: %s\n", f.entityId.c_str());
  if (!outDxf.empty()) {
    std::ofstream(outDxf, std::ios::binary) << toDxf(bus.document());
    std::printf("wrote %s\n", outDxf.c_str());
  }
  return 0;
}

int cmdBim() {
  const bim::Model m = bim::villaRiverside();
  std::printf("%-5s %-34s %-8s %8s %8s %8s", "Mark", "Type", "Level", "Length", "Area", "Volume");
#ifdef THCAD_HAS_OCCT
  std::printf(" %9s %9s", "OCCT vol", "net vol");
#endif
  std::printf("\n");
  for (const auto& w : m.walls) {
    std::printf("%-5s %-34s %-8s %8.0f %8.2f %8.2f", w.mark.c_str(), m.type(w.typeId)->name.c_str(), m.level(w.baseLevel)->name.c_str(), w.length,
                bim::wallArea(m, w), bim::wallVolume(m, w));
#ifdef THCAD_HAS_OCCT
    const auto* t = m.type(w.typeId);
    std::printf(" %9.3f %9.3f", occt::wallSolid(w.length, t->thickness, bim::wallHeight(m, w)).volumeM3(), occt::wallWithOpenings(m, w).volumeM3());
#endif
    std::printf("\n");
  }
  static const char* names[] = {"Model Health", "Clash Detection", "Model Standards", "Room Completeness", "Parameter Check"};
  for (const auto& c : bim::runModelChecks(m)) {
    std::printf("%-18s %zu\n", names[static_cast<int>(c.key)], c.count());
    for (const auto& msg : c.messages) std::printf("    %s\n", msg.c_str());
  }
  return 0;
}

#ifdef THCAD_HAS_OCCT
int cmdExtrude(const std::string& in, const std::string& layer, double h, const std::string& out) {
  DxfImport imp = fromDxf(readFile(in), in);
  size_t n = 0;
  auto solid = occt::extrudeClosedPolylines(imp.document, layer, h, &n);
  if (n == 0) { std::fprintf(stderr, "no closed polylines on layer %s\n", layer.c_str()); return 1; }
  std::printf("extruded %zu profiles, volume %.4f m3\n", n, solid.volumeM3());
  if (auto err = occt::writeStep(solid, out); !err.empty()) { std::fprintf(stderr, "%s\n", err.c_str()); return 1; }
  std::printf("wrote %s\n", out.c_str());
  return 0;
}
#endif

int cmdAi(const std::string& request, bool approve) {
  auto rt = ai::createRuntime();
  const std::string model = ai::discoverModel();
  if (model.empty()) {
    std::fprintf(stderr, "no local model: put a .gguf file in ~/Library/Application Support/TH AI CAD Studio/models or set THCAD_MODEL\n");
    return 3;
  }
  if (!rt->load(model)) { std::fprintf(stderr, "load failed: %s\n", rt->status().error.c_str()); return 3; }
  CommandBus bus(Document::blank("ai.dwg"));
  ProposalQueue q(bus);
  auto r = ai::requestEdit(*rt, q, bus.document(), request);
  std::printf("%s\n", r.message.c_str());
  if (!r.ok) { std::fprintf(stderr, "raw output:\n%s\n", r.rawOutput.c_str()); return 1; }
  if (approve) {
    if (auto err = q.approve(r.proposalId)) { std::fprintf(stderr, "approve failed: %s\n", toString(err->code)); return 1; }
    std::printf("approved: %zu entities\n%s\n", bus.document().entities.size(), json::stringify(documentToJson(bus.document())).c_str());
  }
  auto st = rt->status();
  std::printf("%.1f tok/s, first token %.2fs\n", st.lastTokensPerSecond, st.lastLatencySeconds);
  return 0;
}

}  // namespace

int main(int argc, char** argv) {
  if (argc < 2) return usage();
  const std::string cmd = argv[1];
  if (cmd == "info") return cmdInfo();
  if (cmd == "run" && argc >= 3) return cmdRun(argv[2], argc >= 4 ? argv[3] : "");
  if (cmd == "bim-check") return cmdBim();
#ifdef THCAD_HAS_OCCT
  if (cmd == "extrude" && argc >= 6) return cmdExtrude(argv[2], argv[3], std::atof(argv[4]), argv[5]);
  if (cmd == "scene" && argc >= 3) {
    // scene <file.json> [--overlaps]: exact volumes (and pairwise overlaps) of a UI scene
    std::ifstream f(argv[2]);
    std::stringstream ss;
    ss << f.rdbuf();
    auto parsed = json::parse(ss.str());
    if (auto* e = std::get_if<json::ParseError>(&parsed)) { std::fprintf(stderr, "%s\n", e->message.c_str()); return 1; }
    const auto items = occt::sceneFromJson(std::get<json::Value>(parsed));
    const auto r = occt::analyzeScene(items, argc >= 4 && std::string(argv[3]) == "--overlaps");
    for (const auto& i : r.items) std::printf("%-14s %s %.6f m3\n", i.id.c_str(), i.built ? "ok  " : "FAIL", i.volume);
    for (const auto& o : r.overlaps) std::printf("overlap %s x %s = %.3f cm3\n", o.a.c_str(), o.b.c_str(), o.volume * 1e6);
    return 0;
  }
#endif
  if (cmd == "models") {
    const std::string def = ai::discoverModel();
    for (const auto& m : ai::listModels()) std::printf("%s %s\n", m == def ? "*" : " ", m.c_str());
    return 0;
  }
  if (cmd == "ai-eval") {
    auto rt = ai::createRuntime();
    const std::string model = ai::discoverModel();
    if (model.empty() || !rt->load(model)) { std::fprintf(stderr, "no local model\n"); return 3; }
    std::printf("model: %s\n", rt->status().modelName.c_str());
    bool compare = false;
    int set = 0;
    for (int i = 2; i < argc; ++i) {
      compare |= std::string(argv[i]) == "--compare";
      if (std::string(argv[i]) == "--holdout") set = 1;
      if (std::string(argv[i]) == "--holdout-b") set = 2;
      if (std::string(argv[i]) == "--holdout-c") set = 3;
    }
    return runAiEval(*rt, compare, set);
  }
  if (cmd == "ai" && argc >= 3) return cmdAi(argv[2], argc >= 4 && std::string(argv[3]) == "--approve");
  return usage();
}
