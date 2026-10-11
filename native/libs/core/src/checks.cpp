#include "thcad/core/checks.hpp"

#include <cmath>
#include <cstdlib>

namespace thcad {

std::vector<Finding> runChecks(const Document& doc) {
  std::vector<Finding> out;
  for (const auto& e : doc.entities) {
    if (const auto* d = std::get_if<Dimension>(&e.shape); d && d->override_) {
      const double m = distance(d->a, d->b);
      char* end = nullptr;
      const double shown = std::strtod(d->override_->c_str(), &end);
      const bool numeric = end && end != d->override_->c_str();
      if (!numeric || std::abs(shown - m) / std::max(m, 1.0) > 0.01)
        out.push_back({Finding::Kind::DimensionOverride, e.id(), m, *d->override_});
    }
    if (const auto* l = std::get_if<Line>(&e.shape); l && l->a == l->b) out.push_back({Finding::Kind::ZeroLength, e.id()});
  }
  return out;
}

}  // namespace thcad
