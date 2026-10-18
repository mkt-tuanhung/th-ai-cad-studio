#pragma once
// Native BIM element model — mirrors ui/src/bim/model.ts (same data, same formulas, same checks).
#include <array>
#include <map>
#include <optional>
#include <string>
#include <vector>

namespace thcad::bim {

struct Level { std::string id, name; double elevation; };
struct WallType { std::string id, family, name; double thickness; std::string structure, finishExt, finishInt, description; };
struct Wall {
  std::string id, mark, typeId, baseLevel;
  double baseOffset = 0;
  std::string topLevel;
  double topOffset = 0;
  double length = 0;
  /** Location line start (mm, plan) and direction (degrees CCW from +X). Native-only for now. */
  double x = 0, y = 0, angleDeg = 0;
};
struct Opening { std::string id; enum class Cat { Door, Window } category; std::string mark, family, type, hostWall; double offset, width, height, sill; };
struct Room { std::string id, number, name, level; double area; };
using P2 = std::array<double, 2>;
/** A slab drawn in the UI (ui/src/bim/model.ts Slab); the UI builds its solid, the native builder only needs to
 *  know how much of a level's floor it covers. */
struct Slab {
  std::string id;
  enum class Kind { Floor, Roof, Ceiling } kind = Kind::Floor;
  std::string level;
  double offset = 0;
  std::vector<P2> outline;              // mm, plan
  std::vector<std::vector<P2>> openings;  // holes (a stair well)
  bool landing = false;                 // a stair landing part way up a storey
};

struct Model {
  std::vector<Level> levels;
  std::vector<WallType> wallTypes;
  std::vector<Wall> walls;
  std::vector<Opening> doors, windows;
  std::vector<Room> rooms;
  /** Slabs drawn in the UI (it builds their solids). The native builder still adds its default full-floor slab
   *  on a level unless the drawn floor / roof slabs cover that floor (see defaultSlabNeeded). */
  std::vector<Slab> slabs;

  const Level* level(const std::string& id) const;
  const WallType* type(const std::string& id) const;
  const Wall* wall(const std::string& id) const;
};

Model villaRiverside();

/** Plan extent (x0, y0, x1, y1 mm, wall location lines) of the exterior walls (≥ 200 mm) that start or end on
 *  each level: where the native builder puts that level's default floor / roof slab. */
std::map<std::string, std::array<double, 4>> levelWallSpans(const Model& m);
/** Plan area (mm²) of the drawn floor and roof slabs of `level` inside the box — stair landings, ceilings and
 *  slabs far off the level left out, stair wells taken off. */
double drawnSlabArea(const Model& m, const std::string& level, const std::array<double, 4>& box);
/** Whether the native default slab of `level` (over `box`) is still needed: only drawn slabs that actually make
 *  the floor (≥ 65 % of the box, or ≥ 90 % of the level's rooms and ≥ 40 % of the box) replace it — a balcony
 *  or a landing does not. */
bool defaultSlabNeeded(const Model& m, const std::string& level, const std::array<double, 4>& box);

double wallHeight(const Model& m, const Wall& w);  // mm
double wallArea(const Model& m, const Wall& w);    // m²
double wallVolume(const Model& m, const Wall& w);  // m³

struct CheckResult {
  enum class Key { Health, Clash, Standards, Rooms, Params } key;
  enum class Status { Ok, Error, Warning } status;
  std::vector<std::string> messages;
  size_t count() const { return messages.size(); }
};
std::vector<CheckResult> runModelChecks(const Model& m);

}  // namespace thcad::bim
