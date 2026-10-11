#pragma once
#include <TopoDS_Shape.hxx>

#include "thcad/occt/geometry.hpp"

namespace thcad::occt {
struct Solid::Impl {
  TopoDS_Shape shape;
};
}  // namespace thcad::occt
