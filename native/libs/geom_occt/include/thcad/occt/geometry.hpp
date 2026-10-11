#pragma once
// Open CASCADE adapter: exact solids for BIM elements and 2D→3D operations on CAD documents.
// Public API is OCCT-free (pimpl) so the rest of the engine does not include OCCT headers.
#include <memory>
#include <string>
#include <vector>

#include "thcad/bim/model.hpp"
#include "thcad/core/document.hpp"

namespace thcad::occt {

class Solid {
 public:
  Solid();
  ~Solid();
  Solid(Solid&&) noexcept;
  Solid& operator=(Solid&&) noexcept;
  bool isNull() const;
  /** Exact volume in m³ (BRepGProp). */
  double volumeM3() const;
  struct Impl;
  std::unique_ptr<Impl> impl;
};

/** Straight wall solid: length × thickness × height (mm), base at z = 0. */
Solid wallSolid(double lengthMm, double thicknessMm, double heightMm);
/** Wall with its hosted openings cut out by boolean subtraction. */
Solid wallWithOpenings(const bim::Model& m, const bim::Wall& w);
/** Every wall (with openings) placed on its location line and level; one compound. */
Solid buildingSolid(const bim::Model& m);
/** Extrudes every closed polyline on `layer` by `heightMm`; returns one compound. */
Solid extrudeClosedPolylines(const Document& doc, const std::string& layer, double heightMm, size_t* count = nullptr);
/** Writes a STEP AP214 file. Returns an empty string on success, otherwise the error. */
std::string writeStep(const Solid& s, const std::string& path);
/** OCCT version string, e.g. "7.9.3". */
std::string version();

}  // namespace thcad::occt
