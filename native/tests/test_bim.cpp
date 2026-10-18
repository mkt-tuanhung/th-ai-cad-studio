#include "check.hpp"
#include "thcad/bim/model.hpp"
#include "thcad/bim/model_json.hpp"
#include "thcad/core/json.hpp"

using namespace thcad::bim;

TEST("BIM quantities match the approved schedule (mockup 04)") {
  const Model m = villaRiverside();
  CHECK(m.walls.size() == 24 && m.doors.size() == 12 && m.windows.size() == 18 && m.rooms.size() == 8 && m.levels.size() == 4);
  const double area[] = {12.75, 10.80, 8.40, 12.60, 11.70};
  const double vol[] = {2.55, 2.16, 1.26, 2.52, 2.34};
  for (int i = 0; i < 5; ++i) {
    CHECK_NEAR(wallArea(m, m.walls[i]), area[i], 1e-9);
    CHECK_NEAR(wallVolume(m, m.walls[i]), vol[i], 1e-9);
  }
}

TEST("BIM model checks give 0 / 3 / 5 / 0 / 0 like the UI") {
  const auto r = runModelChecks(villaRiverside());
  CHECK(r[0].count() == 0 && r[1].count() == 3 && r[2].count() == 5 && r[3].count() == 0 && r[4].count() == 0);
}

TEST("BIM health detects a wall whose top is below its base") {
  Model m = villaRiverside();
  m.walls[0].topLevel = "L1";
  CHECK(runModelChecks(m)[0].count() == 1);
}

namespace {
Slab rectSlab(const std::string& id, Slab::Kind kind, const std::string& level, double x0, double y0, double x1, double y1) {
  Slab s;
  s.id = id;
  s.kind = kind;
  s.level = level;
  s.outline = {{x0, y0}, {x1, y0}, {x1, y1}, {x0, y1}};
  return s;
}
std::array<double, 4> slabBox(const Model& m, const std::string& lv) {
  const auto b = levelWallSpans(m).at(lv);
  return {b[0] - 100, b[1] - 100, b[2] + 100, b[3] + 100};  // outer face of the 200 mm walls (SceneView::addBuilding)
}
}  // namespace

TEST("BIM default level slab: a balcony or a landing keeps it, drawn floor slabs replace it (A10)") {
  Model villa = villaRiverside();
  const auto spans = levelWallSpans(villa);
  CHECK(spans.size() == 4);
  CHECK_NEAR(spans.at("L2")[2], 13800, 1e-6);
  CHECK_NEAR(spans.at("RF")[0], 1200, 1e-6);
  for (const char* lv : {"L1", "L2", "L3", "RF"}) CHECK(defaultSlabNeeded(villa, lv, slabBox(villa, lv)));
  // a 2 m² balcony drawn on L2 (cantilevered out of the east wall), a 2 m² slab inside, a full-size landing:
  // the floor of L2 must stay
  Model withBalcony = villa;
  withBalcony.slabs.push_back(rectSlab("balcony", Slab::Kind::Floor, "L2", 13800, 4000, 15800, 5000));
  withBalcony.slabs.push_back(rectSlab("wet", Slab::Kind::Floor, "L2", 1000, 1000, 3000, 2000));
  Slab landing = rectSlab("landing", Slab::Kind::Floor, "L2", -100, -100, 13900, 9900);
  landing.landing = true;
  withBalcony.slabs.push_back(landing);
  Slab ceiling = rectSlab("ceiling", Slab::Kind::Ceiling, "L2", -100, -100, 13900, 9900);
  withBalcony.slabs.push_back(ceiling);
  CHECK(drawnSlabArea(withBalcony, "L2", slabBox(withBalcony, "L2")) < 2.2e6);
  for (const char* lv : {"L1", "L2", "L3", "RF"}) CHECK(defaultSlabNeeded(withBalcony, lv, slabBox(withBalcony, lv)));
  // an imported plan: real floor slabs on every level (a stair well in L2), a roof slab on RF
  Model imported = villa;
  Slab l2 = rectSlab("S-L2", Slab::Kind::Floor, "L2", -100, -100, 13900, 9900);
  l2.openings.push_back({{5000, 4000}, {6000, 4000}, {6000, 7000}, {5000, 7000}});
  imported.slabs.push_back(rectSlab("S-L1", Slab::Kind::Floor, "L1", -100, -100, 13900, 9900));
  imported.slabs.push_back(l2);
  imported.slabs.push_back(rectSlab("S-L3", Slab::Kind::Floor, "L3", -100, -100, 13900, 9900));
  imported.slabs.push_back(rectSlab("S-RF", Slab::Kind::Roof, "RF", 1100, 1100, 12700, 8700));
  CHECK_NEAR(drawnSlabArea(imported, "L2", slabBox(imported, "L2")), 14000.0 * 10000 - 1000.0 * 3000, 1);
  for (const char* lv : {"L1", "L2", "L3", "RF"}) CHECK(!defaultSlabNeeded(imported, lv, slabBox(imported, lv)));
  // an L-shaped floor (55 % of the box) still counts when it covers the level's rooms
  Model ell = villa;
  Slab lslab;
  lslab.id = "L";
  lslab.level = "L3";
  lslab.outline = {{-100, -100}, {13900, -100}, {13900, 4000}, {5000, 4000}, {5000, 9900}, {-100, 9900}};
  ell.slabs.push_back(lslab);
  ell.rooms.push_back({"r1", "301", "Hall", "L3", 60});
  const auto b3 = slabBox(ell, "L3");
  CHECK(drawnSlabArea(ell, "L3", b3) < 0.65 * (b3[2] - b3[0]) * (b3[3] - b3[1]));
  CHECK(!defaultSlabNeeded(ell, "L3", b3));
  ell.rooms.back().area = 120;  // the drawn slab is only part of a bigger floor: keep the default
  CHECK(defaultSlabNeeded(ell, "L3", b3));
}

TEST("BIM model JSON reads slab kind, outline, stair wells and landings from the UI") {
  auto v = std::get<thcad::json::Value>(thcad::json::parse(R"({"levels":[{"id":"L1","name":"Level 1","elevation":0}],"wallTypes":[],"walls":[],
    "slabs":[{"id":"s1","kind":"floor","level":"L1","offset":0,"thickness":200,"outline":[[0,0],[4000,0],[4000,3000],[0,3000]],"openings":[[[1000,1000],[2000,1000],[2000,2000],[1000,2000]]]},
             {"id":"s2","kind":"floor","level":"L1","offset":1650,"thickness":150,"outline":[[0,0],[1000,0],[1000,1000]],"landing":true},
             {"id":"s3","kind":"roof","level":"L1","offset":0,"thickness":150,"outline":[[0,0],[1,0],[1,1]]},
             {"id":"s4","kind":"ceiling","level":"L1","offset":2700,"thickness":10,"outline":[]}]})"));
  auto m = modelFromJson(v, villaRiverside());
  CHECK(m && m->slabs.size() == 4);
  if (!m || m->slabs.size() != 4) return;
  CHECK(m->slabs[0].kind == Slab::Kind::Floor && m->slabs[0].outline.size() == 4 && m->slabs[0].openings.size() == 1 && !m->slabs[0].landing);
  CHECK(m->slabs[1].landing && m->slabs[1].offset == 1650);
  CHECK(m->slabs[2].kind == Slab::Kind::Roof && m->slabs[3].kind == Slab::Kind::Ceiling);
  CHECK_NEAR(drawnSlabArea(*m, "L1", {0, 0, 4000, 3000}), 4000.0 * 3000 - 1000.0 * 1000 + 0.5, 1e-6);
}
