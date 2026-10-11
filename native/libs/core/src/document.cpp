#include "thcad/core/document.hpp"

#include <algorithm>

namespace thcad {

const char* kindName(const Shape& s) {
  static constexpr const char* names[] = {"line", "polyline", "circle", "arc", "text", "dimension"};
  return names[s.index()];
}

const Layer* Document::findLayer(const std::string& n) const {
  auto it = std::find_if(layers.begin(), layers.end(), [&](const Layer& l) { return l.name == n; });
  return it == layers.end() ? nullptr : &*it;
}

const Entity* Document::findEntity(const std::string& i) const {
  auto it = std::find_if(entities.begin(), entities.end(), [&](const Entity& e) { return e.id() == i; });
  return it == entities.end() ? nullptr : &*it;
}

std::vector<Layer> defaultLayers() {
  // Same standard layer set as ui/src/cad/seed.ts.
  return {
      {"0", "#1f2937", true, false, Linetype::Continuous, 0.25},
      {"A-Wall", "#111827", true, false, Linetype::Continuous, 0.5},
      {"A-Door", "#0f766e", true, false, Linetype::Continuous, 0.25},
      {"A-Window", "#2563eb", true, false, Linetype::Continuous, 0.25},
      {"A-Furniture", "#6b7280", true, false, Linetype::Continuous, 0.13},
      {"A-Grid", "#9aa1ab", true, false, Linetype::DashDot, 0.13},
      {"A-Dims", "#3f4654", true, false, Linetype::Continuous, 0.13},
      {"A-Anno", "#1f2937", true, false, Linetype::Continuous, 0.25},
      {"Defpoints", "#9ca3af", true, false, Linetype::Continuous, 0.13},
  };
}

Document Document::blank(std::string name) {
  Document d;
  d.id = "doc-" + name;
  d.name = std::move(name);
  d.layers = defaultLayers();
  return d;
}

}  // namespace thcad
