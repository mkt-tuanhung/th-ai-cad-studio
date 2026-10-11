#pragma once
// BIM model wire format shared with ui/src/bim/model.ts (BimModel). Placements (x, y, angle) are
// engine-side data: walls keep the placement of the seed model with the same id.
#include <optional>
#include <string>

#include "thcad/bim/model.hpp"
#include "thcad/core/json.hpp"

namespace thcad::bim {

/** Returns nullopt (and `error`) when the JSON is not a BimModel. */
std::optional<Model> modelFromJson(const json::Value& v, const Model& placements, std::string* error = nullptr);

}  // namespace thcad::bim
