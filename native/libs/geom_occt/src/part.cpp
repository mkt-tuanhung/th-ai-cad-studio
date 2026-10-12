#include "thcad/occt/part.hpp"

#include <BRepAlgoAPI_Cut.hxx>
#include <BRepAlgoAPI_Fuse.hxx>
#include <BRepBndLib.hxx>
#include <BRepBuilderAPI_MakeEdge.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakePolygon.hxx>
#include <BRepBuilderAPI_MakeWire.hxx>
#include <BRepBuilderAPI_Transform.hxx>
#include <BRepAdaptor_Curve.hxx>
#include <BRepFilletAPI_MakeChamfer.hxx>
#include <BRepFilletAPI_MakeFillet.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <BRepPrimAPI_MakePrism.hxx>
#include <BRepPrimAPI_MakeRevol.hxx>
#include <BRep_Tool.hxx>
#include <Bnd_Box.hxx>
#include <GC_MakeArcOfCircle.hxx>
#include <TopExp.hxx>
#include <TopTools_IndexedDataMapOfShapeListOfShape.hxx>
#include <IntCurvesFace_ShapeIntersector.hxx>
#include <gp_Lin.hxx>
#include <TopExp_Explorer.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <gp_Ax2.hxx>
#include <gp_Circ.hxx>
#include <gp_Trsf.hxx>

#include <cmath>
#include <map>
#include <sstream>

#include "part_impl.hpp"

namespace thcad::occt {

namespace {
constexpr double kPi = 3.14159265358979323846;

std::string str(const json::Value& o, std::string_view k, const std::string& def = {}) {
  const json::Value* v = o.get(k);
  return v && v->str() ? *v->str() : def;
}
double num(const json::Value& o, std::string_view k, double def = 0) {
  const json::Value* v = o.get(k);
  return v && v->num() ? *v->num() : def;
}
bool flag(const json::Value& o, std::string_view k) {
  const json::Value* v = o.get(k);
  return v && v->boolean() && *v->boolean();
}

/** Sketch plane: origin, normal, u axis (v = normal × u). */
gp_Ax2 planeOf(const SketchDef& s) {
  if (s.plane == "XZ") return gp_Ax2(gp_Pnt(0, s.offset, 0), gp_Dir(0, -1, 0), gp_Dir(1, 0, 0));
  if (s.plane == "YZ") return gp_Ax2(gp_Pnt(s.offset, 0, 0), gp_Dir(1, 0, 0), gp_Dir(0, 1, 0));
  return gp_Ax2(gp_Pnt(0, 0, s.offset), gp_Dir(0, 0, 1), gp_Dir(1, 0, 0));
}
gp_Pnt on(const gp_Ax2& ax, double u, double v) {
  return gp_Pnt(ax.Location().XYZ() + ax.XDirection().XYZ() * u + ax.YDirection().XYZ() * v);
}

TopoDS_Face faceOf(const gp_Ax2& ax, const SketchShape& sh) {
  switch (sh.kind) {
    case SketchShape::Kind::Rect: {
      if (sh.w <= 0 || sh.h <= 0) return {};
      BRepBuilderAPI_MakePolygon p(on(ax, sh.x, sh.y), on(ax, sh.x + sh.w, sh.y), on(ax, sh.x + sh.w, sh.y + sh.h), on(ax, sh.x, sh.y + sh.h), true);
      return BRepBuilderAPI_MakeFace(p.Wire(), true).Face();
    }
    case SketchShape::Kind::Circle: {
      if (sh.r <= 0) return {};
      gp_Ax2 c(on(ax, sh.x, sh.y), ax.Direction(), ax.XDirection());
      return BRepBuilderAPI_MakeFace(BRepBuilderAPI_MakeWire(BRepBuilderAPI_MakeEdge(gp_Circ(c, sh.r))).Wire(), true).Face();
    }
    case SketchShape::Kind::Poly: {
      if (sh.pts.size() < 3) return {};
      BRepBuilderAPI_MakePolygon p;
      for (const auto& q : sh.pts) p.Add(on(ax, q[0], q[1]));
      p.Close();
      if (!p.IsDone()) return {};
      return BRepBuilderAPI_MakeFace(p.Wire(), true).Face();
    }
    case SketchShape::Kind::Slot: {
      // two semicircles joined by straight sides; centre (x, y), centre distance w, radius r
      if (sh.r <= 0 || sh.w <= 0) return {};
      const double a = sh.angle * kPi / 180, ux = std::cos(a), uy = std::sin(a), nx = -uy, ny = ux, L = sh.w / 2;
      auto P = [&](double s, double t) { return on(ax, sh.x + ux * s + nx * t, sh.y + uy * s + ny * t); };
      const gp_Pnt p1 = P(-L, -sh.r), p2 = P(L, -sh.r), p3 = P(L, sh.r), p4 = P(-L, sh.r);
      BRepBuilderAPI_MakeWire w;
      w.Add(BRepBuilderAPI_MakeEdge(p1, p2));
      w.Add(BRepBuilderAPI_MakeEdge(GC_MakeArcOfCircle(p2, P(L + sh.r, 0), p3).Value()));
      w.Add(BRepBuilderAPI_MakeEdge(p3, p4));
      w.Add(BRepBuilderAPI_MakeEdge(GC_MakeArcOfCircle(p4, P(-L - sh.r, 0), p1).Value()));
      if (!w.IsDone()) return {};
      return BRepBuilderAPI_MakeFace(w.Wire(), true).Face();
    }
  }
  return {};
}

TopoDS_Shape fuse(const TopoDS_Shape& a, const TopoDS_Shape& b) {
  if (a.IsNull()) return b;
  if (b.IsNull()) return a;
  BRepAlgoAPI_Fuse f(a, b);
  if (!f.IsDone() || f.HasErrors()) return {};
  f.SimplifyResult();
  return f.Shape();
}
TopoDS_Shape cut(const TopoDS_Shape& a, const TopoDS_Shape& b) {
  if (a.IsNull() || b.IsNull()) return a;
  BRepAlgoAPI_Cut c(a, b);
  if (!c.IsDone() || c.HasErrors()) return {};
  c.SimplifyResult();
  return c.Shape();
}

Bnd_Box boxOf(const TopoDS_Shape& s) {
  Bnd_Box b;
  if (!s.IsNull()) BRepBndLib::Add(s, b);
  return b;
}

/** Edges picked by a selection keyword. */
std::vector<TopoDS_Edge> edgesOf(const TopoDS_Shape& s, const std::string& sel) {
  std::vector<TopoDS_Edge> out;
  Bnd_Box b = boxOf(s);
  if (b.IsVoid()) return out;
  double x0, y0, z0, x1, y1, z1;
  b.Get(x0, y0, z0, x1, y1, z1);
  const double tol = 1e-3 * std::max({x1 - x0, y1 - y0, z1 - z0, 1.0}) + 1e-4;
  TopTools_IndexedMapOfShape edges;
  TopExp::MapShapes(s, TopAbs_EDGE, edges);
  TopTools_IndexedDataMapOfShapeListOfShape faces;
  TopExp::MapShapesAndAncestors(s, TopAbs_EDGE, TopAbs_FACE, faces);
  for (int i = 1; i <= edges.Extent(); ++i) {
    const TopoDS_Edge e = TopoDS::Edge(edges(i));
    if (BRep_Tool::Degenerated(e)) continue;
    // seam of a cylinder / revolved face: both sides are the same face, nothing to round
    if (const int k = faces.FindIndex(e); k > 0) {
      const TopTools_ListOfShape& fl = faces(k);
      if (fl.Extent() == 2 && fl.First().IsSame(fl.Last())) continue;
      if (fl.Extent() < 2) continue;
    }
    BRepAdaptor_Curve c(e);
    const gp_Pnt a = c.Value(c.FirstParameter()), z = c.Value(c.LastParameter()), m = c.Value((c.FirstParameter() + c.LastParameter()) / 2);
    bool take = sel == "all";
    if (sel == "vertical") take = c.GetType() == GeomAbs_Line && std::abs(a.X() - z.X()) < tol && std::abs(a.Y() - z.Y()) < tol && std::abs(a.Z() - z.Z()) > tol;
    else if (sel == "top") take = std::abs(a.Z() - z1) < tol && std::abs(z.Z() - z1) < tol && std::abs(m.Z() - z1) < tol;
    else if (sel == "bottom") take = std::abs(a.Z() - z0) < tol && std::abs(z.Z() - z0) < tol && std::abs(m.Z() - z0) < tol;
    else if (sel == "circular") take = c.GetType() == GeomAbs_Circle;
    if (take) out.push_back(e);
  }
  return out;
}
}  // namespace

PartDef partFromJson(const json::Value& v) {
  PartDef p;
  if (const json::Value* ss = v.get("sketches"); ss && ss->arr())
    for (const auto& so : *ss->arr()) {
      SketchDef s;
      s.id = str(so, "id");
      s.plane = str(so, "plane", "XY");
      s.offset = num(so, "offset");
      if (const json::Value* shs = so.get("shapes"); shs && shs->arr())
        for (const auto& ho : *shs->arr()) {
          SketchShape h;
          const std::string t = str(ho, "t");
          h.kind = t == "circle" ? SketchShape::Kind::Circle : t == "poly" ? SketchShape::Kind::Poly : t == "slot" ? SketchShape::Kind::Slot : SketchShape::Kind::Rect;
          h.x = num(ho, "x"), h.y = num(ho, "y"), h.w = num(ho, "w"), h.h = num(ho, "h"), h.r = num(ho, "r"), h.angle = num(ho, "angle");
          if (const json::Value* pts = ho.get("pts"); pts && pts->arr())
            for (const auto& q : *pts->arr())
              if (const json::Array* a = q.arr(); a && a->size() >= 2 && (*a)[0].num() && (*a)[1].num()) h.pts.push_back({*(*a)[0].num(), *(*a)[1].num()});
          s.shapes.push_back(h);
        }
      p.sketches.push_back(s);
    }
  static const std::map<std::string, FeatureDef::Kind> kinds{{"extrude", FeatureDef::Kind::Extrude}, {"revolve", FeatureDef::Kind::Revolve}, {"hole", FeatureDef::Kind::Hole}, {"fillet", FeatureDef::Kind::Fillet}, {"chamfer", FeatureDef::Kind::Chamfer}, {"pattern", FeatureDef::Kind::Pattern}};
  if (const json::Value* fs = v.get("features"); fs && fs->arr())
    for (const auto& fo : *fs->arr()) {
      FeatureDef f;
      f.id = str(fo, "id");
      const std::string k = str(fo, "kind");
      if (!kinds.count(k)) continue;
      f.kind = kinds.at(k);
      f.cut = str(fo, "op") == "cut";
      f.suppressed = flag(fo, "suppressed");
      f.sketch = str(fo, "sketch");
      f.depth = num(fo, "depth", 10);
      f.reverse = flag(fo, "reverse");
      f.through = flag(fo, "through");
      f.symmetric = flag(fo, "symmetric");
      f.angle = num(fo, "angle", 360);
      f.axis = str(fo, "axis", "v");
      f.x = num(fo, "x"), f.y = num(fo, "y"), f.dia = num(fo, "dia"), f.cbDia = num(fo, "cbDia"), f.cbDepth = num(fo, "cbDepth");
      f.edges = str(fo, "edges", "all");
      f.r = num(fo, "r", 1);
      f.source = str(fo, "source");
      f.circular = str(fo, "type") == "circular";
      f.count = static_cast<int>(num(fo, "count", 2));
      f.dx = num(fo, "dx"), f.dy = num(fo, "dy"), f.cx = num(fo, "cx"), f.cy = num(fo, "cy");
      p.features.push_back(f);
    }
  return p;
}

namespace {
/** Tool body of an extrude / revolve / hole feature against the current shape (for patterns too). */
TopoDS_Shape toolOf(const PartDef& p, const FeatureDef& f, const TopoDS_Shape& current, std::string* err) {
  if (f.kind == FeatureDef::Kind::Hole) {
    Bnd_Box b = boxOf(current);
    if (b.IsVoid()) return (*err = "hole needs a body", TopoDS_Shape());
    double x0, y0, z0, x1, y1, z1;
    b.Get(x0, y0, z0, x1, y1, z1);
    if (f.dia <= 0) return (*err = "hole diameter must be > 0", TopoDS_Shape());
    // the hole starts on the highest material surface above (x, y): drop a vertical ray onto the body
    IntCurvesFace_ShapeIntersector isect;
    isect.Load(current, 1e-4);
    isect.Perform(gp_Lin(gp_Pnt(f.x, f.y, z1 + 10), gp_Dir(0, 0, -1)), -1e9, 1e9);
    double top = -1e18;
    if (isect.IsDone())
      for (int i = 1; i <= isect.NbPnt(); ++i) top = std::max(top, isect.Pnt(i).Z());
    if (top < -1e17) return (*err = "no material under the hole at (" + std::to_string(int(f.x)) + ", " + std::to_string(int(f.y)) + ")", TopoDS_Shape());
    const double depth = f.through ? top - z0 + 1 : f.depth;
    // from 1 mm above the surface downwards
    TopoDS_Shape tool = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(f.x, f.y, top - depth), gp::DZ()), f.dia / 2, depth + 1).Shape();
    if (f.cbDia > f.dia && f.cbDepth > 0) tool = fuse(tool, BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(f.x, f.y, top - f.cbDepth), gp::DZ()), f.cbDia / 2, f.cbDepth + 1).Shape());
    return tool;
  }
  const SketchDef* s = nullptr;
  for (const auto& k : p.sketches)
    if (k.id == f.sketch) s = &k;
  if (!s) return (*err = "sketch " + f.sketch + " not found", TopoDS_Shape());
  const gp_Ax2 ax = planeOf(*s);
  TopoDS_Shape body;
  for (const auto& sh : s->shapes) {
    TopoDS_Face face = faceOf(ax, sh);
    if (face.IsNull()) continue;
    TopoDS_Shape one;
    if (f.kind == FeatureDef::Kind::Extrude) {
      double d = f.depth;
      if (f.through) {
        Bnd_Box b = boxOf(current);
        d = b.IsVoid() ? f.depth : std::sqrt(b.SquareExtent()) + 2;
      }
      if (d <= 0) return (*err = "depth must be > 0", TopoDS_Shape());
      gp_Vec n(ax.Direction());
      if (f.reverse) n.Reverse();
      if (f.symmetric || f.through) {
        gp_Trsf back;
        back.SetTranslation(n * (-d / (f.through ? 1 : 2)));
        TopoDS_Shape moved = BRepBuilderAPI_Transform(face, back, true).Shape();
        one = BRepPrimAPI_MakePrism(moved, n * (f.through ? 2 * d : d)).Shape();
      } else one = BRepPrimAPI_MakePrism(face, n * d).Shape();
    } else {
      const gp_Ax1 axis(ax.Location(), f.axis == "u" ? ax.XDirection() : ax.YDirection());
      const double a = (f.angle > 0 && f.angle < 360 ? f.angle : 360) * kPi / 180;
      one = BRepPrimAPI_MakeRevol(face, axis, a).Shape();
    }
    body = fuse(body, one);
  }
  if (body.IsNull()) *err = "sketch has no closed profile";
  return body;
}
}  // namespace

TopoDS_Shape buildPart(const PartDef& p, std::vector<std::string>* errors) {
  TopoDS_Shape shape;
  std::map<std::string, const FeatureDef*> byId;
  for (const auto& f : p.features) byId[f.id] = &f;
  // tool bodies as built (a pattern repeats the original body, not one re-derived from the cut part)
  std::map<std::string, TopoDS_Shape> tools;
  auto fail = [&](const FeatureDef& f, const std::string& why) {
    if (errors) errors->push_back(f.id + ": " + why);
  };
  for (const auto& f : p.features) {
    if (f.suppressed) continue;
    try {
      std::string err;
      if (f.kind == FeatureDef::Kind::Extrude || f.kind == FeatureDef::Kind::Revolve || f.kind == FeatureDef::Kind::Hole) {
        TopoDS_Shape tool = toolOf(p, f, shape, &err);
        if (tool.IsNull()) {
          fail(f, err);
          continue;
        }
        tools[f.id] = tool;
        const bool remove = f.cut || f.kind == FeatureDef::Kind::Hole;
        if (remove && shape.IsNull()) {
          fail(f, "nothing to cut yet");
          continue;
        }
        TopoDS_Shape next = remove ? cut(shape, tool) : fuse(shape, tool);
        if (next.IsNull()) fail(f, "boolean failed");
        else shape = next;
      } else if (f.kind == FeatureDef::Kind::Fillet || f.kind == FeatureDef::Kind::Chamfer) {
        if (shape.IsNull()) {
          fail(f, "no body to round");
          continue;
        }
        const auto edges = edgesOf(shape, f.edges);
        if (edges.empty()) {
          fail(f, "no " + f.edges + " edges");
          continue;
        }
        TopoDS_Shape next;
        std::string kernel;
        try {
          if (f.kind == FeatureDef::Kind::Fillet) {
            BRepFilletAPI_MakeFillet mk(shape);
            for (const auto& e : edges) mk.Add(f.r, e);
            mk.Build();
            if (mk.IsDone()) next = mk.Shape();
          } else {
            BRepFilletAPI_MakeChamfer mk(shape);
            for (const auto& e : edges) mk.Add(f.r, e);
            mk.Build();
            if (mk.IsDone()) next = mk.Shape();
          }
        } catch (const Standard_Failure& e) {
          kernel = e.GetMessageString() ? e.GetMessageString() : "";
        }
        std::ostringstream r;
        r << f.r;
        if (next.IsNull()) fail(f, (f.kind == FeatureDef::Kind::Fillet ? "fillet R" : "chamfer ") + r.str() + " does not fit the " + f.edges + " edges" + (kernel.empty() ? "" : " (OCCT: " + kernel + ")"));
        else shape = next;
      } else if (f.kind == FeatureDef::Kind::Pattern) {
        auto it = byId.find(f.source);
        if (it == byId.end() || it->second->kind == FeatureDef::Kind::Fillet || it->second->kind == FeatureDef::Kind::Chamfer || it->second->kind == FeatureDef::Kind::Pattern) {
          fail(f, "pattern source must be an extrude, revolve or hole");
          continue;
        }
        const FeatureDef& src = *it->second;
        if (!tools.count(src.id)) {
          fail(f, "source " + src.id + " did not build");
          continue;
        }
        const TopoDS_Shape tool = tools.at(src.id);
        const bool remove = src.cut || src.kind == FeatureDef::Kind::Hole;
        for (int i = 1; i < std::max(2, f.count); ++i) {
          gp_Trsf t;
          if (f.circular) t.SetRotation(gp_Ax1(gp_Pnt(f.cx, f.cy, 0), gp::DZ()), (f.angle >= 360 ? 2 * kPi / f.count : f.angle * kPi / 180 / (f.count - 1)) * i);
          else t.SetTranslation(gp_Vec(f.dx * i, f.dy * i, 0));
          TopoDS_Shape copy = BRepBuilderAPI_Transform(tool, t, true).Shape();
          TopoDS_Shape next = remove ? cut(shape, copy) : fuse(shape, copy);
          if (next.IsNull()) {
            fail(f, "instance " + std::to_string(i + 1) + " failed");
            break;
          }
          shape = next;
        }
      }
    } catch (const Standard_Failure& e) {
      fail(f, std::string("OCCT: ") + (e.GetMessageString() ? e.GetMessageString() : "failure"));
    } catch (...) {
      fail(f, "failed");
    }
  }
  return shape;
}

}  // namespace thcad::occt
