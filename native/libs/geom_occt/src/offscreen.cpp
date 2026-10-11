#include "thcad/occt/offscreen.hpp"

#include <AIS_InteractiveContext.hxx>
#include <AIS_Shape.hxx>
#include <AIS_ViewCube.hxx>
#include <Aspect_DisplayConnection.hxx>
#include <BRepBuilderAPI_Transform.hxx>
#include <Image_AlienPixMap.hxx>
#include <OpenGl_GraphicDriver.hxx>
#include <Prs3d_Drawer.hxx>
#include <Prs3d_LineAspect.hxx>
#include <Graphic3d_Camera.hxx>
#include <V3d_View.hxx>
#include <V3d_Viewer.hxx>
#include <gp_Ax1.hxx>
#include <gp_Trsf.hxx>

#include <chrono>
#include <cmath>
#include <map>
#include <cstring>

#include "platform_window.hpp"
#include "solid_impl.hpp"

namespace thcad::occt {

struct OffscreenView::Impl {
  Handle(V3d_Viewer) viewer;
  Handle(V3d_View) view;
  Handle(AIS_InteractiveContext) ctx;
  Handle(Aspect_Window) window;
  std::map<std::string, Handle(AIS_Shape)> walls;
  std::string mode = "shaded", selected;
  int w = 0, h = 0;
  double ms = 0;
  bool ok = false;
  bool fitted = false;

  void applyStyle() {
    const bool wire = mode != "shaded";
    view->SetComputedMode(mode == "hidden");  // exact hidden-line removal (HLR)
    for (auto& [id, s] : walls) {
      const bool sel = id == selected;
      s->SetColor(sel ? Quantity_Color(0.12, 0.6, 0.63, Quantity_TOC_RGB) : wire ? Quantity_Color(0.15, 0.17, 0.22, Quantity_TOC_RGB) : Quantity_Color(0.80, 0.81, 0.80, Quantity_TOC_RGB));
      ctx->SetDisplayMode(s, wire ? AIS_WireFrame : AIS_Shaded, false);
    }
    ctx->UpdateCurrentViewer();
    view->Update();  // recompute HLR presentations when the computed mode changes
  }
};

OffscreenView::OffscreenView() : d(std::make_unique<Impl>()) {
  ensureCocoaApplication();
  Handle(Aspect_DisplayConnection) disp = new Aspect_DisplayConnection();
  Handle(OpenGl_GraphicDriver) driver = new OpenGl_GraphicDriver(disp, false);
  d->viewer = new V3d_Viewer(driver);
  d->viewer->SetDefaultLights();
  d->viewer->SetLightOn();
  d->ctx = new AIS_InteractiveContext(d->viewer);
  d->ctx->DefaultDrawer()->SetFaceBoundaryDraw(true);
  d->ctx->DefaultDrawer()->SetFaceBoundaryAspect(new Prs3d_LineAspect(Quantity_NOC_GRAY25, Aspect_TOL_SOLID, 1.0));
  d->view = d->viewer->CreateView();
  // hidden, never-mapped window: provides the GL context; frames are rendered into an FBO
  try {
    d->window = makeOffscreenWindow(disp);
  } catch (...) {
    return;  // ok() stays false
  }
  d->view->SetWindow(d->window);
  d->view->SetBgGradientColors(Quantity_Color(0.933, 0.945, 0.957, Quantity_TOC_RGB), Quantity_Color(0.88, 0.898, 0.914, Quantity_TOC_RGB), Aspect_GradientFillMethod_Vertical);
  d->view->SetProj(V3d_XposYnegZpos);
  d->view->SetUp(0, 0, 1);
  d->ok = true;
}

OffscreenView::~OffscreenView() = default;
bool OffscreenView::ok() const { return d->ok; }
double OffscreenView::lastRenderMs() const { return d->ms; }

void OffscreenView::setModel(const bim::Model& m) {
  for (auto& [id, s] : d->walls) d->ctx->Remove(s, false);
  d->walls.clear();
  for (const auto& w : m.walls) {
    Solid s = wallWithOpenings(m, w);
    if (s.isNull()) continue;
    const bim::WallType* t = m.type(w.typeId);
    const bim::Level* base = m.level(w.baseLevel);
    gp_Trsf center, rot, move;
    center.SetTranslation(gp_Vec(0, -(t ? t->thickness : 0) / 2, 0));
    rot.SetRotation(gp_Ax1(gp_Pnt(0, 0, 0), gp::DZ()), w.angleDeg * M_PI / 180);
    move.SetTranslation(gp_Vec(w.x, w.y, (base ? base->elevation : 0) + w.baseOffset));
    Handle(AIS_Shape) a = new AIS_Shape(BRepBuilderAPI_Transform(s.impl->shape, move * rot * center, true).Shape());
    d->ctx->Display(a, AIS_Shaded, -1, false);
    d->walls[w.id] = a;
  }
  d->applyStyle();
}

void OffscreenView::setMode(const std::string& mode) {
  d->mode = mode;
  d->applyStyle();
}
void OffscreenView::setSelected(const std::string& id) {
  d->selected = id;
  d->applyStyle();
}
void OffscreenView::orbit(int x0, int y0, int x1, int y1, bool start) {
  if (start) d->view->StartRotation(x0, y0);
  d->view->Rotation(x1, y1);
}
void OffscreenView::pan(int dx, int dy) { d->view->Pan(dx, -dy, 1.0, false); }
void OffscreenView::zoom(int x, int y, double delta) {
  d->view->StartZoomAtPoint(x, y);
  const int k = static_cast<int>(std::lround(delta * 40));
  d->view->ZoomAtPoint(x, y, x + k, y + k);
}
void OffscreenView::fit() { d->view->FitAll(0.06, false); }
void OffscreenView::preset(const std::string& p) {
  d->view->SetProj(p == "top" ? V3d_Zpos : p == "front" ? V3d_Yneg : p == "right" ? V3d_Xpos : V3d_XposYnegZpos);
  // world Z is up (OCCT keeps the previous / default +Y up otherwise); plan view keeps north (+Y) up
  if (p == "top") d->view->SetUp(0, 1, 0);
  else d->view->SetUp(0, 0, 1);
  fit();
}

std::vector<unsigned char> OffscreenView::renderRgba(int w, int h) {
  const auto t0 = std::chrono::steady_clock::now();
  // ToPixMap renders into an FBO of exactly w×h and adapts the camera aspect to it
  d->view->Camera()->SetAspect(static_cast<double>(w) / h);
  if (!d->fitted) { d->view->FitAll(0.06, false); d->fitted = true; }
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

}  // namespace thcad::occt
