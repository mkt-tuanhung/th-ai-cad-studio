#pragma once
// OCCT-side entry point of the feature evaluator (scene.cpp builds part items through it).
#include <TopoDS_Shape.hxx>

#include <string>
#include <vector>

#include "thcad/occt/part.hpp"

namespace thcad::occt {
TopoDS_Shape buildPart(const PartDef& p, std::vector<std::string>* errors);
}
