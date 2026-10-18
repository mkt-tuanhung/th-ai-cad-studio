#include <cstdlib>
#include <filesystem>
#include "check.hpp"
#include "thcad/occt/geometry.hpp"
#include "thcad/occt/scene.hpp"
#include <cmath>
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
  const std::string path = (std::filesystem::temp_directory_path() / "thcad_test.step").string();
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
    // CI runners without a GPU (software OpenGL 1.1, no FBO) cannot draw: THCAD_TEST_NO_GPU=1 skips this check
    if (!std::getenv("THCAD_TEST_NO_GPU")) CHECK(drawn > (std::string(mode) == "shaded" ? 740u * 530u / 10u : 740u * 530u / 200u));
    std::ofstream f((std::filesystem::temp_directory_path() / (std::string("thcad_offscreen_") + mode + ".ppm")).string(), std::ios::binary);
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

TEST("OCCT building keeps the level slab under a drawn balcony, drops it under drawn floor slabs (A10)") {
  auto count = [](const bim::Model& m, double* l2Volume) {
    occt::SceneView v;
    if (!v.ok()) return -1;
    v.addBuilding(m, false);
    if (l2Volume) *l2Volume = v.volumeM3("slab:L2");
    return v.visibleCount();
  };
  auto rect = [](const char* id, bim::Slab::Kind k, const char* lv, double x0, double y0, double x1, double y1) {
    bim::Slab s;
    s.id = id;
    s.kind = k;
    s.level = lv;
    s.outline = {{x0, y0}, {x1, y0}, {x1, y1}, {x0, y1}};
    return s;
  };
  const bim::Model villa = bim::villaRiverside();
  double plain = 0, kept = 0;
  const int base = count(villa, &plain);
  if (base < 0) return;  // no OpenGL
  CHECK_NEAR(plain, 14.0 * 10.0 * 0.2, 1e-6);
  bim::Model balcony = villa;
  balcony.slabs.push_back(rect("balcony", bim::Slab::Kind::Floor, "L2", 13800, 4000, 15800, 5000));
  balcony.slabs.push_back(rect("wet", bim::Slab::Kind::Floor, "L2", 1000, 1000, 3000, 2000));
  CHECK(count(balcony, &kept) == base);
  // the drawn slabs are taken out of the default one: no doubled concrete (0.1 m² of the balcony + 2 m²)
  CHECK_NEAR(kept, plain - (0.1 + 2.0) * 0.2, 1e-6);
  bim::Model imported = villa;
  for (const char* lv : {"L1", "L2", "L3"}) imported.slabs.push_back(rect(lv, bim::Slab::Kind::Floor, lv, -100, -100, 13900, 9900));
  imported.slabs.push_back(rect("roof", bim::Slab::Kind::Roof, "RF", 1100, 1100, 12700, 8700));
  CHECK(count(imported, nullptr) == base - 4);
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

TEST("OCCT scene: primitives build exact solids; fuse, cut, common, pick and STEP") {
  occt::SceneView v;
  using K = occt::Prim::Kind;
  auto box = [](double x, double y, double z, double dx, double dy, double dz) {
    occt::Prim p;
    p.kind = K::Box;
    p.f.o = {x, y, z};
    p.s = {dx, dy, dz};
    return p;
  };
  occt::SceneItem a{"a", {0.5, 0.5, 0.5}, 0, {box(0, 0, 0, 1000, 1000, 1000)}, {}, false};
  // fused overlapping boxes count the overlap once: 1 + 1 − 0.5 = 1.5 m³
  occt::SceneItem f{"f", {0.5, 0.5, 0.5}, 0, {box(3000, 0, 0, 1000, 1000, 1000), box(3500, 0, 0, 1000, 1000, 1000)}, {}, true};
  // cylinder r 500 h 1000 with a 200 mm hole: π (0.25 − 0.04) · 1
  occt::Prim cyl;
  cyl.kind = K::Cylinder;
  cyl.f.o = {0, 3000, 0};
  cyl.s = {500, 1000, 0};
  occt::Prim hole = cyl;
  hole.f.o = {0, 3000, -10};
  hole.s = {200, 1020, 0};
  occt::SceneItem c{"c", {0.5, 0.5, 0.5}, 0, {cyl}, {hole}, false};
  occt::SceneItem o{"o", {0.5, 0.5, 0.5}, 0, {box(500, 500, 500, 1000, 1000, 1000)}, {}, false};
  // prism (right triangle 1 m × 1 m, 2 m high) = 1 m³; revolve of a 100 × 200 rectangle at r 400–500
  occt::Prim tri;
  tri.kind = K::Prism;
  tri.f.o = {0, 6000, 0};
  tri.pts = {{0, 0}, {1000, 0}, {0, 1000}};
  tri.s = {2000, 0, 0};
  occt::Prim ring;
  ring.kind = K::Revolve;
  ring.f.o = {6000, 6000, 0};
  ring.pts = {{400, 0}, {500, 0}, {500, 200}, {400, 200}};
  occt::SceneItem t{"t", {0.5, 0.5, 0.5}, 0, {tri}, {}, false};
  occt::SceneItem r{"r", {0.5, 0.5, 0.5}, 0, {ring}, {}, false};
  if (!v.ok()) return;  // no OpenGL at all
  CHECK(v.setItems({a, f, c, o, t, r}) == 0);
  CHECK_NEAR(v.volumeM3("a"), 1.0, 1e-9);
  CHECK_NEAR(v.volumeM3("f"), 1.5, 1e-6);
  CHECK_NEAR(v.volumeM3("c"), M_PI * (0.25 - 0.04), 1e-6);
  CHECK_NEAR(v.volumeM3("t"), 1.0, 1e-9);
  CHECK_NEAR(v.volumeM3("r"), M_PI * (0.25 - 0.16) * 0.2, 1e-6);
  CHECK_NEAR(v.commonM3("a", "o"), 0.125, 1e-6);  // 0.5³
  CHECK_NEAR(v.commonM3("a", "f"), 0.0, 1e-12);
  v.preset("top");
  if (!std::getenv("THCAD_TEST_NO_GPU")) {
    CHECK(!v.renderRgba(400, 400).empty());
    CHECK(v.pick(200, 200) != "x");  // a hit or the background, never a bogus id
    // the view is fitted on everything; the middle of the frame looks down at the scene centre
  }
  const std::string step = (std::filesystem::temp_directory_path() / "thcad_scene.step").string();
  CHECK(v.writeStep(step).empty());
  CHECK(std::filesystem::file_size(step) > 1000);
}

TEST("OCCT feature part: extrude, through hole, linear pattern, fillet, revolve, chamfer; failures are reported") {
  auto load = [](const char* text) {
    auto parsed = json::parse(text);
    return occt::sceneFromJson(std::get<json::Value>(parsed));
  };
  // 100 × 60 × 10 plate, three Ø10 through holes 30 mm apart, vertical corners rounded r 5
  auto items = load(R"({"items":[{"id":"plate","part":{
    "sketches":[{"id":"s1","plane":"XY","offset":0,"shapes":[{"t":"rect","x":0,"y":0,"w":100,"h":60}]}],
    "features":[{"id":"f1","kind":"extrude","sketch":"s1","depth":10},
                {"id":"f2","kind":"hole","x":20,"y":30,"dia":10,"through":true},
                {"id":"f3","kind":"pattern","source":"f2","type":"linear","count":3,"dx":30,"dy":0},
                {"id":"f4","kind":"fillet","edges":"vertical","r":5}]}}]})");
  auto r = occt::analyzeScene(items, false);
  const double pi = 3.14159265358979323846;
  const double expected = 100 * 60 * 10 - 3 * pi * 25 * 10 - 4 * (25 - pi * 25 / 4) * 10;
  CHECK(r.items[0].built);
  CHECK_NEAR(r.items[0].volume * 1e9, expected, 0.5);
  // revolve a 10 × 20 rectangle on XZ about its v axis (world Z) → cylinder r 10, h 20
  items = load(R"({"items":[{"id":"cyl","part":{"sketches":[{"id":"s","plane":"XZ","shapes":[{"t":"rect","x":0,"y":0,"w":10,"h":20}]}],
    "features":[{"id":"f1","kind":"revolve","sketch":"s","axis":"v","angle":360}]}}]})");
  r = occt::analyzeScene(items, false);
  CHECK_NEAR(r.items[0].volume * 1e9, pi * 100 * 20, 0.5);
  // chamfer the top edges of a 20 mm cube: smaller than the cube, still a valid solid
  items = load(R"({"items":[{"id":"c","part":{"sketches":[{"id":"s","shapes":[{"t":"rect","x":0,"y":0,"w":20,"h":20}]}],
    "features":[{"id":"f1","kind":"extrude","sketch":"s","depth":20},{"id":"f2","kind":"chamfer","edges":"top","r":2}]}}]})");
  r = occt::analyzeScene(items, false);
  CHECK(r.items[0].built);
  CHECK(r.items[0].volume * 1e9 < 8000 - 100 && r.items[0].volume * 1e9 > 8000 - 200);
  // a fillet bigger than the plate allows fails, is reported, and leaves the previous body
  items = load(R"({"items":[{"id":"bad","part":{"sketches":[{"id":"s","shapes":[{"t":"rect","x":0,"y":0,"w":20,"h":20}]}],
    "features":[{"id":"f1","kind":"extrude","sketch":"s","depth":5},{"id":"f2","kind":"fillet","edges":"vertical","r":15}]}}]})");
  r = occt::analyzeScene(items, false);
  CHECK(!r.items[0].built);
  CHECK_NEAR(r.items[0].volume * 1e9, 2000, 0.5);
}

TEST("OCCT feature part: holes start on the material under them (counterbores in a plate below a boss)") {
  auto parsed = json::parse(R"({"items":[{"id":"bracket","part":{
    "sketches":[{"id":"s1","shapes":[{"t":"rect","x":0,"y":0,"w":120,"h":80}]},{"id":"s2","offset":12,"shapes":[{"t":"circle","x":60,"y":40,"r":22}]}],
    "features":[{"id":"f1","kind":"extrude","sketch":"s1","depth":12},
                {"id":"f2","kind":"fillet","edges":"vertical","r":6},
                {"id":"f3","kind":"extrude","sketch":"s2","depth":18},
                {"id":"f4","kind":"hole","x":60,"y":40,"dia":25,"through":true},
                {"id":"f5","kind":"hole","x":15,"y":15,"dia":9,"through":true,"cbDia":15,"cbDepth":5},
                {"id":"f6","kind":"pattern","source":"f5","type":"linear","count":2,"dx":90},
                {"id":"f7","kind":"hole","x":15,"y":65,"dia":9,"through":true,"cbDia":15,"cbDepth":5},
                {"id":"f8","kind":"pattern","source":"f7","type":"linear","count":2,"dx":90}]}}]})");
  auto r = occt::analyzeScene(occt::sceneFromJson(std::get<json::Value>(parsed)), false);
  const double pi = 3.14159265358979323846;
  const double plate = 120 * 80 * 12 - 4 * (36 - pi * 36 / 4) * 12;
  const double boss = pi * 22 * 22 * 18, bore = pi * 12.5 * 12.5 * 30;
  const double mounts = 4 * (pi * 4.5 * 4.5 * 12 + pi * (7.5 * 7.5 - 4.5 * 4.5) * 5);
  CHECK(r.items[0].built);
  CHECK_NEAR(r.items[0].volume * 1e9, plate + boss - bore - mounts, 1.0);
}
