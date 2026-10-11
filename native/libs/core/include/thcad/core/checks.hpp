#pragma once
// Deterministic drawing checks ("Detected (n)" in the UI). No AI involved.
#include <optional>
#include <string>
#include <vector>

#include "thcad/core/document.hpp"

namespace thcad {

struct Finding {
  enum class Kind { DimensionOverride, ZeroLength } kind;
  std::string entityId;
  double measured = 0;
  std::string shown;
};

std::vector<Finding> runChecks(const Document& doc);

}  // namespace thcad
