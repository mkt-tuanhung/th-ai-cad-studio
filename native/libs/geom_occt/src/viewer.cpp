#include "thcad/occt/viewer.hpp"

#include "platform_window.hpp"
#include "solid_impl.hpp"

#include <AIS_InteractiveContext.hxx>
#include <AIS_Shape.hxx>
#include <AIS_ViewController.hxx>
#include <AIS_ViewCube.hxx>
#include <Graphic3d_TransformPers.hxx>
#include <Graphic3d_Vec2.hxx>
#include <Aspect_DisplayConnection.hxx>
#include <OpenGl_GraphicDriver.hxx>
#include <Prs3d_Drawer.hxx>
#include <Quantity_Color.hxx>
#include <V3d_View.hxx>
#include <V3d_Viewer.hxx>

namespace thcad::occt {

struct Viewer::Impl : public AIS_ViewController {
  Handle(V3d_Viewer) viewer;
  Handle(V3d_View) view;
  Handle(AIS_InteractiveContext) ctx;
  Handle(Aspect_Window) window;
  Handle(AIS_Shape) current;
  bool ok = false;

  Aspect_VKeyFlags flags(bool shift) const { return shift ? Aspect_VKeyFlags_SHIFT : Aspect_VKeyFlags_NONE; }
  static Aspect_VKeyMouse mouse(int b) {
    Aspect_VKeyMouse m = Aspect_VKeyMouse_NONE;
    if (b & Viewer::Left) m |= Aspect_VKeyMouse_LeftButton;
    if (b & Viewer::Middle) m |= Aspect_VKeyMouse_MiddleButton;
    if (b & Viewer::Right) m |= Aspect_VKeyMouse_RightButton;
    return m;
  }
  void flush() {
    if (ok) FlushViewEvents(ctx, view, true);
  }
};

Viewer::Viewer() : d(std::make_unique<Impl>()) {}
Viewer::~Viewer() = default;

bool Viewer::attach(void* nsView) {
  Handle(Aspect_DisplayConnection) disp = new Aspect_DisplayConnection();
  Handle(OpenGl_GraphicDriver) driver = new OpenGl_GraphicDriver(disp, false);
  d->viewer = new V3d_Viewer(driver);
  d->viewer->SetDefaultLights();
  d->viewer->SetLightOn();
  d->ctx = new AIS_InteractiveContext(d->viewer);
  d->ctx->SetDisplayMode(AIS_Shaded, false);
  d->view = d->viewer->CreateView();
  d->window = wrapNativeWindow(nsView, disp);
  d->view->SetWindow(d->window);
  d->view->SetBgGradientColors(Quantity_Color(0.93, 0.945, 0.957, Quantity_TOC_RGB), Quantity_Color(0.88, 0.9, 0.92, Quantity_TOC_RGB), Aspect_GradientFillMethod_Vertical);
  d->view->SetProj(V3d_XposYnegZpos);
  Handle(AIS_ViewCube) cube = new AIS_ViewCube();
  cube->SetSize(55);
  cube->SetTransformPersistence(new Graphic3d_TransformPers(Graphic3d_TMF_TriedronPers, Aspect_TOTP_RIGHT_UPPER, Graphic3d_Vec2i(85, 85)));
  d->ctx->Display(cube, false);
  d->ok = true;
  return true;
}

void Viewer::display(const Solid& s, bool fit) {
  if (!d->ok || s.isNull()) return;
  if (!d->current.IsNull()) d->ctx->Remove(d->current, false);
  d->current = new AIS_Shape(s.impl->shape);
  d->current->SetColor(Quantity_Color(0.92, 0.92, 0.9, Quantity_TOC_RGB));
  d->current->Attributes()->SetFaceBoundaryDraw(true);
  d->ctx->Display(d->current, AIS_Shaded, 0, false);
  if (fit) d->view->FitAll(0.05, false);
  d->view->Redraw();
}

void Viewer::resized() {
  if (d->ok) { d->view->MustBeResized(); d->view->Redraw(); }
}
void Viewer::redraw() {
  if (d->ok) d->view->Redraw();
}
void Viewer::fitAll() {
  if (d->ok) { d->view->FitAll(0.05, false); d->view->Redraw(); }
}
void Viewer::setView(Preset p) {
  if (!d->ok) return;
  d->view->SetProj(p == Preset::Top ? V3d_Zpos : p == Preset::Front ? V3d_Yneg : p == Preset::Right ? V3d_Xpos : V3d_XposYnegZpos);
  fitAll();
}

bool Viewer::dump(const std::string& path) {
  if (!d->ok) return false;
  d->view->Redraw();
  return d->view->Dump(path.c_str());
}

void Viewer::mouseDown(int x, int y, int b, bool shift) {
  d->PressMouseButton(Graphic3d_Vec2i(x, y), Impl::mouse(b), d->flags(shift), false);
  d->flush();
}
void Viewer::mouseMove(int x, int y, int b, bool shift) {
  d->UpdateMousePosition(Graphic3d_Vec2i(x, y), Impl::mouse(b), d->flags(shift), false);
  d->flush();
}
void Viewer::mouseUp(int x, int y, int b, bool shift) {
  d->ReleaseMouseButton(Graphic3d_Vec2i(x, y), Impl::mouse(b), d->flags(shift), false);
  d->flush();
}
void Viewer::wheel(int x, int y, double delta) {
  d->UpdateZoom(Aspect_ScrollDelta(Graphic3d_Vec2i(x, y), delta));
  d->flush();
}

}  // namespace thcad::occt
