qt_standard_project_setup()
set(CMAKE_AUTOMOC ON)

qt_add_executable(THAICADStudio MACOSX_BUNDLE WIN32
  src/main.cpp
  src/main_window.cpp src/main_window.hpp
  src/ui_scheme.cpp src/ui_scheme.hpp
  src/host_bridge.cpp src/host_bridge.hpp
  src/native_viewport.cpp src/native_viewport.hpp
  src/mac_window.hpp
)
if(APPLE)
  target_sources(THAICADStudio PRIVATE src/mac_window.mm)
else()
  target_sources(THAICADStudio PRIVATE src/window_other.cpp)
endif()
set_target_properties(THAICADStudio PROPERTIES
  OUTPUT_NAME "TH AI CAD Studio"
  MACOSX_BUNDLE_GUI_IDENTIFIER vn.th.aicadstudio
  MACOSX_BUNDLE_BUNDLE_NAME "TH AI CAD Studio"
  MACOSX_BUNDLE_SHORT_VERSION_STRING ${PROJECT_VERSION}
  MACOSX_BUNDLE_INFO_PLIST ${CMAKE_CURRENT_SOURCE_DIR}/resources/Info.plist.in
)
target_link_libraries(THAICADStudio PRIVATE
  Qt6::Core Qt6::Gui Qt6::Widgets Qt6::WebEngineWidgets Qt6::WebChannel
  thcad::ai thcad::bim thcad::core)
if(APPLE)
  target_link_libraries(THAICADStudio PRIVATE "-framework AppKit")
endif()
target_compile_definitions(THAICADStudio PRIVATE THCAD_SOURCE_DIR="${CMAKE_SOURCE_DIR}")
if(THCAD_WITH_OCCT)
  target_link_libraries(THAICADStudio PRIVATE thcad::geom_occt)
  target_compile_definitions(THAICADStudio PRIVATE THCAD_HAS_OCCT=1)
endif()

# Bundle the built UI (ui/dist) into Contents/Resources/ui when it exists.
set(THCAD_UI_DIST "${CMAKE_SOURCE_DIR}/../ui/dist")
# Always re-copied (the UI changes independently of the C++ sources).
# macOS: <App>.app/Contents/Resources/ui · Windows: <dir of .exe>/ui
if(APPLE)
  set(THCAD_UI_DEST "$<TARGET_BUNDLE_CONTENT_DIR:THAICADStudio>/Resources/ui")
else()
  set(THCAD_UI_DEST "$<TARGET_FILE_DIR:THAICADStudio>/ui")
endif()
add_custom_target(thcad_ui_bundle ALL
  COMMAND ${CMAKE_COMMAND} -E rm -rf "${THCAD_UI_DEST}"
  COMMAND ${CMAKE_COMMAND} -E copy_directory "${THCAD_UI_DIST}" "${THCAD_UI_DEST}"
  COMMENT "Bundling UI from ui/dist")
add_dependencies(thcad_ui_bundle THAICADStudio)
