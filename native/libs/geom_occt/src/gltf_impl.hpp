#pragma once
// glTF 2.0 binary writer for SceneView::writeGlb (internal: OCCT shapes in, GLB file out).
#include <TopoDS_Shape.hxx>

#include <array>
#include <string>
#include <vector>

#include "thcad/occt/scene.hpp"

namespace thcad::occt {

struct GlbItem {
  std::string id, mat, group;
  std::array<double, 3> rgb{0.8, 0.8, 0.8};
  double transparency = 0;
  TopoDS_Shape shape;
};

/** Tessellates each shape (exact B-rep → triangles), writes `path`. Empty string on success. */
std::string writeGlbFile(const std::vector<GlbItem>& items, const std::string& path, GlbStats* stats);

/** Stable material name of a surface + colour: "md:<mat>:<rrggbb>[:t<alpha%>]". */
std::string glbMaterialName(const std::string& mat, const std::array<double, 3>& rgb, double transparency);

}  // namespace thcad::occt
