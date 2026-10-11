#include "thcad/occt/geometry.hpp"

#include "solid_impl.hpp"

#include <cmath>

#include <BRepAlgoAPI_Cut.hxx>
#include <BRepBuilderAPI_MakePolygon.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepGProp.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepPrimAPI_MakePrism.hxx>
#include <BRep_Builder.hxx>
#include <GProp_GProps.hxx>
#include <IFSelect_ReturnStatus.hxx>
#include <Message.hxx>
#include <Message_Messenger.hxx>
#include <Message_PrinterOStream.hxx>
#include <STEPControl_Writer.hxx>
#include <Standard_Version.hxx>
#include <TopoDS_Compound.hxx>
#include <TopoDS_Shape.hxx>
#include <gp_Ax1.hxx>
#include <gp_Pnt.hxx>
#include <gp_Trsf.hxx>
#include <BRepBuilderAPI_Transform.hxx>
#include <gp_Vec.hxx>

namespace thcad::occt {

Solid::Solid() : impl(std::make_unique<Impl>()) {}
Solid::~Solid() = default;
Solid::Solid(Solid&&) noexcept = default;
Solid& Solid::operator=(Solid&&) noexcept = default;
bool Solid::isNull() const { return impl->shape.IsNull(); }

double Solid::volumeM3() const {
  if (isNull()) return 0;
  GProp_GProps props;
  BRepGProp::VolumeProperties(impl->shape, props);
  return props.Mass() / 1e9;  // mm³ → m³
}

Solid wallSolid(double lengthMm, double thicknessMm, double heightMm) {
  Solid s;
  if (lengthMm > 0 && thicknessMm > 0 && heightMm > 0) s.impl->shape = BRepPrimAPI_MakeBox(lengthMm, thicknessMm, heightMm).Shape();
  return s;
}

Solid wallWithOpenings(const bim::Model& m, const bim::Wall& w) {
  const bim::WallType* t = m.type(w.typeId);
  Solid s = wallSolid(w.length, t ? t->thickness : 0, bim::wallHeight(m, w));
  if (s.isNull()) return s;
  TopoDS_Shape shape = s.impl->shape;
  auto cut = [&](const bim::Opening& o) {
    if (o.hostWall != w.id) return;
    // opening box spans the full wall thickness (+1 mm each side to avoid coplanar faces)
    TopoDS_Shape box = BRepPrimAPI_MakeBox(gp_Pnt(o.offset, -1, o.sill), gp_Pnt(o.offset + o.width, (t ? t->thickness : 0) + 1, o.sill + o.height)).Shape();
    BRepAlgoAPI_Cut c(shape, box);
    if (c.IsDone()) shape = c.Shape();
  };
  for (const auto& o : m.doors) cut(o);
  for (const auto& o : m.windows) cut(o);
  s.impl->shape = shape;
  return s;
}

Solid buildingSolid(const bim::Model& m) {
  BRep_Builder builder;
  TopoDS_Compound comp;
  builder.MakeCompound(comp);
  for (const auto& w : m.walls) {
    Solid s = wallWithOpenings(m, w);
    if (s.isNull()) continue;
    const bim::WallType* t = m.type(w.typeId);
    const bim::Level* base = m.level(w.baseLevel);
    gp_Trsf center, rot, move;
    center.SetTranslation(gp_Vec(0, -(t ? t->thickness : 0) / 2, 0));  // location line = wall centre line
    rot.SetRotation(gp_Ax1(gp_Pnt(0, 0, 0), gp::DZ()), w.angleDeg * M_PI / 180);
    move.SetTranslation(gp_Vec(w.x, w.y, (base ? base->elevation : 0) + w.baseOffset));
    builder.Add(comp, BRepBuilderAPI_Transform(s.impl->shape, move * rot * center, true).Shape());
  }
  Solid out;
  out.impl->shape = comp;
  return out;
}

Solid extrudeClosedPolylines(const Document& doc, const std::string& layer, double heightMm, size_t* count) {
  BRep_Builder builder;
  TopoDS_Compound comp;
  builder.MakeCompound(comp);
  size_t n = 0;
  for (const auto& e : doc.entities) {
    if (e.props.layer != layer) continue;
    const auto* p = std::get_if<Polyline>(&e.shape);
    if (!p || !p->closed || p->points.size() < 3) continue;
    BRepBuilderAPI_MakePolygon poly;
    for (auto q : p->points) poly.Add(gp_Pnt(q.x, q.y, 0));
    poly.Close();
    if (!poly.IsDone()) continue;
    BRepBuilderAPI_MakeFace face(poly.Wire(), true);
    if (!face.IsDone()) continue;
    builder.Add(comp, BRepPrimAPI_MakePrism(face.Face(), gp_Vec(0, 0, heightMm)).Shape());
    ++n;
  }
  if (count) *count = n;
  Solid s;
  if (n) s.impl->shape = comp;
  return s;
}

std::string writeStep(const Solid& s, const std::string& path) {
  if (s.isNull()) return "empty shape";
  static const bool quiet = [] {
    Message::DefaultMessenger()->RemovePrinters(STANDARD_TYPE(Message_PrinterOStream));
    return true;
  }();
  (void)quiet;
  STEPControl_Writer w;
  if (w.Transfer(s.impl->shape, STEPControl_AsIs) != IFSelect_RetDone) return "STEP transfer failed";
  if (w.Write(path.c_str()) != IFSelect_RetDone) return "cannot write " + path;
  return {};
}

std::string version() { return OCC_VERSION_COMPLETE; }

}  // namespace thcad::occt
