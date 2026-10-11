#pragma once
// Native BIM element model — mirrors ui/src/bim/model.ts (same data, same formulas, same checks).
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

struct Model {
  std::vector<Level> levels;
  std::vector<WallType> wallTypes;
  std::vector<Wall> walls;
  std::vector<Opening> doors, windows;
  std::vector<Room> rooms;

  const Level* level(const std::string& id) const;
  const WallType* type(const std::string& id) const;
  const Wall* wall(const std::string& id) const;
};

Model villaRiverside();

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
