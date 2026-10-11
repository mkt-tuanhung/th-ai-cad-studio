#include "thcad/core/geometry.hpp"

#include <algorithm>

namespace thcad {

double distanceToSegment(Vec2 p, Vec2 a, Vec2 b) {
  const Vec2 ab = b - a;
  const double len2 = ab.x * ab.x + ab.y * ab.y;
  const double t = len2 > 0 ? std::clamp(((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / len2, 0.0, 1.0) : 0.0;
  return distance(p, a + ab * t);
}

std::optional<Circle> circleFrom3(Vec2 p1, Vec2 p2, Vec2 p3) {
  const double d = 2 * (p1.x * (p2.y - p3.y) + p2.x * (p3.y - p1.y) + p3.x * (p1.y - p2.y));
  if (std::abs(d) < 1e-9) return std::nullopt;
  const double s1 = p1.x * p1.x + p1.y * p1.y, s2 = p2.x * p2.x + p2.y * p2.y, s3 = p3.x * p3.x + p3.y * p3.y;
  const Vec2 c{(s1 * (p2.y - p3.y) + s2 * (p3.y - p1.y) + s3 * (p1.y - p2.y)) / d,
               (s1 * (p3.x - p2.x) + s2 * (p1.x - p3.x) + s3 * (p2.x - p1.x)) / d};
  return Circle{c, distance(c, p1)};
}

}  // namespace thcad
