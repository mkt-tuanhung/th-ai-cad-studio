add_library(thcad_core
  src/geometry.cpp
  src/document.cpp
  src/command_bus.cpp
  src/commands.cpp
  src/dxf.cpp
  src/json.cpp
  src/ops_json.cpp
  src/proposal.cpp
  src/checks.cpp
)
add_library(thcad::core ALIAS thcad_core)
target_include_directories(thcad_core PUBLIC include)
