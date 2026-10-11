#pragma once
#include <optional>
#include <string>
#include <vector>

#include "thcad/core/entity.hpp"

namespace thcad {

struct Document {
  std::string id;
  std::string name;
  std::vector<Entity> entities;
  std::vector<Layer> layers;
  std::string currentLayer = "0";
  bool dirty = false;

  const Layer* findLayer(const std::string& name) const;
  const Entity* findEntity(const std::string& id) const;
  static Document blank(std::string name);
};

std::vector<Layer> defaultLayers();

}  // namespace thcad
