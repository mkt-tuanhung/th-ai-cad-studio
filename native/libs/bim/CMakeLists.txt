add_library(thcad_bim src/model.cpp src/model_json.cpp)
add_library(thcad::bim ALIAS thcad_bim)
target_include_directories(thcad_bim PUBLIC include)
target_link_libraries(thcad_bim PUBLIC thcad::core)
