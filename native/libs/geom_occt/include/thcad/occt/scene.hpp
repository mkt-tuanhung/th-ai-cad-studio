#pragma once
// Generic OCCT scene for the discipline workspaces (Interior, MEP, Mechanical). The web UI turns its
// domain model into primitives (boxes, cylinders, cones, spheres, tori, prisms, revolved profiles,
// with optional cuts); this module builds exact B-rep solids from them, renders offscreen (same
// pipeline as the BIM view), picks with exact ray–face intersection, measures volumes and checks
// overlaps with boolean common. Public API is OCCT-free (pimpl).
#include <array>
#include <memory>
#include <string>
#include <vector>

#include "thcad/bim/model.hpp"
#include "thcad/core/json.hpp"

namespace thcad::occt {

/** Local frame: origin, local Z (dir) and local X (xdir); lengths in mm. */
struct Frame {
  std::array<double, 3> o{0, 0, 0};
  std::array<double, 3> z{0, 0, 1};
  std::array<double, 3> x{1, 0, 0};
};

struct Prim {
  enum class Kind { Box, Cylinder, Cone, Sphere, Torus, Prism, Revolve };
  Kind kind = Kind::Box;
  Frame f;
  /** Box: dx dy dz (from the frame origin). Cylinder: r, h. Cone: r1, r2, h. Sphere: r.
   *  Torus: R, r, angle (deg). Prism: h. Revolve: angle (deg, default 360). */
  std::array<double, 3> s{0, 0, 0};
  /** Prism: polygon in local XY. Revolve: profile in local XZ (x = radius, y = height). */
  std::vector<std::array<double, 2>> pts;
};

struct SceneItem {
  std::string id;
  std::array<double, 3> rgb{0.8, 0.8, 0.8};
  double transparency = 0;  // 0 opaque … 1 invisible
  std::vector<Prim> parts;
  std::vector<Prim> cuts;
  /** Fuse parts into one solid (exact volume for overlapping parts); otherwise a compound. */
  bool fuse = false;
  /** Surface model for the path tracer: "matte" | "glossy" | "metal" | "glass" | "emissive". */
  std::string mat = "matte";
};

/** Final-quality render of a scene (OCCT ray / path tracing, offscreen, progressive). */
struct RenderParams {
  int w = 1920, h = 1080;
  int samples = 64;  // samples per pixel (one per progressive pass)
  int bounces = 4;   // path depth
  /** "path" (physically based GI) | "raytrace" (Whitted: direct light, shadows, reflections) */
  std::string engine = "path";
  double exposure = 0;  // EV, filmic tone mapping
  bool sun = true;
  double sunIntensity = 1.2;
  double sunAzimuthDeg = 320, sunElevationDeg = 40;
  /** Sky dome: "clear" | "overcast" | "studio" (uniform soft light) | "night". */
  std::string sky = "clear";
  /** Perspective camera; when absent the scene is framed from the default iso direction. */
  bool hasCamera = false;
  std::array<double, 3> eye{0, 0, 0}, at{0, 0, 0};
  double fovDeg = 55;
};

/** {items:[{id, rgb, transparency, fuse, parts:[{k, o, z, x, s, pts}], cuts:[…]}]} → items (see ui/src/engine3d/scene.ts). */
std::vector<SceneItem> sceneFromJson(const json::Value& v);

/** Exact volumes and pairwise overlaps without a renderer (CLI / tests). */
struct SceneReport {
  struct Item { std::string id; double volume = 0; bool built = false; };
  std::vector<Item> items;
  struct Overlap { std::string a, b; double volume = 0; };
  std::vector<Overlap> overlaps;  // only pairs with volume > 1e-12 m³
};
SceneReport analyzeScene(const std::vector<SceneItem>& items, bool overlaps);

class SceneView {
 public:
  /** pathTracing: request a core-profile GL context (needed for ray tracing on macOS). */
  explicit SceneView(bool pathTracing = false);
  ~SceneView();
  bool ok() const;
  /** Builds every item; returns the number of solids that failed to build. */
  int setItems(const std::vector<SceneItem>& items);
  /** Adds the BIM building (walls with their openings cut, glazing in the windows, floor / roof
   *  slabs spanning each level's walls) and optionally a ground plane. Returns the walls added. */
  int addBuilding(const bim::Model& m, bool ground);
  /** "shaded" | "wireframe" | "hidden" | "clay" */
  void setMode(const std::string& mode);
  void setSelected(const std::string& id);
  /** Items drawn in the highlight colour (e.g. clashes). */
  void setHighlighted(const std::vector<std::string>& ids);
  void orbit(int x0, int y0, int x1, int y1, bool start);
  void pan(int dx, int dy);
  void zoom(int x, int y, double delta);
  void fit();
  void preset(const std::string& name);  // "home" | "top" | "front" | "right"
  std::vector<unsigned char> renderRgba(int w, int h);
  double lastRenderMs() const;
  double lastBuildMs() const;
  /** Item under device pixel (x, y) of the last w×h frame; empty if none. */
  std::string pick(int x, int y) const;
  /** Exact volume of an item in m³ (−1 if unknown). */
  double volumeM3(const std::string& id) const;
  /** Volume of the boolean common of two items in m³ (0 = no overlap, −1 = unknown). */
  double commonM3(const std::string& a, const std::string& b) const;
  /** Every intersecting pair (exact boolean common, bounding boxes first); ids are sorted. */
  std::vector<SceneReport::Overlap> overlaps() const;
  /** STEP AP214 of the whole scene; empty string on success, else the error. */
  std::string writeStep(const std::string& path) const;

  /** Sets up a final render (camera, sun + sky, materials, ray-tracing parameters). Empty string on
   *  success, else why it cannot render (e.g. the GPU has no ray-tracing support). */
  std::string beginRender(const RenderParams& p);
  /** Adds progressive passes for up to `maxMs`; returns the samples accumulated so far. */
  int renderPasses(int maxMs);
  int renderedSamples() const;
  /** Current accumulated image, top-down RGBA8 (or RGBA16 when `sixteenBit`, 8 bytes per pixel). */
  std::vector<unsigned char> renderedImage(bool sixteenBit = false);
  void endRender();

 private:
  struct Impl;
  std::unique_ptr<Impl> d;
};

}  // namespace thcad::occt
