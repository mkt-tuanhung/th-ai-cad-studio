#include "thcad/occt/scene.hpp"
#include "thcad/occt/geometry.hpp"

#include <AIS_InteractiveContext.hxx>
#include <AIS_Shape.hxx>
#include <Aspect_SkydomeBackground.hxx>
#include <Graphic3d_BSDF.hxx>
#include <Graphic3d_CubeMapPacked.hxx>
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

#include "platform_window.hpp"
#include "solid_impl.hpp"
#include <BRepBuilderAPI_Transform.hxx>

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
  }
  return {};
}

TopoDS_Shape buildItem(const SceneItem& it, bool* failed) {
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
  static const std::map<std::string, Prim::Kind> kinds{{"box", Prim::Kind::Box}, {"cyl", Prim::Kind::Cylinder}, {"cone", Prim::Kind::Cone}, {"sphere", Prim::Kind::Sphere}, {"torus", Prim::Kind::Torus}, {"prism", Prim::Kind::Prism}, {"revolve", Prim::Kind::Revolve}};
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
    if (const json::Value* ps = io.get("parts"); ps && ps->arr())
      for (const auto& p : *ps->arr()) it.parts.push_back(primFromJson(p));
    if (const json::Value* cs = io.get("cuts"); cs && cs->arr())
      for (const auto& p : *cs->arr()) it.cuts.push_back(primFromJson(p));
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
  };
  std::map<std::string, Entry> items;
  std::string mode = "shaded", selected;
  std::set<std::string> highlighted;
  int w = 0, h = 0;
  double ms = 0, buildMs = 0;
  bool ok = false, fitted = false;
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
      e.ais->SetTransparency(wire ? 0 : e.item.transparency);
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
  int failures = 0;
  for (const auto& it : items) {
    bool failed = false;
    TopoDS_Shape s = buildItem(it, &failed);
    if (failed) ++failures;
    if (s.IsNull()) continue;
    Impl::Entry e;
    e.item = it;
    e.shape = s;
    e.ais = new AIS_Shape(s);
    d->ctx->Display(e.ais, AIS_Shaded, -1, false);
    d->items[it.id] = std::move(e);
  }
  d->applyStyle();
  d->buildMs = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
  return failures;
}

int SceneView::addBuilding(const bim::Model& m, bool ground) {
  auto add = [&](const std::string& id, const TopoDS_Shape& s, std::array<double, 3> rgb, const char* mat) {
    if (s.IsNull()) return;
    Impl::Entry e;
    e.item.id = id;
    e.item.rgb = rgb;
    e.item.mat = mat;
    e.shape = s;
    e.ais = new AIS_Shape(s);
    d->ctx->Display(e.ais, AIS_Shaded, -1, false);
    d->items[id] = std::move(e);
  };
  struct Box2 { double x0 = 1e18, y0 = 1e18, x1 = -1e18, y1 = -1e18; };
  std::map<std::string, Box2> spans;  // level id → plan extent of the walls that start or end there
  int n = 0;
  for (const auto& w : m.walls) {
    const bim::WallType* t = m.type(w.typeId);
    const bim::Level* base = m.level(w.baseLevel);
    const double th = t ? t->thickness : 200;
    gp_Trsf center, rot, move;
    center.SetTranslation(gp_Vec(0, -th / 2, 0));
    rot.SetRotation(gp_Ax1(gp_Pnt(0, 0, 0), gp::DZ()), w.angleDeg * kPiScene / 180);
    move.SetTranslation(gp_Vec(w.x, w.y, (base ? base->elevation : 0) + w.baseOffset));
    const gp_Trsf place = move * rot * center;
    Solid s = wallWithOpenings(m, w);
    if (s.isNull()) continue;
    const bool ext = th >= 200;
    add(w.id, BRepBuilderAPI_Transform(s.impl->shape, place, true).Shape(), ext ? std::array<double, 3>{0.88, 0.87, 0.84} : std::array<double, 3>{0.93, 0.93, 0.92}, "matte");
    ++n;
    // glazing: a 20 mm pane in the middle of each window opening
    for (const auto& o : m.windows)
      if (o.hostWall == w.id) {
        TopoDS_Shape pane = BRepPrimAPI_MakeBox(gp_Pnt(o.offset, th / 2 - 10, o.sill), o.width, 20, o.height).Shape();
        add("glass:" + o.id, BRepBuilderAPI_Transform(pane, place, true).Shape(), {0.55, 0.7, 0.78}, "glass");
      }
    const double a = w.angleDeg * kPiScene / 180;
    const double ex = w.x + std::cos(a) * w.length, ey = w.y + std::sin(a) * w.length;
    if (ext)
      for (const std::string& lv : {w.baseLevel, w.topLevel}) {
        Box2& b = spans[lv];
        b.x0 = std::min({b.x0, w.x, ex}), b.x1 = std::max({b.x1, w.x, ex});
        b.y0 = std::min({b.y0, w.y, ey}), b.y1 = std::max({b.y1, w.y, ey});
      }
  }
  for (const auto& [lv, b] : spans) {
    const bim::Level* l = m.level(lv);
    if (!l || b.x1 <= b.x0) continue;
    // slab top at the level, outer face of the 200 mm exterior walls
    add("slab:" + lv, BRepPrimAPI_MakeBox(gp_Pnt(b.x0 - 100, b.y0 - 100, l->elevation - 200), b.x1 - b.x0 + 200, b.y1 - b.y0 + 200, 200).Shape(), {0.8, 0.79, 0.77}, "matte");
  }
  if (ground) add("ground", BRepPrimAPI_MakeBox(gp_Pnt(-40000, -40000, -350), 94000, 90000, 200).Shape(), {0.5, 0.56, 0.42}, "matte");
  d->applyStyle();
  return n;
}

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
void SceneView::orbit(int x0, int y0, int x1, int y1, bool start) {
  if (start) d->view->StartRotation(x0, y0);
  d->view->Rotation(x1, y1);
}
void SceneView::pan(int dx, int dy) { d->view->Pan(dx, -dy, 1.0, false); }
void SceneView::zoom(int x, int y, double delta) {
  d->view->StartZoomAtPoint(x, y);
  const int k = static_cast<int>(std::lround(delta * 40));
  d->view->ZoomAtPoint(x, y, x + k, y + k);
}
void SceneView::fit() { d->view->FitAll(0.06, false); }
void SceneView::preset(const std::string& p) {
  d->view->SetProj(p == "top" ? V3d_Zpos : p == "front" ? V3d_Yneg : p == "right" ? V3d_Xpos : V3d_XposYnegZpos);
  // world Z is up (OCCT keeps the previous / default +Y up otherwise); plan view keeps north (+Y) up
  if (p == "top") d->view->SetUp(0, 1, 0);
  else d->view->SetUp(0, 0, 1);
  fit();
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
    if (e.item.transparency >= 0.9) continue;
    Bnd_Box box;
    BRepBndLib::Add(e.shape, box);
    if (box.IsOut(ray)) continue;
    IntCurvesFace_ShapeIntersector isect;
    isect.Load(e.shape, 1e-3);
    isect.Perform(ray, -1e12, 1e12);
    if (!isect.IsDone()) continue;
    for (int i = 1; i <= isect.NbPnt(); ++i) {
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
    cam->SetUp(gp::DZ());
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
  for (V3d_ListOfLightIterator it(d->viewer->DefinedLightIterator()); it.More();) {
    Handle(V3d_Light) l = it.Value();
    it.Next();
    d->viewer->DelLight(l);
  }
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
  Handle(OpenGl_GraphicDriver) drv = Handle(OpenGl_GraphicDriver)::DownCast(d->viewer->Driver());
  const Handle(OpenGl_Context) gl = drv.IsNull() ? Handle(OpenGl_Context)() : drv->GetSharedContext();
  if (gl.IsNull() || !gl->HasRayTracing()) {
    const std::string why = gl.IsNull() ? "no GL context" : "this GPU/driver has no OpenGL ray-tracing support (OpenGL " + std::to_string(gl->VersionMajor()) + "." + std::to_string(gl->VersionMinor()) + ")";
    endRender();
    return why;
  }
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
