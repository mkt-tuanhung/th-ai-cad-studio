#include "check.hpp"
#include "thcad/bim/model.hpp"

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
