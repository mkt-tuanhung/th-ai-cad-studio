#pragma once
// ASCII DXF R12 (AC1009) writer/reader — same subset as ui/src/cad/dxf.ts.
#include <map>
#include <string>
#include <string_view>

#include "thcad/core/document.hpp"

namespace thcad {

std::string toDxf(const Document& doc);

struct DxfImport {
  Document document;
  std::map<std::string, int> skipped;  // entity type → count
};
DxfImport fromDxf(std::string_view text, std::string name);

}  // namespace thcad
