qt_standard_project_setup()
set(CMAKE_AUTOMOC ON)

qt_add_executable(THAICADStudio MACOSX_BUNDLE WIN32
  src/main.cpp
  src/main_window.cpp src/main_window.hpp
  src/ui_scheme.cpp src/ui_scheme.hpp
  src/host_bridge.cpp src/host_bridge.hpp
  src/dwg_reader.cpp src/dwg_reader.hpp
  src/native_viewport.cpp src/native_viewport.hpp
  src/video_writer.cpp src/video_writer.hpp
  src/speech_input.hpp
  src/whisper_runner.cpp src/whisper_runner.hpp
  src/model_downloader.cpp src/model_downloader.hpp
  src/blender_worker.cpp src/blender_worker.hpp
  src/library_store.cpp src/library_store.hpp
  src/host_library.cpp
  src/mac_window.hpp
  src/licence_gate.cpp src/licence_gate.hpp
)
# brand icon: macOS AppIcon.icns in Contents/Resources, Windows app.ico through a resource script
if(APPLE)
  set(THCAD_ICNS ${CMAKE_CURRENT_SOURCE_DIR}/resources/branding/AppIcon.icns)
  set_source_files_properties(${THCAD_ICNS} PROPERTIES MACOSX_PACKAGE_LOCATION Resources)
  target_sources(THAICADStudio PRIVATE ${THCAD_ICNS})
elseif(WIN32)
  target_sources(THAICADStudio PRIVATE resources/branding/app.rc)
endif()
if(APPLE)
  target_sources(THAICADStudio PRIVATE src/mac_window.mm src/video_writer_mac.mm src/speech_input_mac.mm)
  # ARC keeps the AVFoundation writer objects alive as C++ members
  set_source_files_properties(src/video_writer_mac.mm src/speech_input_mac.mm PROPERTIES COMPILE_FLAGS "-fobjc-arc")
else()
  target_sources(THAICADStudio PRIVATE src/window_other.cpp)
endif()
if(NOT APPLE AND NOT WIN32)
  target_sources(THAICADStudio PRIVATE src/speech_input_other.cpp)
endif()
# Blender render worker script (run by the user's own Blender as a separate process; Blender is not bundled)
set(THCAD_MD_RENDER ${CMAKE_CURRENT_SOURCE_DIR}/resources/md_render.py)
# asset library helper (import / probe 3D files), run by the same Blender
set(THCAD_MD_LIBRARY ${CMAKE_CURRENT_SOURCE_DIR}/resources/md_library.py)
if(APPLE)
  set_source_files_properties(${THCAD_MD_RENDER} ${THCAD_MD_LIBRARY} PROPERTIES MACOSX_PACKAGE_LOCATION Resources)
  target_sources(THAICADStudio PRIVATE ${THCAD_MD_RENDER} ${THCAD_MD_LIBRARY})
else()
  add_custom_command(TARGET THAICADStudio POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E make_directory "$<TARGET_FILE_DIR:THAICADStudio>/resources"
    COMMAND ${CMAKE_COMMAND} -E copy_if_different ${THCAD_MD_RENDER} "$<TARGET_FILE_DIR:THAICADStudio>/resources/md_render.py"
    COMMAND ${CMAKE_COMMAND} -E copy_if_different ${THCAD_MD_LIBRARY} "$<TARGET_FILE_DIR:THAICADStudio>/resources/md_library.py")
endif()
if(WIN32)
  target_sources(THAICADStudio PRIVATE src/video_writer_win.cpp src/speech_input_win.cpp)
  target_link_libraries(THAICADStudio PRIVATE mfplat mfreadwrite mfuuid sapi ole32)
endif()
set_target_properties(THAICADStudio PROPERTIES
  OUTPUT_NAME "MD CAD AI STUDIO"
  MACOSX_BUNDLE_GUI_IDENTIFIER vn.th.aicadstudio
  MACOSX_BUNDLE_BUNDLE_NAME "MD CAD AI STUDIO"
  MACOSX_BUNDLE_SHORT_VERSION_STRING ${PROJECT_VERSION}
  MACOSX_BUNDLE_INFO_PLIST ${CMAKE_CURRENT_SOURCE_DIR}/resources/Info.plist.in
)
target_link_libraries(THAICADStudio PRIVATE
  Qt6::Core Qt6::Gui Qt6::Widgets Qt6::WebEngineWidgets Qt6::WebChannel Qt6::Network
  thcad::ai thcad::bim thcad::core)
if(APPLE)
  target_link_libraries(THAICADStudio PRIVATE "-framework AppKit" "-framework AVFoundation" "-framework CoreMedia" "-framework CoreVideo" "-framework Speech")
endif()
target_compile_definitions(THAICADStudio PRIVATE THCAD_SOURCE_DIR="${CMAKE_SOURCE_DIR}")
# licence: verification only (the signing seed never leaves the owner's keygen vault)
if(NOT THCAD_HAS_LICENSE)
  message(FATAL_ERROR "the desktop app needs libsodium for its licence check (brew install libsodium / vcpkg libsodium)")
endif()
target_link_libraries(THAICADStudio PRIVATE thcad::license)
if(THCAD_LICENSE_ENFORCE)
  target_compile_definitions(THAICADStudio PRIVATE THCAD_LICENSE_ENFORCE=1)
  message(STATUS "Licence enforcement: ON (customer build)")
else()
  message(STATUS "Licence enforcement: OFF (dev / QA build — never package this)")
endif()
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
