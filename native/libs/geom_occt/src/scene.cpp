#include "thcad/occt/scene.hpp"
#include "thcad/occt/geometry.hpp"

#include <AIS_InteractiveContext.hxx>
#include <AIS_Shape.hxx>
#include <Graphic3d_BSDF.hxx>
#include <Graphic3d_ClipPlane.hxx>
#include <gp_Pln.hxx>
#include <Graphic3d_CubeMapPacked.hxx>
#include <Graphic3d_Vec3.hxx>
#include <Graphic3d_Vec4.hxx>
#include <Graphic3d_MaterialAspect.hxx>
#include <OpenGl_Context.hxx>
#include <V3d_AmbientLight.hxx>
#include <V3d_DirectionalLight.hxx>
#include <Aspect_DisplayConnection.hxx>
#include <BRepAlgoAPI_Common.hxx>
#include <BRepAlgoAPI_Cut.hxx>
#include <BRepAlgoAPI_Fuse.hxx>
#include <BRepBndLib.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakePolygon.hxx>
#include <BRepGProp.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepPrimAPI_MakeCone.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <BRepPrimAPI_MakePrism.hxx>
#include <BRepPrimAPI_MakeRevol.hxx>
#include <BRepPrimAPI_MakeSphere.hxx>
#include <BRepPrimAPI_MakeTorus.hxx>
#include <BRep_Builder.hxx>
#include <BRep_Tool.hxx>
#include <Bnd_Box.hxx>
#include <GProp_GProps.hxx>
#include <Graphic3d_Camera.hxx>
#include <IFSelect_ReturnStatus.hxx>
#include <Image_AlienPixMap.hxx>
#include <IntCurvesFace_ShapeIntersector.hxx>
#include <OpenGl_GraphicDriver.hxx>
#include <Prs3d_Drawer.hxx>
#include <Prs3d_LineAspect.hxx>
#include <STEPControl_Writer.hxx>
#include <TopTools_ListOfShape.hxx>
#include <TopoDS_Compound.hxx>
#include <V3d_View.hxx>
#include <V3d_Viewer.hxx>
#include <gp_Ax2.hxx>
#include <gp_Ax3.hxx>
#include <gp_Lin.hxx>

#include <algorithm>
#include <chrono>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cmath>
#include <cstring>
#include <limits>
#include <map>
#include <set>

#include "gltf_impl.hpp"
#include "platform_window.hpp"
#include "solid_impl.hpp"
#include "part_impl.hpp"
#include <BRepBuilderAPI_Transform.hxx>
#include <BRepAdaptor_Curve.hxx>
#include <BRepAdaptor_Surface.hxx>
#include <BRepTools.hxx>
#include <BRepTools_WireExplorer.hxx>
#include <GCPnts_TangentialDeflection.hxx>
#include <HLRAlgo_Projector.hxx>
#include <HLRBRep_Algo.hxx>
#include <HLRBRep_HLRToShape.hxx>
#include <HLRBRep_PolyAlgo.hxx>
#include <HLRBRep_PolyHLRToShape.hxx>
#include <BRepMesh_IncrementalMesh.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Wire.hxx>
#include <gp_Pnt2d.hxx>

namespace thcad::occt {
namespace { constexpr double kPiScene = 3.14159265358979323846; }

namespace {

gp_Pnt P(const std::array<double, 3>& a) { return gp_Pnt(a[0], a[1], a[2]); }
gp_Dir D(const std::array<double, 3>& a, const gp_Dir& fallback) {
  const double n = std::sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
  return n > 1e-12 ? gp_Dir(a[0], a[1], a[2]) : fallback;
}

gp_Ax2 axes(const Frame& f) {
  gp_Dir z = D(f.z, gp::DZ());
  gp_Dir x = D(f.x, gp::DX());
  if (std::abs(z.Dot(x)) > 0.999) x = std::abs(z.Dot(gp::DX())) > 0.9 ? gp_Dir(gp::DY()) : gp_Dir(gp::DX());
  return gp_Ax2(P(f.o), z, x);
}

/** Local (u, v, w) → world through the frame. */
gp_Pnt local(const gp_Ax2& ax, double u, double v, double w) {
  const gp_XYZ o = ax.Location().XYZ();
  return gp_Pnt(o + ax.XDirection().XYZ() * u + ax.YDirection().XYZ() * v + ax.Direction().XYZ() * w);
}

TopoDS_Shape build(const Prim& p) {
  const gp_Ax2 ax = axes(p.f);
  switch (p.kind) {
    case Prim::Kind::Box:
      if (p.s[0] <= 0 || p.s[1] <= 0 || p.s[2] <= 0) return {};
      return BRepPrimAPI_MakeBox(ax, p.s[0], p.s[1], p.s[2]).Shape();
    case Prim::Kind::Cylinder:
      if (p.s[0] <= 0 || p.s[1] <= 0) return {};
      return BRepPrimAPI_MakeCylinder(ax, p.s[0], p.s[1]).Shape();
    case Prim::Kind::Cone:
      if (p.s[2] <= 0 || (p.s[0] <= 0 && p.s[1] <= 0)) return {};
      return BRepPrimAPI_MakeCone(ax, p.s[0], p.s[1], p.s[2]).Shape();
    case Prim::Kind::Sphere:
      if (p.s[0] <= 0) return {};
      return BRepPrimAPI_MakeSphere(ax.Location(), p.s[0]).Shape();
    case Prim::Kind::Torus: {
      if (p.s[0] <= 0 || p.s[1] <= 0 || p.s[1] >= p.s[0]) return {};
      const double ang = (p.s[2] > 0 && p.s[2] < 360 ? p.s[2] : 360) * M_PI / 180;
      return BRepPrimAPI_MakeTorus(ax, p.s[0], p.s[1], ang).Shape();
    }
    case Prim::Kind::Prism: {
      if (p.pts.size() < 3 || p.s[0] <= 0) return {};
      BRepBuilderAPI_MakePolygon poly;
      for (const auto& q : p.pts) poly.Add(local(ax, q[0], q[1], 0));
      poly.Close();
      if (!poly.IsDone()) return {};
      BRepBuilderAPI_MakeFace face(poly.Wire(), true);
      if (!face.IsDone()) return {};
      return BRepPrimAPI_MakePrism(face.Face(), gp_Vec(ax.Direction()) * p.s[0]).Shape();
    }
    case Prim::Kind::Revolve: {
      if (p.pts.size() < 3) return {};
      BRepBuilderAPI_MakePolygon poly;
      for (const auto& q : p.pts) poly.Add(local(ax, q[0], 0, q[1]));  // profile in local XZ
      poly.Close();
      if (!poly.IsDone()) return {};
      BRepBuilderAPI_MakeFace face(poly.Wire(), true);
      if (!face.IsDone()) return {};
      const double ang = (p.s[0] > 0 && p.s[0] < 360 ? p.s[0] : 360) * M_PI / 180;
      return BRepPrimAPI_MakeRevol(face.Face(), gp_Ax1(ax.Location(), ax.Direction()), ang).Shape();
    }
    case Prim::Kind::Mesh: {
      if (p.tri.size() < 9) return {};
      BRep_Builder b;
      TopoDS_Compound c;
      b.MakeCompound(c);
      int n = 0;
      for (size_t i = 0; i + 8 < p.tri.size(); i += 9) {
        const gp_Pnt a = local(ax, p.tri[i], p.tri[i + 1], p.tri[i + 2]), q = local(ax, p.tri[i + 3], p.tri[i + 4], p.tri[i + 5]), r = local(ax, p.tri[i + 6], p.tri[i + 7], p.tri[i + 8]);
        if (a.Distance(q) < 1e-6 || q.Distance(r) < 1e-6 || r.Distance(a) < 1e-6) continue;
        BRepBuilderAPI_MakePolygon poly(a, q, r, true);
        if (!poly.IsDone()) continue;
        BRepBuilderAPI_MakeFace face(poly.Wire(), true);
        if (!face.IsDone()) continue;
        b.Add(c, face.Face());
        ++n;
      }
      return n ? TopoDS_Shape(c) : TopoDS_Shape();
    }
  }
  return {};
}

TopoDS_Shape buildItem(const SceneItem& it, bool* failed, std::vector<std::string>* errors = nullptr) {
  if (it.part) {
    std::vector<std::string> errs;
    TopoDS_Shape s = buildPart(*it.part, &errs);
    if (!errs.empty()) *failed = true;
    if (errors)
      for (const auto& e : errs) errors->push_back(it.id + ": " + e);
    return s;
  }
  std::vector<TopoDS_Shape> parts;
  for (const auto& p : it.parts) {
    try {
      TopoDS_Shape s = build(p);
      if (s.IsNull()) *failed = true;
      else parts.push_back(s);
    } catch (...) {
      *failed = true;
    }
  }
  if (parts.empty()) return {};
  TopoDS_Shape shape;
  if (it.fuse && parts.size() > 1) {
    TopTools_ListOfShape args, tools;
    args.Append(parts[0]);
    for (size_t i = 1; i < parts.size(); ++i) tools.Append(parts[i]);
    BRepAlgoAPI_Fuse fuse;
    fuse.SetArguments(args);
    fuse.SetTools(tools);
    fuse.Build();
    if (fuse.IsDone()) shape = fuse.Shape();
  }
  if (shape.IsNull()) {
    BRep_Builder b;
    TopoDS_Compound c;
    b.MakeCompound(c);
    for (const auto& s : parts) b.Add(c, s);
    shape = parts.size() == 1 ? parts[0] : TopoDS_Shape(c);
  }
  if (!it.cuts.empty()) {
    // tools as a list (not a compound): cut tools may overlap each other, which a compound would
    // turn into an invalid self-interfering argument
    TopTools_ListOfShape args, tools;
    args.Append(shape);
    for (const auto& p : it.cuts) {
      try {
        TopoDS_Shape s = build(p);
        if (!s.IsNull()) tools.Append(s);
      } catch (...) {
      }
    }
    if (!tools.IsEmpty()) {
      BRepAlgoAPI_Cut cut;
      cut.SetArguments(args);
      cut.SetTools(tools);
      cut.Build();
      if (cut.IsDone() && !cut.HasErrors()) shape = cut.Shape();
      else *failed = true;
    }
  }
  return shape;
}

}  // namespace

namespace {
std::array<double, 3> v3(const json::Value* v, std::array<double, 3> def) {
  const json::Array* a = v ? v->arr() : nullptr;
  if (!a || a->size() < 3) return def;
  std::array<double, 3> out = def;
  for (int i = 0; i < 3; ++i)
    if (const double* n = (*a)[i].num()) out[i] = *n;
  return out;
}
Prim primFromJson(const json::Value& o) {
  static const std::map<std::string, Prim::Kind> kinds{{"box", Prim::Kind::Box}, {"cyl", Prim::Kind::Cylinder}, {"cone", Prim::Kind::Cone}, {"sphere", Prim::Kind::Sphere}, {"torus", Prim::Kind::Torus}, {"prism", Prim::Kind::Prism}, {"revolve", Prim::Kind::Revolve}, {"mesh", Prim::Kind::Mesh}};
  Prim p;
  const json::Value* k = o.get("k");
  if (k && k->str() && kinds.count(*k->str())) p.kind = kinds.at(*k->str());
  p.f.o = v3(o.get("o"), {0, 0, 0});
  p.f.z = v3(o.get("z"), {0, 0, 1});
  p.f.x = v3(o.get("x"), {1, 0, 0});
  p.s = v3(o.get("s"), {0, 0, 0});
  if (const json::Value* pts = o.get("pts"); pts && pts->arr())
    for (const auto& q : *pts->arr())
      if (const json::Array* a = q.arr(); a && a->size() >= 2 && (*a)[0].num() && (*a)[1].num()) p.pts.push_back({*(*a)[0].num(), *(*a)[1].num()});
  if (const json::Value* tri = o.get("tri"); tri && tri->arr()) {
    p.tri.reserve(tri->arr()->size());
    for (const auto& v : *tri->arr()) p.tri.push_back(v.num() ? *v.num() : 0);
  }
  return p;
}
}  // namespace

std::vector<SceneItem> sceneFromJson(const json::Value& v) {
  std::vector<SceneItem> out;
  const json::Value* items = v.get("items");
  if (!items || !items->arr()) return out;
  for (const auto& io : *items->arr()) {
    SceneItem it;
    if (const json::Value* id = io.get("id"); id && id->str()) it.id = *id->str();
    it.rgb = v3(io.get("rgb"), {0.8, 0.8, 0.8});
    if (const json::Value* t = io.get("transparency"); t && t->num()) it.transparency = *t->num();
    if (const json::Value* f = io.get("fuse"); f && f->boolean()) it.fuse = *f->boolean();
    if (const json::Value* m = io.get("mat"); m && m->str()) it.mat = *m->str();
    if (const json::Value* g = io.get("group"); g && g->str()) it.group = *g->str();
    if (const json::Value* ps = io.get("parts"); ps && ps->arr())
      for (const auto& p : *ps->arr()) it.parts.push_back(primFromJson(p));
    if (const json::Value* cs = io.get("cuts"); cs && cs->arr())
      for (const auto& p : *cs->arr()) it.cuts.push_back(primFromJson(p));
    if (const json::Value* pt = io.get("part"); pt && pt->obj()) it.part = std::make_shared<PartDef>(partFromJson(*pt));
    out.push_back(std::move(it));
  }
  return out;
}

SceneReport analyzeScene(const std::vector<SceneItem>& items, bool overlaps) {
  SceneReport r;
  std::vector<TopoDS_Shape> shapes;
  for (const auto& it : items) {
    bool failed = false;
    TopoDS_Shape s = buildItem(it, &failed);
    SceneReport::Item ri{it.id, 0, !s.IsNull() && !failed};
    if (!s.IsNull()) {
      GProp_GProps props;
      BRepGProp::VolumeProperties(s, props);
      ri.volume = props.Mass() / 1e9;
    }
    r.items.push_back(ri);
    shapes.push_back(s);
  }
  if (overlaps)
    for (size_t i = 0; i < shapes.size(); ++i)
      for (size_t j = i + 1; j < shapes.size(); ++j) {
        if (shapes[i].IsNull() || shapes[j].IsNull()) continue;
        Bnd_Box a, b;
        BRepBndLib::Add(shapes[i], a);
        BRepBndLib::Add(shapes[j], b);
        if (a.IsOut(b)) continue;
        BRepAlgoAPI_Common c(shapes[i], shapes[j]);
        if (!c.IsDone()) continue;
        GProp_GProps props;
        BRepGProp::VolumeProperties(c.Shape(), props);
        if (props.Mass() / 1e9 > 1e-12) r.overlaps.push_back({items[i].id, items[j].id, props.Mass() / 1e9});
      }
  return r;
}

struct SceneView::Impl {
  Handle(V3d_Viewer) viewer;
  Handle(V3d_View) view;
  Handle(AIS_InteractiveContext) ctx;
  Handle(Aspect_Window) window;
  struct Entry {
    SceneItem item;
    TopoDS_Shape shape;
    Handle(AIS_Shape) ais;
    double volume = -1;
    // v2.4 linked model: element guid, the item that owns this one (a wall owns its window panes), build number,
    // signature of a default level slab, the view-only low-wall clip plane
    std::string guid, owner, sig;
    unsigned long long serial = 0;
    Handle(Graphic3d_ClipPlane) low;
  };
  std::map<std::string, Entry> items;
  std::string mode = "shaded", selected;
  std::set<std::string> highlighted;
  int w = 0, h = 0;
  double ms = 0, buildMs = 0;
  bool ok = false, fitted = false;
  std::vector<Handle(Graphic3d_ClipPlane)> clips;
  std::vector<std::string> errors;
  std::string lighting = "standard";
  // v2.4 linked model: build counter, view-only opacity and low-wall cut heights
  unsigned long long nextSerial = 1;
  std::map<std::string, double> viewAlpha, lowCut;

  /** Shows an entry under `id` (replacing one there) with a fresh build number. */
  void put(const std::string& id, Entry&& e) {
    if (auto it = items.find(id); it != items.end()) {
      ctx->Remove(it->second.ais, false);
      items.erase(it);
    }
    e.serial = nextSerial++;
    if (auto g = guids.find(id); g != guids.end()) e.guid = g->second;
    ctx->Display(e.ais, AIS_Shaded, -1, false);
    applyLow(id, e);
    items[id] = std::move(e);
  }
  /** Removes an entry and every entry it owns. */
  void erase(const std::string& id, std::vector<std::string>* removed = nullptr) {
    for (auto it = items.begin(); it != items.end();) {
      if (it->first == id || it->second.owner == id) {
        ctx->Remove(it->second.ais, false);
        if (removed) removed->push_back(it->first);
        it = items.erase(it);
      } else ++it;
    }
  }
  void applyLow(const std::string& id, Entry& e) {
    if (!e.low.IsNull()) {
      e.ais->RemoveClipPlane(e.low);
      e.low.Nullify();
    }
    auto c = lowCut.find(id);
    if (c == lowCut.end()) return;
    // keep z <= cut: -z + cut >= 0
    e.low = new Graphic3d_ClipPlane(gp_Pln(0, 0, -1, c->second));
    e.low->SetCapping(true);
    e.low->SetCappingColor(Quantity_Color(0.62, 0.6, 0.57, Quantity_TOC_RGB));
    e.ais->AddClipPlane(e.low);
  }
  std::map<std::string, std::string> guids;
  /** A building wall: its solid with the openings cut, placed on its centre line, and a 20 mm pane in each window. */
  bool addWall(const bim::Model& m, const bim::Wall& w);
  /** Default level slab of a level: its box (x y z dx dy dz), the item (box less the drawn slabs inside it) and a
   *  signature of both (an unchanged signature = the slab is kept as it is by a patch). */
  struct SlabSpec {
    std::array<double, 6> box{};
    SceneItem item;
    std::string sig;
  };
  /** Default level slabs: spanning the exterior walls of each level the drawn slabs do not cover. */
  std::map<std::string, SlabSpec> levelSlabs(const bim::Model& m) const;
  void addSlab(const std::string& lv, const SlabSpec& sp);
  Entry entry(const std::string& id, const TopoDS_Shape& s, std::array<double, 3> rgb, const char* mat, const char* group = "") const {
    Entry e;
    e.item.id = id;
    e.item.rgb = rgb;
    e.item.mat = mat;
    e.item.group = group;  // material group for presentation variations
    if (std::string(mat) == "glass") e.item.transparency = 0.6;
    e.shape = s;
    e.ais = new AIS_Shape(s);
    return e;
  }
  // final render state
  Handle(Standard_Transient) fbo;
  RenderParams rp;
  int passes = 0;

  void applyStyle() {
    const bool wire = mode == "wireframe" || mode == "hidden";
    view->SetComputedMode(mode == "hidden");
    for (auto& [id, e] : items) {
      Quantity_Color c(e.item.rgb[0], e.item.rgb[1], e.item.rgb[2], Quantity_TOC_RGB);
      if (mode == "clay") c = Quantity_Color(0.86, 0.85, 0.83, Quantity_TOC_RGB);
      if (wire) c = Quantity_Color(0.15, 0.17, 0.22, Quantity_TOC_RGB);
      if (highlighted.count(id)) c = Quantity_Color(0.9, 0.22, 0.25, Quantity_TOC_RGB);
      if (id == selected) c = Quantity_Color(0.12, 0.6, 0.63, Quantity_TOC_RGB);
      e.ais->SetColor(c);
      const auto va = viewAlpha.find(id);  // see-through walls (view only)
      e.ais->SetTransparency(wire ? 0 : va != viewAlpha.end() ? std::clamp(1.0 - va->second, 0.0, 0.95) : e.item.transparency);
      ctx->SetDisplayMode(e.ais, wire ? AIS_WireFrame : AIS_Shaded, false);
    }
    ctx->UpdateCurrentViewer();
    view->Update();
  }
};

SceneView::SceneView(bool pathTracing) : d(std::make_unique<Impl>()) {
  ensureCocoaApplication();
  Handle(Aspect_DisplayConnection) disp = new Aspect_DisplayConnection();
  Handle(OpenGl_GraphicDriver) driver = new OpenGl_GraphicDriver(disp, false);
  // macOS only offers GL 4.1 (needed by the ray tracer) as a core profile; the default is legacy 2.1
  if (pathTracing) driver->ChangeOptions().contextCompatible = false;
  d->viewer = new V3d_Viewer(driver);
  d->viewer->SetDefaultLights();
  d->viewer->SetLightOn();
  d->ctx = new AIS_InteractiveContext(d->viewer);
  d->ctx->DefaultDrawer()->SetFaceBoundaryDraw(true);
  d->ctx->DefaultDrawer()->SetFaceBoundaryAspect(new Prs3d_LineAspect(Quantity_NOC_GRAY35, Aspect_TOL_SOLID, 0.8));
  d->view = d->viewer->CreateView();
  try {
    d->window = makeOffscreenWindow(disp);
  } catch (...) {
    return;
  }
  d->view->SetWindow(d->window);
  d->view->SetBgGradientColors(Quantity_Color(0.933, 0.945, 0.957, Quantity_TOC_RGB), Quantity_Color(0.86, 0.88, 0.9, Quantity_TOC_RGB), Aspect_GradientFillMethod_Vertical);
  d->view->SetProj(V3d_XposYnegZpos);
  d->view->SetUp(0, 0, 1);
  d->ok = true;
}

SceneView::~SceneView() {
  if (d) endRender();
}
bool SceneView::ok() const { return d->ok; }
double SceneView::lastRenderMs() const { return d->ms; }
double SceneView::lastBuildMs() const { return d->buildMs; }

int SceneView::setItems(const std::vector<SceneItem>& items) {
  const auto t0 = std::chrono::steady_clock::now();
  for (auto& [id, e] : d->items) d->ctx->Remove(e.ais, false);
  d->items.clear();
  d->guids.clear();
  d->errors.clear();
  int failures = 0;
  for (const auto& it : items) {
    bool failed = false;
    TopoDS_Shape s = buildItem(it, &failed, &d->errors);
    if (failed) ++failures;
    if (s.IsNull()) continue;
    Impl::Entry e;
    e.item = it;
    e.shape = s;
    e.ais = new AIS_Shape(s);
    // triangle meshes (terrain, corridor surfaces): no face-boundary lines, they would hatch the surface
    if (!it.parts.empty() && it.parts.front().kind == Prim::Kind::Mesh) {
      e.ais->Attributes()->SetFaceBoundaryDraw(false);
    }
    d->put(it.id, std::move(e));
  }
  d->applyStyle();
  d->buildMs = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
  return failures;
}

bool SceneView::Impl::addWall(const bim::Model& m, const bim::Wall& w) {
  const bim::WallType* t = m.type(w.typeId);
  const bim::Level* base = m.level(w.baseLevel);
  const double th = t ? t->thickness : 200;
  gp_Trsf center, rot, move;
  center.SetTranslation(gp_Vec(0, -th / 2, 0));
  rot.SetRotation(gp_Ax1(gp_Pnt(0, 0, 0), gp::DZ()), w.angleDeg * kPiScene / 180);
  move.SetTranslation(gp_Vec(w.x, w.y, (base ? base->elevation : 0) + w.baseOffset));
  const gp_Trsf place = move * rot * center;
  Solid s = wallWithOpenings(m, w);
  if (s.isNull()) return false;
  const bool ext = th >= 200;
  put(w.id, entry(w.id, BRepBuilderAPI_Transform(s.impl->shape, place, true).Shape(), ext ? std::array<double, 3>{0.88, 0.87, 0.84} : std::array<double, 3>{0.93, 0.93, 0.92}, "matte", ext ? "wall-exterior" : "wall"));
  // glazing: a 20 mm pane in the middle of each window opening
  for (const auto& o : m.windows)
    if (o.hostWall == w.id) {
      TopoDS_Shape pane = BRepPrimAPI_MakeBox(gp_Pnt(o.offset, th / 2 - 10, o.sill), o.width, 20, o.height).Shape();
      Entry g = entry("glass:" + o.id, BRepBuilderAPI_Transform(pane, place, true).Shape(), {0.55, 0.7, 0.78}, "glass", "glass");
      g.owner = w.id;
      put("glass:" + o.id, std::move(g));
    }
  return true;
}

std::map<std::string, SceneView::Impl::SlabSpec> SceneView::Impl::levelSlabs(const bim::Model& m) const {
  // a default floor / roof slab spanning each level's exterior walls, unless the drawn slabs make that floor
  // (an imported plan); a balcony, a landing or a part slab does not replace it
  std::map<std::string, SlabSpec> out;
  for (const auto& [lv, b] : bim::levelWallSpans(m)) {
    const bim::Level* l = m.level(lv);
    if (!l || b[2] <= b[0]) continue;
    // slab top at the level, outer face of the 200 mm exterior walls
    const std::array<double, 4> box{b[0] - 100, b[1] - 100, b[2] + 100, b[3] + 100};
    if (!bim::defaultSlabNeeded(m, lv, box)) continue;
    // the drawn slabs on this level that lie inside it are taken out of it (no doubled concrete, no
    // coplanar faces fighting in the view, one outline in sections)
    SlabSpec sp;
    sp.box = {box[0], box[1], l->elevation - 200, box[2] - box[0], box[3] - box[1], 200};
    Prim p;
    p.f.o = {box[0], box[1], l->elevation - 200};
    p.s = {box[2] - box[0], box[3] - box[1], 200};
    sp.item.parts.push_back(p);
    char sig[200];
    std::snprintf(sig, sizeof sig, "%.3f %.3f %.3f %.3f %.3f", box[0], box[1], box[2], box[3], l->elevation);
    sp.sig = sig;
    for (const bim::Slab& ds : m.slabs) {
      if (ds.level != lv || ds.kind == bim::Slab::Kind::Ceiling || ds.landing || ds.outline.size() < 3) continue;
      if (bim::drawnSlabArea(bim::Model{.slabs = {ds}}, lv, box) <= 0) continue;
      Prim c;
      c.kind = Prim::Kind::Prism;
      c.f.o = {0, 0, l->elevation - 210};
      c.pts = ds.outline;
      c.s = {220, 0, 0};
      sp.item.cuts.push_back(c);
      for (const auto& q : ds.outline) {
        std::snprintf(sig, sizeof sig, " %.3f,%.3f", q[0], q[1]);
        sp.sig += sig;
      }
      sp.sig += ";";
    }
    out[lv] = std::move(sp);
  }
  return out;
}

void SceneView::Impl::addSlab(const std::string& lv, const SlabSpec& sp) {
  bool failed = false;
  TopoDS_Shape shape;
  try {
    shape = buildItem(sp.item, &failed);
  } catch (...) {
    failed = true;
  }
  const auto& b = sp.box;
  if (failed || shape.IsNull()) shape = BRepPrimAPI_MakeBox(gp_Pnt(b[0], b[1], b[2]), b[3], b[4], b[5]).Shape();
  Entry e = entry("slab:" + lv, shape, {0.8, 0.79, 0.77}, "matte", "floor");
  e.sig = sp.sig;
  put("slab:" + lv, std::move(e));
}
int SceneView::addBuilding(const bim::Model& m, bool ground) {
  int n = 0;
  for (const auto& w : m.walls) n += d->addWall(m, w) ? 1 : 0;
  for (const auto& [lv, b] : d->levelSlabs(m)) d->addSlab(lv, b);
  if (ground) d->put("ground", d->entry("ground", BRepPrimAPI_MakeBox(gp_Pnt(-40000, -40000, -350), 94000, 90000, 200).Shape(), {0.5, 0.56, 0.42}, "matte", "ground"));
  d->applyStyle();
  return n;
}

// ---- v2.4 linked model: incremental BIM updates and view-only states ------------------------------------------

SceneView::PatchResult SceneView::patchBuilding(const bim::Model* m, const std::vector<std::string>& walls, const std::vector<SceneItem>& items, const std::vector<std::string>& remove, bool levelSlabs) {
  const auto t0 = std::chrono::steady_clock::now();
  PatchResult r;
  for (const auto& id : remove) d->erase(id, &r.removed);
  for (const auto& id : walls) {
    d->erase(id, &r.removed);
    const bim::Wall* w = m ? m->wall(id) : nullptr;
    if (!w) continue;
    if (d->addWall(*m, *w)) {
      r.rebuilt.push_back(id);
      for (const auto& [k, e] : d->items)
        if (e.owner == id) r.rebuilt.push_back(k);
    }
  }
  for (const auto& it : items) {
    bool failed = false;
    TopoDS_Shape s = buildItem(it, &failed, &d->errors);
    d->erase(it.id, &r.removed);
    if (s.IsNull()) continue;
    Impl::Entry e;
    e.item = it;
    e.shape = s;
    e.ais = new AIS_Shape(s);
    if (!it.parts.empty() && it.parts.front().kind == Prim::Kind::Mesh) e.ais->Attributes()->SetFaceBoundaryDraw(false);
    d->put(it.id, std::move(e));
    r.rebuilt.push_back(it.id);
  }
  if (levelSlabs && m) {
    const auto want = d->levelSlabs(*m);
    std::vector<std::string> gone;
    for (const auto& [id, e] : d->items)
      if (id.rfind("slab:", 0) == 0 && !want.count(id.substr(5))) gone.push_back(id);
    for (const auto& id : gone) d->erase(id, &r.removed);
    for (const auto& [lv, sp] : want) {
      auto it = d->items.find("slab:" + lv);
      if (it != d->items.end() && it->second.sig == sp.sig) continue;  // same extent: keep the solid
      d->addSlab(lv, sp);
      r.rebuilt.push_back("slab:" + lv);
    }
  }
  // what was rebuilt is not "removed"
  r.removed.erase(std::remove_if(r.removed.begin(), r.removed.end(), [&](const std::string& id) { return d->items.count(id) > 0; }), r.removed.end());
  d->applyStyle();
  r.items = static_cast<int>(d->items.size());
  r.ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
  d->buildMs = r.ms;
  return r;
}

void SceneView::setGuids(const std::vector<std::pair<std::string, std::string>>& idGuid) {
  for (const auto& [id, g] : idGuid) {
    d->guids[id] = g;
    if (auto it = d->items.find(id); it != d->items.end()) it->second.guid = g;
  }
}

std::vector<SceneView::ItemInfo> SceneView::itemInfo() const {
  std::vector<ItemInfo> out;
  for (const auto& [id, e] : d->items) {
    char addr[32];
    std::snprintf(addr, sizeof addr, "%p", static_cast<const void*>(e.shape.TShape().get()));
    out.push_back({id, e.guid, e.owner, addr, e.serial});
  }
  return out;
}
unsigned long long SceneView::builtCount() const { return d->nextSerial - 1; }

void SceneView::setViewAlpha(const std::vector<std::pair<std::string, double>>& alpha) {
  d->viewAlpha.clear();
  for (const auto& [id, a] : alpha) d->viewAlpha[id] = a;
  d->applyStyle();
}

void SceneView::setLowWalls(const std::vector<std::pair<std::string, double>>& cutZ) {
  d->lowCut.clear();
  for (const auto& [id, z] : cutZ) d->lowCut[id] = z;
  for (auto& [id, e] : d->items) d->applyLow(id, e);
  d->ctx->UpdateCurrentViewer();
  d->view->Update();
}

std::array<double, 3> SceneView::project(const std::array<double, 3>& p) const {
  const gp_Pnt q = d->view->Camera()->Project(gp_Pnt(p[0], p[1], p[2]));
  return {(q.X() + 1) / 2 * d->w, (1 - q.Y()) / 2 * d->h, q.Z()};
}

std::string SceneView::walkCollide(double forward, double right, double yawDeg, double pitchDeg, double radius) {
  const Handle(Graphic3d_Camera)& cam = d->view->Camera();
  if (cam->ProjectionType() != Graphic3d_Camera::Projection_Perspective) cam->SetProjectionType(Graphic3d_Camera::Projection_Perspective);
  gp_Pnt eye = cam->Eye();
  const double yaw = yawDeg * M_PI / 180, pitch = pitchDeg * M_PI / 180;
  gp_Vec v(cam->Direction());
  v.Rotate(gp_Ax1(gp::Origin(), gp::DZ()), yaw);
  const gp_Dir rightDir = gp_Dir(gp_Vec(v).Crossed(gp_Vec(gp::DZ())));
  v.Rotate(gp_Ax1(gp::Origin(), rightDir), pitch);
  v.SetZ(std::clamp(v.Z(), -0.95, 0.95));
  const gp_Dir nd(v);
  const gp_Dir horiz(nd.X(), nd.Y(), 0);
  gp_Vec move = gp_Vec(horiz) * forward + gp_Vec(rightDir) * right;
  std::string blocker;
  const double want = move.Magnitude();
  if (want > 1e-6) {
    const gp_Dir md(move);
    double allowed = want;
    // rays at eye height and at knee height (1 m lower) along the move
    for (const double dz : {0.0, -1000.0}) {
      const gp_Lin ray(eye.Translated(gp_Vec(0, 0, dz)), md);
      for (const auto& [id, e] : d->items) {
        if (id == "ground" || id.rfind("glass:", 0) == 0 || e.item.transparency >= 0.9 || !d->ctx->IsDisplayed(e.ais)) continue;
        Bnd_Box box;
        BRepBndLib::Add(e.shape, box);
        box.Enlarge(radius);
        if (box.IsOut(ray)) continue;
        IntCurvesFace_ShapeIntersector isect;
        isect.Load(e.shape, 1e-3);
        isect.Perform(ray, 0.0, want + radius);
        if (!isect.IsDone()) continue;
        for (int i = 1; i <= isect.NbPnt(); ++i) {
          const double t = isect.WParameter(i) - radius;
          if (t < allowed) {
            allowed = std::max(0.0, t);
            blocker = id;
          }
        }
      }
    }
    move = gp_Vec(md) * allowed;
  }
  eye.Translate(move);
  cam->SetEye(eye);
  cam->SetCenter(eye.Translated(gp_Vec(nd) * 1000));
  cam->SetUp(gp::DZ());
  d->view->AutoZFit();
  return blocker;
}

void SceneView::setCameraFull(const std::array<double, 3>& eye, const std::array<double, 3>& at, const std::array<double, 3>& up, double fovDeg, bool ortho) {
  const Handle(Graphic3d_Camera)& cam = d->view->Camera();
  cam->SetProjectionType(ortho ? Graphic3d_Camera::Projection_Orthographic : Graphic3d_Camera::Projection_Perspective);
  cam->SetEye(gp_Pnt(eye[0], eye[1], eye[2]));
  cam->SetCenter(gp_Pnt(at[0], at[1], at[2]));
  const double n = std::sqrt(up[0] * up[0] + up[1] * up[1] + up[2] * up[2]);
  cam->SetUp(n > 1e-9 ? gp_Dir(up[0], up[1], up[2]) : gp::DZ());
  cam->SetFOVy(fovDeg);
  d->fitted = true;
  d->view->AutoZFit();
}

std::array<double, 11> SceneView::cameraFull() const {
  const Handle(Graphic3d_Camera)& cam = d->view->Camera();
  const gp_Pnt e = cam->Eye(), c = cam->Center();
  const gp_Dir u = cam->Up();
  return {e.X(), e.Y(), e.Z(), c.X(), c.Y(), c.Z(), u.X(), u.Y(), u.Z(), cam->FOVy(), cam->IsOrthographic() ? 1.0 : 0.0};
}
// ---------------------------------------------------------------------------------------------------------------

void SceneView::setMode(const std::string& mode) {
  d->mode = mode;
  d->applyStyle();
}
void SceneView::setSelected(const std::string& id) {
  d->selected = id;
  d->applyStyle();
}
void SceneView::setHighlighted(const std::vector<std::string>& ids) {
  d->highlighted = std::set<std::string>(ids.begin(), ids.end());
  d->applyStyle();
}
// Camera moves are computed on the camera itself: the offscreen GL window is a fixed 64 × 64 stub (frames
// render into FBOs of any size), so V3d's pixel-based Rotation / Pan / ZoomAtPoint / WindowFit would read
// device pixels against the wrong window size.
namespace {
/** World vector of a screen offset (device px, y down) at the camera's target depth. */
gp_Vec screenVec(const Handle(Graphic3d_Camera)& cam, double dx, double dy, int w, int h) {
  const gp_XYZ dim = cam->ViewDimensions();
  const gp_Dir up = cam->OrthogonalizedUp();
  const gp_Dir right = cam->Direction().Crossed(up);
  return gp_Vec(right) * (dx / std::max(1, w) * dim.X()) + gp_Vec(up) * (-dy / std::max(1, h) * dim.Y());
}
void shift(const Handle(Graphic3d_Camera)& cam, const gp_Vec& v) { cam->SetEyeAndCenter(cam->Eye().Translated(v), cam->Center().Translated(v)); }
}  // namespace

void SceneView::orbit(int x0, int y0, int x1, int y1, bool start) {
  static thread_local int lx = 0, ly = 0;
  if (start) {
    lx = x0, ly = y0;
    return;
  }
  const double dx = x1 - lx, dy = y1 - ly;
  lx = x1, ly = y1;
  // turntable about world Z through the target, then tilt about the screen's horizontal axis
  const Handle(Graphic3d_Camera)& cam = d->view->Camera();
  const gp_Pnt c = cam->Center();
  const double k = 0.3 * M_PI / 180;  // per device pixel
  gp_Trsf yaw, pitch;
  yaw.SetRotation(gp_Ax1(c, gp::DZ()), -dx * k);
  gp_Vec eye(c, cam->Eye());
  gp_Dir up = cam->OrthogonalizedUp();
  eye.Transform(yaw);
  up.Transform(yaw);
  const gp_Dir right = gp_Dir(gp_Vec(eye).Reversed().Crossed(gp_Vec(up)));
  pitch.SetRotation(gp_Ax1(c, right), -dy * k);
  gp_Vec eye2 = eye.Transformed(pitch);
  gp_Dir up2 = up.Transformed(pitch);
  if (up2.Z() < 0.02 && std::abs(eye2.Normalized().Z()) > 0.98) eye2 = eye, up2 = up;  // stop at the poles
  cam->SetEye(c.Translated(eye2));
  cam->SetUp(up2);
  d->view->AutoZFit();
}
void SceneView::pan(int dx, int dy) {
  const Handle(Graphic3d_Camera)& cam = d->view->Camera();
  shift(cam, screenVec(cam, -dx, -dy, d->w, d->h));
  d->view->AutoZFit();
}
void SceneView::zoom(int x, int y, double delta) {
  const Handle(Graphic3d_Camera)& cam = d->view->Camera();
  const double f = std::pow(0.85, delta);  // < 1 = closer
  // keep the point under the cursor where it is
  const gp_Vec s = screenVec(cam, x - d->w / 2.0, y - d->h / 2.0, d->w, d->h);
  shift(cam, s * (1 - f));
  cam->SetScale(cam->Scale() * f);
  d->view->AutoZFit();
}
void SceneView::windowFit(int x0, int y0, int x1, int y1) {
  if (std::abs(x1 - x0) < 4 || std::abs(y1 - y0) < 4 || d->w <= 0 || d->h <= 0) return;
  const Handle(Graphic3d_Camera)& cam = d->view->Camera();
  shift(cam, screenVec(cam, (x0 + x1) / 2.0 - d->w / 2.0, (y0 + y1) / 2.0 - d->h / 2.0, d->w, d->h));
  cam->SetScale(cam->Scale() * std::max(std::abs(x1 - x0) / double(d->w), std::abs(y1 - y0) / double(d->h)));
  d->view->AutoZFit();
}
void SceneView::fit() { d->view->FitAll(0.06, false); }
void SceneView::preset(const std::string& p) {
  // elevations / plan are orthographic (a walk leaves the camera in perspective)
  const bool ortho = p == "top" || p == "front" || p == "back" || p == "left" || p == "right";
  if (ortho) d->view->Camera()->SetProjectionType(Graphic3d_Camera::Projection_Orthographic);
  d->view->SetProj(p == "top" ? V3d_Zpos : p == "front" ? V3d_Yneg : p == "back" ? V3d_Ypos : p == "right" ? V3d_Xpos : p == "left" ? V3d_Xneg : V3d_XposYnegZpos);
  // world Z is up (OCCT keeps the previous / default +Y up otherwise); plan view keeps north (+Y) up
  if (p == "top") d->view->SetUp(0, 1, 0);
  else d->view->SetUp(0, 0, 1);
  fit();
}

void SceneView::setHidden(const std::vector<std::string>& ids, const std::vector<std::string>& keepOnly) {
  const std::set<std::string> hide(ids.begin(), ids.end()), keep(keepOnly.begin(), keepOnly.end());
  for (auto& [id, e] : d->items) {
    if (hide.count(id) || (!keep.empty() && !keep.count(id))) d->ctx->Erase(e.ais, false);
    else if (!d->ctx->IsDisplayed(e.ais)) d->ctx->Display(e.ais, false);
  }
  d->applyStyle();
}

std::vector<std::string> SceneView::buildErrors() const { return d->errors; }

int SceneView::visibleCount() const {
  int n = 0;
  for (const auto& [id, e] : d->items) n += d->ctx->IsDisplayed(e.ais) ? 1 : 0;
  return n;
}

std::array<double, 6> SceneView::bounds(const std::vector<std::string>& ids) const {
  Bnd_Box b;
  for (const auto& [id, e] : d->items)
    if (ids.empty() || std::find(ids.begin(), ids.end(), id) != ids.end()) BRepBndLib::AddOptimal(e.shape, b, false, false);
  if (b.IsVoid()) return {0, 0, 0, 0, 0, 0};
  double x0, y0, z0, x1, y1, z1;
  b.Get(x0, y0, z0, x1, y1, z1);
  return {x0, y0, z0, x1, y1, z1};
}

SceneView::Drawing2D SceneView::drawing2d(const std::array<double, 3>& toViewer, const std::array<double, 3>& xDir, const std::array<double, 4>* cut) const {
  Drawing2D out;
  const auto t0 = std::chrono::steady_clock::now();
  try {
    const gp_Dir z(toViewer[0], toViewer[1], toViewer[2]), x(xDir[0], xDir[1], xDir[2]);
    const HLRAlgo_Projector proj(gp_Ax2(gp_Pnt(0, 0, 0), z, x));
    // what is drawn: the shown items, without the ground plate
    std::vector<TopoDS_Shape> shapes;
    for (const auto& [id, e] : d->items)
      if (id != "ground" && !e.shape.IsNull() && d->ctx->IsDisplayed(e.ais)) shapes.push_back(e.shape);
    // section: keep what lies beyond the plane (a box from the plane to the far side of the bounds)
    gp_Dir n;
    double off = 0;
    if (cut) {
      Bnd_Box b;
      for (const TopoDS_Shape& s : shapes) BRepBndLib::Add(s, b);
      double x0, y0, z0, x1, y1, z1;
      b.Get(x0, y0, z0, x1, y1, z1);
      x0 -= 1000, y0 -= 1000, z0 -= 1000, x1 += 1000, y1 += 1000, z1 += 1000;
      const auto& c = *cut;
      const int axis = std::abs(c[0]) > 0.5 ? 0 : std::abs(c[1]) > 0.5 ? 1 : 2;
      const double k = c[axis], at = -c[3] / k;  // plane coordinate on that axis
      double lo[3] = {x0, y0, z0}, hi[3] = {x1, y1, z1};
      if (k > 0) lo[axis] = at;
      else hi[axis] = at;
      const TopoDS_Shape keep = BRepPrimAPI_MakeBox(gp_Pnt(lo[0], lo[1], lo[2]), gp_Pnt(hi[0], hi[1], hi[2])).Shape();
      n = gp_Dir(c[0], c[1], c[2]);
      off = c[3];
      std::vector<TopoDS_Shape> kept;
      for (const TopoDS_Shape& s : shapes) {
        BRepAlgoAPI_Common common(s, keep);
        if (!common.IsDone()) continue;
        const TopoDS_Shape r = common.Shape();
        bool any = false;
        for (TopExp_Explorer f(r, TopAbs_FACE); f.More(); f.Next()) {
          any = true;
          // a face on the cutting plane = cut material
          BRepAdaptor_Surface surf(TopoDS::Face(f.Current()));
          if (surf.GetType() != GeomAbs_Plane) continue;
          const gp_Pln pl = surf.Plane();
          if (!pl.Axis().Direction().IsParallel(n, 1e-6)) continue;
          const gp_Pnt o = pl.Location();
          if (std::abs(n.X() * o.X() + n.Y() * o.Y() + n.Z() * o.Z() + off) > 0.5) continue;
          std::vector<std::array<double, 2>> poly;
          for (BRepTools_WireExplorer w(BRepTools::OuterWire(TopoDS::Face(f.Current()))); w.More(); w.Next()) {
            gp_Pnt2d p;
            proj.Project(BRep_Tool::Pnt(w.CurrentVertex()), p);
            poly.push_back({p.X(), p.Y()});
          }
          if (poly.size() >= 3) out.cut.push_back(std::move(poly));
        }
        if (any) kept.push_back(r);
      }
      shapes = std::move(kept);
    }
    // hidden lines on the triangulation (HLRBRep_PolyAlgo): the exact algorithm (HLRBRep_Algo) can read past its
    // data on some models and crash the app (HLRBRep_Data::NextInterference); building drawings are planar faces,
    // which the polygonal one draws exactly, and it is faster. Meshed fine enough for curved items at 1:100.
    Handle(HLRBRep_PolyAlgo) algo = new HLRBRep_PolyAlgo();
    for (const TopoDS_Shape& s : shapes) {
      BRepMesh_IncrementalMesh mesh(s, 2.0, false, 0.2, true);
      algo->Load(s);
    }
    algo->Projector(proj);
    algo->Update();
    HLRBRep_PolyHLRToShape hlr;
    hlr.Update(algo);
    double u0 = 1e300, v0 = 1e300, u1 = -1e300, v1 = -1e300;
    for (const TopoDS_Shape& comp : {hlr.VCompound(), hlr.OutLineVCompound()}) {
      if (comp.IsNull()) continue;
      for (TopExp_Explorer ex(comp, TopAbs_EDGE); ex.More(); ex.Next()) {
        BRepAdaptor_Curve curve(TopoDS::Edge(ex.Current()));
        std::vector<std::array<double, 2>> pl;
        if (curve.GetType() == GeomAbs_Line) {
          const gp_Pnt a = curve.Value(curve.FirstParameter()), b = curve.Value(curve.LastParameter());
          pl = {{a.X(), a.Y()}, {b.X(), b.Y()}};
        } else {
          GCPnts_TangentialDeflection td(curve, 0.1, 1.0);
          for (int i = 1; i <= td.NbPoints(); ++i) pl.push_back({td.Value(i).X(), td.Value(i).Y()});
        }
        if (pl.size() < 2) continue;
        for (const auto& p : pl) u0 = std::min(u0, p[0]), v0 = std::min(v0, p[1]), u1 = std::max(u1, p[0]), v1 = std::max(v1, p[1]);
        out.lines.push_back(std::move(pl));
      }
    }
    if (u1 >= u0) out.bounds = {u0, v0, u1, v1};
  } catch (const Standard_Failure& e) {
    out.error = e.GetMessageString() ? e.GetMessageString() : "HLR failed";
  }
  out.ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
  return out;
}

void SceneView::setSectionBox(bool on, const std::vector<std::string>& around, double topZ) {
  for (const Handle(Graphic3d_ClipPlane)& p : d->clips) d->view->RemoveClipPlane(p);
  d->clips.clear();
  if (on) {
    auto b = bounds(around);
    if (around.empty()) {
      // whole model: cut away everything above topZ (mid-height by default); a hair of margin elsewhere
      b[5] = std::isnan(topZ) ? b[2] + (b[5] - b[2]) * 0.5 : topZ;
      b = {b[0] - 1, b[1] - 1, b[2] - 1, b[3] + 1, b[4] + 1, b[5]};
    }
    else {
      const double m = 0.15 * std::max({b[3] - b[0], b[4] - b[1], b[5] - b[2]});
      b = {b[0] - m, b[1] - m, b[2] - m, b[3] + m, b[4] + m, b[5] + m};
    }
    // planes keep the inside of the box: n · p + d >= 0
    setClipPlanes({{1, 0, 0, -b[0]}, {-1, 0, 0, b[3]}, {0, 1, 0, -b[1]}, {0, -1, 0, b[4]}, {0, 0, 1, -b[2]}, {0, 0, -1, b[5]}});
    return;
  }
  d->view->Update();
}

void SceneView::setClipPlanes(const std::vector<std::array<double, 4>>& planes) {
  for (const Handle(Graphic3d_ClipPlane)& p : d->clips) d->view->RemoveClipPlane(p);
  d->clips.clear();
  for (const auto& q : planes) {
    Handle(Graphic3d_ClipPlane) p = new Graphic3d_ClipPlane(gp_Pln(q[0], q[1], q[2], q[3]));
    p->SetCapping(true);
    p->SetCappingColor(Quantity_Color(0.55, 0.57, 0.6, Quantity_TOC_RGB));
    d->view->AddClipPlane(p);
    d->clips.push_back(p);
  }
  d->view->Update();
}


void SceneView::setCamera(const std::array<double, 3>& eye, const std::array<double, 3>& at, double fovDeg) {
  setCamera(eye, at, fovDeg, {0, 0, 1});
}

void SceneView::setCamera(const std::array<double, 3>& eye, const std::array<double, 3>& at, double fovDeg, const std::array<double, 3>& up) {
  const Handle(Graphic3d_Camera)& cam = d->view->Camera();
  cam->SetProjectionType(Graphic3d_Camera::Projection_Perspective);
  cam->SetEye(gp_Pnt(eye[0], eye[1], eye[2]));
  cam->SetCenter(gp_Pnt(at[0], at[1], at[2]));
  // an up vector parallel to the view direction is meaningless: fall back to world Z (or Y looking straight down)
  gp_Vec dir(gp_Pnt(eye[0], eye[1], eye[2]), gp_Pnt(at[0], at[1], at[2]));
  gp_Vec u(up[0], up[1], up[2]);
  if (u.Magnitude() < 1e-9 || dir.Magnitude() < 1e-9 || u.Crossed(dir).Magnitude() < 1e-6 * u.Magnitude() * dir.Magnitude())
    u = std::abs(dir.Z()) > 0.999 * dir.Magnitude() ? gp_Vec(0, 1, 0) : gp_Vec(0, 0, 1);
  cam->SetUp(gp_Dir(u));
  cam->OrthogonalizeUp();
  cam->SetFOVy(fovDeg);
  d->fitted = true;
  d->view->AutoZFit();
}

std::array<double, 3> SceneView::cameraUp() const {
  const gp_Dir u = d->view->Camera()->Up();
  return {u.X(), u.Y(), u.Z()};
}

std::array<double, 7> SceneView::camera() const {
  const Handle(Graphic3d_Camera)& cam = d->view->Camera();
  const gp_Pnt e = cam->Eye(), c = cam->Center();
  return {e.X(), e.Y(), e.Z(), c.X(), c.Y(), c.Z(), cam->FOVy()};
}

void SceneView::walk(double forward, double right, double yawDeg, double pitchDeg) {
  const Handle(Graphic3d_Camera)& cam = d->view->Camera();
  if (cam->ProjectionType() != Graphic3d_Camera::Projection_Perspective) cam->SetProjectionType(Graphic3d_Camera::Projection_Perspective);
  gp_Pnt eye = cam->Eye();
  gp_Dir dir = cam->Direction();
  // yaw about Z, pitch about the horizontal right axis
  const double yaw = yawDeg * M_PI / 180, pitch = pitchDeg * M_PI / 180;
  gp_Vec v(dir);
  v.Rotate(gp_Ax1(gp::Origin(), gp::DZ()), yaw);
  const gp_Dir rightDir = gp_Dir(gp_Vec(v).Crossed(gp_Vec(gp::DZ())));
  v.Rotate(gp_Ax1(gp::Origin(), rightDir), pitch);
  const double z = std::clamp(v.Z(), -0.95, 0.95);
  v.SetZ(z);
  const gp_Dir nd(v);
  const gp_Dir horiz(nd.X(), nd.Y(), 0);
  eye.Translate(gp_Vec(horiz) * forward + gp_Vec(rightDir) * right);
  cam->SetEye(eye);
  cam->SetCenter(eye.Translated(gp_Vec(nd) * 1000));
  cam->SetUp(gp::DZ());
  d->view->AutoZFit();
}

std::vector<unsigned char> SceneView::renderRgba(int w, int h) {
  const auto t0 = std::chrono::steady_clock::now();
  d->view->Camera()->SetAspect(static_cast<double>(w) / h);
  if (!d->fitted && !d->items.empty()) {
    d->view->FitAll(0.06, false);
    d->fitted = true;
  }
  d->w = w;
  d->h = h;
  Image_AlienPixMap img;
  if (!img.InitZero(Image_Format_RGBA, w, h)) return {};
  if (!d->view->ToPixMap(img, w, h)) return {};
  std::vector<unsigned char> out(static_cast<size_t>(w) * h * 4);
  for (int y = 0; y < h; ++y) {
    // Image_PixMap::Row(r) already walks top-down whatever the storage order (TopToDown)
    std::memcpy(out.data() + static_cast<size_t>(y) * w * 4, img.Row(y), static_cast<size_t>(w) * 4);
  }
  d->ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
  return out;
}

std::string SceneView::pick(int x, int y) const {
  if (d->w <= 0 || d->h <= 0) return {};
  // ray through the pixel: unproject the near and far planes of the camera used for the last frame
  const Handle(Graphic3d_Camera)& cam = d->view->Camera();
  const double nx = 2.0 * (x + 0.5) / d->w - 1.0, ny = 1.0 - 2.0 * (y + 0.5) / d->h;
  const gp_Pnt a = cam->UnProject(gp_Pnt(nx, ny, -1.0)), b = cam->UnProject(gp_Pnt(nx, ny, 1.0));
  if (a.Distance(b) < 1e-9) return {};
  const gp_Lin ray(a, gp_Dir(gp_Vec(a, b)));
  std::string best;
  double bestT = std::numeric_limits<double>::max();
  for (const auto& [id, e] : d->items) {
    if (e.item.transparency >= 0.9 || !d->ctx->IsDisplayed(e.ais)) continue;
    if (auto va = d->viewAlpha.find(id); va != d->viewAlpha.end() && va->second <= 0.5) continue;  // see-through walls
    Bnd_Box box;
    BRepBndLib::Add(e.shape, box);
    if (box.IsOut(ray)) continue;
    IntCurvesFace_ShapeIntersector isect;
    isect.Load(e.shape, 1e-3);
    // perspective (walk): only what is in front of the eye; orthographic: the whole line of sight
    isect.Perform(ray, cam->IsOrthographic() ? -1e12 : 0.0, 1e12);
    if (!isect.IsDone()) continue;
    for (int i = 1; i <= isect.NbPnt(); ++i) {
      const gp_Pnt q = isect.Pnt(i);
      bool clipped = false;  // cut away by the section box
      for (const Handle(Graphic3d_ClipPlane)& p : d->clips) {
        const Graphic3d_Vec4d& eq = p->GetEquation();
        if (eq.x() * q.X() + eq.y() * q.Y() + eq.z() * q.Z() + eq.w() < -1e-6) clipped = true;
      }
      if (clipped) continue;
      if (isect.WParameter(i) < bestT) {
        bestT = isect.WParameter(i);
        best = id;
      }
    }
  }
  return best;
}

double SceneView::volumeM3(const std::string& id) const {
  auto it = d->items.find(id);
  if (it == d->items.end()) return -1;
  auto& e = const_cast<Impl::Entry&>(it->second);
  if (e.volume < 0) {
    GProp_GProps props;
    BRepGProp::VolumeProperties(e.shape, props);
    e.volume = props.Mass() / 1e9;
  }
  return e.volume;
}

double SceneView::commonM3(const std::string& a, const std::string& b) const {
  auto ia = d->items.find(a), ib = d->items.find(b);
  if (ia == d->items.end() || ib == d->items.end()) return -1;
  Bnd_Box ba, bb;
  BRepBndLib::Add(ia->second.shape, ba);
  BRepBndLib::Add(ib->second.shape, bb);
  if (ba.IsOut(bb)) return 0;
  BRepAlgoAPI_Common c(ia->second.shape, ib->second.shape);
  if (!c.IsDone()) return -1;
  GProp_GProps props;
  BRepGProp::VolumeProperties(c.Shape(), props);
  return std::max(0.0, props.Mass() / 1e9);
}

std::vector<SceneReport::Overlap> SceneView::overlaps() const {
  std::vector<SceneReport::Overlap> out;
  std::vector<std::pair<const std::string*, Bnd_Box>> boxes;
  for (const auto& [id, e] : d->items) {
    if (e.shape.IsNull()) continue;
    Bnd_Box b;
    BRepBndLib::Add(e.shape, b);
    boxes.emplace_back(&id, b);
  }
  for (size_t i = 0; i < boxes.size(); ++i)
    for (size_t j = i + 1; j < boxes.size(); ++j) {
      if (boxes[i].second.IsOut(boxes[j].second)) continue;
      const double v = commonM3(*boxes[i].first, *boxes[j].first);
      if (v > 1e-12) out.push_back({*boxes[i].first, *boxes[j].first, v});
    }
  return out;
}

std::string SceneView::writeStep(const std::string& path) const {
  if (d->items.empty()) return "empty scene";
  BRep_Builder b;
  TopoDS_Compound c;
  b.MakeCompound(c);
  for (const auto& [id, e] : d->items) b.Add(c, e.shape);
  STEPControl_Writer w;
  if (w.Transfer(c, STEPControl_AsIs) != IFSelect_RetDone) return "STEP transfer failed";
  if (w.Write(path.c_str()) != IFSelect_RetDone) return "cannot write " + path;
  return {};
}

std::string SceneView::writeGlb(const std::string& path, bool visibleOnly, GlbStats* stats) const {
  std::vector<GlbItem> items;
  for (const auto& [id, e] : d->items) {
    if (e.shape.IsNull()) continue;
    if (visibleOnly && !d->ctx->IsDisplayed(e.ais)) continue;
    items.push_back({id, e.item.mat, e.item.group, e.item.rgb, e.item.mat == "glass" ? std::max(0.6, e.item.transparency) : e.item.transparency, e.shape});
  }
  return writeGlbFile(items, path, stats);
}

void SceneView::setLighting(const std::string& preset) {
  // lights and background only: the shapes, their colours and materials are not touched
  const std::string p = preset == "day" || preset == "golden" || preset == "night" ? preset : "standard";
  d->lighting = p;
  std::vector<Handle(Graphic3d_CLight)> old;
  for (const auto& l : d->viewer->DefinedLights()) old.push_back(l);
  for (const auto& l : old) d->viewer->DelLight(l);
  if (p == "standard") {
    d->viewer->SetDefaultLights();
    d->viewer->SetLightOn();
    d->view->SetBgGradientColors(Quantity_Color(0.933, 0.945, 0.957, Quantity_TOC_RGB), Quantity_Color(0.86, 0.88, 0.9, Quantity_TOC_RGB), Aspect_GradientFillMethod_Vertical);
    d->view->Update();
    return;
  }
  struct L { double az, el, sun, amb; Quantity_Color sunC, ambC, top, bottom; };
  const L l = p == "day"
                  ? L{320, 45, 1.0, 0.45, Quantity_Color(1.0, 0.97, 0.92, Quantity_TOC_sRGB), Quantity_Color(0.78, 0.85, 1.0, Quantity_TOC_sRGB), Quantity_Color(0.45, 0.66, 0.92, Quantity_TOC_sRGB), Quantity_Color(0.86, 0.92, 0.98, Quantity_TOC_sRGB)}
              : p == "golden"
                  ? L{250, 9, 1.1, 0.35, Quantity_Color(1.0, 0.68, 0.38, Quantity_TOC_sRGB), Quantity_Color(0.75, 0.62, 0.62, Quantity_TOC_sRGB), Quantity_Color(0.36, 0.42, 0.62, Quantity_TOC_sRGB), Quantity_Color(0.98, 0.72, 0.46, Quantity_TOC_sRGB)}
                  : L{200, 35, 0.18, 0.12, Quantity_Color(0.62, 0.7, 1.0, Quantity_TOC_sRGB), Quantity_Color(1.0, 0.78, 0.52, Quantity_TOC_sRGB), Quantity_Color(0.02, 0.03, 0.08, Quantity_TOC_sRGB), Quantity_Color(0.09, 0.11, 0.2, Quantity_TOC_sRGB)};
  const double az = l.az * M_PI / 180, el = l.el * M_PI / 180;
  const gp_Dir toSun(std::cos(el) * std::sin(az), std::cos(el) * std::cos(az), std::sin(el));
  Handle(V3d_DirectionalLight) sun = new V3d_DirectionalLight(toSun.Reversed(), l.sunC);
  sun->SetIntensity(float(l.sun));
  d->viewer->AddLight(sun);
  d->viewer->SetLightOn(sun);
  Handle(V3d_AmbientLight) amb = new V3d_AmbientLight(l.ambC);
  amb->SetIntensity(float(l.amb));
  d->viewer->AddLight(amb);
  d->viewer->SetLightOn(amb);
  if (p == "night") {
    // warm interior glow: a soft head light (follows the camera) stands in for the room lights
    Handle(V3d_DirectionalLight) head = new V3d_DirectionalLight(gp_Dir(0, 0, -1), Quantity_Color(1.0, 0.8, 0.55, Quantity_TOC_sRGB), true);
    head->SetIntensity(0.35f);
    d->viewer->AddLight(head);
    d->viewer->SetLightOn(head);
  }
  d->view->SetBgGradientColors(l.top, l.bottom, Aspect_GradientFillMethod_Vertical);
  d->view->Update();
}

std::string SceneView::lighting() const { return d->lighting; }

std::string SceneView::geometryHash(int* nItems, double* totalM3) const {
  // FNV-1a 64 over "id|volume|bounds" of every item (sorted map order); colours / materials excluded
  uint64_t h = 1469598103934665603ULL;
  auto mix = [&](const std::string& s) {
    for (unsigned char c : s) h = (h ^ c) * 1099511628211ULL;
  };
  double vol = 0;
  int n = 0;
  for (const auto& [id, e] : d->items) {
    if (e.shape.IsNull()) continue;
    const double v = volumeM3(id);
    Bnd_Box b;
    BRepBndLib::AddOptimal(e.shape, b, false, false);
    double x0 = 0, y0 = 0, z0 = 0, x1 = 0, y1 = 0, z1 = 0;
    if (!b.IsVoid()) b.Get(x0, y0, z0, x1, y1, z1);
    char buf[256];
    std::snprintf(buf, sizeof buf, "|%.9f|%.2f,%.2f,%.2f,%.2f,%.2f,%.2f;", std::max(0.0, v), x0, y0, z0, x1, y1, z1);
    mix(id);
    mix(buf);
    vol += std::max(0.0, v);
    ++n;
  }
  if (nItems) *nItems = n;
  if (totalM3) *totalM3 = vol;
  char out[20];
  std::snprintf(out, sizeof out, "%016llx", static_cast<unsigned long long>(h));
  return out;
}

int SceneView::applyOverrides(const std::map<std::string, MaterialOverride>& byGroup) {
  int n = 0;
  for (auto& [id, e] : d->items) {
    auto it = byGroup.find(e.item.group);
    if (it == byGroup.end()) continue;
    const bool wasGlass = e.item.mat == "glass";
    e.item.rgb = it->second.rgb;
    e.item.mat = it->second.mat;
    if (e.item.mat == "glass" && e.item.transparency < 0.6) e.item.transparency = 0.6;
    else if (wasGlass && e.item.mat != "glass") e.item.transparency = 0;
    ++n;
  }
  if (n) d->applyStyle();
  return n;
}

namespace {
constexpr double kPi = 3.14159265358979323846;

/** Sky light as a packed cubemap (6 tiles in a row: +X −X +Y −Y +Z −Z, GL face convention), Z up:
 *  zenith-to-horizon gradient, ground below, a glow around the sun (the sun itself is a directional
 *  light). Values are display-referred 8-bit; the path tracer uses them as environment radiance. */
Handle(Image_PixMap) skyCubemap(const std::string& kind, const gp_Dir& sun, float clouds) {
  const int n = 256;
  Handle(Image_PixMap) img = new Image_PixMap();
  img->InitZero(Image_Format_RGB, size_t(6 * n), size_t(n));
  const bool night = kind == "night", studio = kind == "studio";
  for (int f = 0; f < 6; ++f)
    for (int y = 0; y < n; ++y)
      for (int x = 0; x < n; ++x) {
        const double u = 2 * (x + 0.5) / n - 1, v = 2 * (y + 0.5) / n - 1;
        double dx, dy, dz;
        switch (f) {
          case 0: dx = 1, dy = -v, dz = -u; break;
          case 1: dx = -1, dy = -v, dz = u; break;
          case 2: dx = u, dy = 1, dz = v; break;
          case 3: dx = u, dy = -1, dz = -v; break;
          case 4: dx = u, dy = -v, dz = 1; break;
          default: dx = -u, dy = -v, dz = -1; break;
        }
        // GL cube faces are Y-up; the scene is Z-up: world (x, y, z) = (dx, −dz, dy)
        const double l = std::sqrt(dx * dx + dy * dy + dz * dz);
        const double wx = dx / l, wy = -dz / l, wz = dy / l;
        double r, g, b;
        if (studio) {
          const double k = 0.78 + 0.18 * std::max(0.0, wz);
          r = g = b = k;
        } else if (night) {
          const double k = std::max(0.0, wz);
          r = 0.02 + 0.03 * k, g = 0.03 + 0.04 * k, b = 0.07 + 0.08 * k;
        } else if (wz >= 0) {
          const double t = std::pow(wz, 0.45);
          // clear: deep blue zenith → pale horizon; overcast: bright grey
          const double zr = 0.22, zg = 0.42, zb = 0.78, hr = 0.78, hg = 0.86, hb = 0.95;
          r = hr + (zr - hr) * t, g = hg + (zg - hg) * t, b = hb + (zb - hb) * t;
          const double cos = wx * sun.X() + wy * sun.Y() + wz * sun.Z();
          const double glow = std::pow(std::max(0.0, cos), 24) * 0.6;
          r += glow, g += glow * 0.9, b += glow * 0.7;
          const double grey = 0.72 + 0.2 * t;
          r += (grey - r) * clouds, g += (grey - g) * clouds, b += (grey - b) * clouds;
        } else {
          // ground: warm grey, darker straight down
          const double k = 0.42 + 0.12 * (1 + wz);
          r = k * 0.95, g = k * 0.9, b = k * 0.82;
        }
        Standard_Byte* px = img->ChangeRawValue(size_t(y), size_t(f * n + x));
        px[0] = Standard_Byte(std::lround(std::clamp(r, 0.0, 1.0) * 255));
        px[1] = Standard_Byte(std::lround(std::clamp(g, 0.0, 1.0) * 255));
        px[2] = Standard_Byte(std::lround(std::clamp(b, 0.0, 1.0) * 255));
      }
  return img;
}

Graphic3d_BSDF bsdfFor(const SceneItem& it) {
  const Graphic3d_Vec3 c(float(it.rgb[0]), float(it.rgb[1]), float(it.rgb[2]));
  if (it.mat == "metal") return Graphic3d_BSDF::CreateMetallic(c, Graphic3d_Fresnel::CreateSchlick(c), 0.18f);
  if (it.mat == "glass") return Graphic3d_BSDF::CreateGlass(Graphic3d_Vec3(0.92f), c, 0.05f, 1.5f);
  Graphic3d_BSDF b = Graphic3d_BSDF::CreateDiffuse(c * 0.9f);
  if (it.mat == "glossy") {
    // varnished wood, stone, lacquer: a clear dielectric coat over the diffuse base
    b.Kc = Graphic3d_Vec4(1.f, 1.f, 1.f, 0.12f);
    b.FresnelCoat = Graphic3d_Fresnel::CreateDielectric(1.5f);
  }
  if (it.mat == "emissive") b.Le = c * 4.f;
  if (it.transparency > 0 && it.mat != "glass") {
    b.Kt = Graphic3d_Vec3(float(it.transparency));
    b.Kd *= float(1 - it.transparency);
  }
  b.Normalize();
  return b;
}
}  // namespace

std::string SceneView::beginRender(const RenderParams& p) {
  if (!d->ok) return "OpenGL unavailable";
  if (d->items.empty()) return "empty scene";
  endRender();
  // capability first: the GL context exists after a first (raster) frame
  d->view->Redraw();
  {
    Handle(OpenGl_GraphicDriver) drv = Handle(OpenGl_GraphicDriver)::DownCast(d->viewer->Driver());
    const Handle(OpenGl_Context) gl = drv.IsNull() ? Handle(OpenGl_Context)() : drv->GetSharedContext();
    if (gl.IsNull() || !gl->HasRayTracing())
      return gl.IsNull() ? "no OpenGL context — ray-tracing unavailable on this GPU/driver"
                         : "this GPU/driver has no OpenGL ray-tracing support (OpenGL " + std::to_string(gl->VersionMajor()) + "." + std::to_string(gl->VersionMinor()) + ")";
  }
  d->rp = p;
  d->passes = 0;
  // materials: physically based surfaces, no edge overlay
  d->ctx->DefaultDrawer()->SetFaceBoundaryDraw(false);
  for (auto& [id, e] : d->items) {
    Graphic3d_MaterialAspect m(Graphic3d_NameOfMaterial_UserDefined);
    const Quantity_Color c(e.item.rgb[0], e.item.rgb[1], e.item.rgb[2], Quantity_TOC_RGB);
    m.SetColor(c);
    m.SetBSDF(bsdfFor(e.item));
    e.ais->Attributes()->SetFaceBoundaryDraw(false);
    e.ais->SetMaterial(m);
    e.ais->SetColor(c);
    e.ais->SetTransparency(e.item.mat == "glass" ? 0.6 : e.item.transparency);
    d->ctx->SetDisplayMode(e.ais, AIS_Shaded, false);
    d->ctx->Redisplay(e.ais, false);
  }
  d->view->SetComputedMode(false);
  // camera
  const Handle(Graphic3d_Camera)& cam = d->view->Camera();
  cam->SetProjectionType(Graphic3d_Camera::Projection_Perspective);
  cam->SetAspect(double(p.w) / p.h);
  if (p.hasCamera) {
    cam->SetEye(gp_Pnt(p.eye[0], p.eye[1], p.eye[2]));
    cam->SetCenter(gp_Pnt(p.at[0], p.at[1], p.at[2]));
    cam->SetUp(gp_Dir(p.up[0], p.up[1], p.up[2]));
    cam->SetFOVy(p.fovDeg);
    cam->SetZRange(1, 1e7);
    d->view->AutoZFit();
  } else {
    d->view->SetProj(V3d_XposYnegZpos);
    d->view->SetUp(0, 0, 1);
    cam->SetFOVy(p.fovDeg);
    d->view->FitAll(0.04, false);
  }
  // light: sun (soft shadows) + sky dome as the environment light
  std::vector<Handle(Graphic3d_CLight)> old;  // V3d_Light is Graphic3d_CLight (OCCT 7.9 and 8)
  for (const auto& l : d->viewer->DefinedLights()) old.push_back(l);
  for (const auto& l : old) d->viewer->DelLight(l);
  const double az = p.sunAzimuthDeg * kPi / 180, el = std::max(2.0, p.sunElevationDeg) * kPi / 180;
  const gp_Dir toSun(std::cos(el) * std::sin(az), std::cos(el) * std::cos(az), std::sin(el));
  if (p.sun && p.sunIntensity > 0 && p.sky != "night") {
    Handle(V3d_DirectionalLight) sun = new V3d_DirectionalLight(toSun.Reversed(), Quantity_NOC_WHITE);
    // irradiance E on a surface facing the sun; the path tracer treats a directional light as a disc
    // of half-angle a with radiance Le (E = Le · Ω, Ω = 2π(1 − cos a)), the Whitted tracer uses E as is
    const double E = p.sunIntensity * 2.5, half = 1.0 * kPi / 180;
    const bool gi = p.engine != "raytrace";
    sun->SetIntensity(float(gi ? E / (2 * kPi * (1 - std::cos(half))) : E));
    sun->SetSmoothAngle(float(gi ? half : 0.0));
    sun->SetCastShadows(true);
    d->viewer->AddLight(sun);
    d->viewer->SetLightOn(sun);
  }
  Handle(V3d_AmbientLight) amb = new V3d_AmbientLight(Quantity_NOC_WHITE);
  amb->SetIntensity(p.sky == "night" ? 0.05f : 0.2f);
  d->viewer->AddLight(amb);
  d->viewer->SetLightOn(amb);
  const float clouds = p.sky == "overcast" ? 0.85f : p.sky == "studio" ? 1.f : 0.15f;
  const gp_Dir skySun = p.sky == "night" ? gp_Dir(0.3, 0.2, -0.93) : toSun;
  // sky: our own cubemap (OCCT's skydome shader needs GLSL 1.30, which macOS core profiles reject)
  d->view->SetBackgroundCubeMap(new Graphic3d_CubeMapPacked(skyCubemap(p.sky, skySun, clouds)), false);
  // ray / path tracing parameters
  Graphic3d_RenderingParams& rp = d->view->ChangeRenderingParams();
  rp.Method = Graphic3d_RM_RAYTRACING;
  rp.IsGlobalIlluminationEnabled = p.engine != "raytrace";
  rp.RaytracingDepth = std::clamp(p.bounces, 1, 10);
  rp.IsShadowEnabled = true;
  rp.IsReflectionEnabled = true;
  rp.IsAntialiasingEnabled = true;
  rp.IsTransparentShadowEnabled = true;
  rp.UseEnvironmentMapBackground = true;
  rp.TwoSidedBsdfModels = true;
  rp.RadianceClampingValue = 30.f;
  rp.ToneMappingMethod = Graphic3d_ToneMappingMethod_Filmic;
  rp.Exposure = float(p.exposure);
  rp.WhitePoint = 4.f;
  rp.CoherentPathTracingMode = false;
  // render target
  const Handle(Graphic3d_CView)& cv = d->view->View();
  d->fbo = cv->FBOCreate(p.w, p.h);
  if (d->fbo.IsNull()) return "cannot allocate a " + std::to_string(p.w) + " x " + std::to_string(p.h) + " render target";
  cv->SetFBO(d->fbo);
  d->view->Redraw();
  ++d->passes;
  return {};
}

int SceneView::renderPasses(int maxMs) {
  if (d->fbo.IsNull()) return d->passes;
  const int target = d->rp.engine == "raytrace" ? std::min(d->rp.samples, 16) : d->rp.samples;
  const auto t0 = std::chrono::steady_clock::now();
  while (d->passes < target && std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count() < maxMs) {
    d->view->Redraw();
    ++d->passes;
  }
  return d->passes;
}

int SceneView::renderedSamples() const { return d->passes; }

std::vector<unsigned char> SceneView::renderedImage(bool sixteenBit) {
  if (d->fbo.IsNull()) return {};
  const int w = d->rp.w, h = d->rp.h;
  if (sixteenBit) {
    Image_PixMap img;
    if (!img.InitZero(Image_Format_RGBAF, w, h)) return {};
    if (!d->view->View()->BufferDump(img, Graphic3d_BT_RGBA)) return {};
    std::vector<unsigned char> out(static_cast<size_t>(w) * h * 8);
    auto* o = reinterpret_cast<uint16_t*>(out.data());
    for (int y = 0; y < h; ++y) {
      const float* row = reinterpret_cast<const float*>(img.Row(y));
      for (int x = 0; x < w * 4; ++x) *o++ = static_cast<uint16_t>(std::lround(std::clamp(row[x], 0.f, 1.f) * 65535.f));
    }
    return out;
  }
  Image_PixMap img;
  if (!img.InitZero(Image_Format_RGBA, w, h)) return {};
  if (!d->view->View()->BufferDump(img, Graphic3d_BT_RGBA)) return {};
  std::vector<unsigned char> out(static_cast<size_t>(w) * h * 4);
  for (int y = 0; y < h; ++y) std::memcpy(out.data() + static_cast<size_t>(y) * w * 4, img.Row(y), static_cast<size_t>(w) * 4);
  return out;
}

void SceneView::endRender() {
  if (d->fbo.IsNull()) return;
  const Handle(Graphic3d_CView)& cv = d->view->View();
  cv->SetFBO(Handle(Standard_Transient)());
  cv->FBORelease(d->fbo);
  d->fbo.Nullify();
}

}  // namespace thcad::occt
