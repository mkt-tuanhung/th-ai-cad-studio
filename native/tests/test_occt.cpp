#include "check.hpp"
#include "thcad/occt/geometry.hpp"
#include "thcad/bim/model_json.hpp"
#include "thcad/core/json.hpp"

using namespace thcad;

TEST("OCCT wall solid volume equals the schedule formula") {
  const bim::Model m = bim::villaRiverside();
  for (const auto& w : m.walls) {
    const auto* t = m.type(w.typeId);
    CHECK_NEAR(occt::wallSolid(w.length, t->thickness, bim::wallHeight(m, w)).volumeM3(), bim::wallVolume(m, w), 1e-6);
  }
}

TEST("OCCT boolean: openings reduce wall volume by exactly their size") {
  const bim::Model m = bim::villaRiverside();
  const auto& w1 = *m.wall("W1");  // hosts D2: 900 x 2100, wall 200 thick
  const double gross = bim::wallVolume(m, w1);
  const double net = occt::wallWithOpenings(m, w1).volumeM3();
  CHECK_NEAR(gross - net, 0.9 * 2.1 * 0.2, 1e-6);
}

TEST("OCCT extrudes closed polylines and writes STEP") {
  Document d = Document::blank("t");
  d.entities.push_back({{"p", "A-Wall"}, Polyline{{{0, 0}, {1000, 0}, {1000, 200}, {0, 200}}, true}});
  d.entities.push_back({{"open", "A-Wall"}, Polyline{{{0, 0}, {5, 5}}, false}});
  size_t n = 0;
  auto s = occt::extrudeClosedPolylines(d, "A-Wall", 3000, &n);
  CHECK(n == 1);
  CHECK_NEAR(s.volumeM3(), 0.6, 1e-9);
  const std::string path = "/tmp/thcad_test.step";
  CHECK(occt::writeStep(s, path).empty());
}

TEST("OCCT building solid: all 24 walls placed, net volume = sum of walls with openings") {
  const bim::Model m = bim::villaRiverside();
  double sum = 0;
  for (const auto& w : m.walls) sum += occt::wallWithOpenings(m, w).volumeM3();
  CHECK_NEAR(occt::buildingSolid(m).volumeM3(), sum, 1e-6);
}

#include "thcad/occt/offscreen.hpp"
#include <fstream>

TEST("OCCT offscreen renders frames in every display mode") {
  occt::OffscreenView v;
  CHECK(v.ok());
  v.setModel(bim::villaRiverside());
  for (const char* mode : {"shaded", "wireframe", "hidden"}) {
    v.setMode(mode);
    auto px = v.renderRgba(740, 530);
    CHECK(px.size() == 740u * 530u * 4u);
    // the building must actually be drawn: count pixels that differ from the background corner
    size_t drawn = 0;
    for (size_t i = 0; i + 3 < px.size(); i += 4)
      if (std::abs(px[i] - px[0]) + std::abs(px[i + 1] - px[1]) + std::abs(px[i + 2] - px[2]) > 40) ++drawn;
    // shaded fills faces; wireframe / hidden-line only draw thin edges
    CHECK(drawn > (std::string(mode) == "shaded" ? 740u * 530u / 10u : 740u * 530u / 200u));
    std::ofstream f(std::string("/tmp/thcad_offscreen_") + mode + ".ppm", std::ios::binary);
    f << "P6\n740 530\n255\n";
    for (size_t i = 0; i + 3 < px.size(); i += 4) f.write(reinterpret_cast<const char*>(&px[i]), 3);
  }
  v.orbit(300, 300, 360, 300, true);
  CHECK(!v.renderRgba(740, 530).empty());
}

TEST("BIM model JSON keeps engine placements and edits from the UI") {
  const bim::Model seed = bim::villaRiverside();
  auto v = std::get<json::Value>(json::parse(R"({"levels":[{"id":"L1","name":"Level 1","elevation":0},{"id":"L2","name":"Level 2","elevation":3000}],
    "wallTypes":[{"id":"I250","family":"Basic Wall","name":"Generic - 250mm Insulated Concrete","thickness":250,"structure":"C30"}],
    "walls":[{"id":"W7","mark":"W7","typeId":"I250","baseLevel":"L1","baseOffset":0,"topLevel":"L2","topOffset":0,"length":9800}],"doors":[],"windows":[],"rooms":[]})"));
  auto m = bim::modelFromJson(v, seed);
  CHECK(m && m->walls.size() == 1 && m->walls[0].x == 13800 && m->walls[0].angleDeg == 90);
  CHECK_NEAR(bim::wallVolume(*m, m->walls[0]), 9.8 * 3 * 0.25, 1e-9);
}

TEST("OCCT hidden-line mode removes hidden edges (fewer dark pixels than wireframe)") {
  occt::OffscreenView v;
  v.setModel(bim::villaRiverside());
  auto dark = [&](const char* mode) {
    v.setMode(mode);
    auto px = v.renderRgba(740, 530);
    size_t n = 0;
    for (size_t i = 0; i + 3 < px.size(); i += 4) n += (px[i] + px[i + 1] + px[i + 2]) / 3 < 150;
    return n;
  };
  const size_t wire = dark("wireframe"), hidden = dark("hidden");
  CHECK(hidden > 1000 && hidden < wire * 9 / 10);
}
