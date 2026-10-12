cmake_minimum_required(VERSION 3.24)
project(THAICADStudio VERSION 0.1.0 LANGUAGES CXX)
if(APPLE)
  enable_language(OBJCXX)  # AppKit glue (unified title bar, offscreen GL context)
endif()

# MD CAD AI STUDIO — native host (architecture option A, see ../docs/ARCHITECTURE.md):
#   Qt 6 host + Qt WebEngine UI shell + native CAD core / OCCT geometry / local AI runtime.

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)
set(CMAKE_OSX_ARCHITECTURES arm64 CACHE STRING "Apple Silicon only")
set(CMAKE_OSX_DEPLOYMENT_TARGET 14.0 CACHE STRING "macOS 14+")

option(THCAD_WITH_QT "Build the Qt 6 desktop app" ON)
option(THCAD_WITH_OCCT "Build the Open CASCADE geometry adapter" ON)
option(THCAD_WITH_LLAMA "Build the llama.cpp local AI backend" ON)
option(THCAD_BUILD_TESTS "Build unit tests" ON)

if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE RelWithDebInfo)
endif()

if(APPLE)
  # Homebrew prefix for Qt / OCCT / llama.cpp
  list(APPEND CMAKE_PREFIX_PATH /opt/homebrew)
endif()

if(MSVC)
  add_compile_options(/W3 /utf-8 /permissive- /Zc:__cplusplus)
  add_compile_definitions(_USE_MATH_DEFINES NOMINMAX _CRT_SECURE_NO_WARNINGS)
else()
  add_compile_options(-Wall -Wextra -Wpedantic -Wno-unused-parameter)
endif()

add_subdirectory(libs/core)
add_subdirectory(libs/bim)
add_subdirectory(libs/ai)

if(THCAD_WITH_OCCT)
  find_package(OpenCASCADE CONFIG QUIET)
  if(OpenCASCADE_FOUND)
    message(STATUS "Open CASCADE ${OpenCASCADE_VERSION}: geometry adapter enabled")
    add_subdirectory(libs/geom_occt)
  else()
    message(WARNING "Open CASCADE not found — geometry adapter disabled")
    set(THCAD_WITH_OCCT OFF)
  endif()
endif()

add_subdirectory(tools)

if(THCAD_WITH_QT)
  find_package(Qt6 6.5 QUIET COMPONENTS Core Gui Widgets WebEngineWidgets WebChannel Network)
  if(Qt6_FOUND)
    message(STATUS "Qt ${Qt6_VERSION}: desktop app enabled")
    add_subdirectory(app)
  else()
    message(WARNING "Qt 6 WebEngine not found — desktop app disabled")
  endif()
endif()

if(THCAD_BUILD_TESTS)
  enable_testing()
  add_subdirectory(tests)
endif()
