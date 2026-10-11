#pragma once
// Entity model. Mirrors ui/src/cad/types.ts (the UI prototype) — keep both in sync.
#include <optional>
#include <string>
#include <variant>
#include <vector>

#include "thcad/core/geometry.hpp"

namespace thcad {

enum class Linetype { ByLayer, Continuous, Dashed, DashDot };

struct EntityProps {
  std::string id;
  std::string layer = "0";
  std::string color = "ByLayer";
  Linetype linetype = Linetype::ByLayer;
  std::string lineweight = "ByLayer";
  int transparency = 0;  // 0–90 %
};

struct Line { Vec2 a, b; };
struct Polyline { std::vector<Vec2> points; bool closed = false; };
struct CircleE { Vec2 center; double radius = 0; };
struct Arc { Vec2 center; double radius = 0, start = 0, end = 0; };  // radians, CCW
struct Text { Vec2 position; double height = 250; std::string value; double rotation = 0; bool centered = false; };
struct Dimension { Vec2 a, b; double offset = 0; std::optional<std::string> override_; double textHeight = 250; };

using Shape = std::variant<Line, Polyline, CircleE, Arc, Text, Dimension>;

struct Entity {
  EntityProps props;
  Shape shape;
  const std::string& id() const { return props.id; }
};

const char* kindName(const Shape& s);

struct Layer {
  std::string name;
  std::string color = "#1f2937";
  bool visible = true;
  bool locked = false;
  Linetype linetype = Linetype::Continuous;
  double lineweight = 0.25;
};

}  // namespace thcad
