#pragma once
// Planar geometry primitives (millimetres, Y up). Mirrors ui/src/cad/geometry.ts.
#include <cmath>
#include <optional>

namespace thcad {

struct Vec2 {
  double x = 0, y = 0;
  friend Vec2 operator+(Vec2 a, Vec2 b) { return {a.x + b.x, a.y + b.y}; }
  friend Vec2 operator-(Vec2 a, Vec2 b) { return {a.x - b.x, a.y - b.y}; }
  friend Vec2 operator*(Vec2 a, double s) { return {a.x * s, a.y * s}; }
  friend bool operator==(Vec2 a, Vec2 b) = default;
};

inline double length(Vec2 a) { return std::hypot(a.x, a.y); }
inline double distance(Vec2 a, Vec2 b) { return length(b - a); }
inline Vec2 midpoint(Vec2 a, Vec2 b) { return {(a.x + b.x) / 2, (a.y + b.y) / 2}; }
inline Vec2 normalized(Vec2 a) {
  const double l = length(a);
  return l > 0 ? Vec2{a.x / l, a.y / l} : Vec2{};
}
inline Vec2 perpendicular(Vec2 a) { return {-a.y, a.x}; }

double distanceToSegment(Vec2 p, Vec2 a, Vec2 b);

struct Circle {
  Vec2 center;
  double radius;
};
/** Circle through three points; nullopt when collinear. */
std::optional<Circle> circleFrom3(Vec2 p1, Vec2 p2, Vec2 p3);

}  // namespace thcad
