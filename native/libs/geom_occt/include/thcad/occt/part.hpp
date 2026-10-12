#pragma once
// Feature-based part: sketches (rectangles, circles, polygons, slots on a principal plane) and an ordered
// feature list (extrude / revolve add or cut, holes with counterbores, fillets, chamfers, linear and
// circular patterns), evaluated in order into one OCCT solid. A feature that fails (e.g. a fillet radius
// larger than its edges allow) is skipped and reported; the part keeps the result of the features before it.
#include <array>
#include <string>
#include <vector>

#include "thcad/core/json.hpp"

namespace thcad::occt {

struct SketchShape {
  enum class Kind { Rect, Circle, Poly, Slot };
  Kind kind = Kind::Rect;
  double x = 0, y = 0, w = 0, h = 0, r = 0, angle = 0;  // rect: corner x, y + w × h; circle: centre + r; slot: centre, length w, radius r, angle
  std::vector<std::array<double, 2>> pts;               // poly
};

struct SketchDef {
  std::string id;
  std::string plane = "XY";  // XY (normal +Z) | XZ (normal −Y) | YZ (normal +X)
  double offset = 0;
  std::vector<SketchShape> shapes;
};

struct FeatureDef {
  enum class Kind { Extrude, Revolve, Hole, Fillet, Chamfer, Pattern };
  std::string id;
  Kind kind = Kind::Extrude;
  bool cut = false;
  bool suppressed = false;
  std::string sketch;  // extrude / revolve
  double depth = 10;   // extrude depth, hole depth
  bool reverse = false;
  bool through = false;
  bool symmetric = false;
  double angle = 360;      // revolve (deg), circular pattern total angle
  std::string axis = "v";  // revolve about the sketch's u or v axis
  double x = 0, y = 0, dia = 0, cbDia = 0, cbDepth = 0;  // hole (from the top face, along −Z)
  std::string edges = "all";  // fillet / chamfer: all | vertical | top | bottom | circular
  double r = 1;               // fillet radius, chamfer distance
  std::string source;         // pattern: feature id
  bool circular = false;
  int count = 2;
  double dx = 0, dy = 0, cx = 0, cy = 0;
};

struct PartDef {
  std::vector<SketchDef> sketches;
  std::vector<FeatureDef> features;
};

PartDef partFromJson(const json::Value& v);

}  // namespace thcad::occt
