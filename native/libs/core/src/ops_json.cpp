#include "thcad/core/ops_json.hpp"

#include "thcad/core/commands.hpp"

namespace thcad {

namespace {

template <class... Ts>
struct overloaded : Ts... { using Ts::operator()...; };

struct Ctx {
  std::string prefix;
  int seq = 0;
  std::string error;
};

/** [x, y] or an AutoCAD point string ("@dx,dy", "@dist<angle", "x,y") relative to `last`. */
std::optional<Vec2> point(const json::Value* v, std::optional<Vec2> last = std::nullopt) {
  if (!v) return std::nullopt;
  if (const std::string* s = v->str()) return parsePointInput(*s, last);
  // tolerate ["@dx,dy"] (a string wrapped in an array)
  if (const json::Array* a = v->arr(); a && a->size() == 1 && (*a)[0].str()) return parsePointInput(*(*a)[0].str(), last);
  const json::Array* a = v->arr();
  if (!a || a->size() != 2 || !(*a)[0].num() || !(*a)[1].num()) return std::nullopt;
  return Vec2{*(*a)[0].num(), *(*a)[1].num()};
}

double num(const json::Value& o, std::string_view k, double def) {
  const json::Value* v = o.get(k);
  return v && v->num() ? *v->num() : def;
}

std::string str(const json::Value& o, std::string_view k, std::string def) {
  const json::Value* v = o.get(k);
  return v && v->str() ? *v->str() : def;
}

std::optional<Entity> entity(const json::Value& o, Ctx& ctx) {
  Entity e;
  e.props.id = str(o, "id", ctx.prefix + "-" + std::to_string(++ctx.seq));
  e.props.layer = str(o, "layer", "0");
  e.props.color = str(o, "color", "ByLayer");
  const std::string kind = str(o, "kind", "");
  auto need = [&](std::optional<Vec2> p, const char* what) {
    if (!p) ctx.error = kind + ": missing or invalid '" + what + "'";
    return p.value_or(Vec2{});
  };
  if (kind == "line") {
    const Vec2 a = need(point(o.get("a")), "a");
    e.shape = Line{a, need(point(o.get("b"), a), "b")};
  }
  else if (kind == "rect") {
    // convenience kind: corner + width + height → closed polyline (the engine does the arithmetic)
    const Vec2 c = need(point(o.get("corner")), "corner");
    const double w = num(o, "width", 0), h = num(o, "height", 0);
    e.shape = Polyline{{c, {c.x + w, c.y}, {c.x + w, c.y + h}, {c.x, c.y + h}}, true};
  } else if (kind == "circle") e.shape = CircleE{need(point(o.get("center")), "center"), num(o, "radius", 0)};
  else if (kind == "arc") {
    // AI-facing schema uses degrees (AutoCAD convention): startDeg / endDeg; the internal wire uses radians
    constexpr double k = 3.14159265358979323846 / 180.0;
    const bool deg = o.get("startDeg") || o.get("endDeg");
    e.shape = Arc{need(point(o.get("center")), "center"), num(o, "radius", 0), deg ? num(o, "startDeg", 0) * k : num(o, "start", 0),
                  deg ? num(o, "endDeg", 0) * k : num(o, "end", 0)};
  }
  else if (kind == "text") {
    const json::Value* c = o.get("centered");
    e.shape = Text{need(point(o.get("position")), "position"), num(o, "height", 250), str(o, "value", ""), num(o, "rotation", 0), c && c->boolean() && *c->boolean()};
  } else if (kind == "dimension") {
    const Vec2 a = need(point(o.get("a")), "a");
    Dimension d{a, need(point(o.get("b"), a), "b"), num(o, "offset", 0), std::nullopt, num(o, "textHeight", 250)};
    if (const json::Value* ov = o.get("override"); ov && ov->str()) d.override_ = *ov->str();
    e.shape = d;
  } else if (kind == "polyline") {
    Polyline p;
    const json::Value* pts = o.get("points");
    if (!pts || !pts->arr()) ctx.error = "polyline: missing 'points'";
    else
      for (const auto& q : *pts->arr())
        p.points.push_back(need(point(&q, p.points.empty() ? std::nullopt : std::optional<Vec2>(p.points.back())), "points[]"));
    const json::Value* c = o.get("closed");
    p.closed = c && c->boolean() && *c->boolean();
    // normalise a closed polyline that repeats its first vertex (AutoCAD stores it once)
    if (p.closed && p.points.size() > 3 && distance(p.points.front(), p.points.back()) < 1e-6) p.points.pop_back();
    e.shape = p;
  } else {
    ctx.error = "unknown entity kind '" + kind + "'";
  }
  if (!ctx.error.empty()) return std::nullopt;
  return e;
}

std::optional<CadOp> op(const json::Value& o, Ctx& ctx) {
  if (!o.obj()) { ctx.error = "op must be an object"; return std::nullopt; }
  const std::string type = str(o, "type", "");
  CadOp out;
  out.label = str(o, "label", type);
  auto entities = [&]() {
    std::vector<Entity> list;
    const json::Value* es = o.get("entities");
    if (!es || !es->arr()) { ctx.error = type + ": missing 'entities'"; return list; }
    for (const auto& ev : *es->arr()) {
      auto e = entity(ev, ctx);
      if (!e) break;
      list.push_back(std::move(*e));
    }
    return list;
  };
  if (type == "add") out.body = OpAdd{entities()};
  else if (type == "replace") out.body = OpReplace{entities()};
  else if (type == "erase") {
    OpErase er;
    if (const json::Value* ids = o.get("ids"); ids && ids->arr())
      for (const auto& i : *ids->arr())
        if (i.str()) er.ids.push_back(*i.str());
    if (er.ids.empty()) ctx.error = "erase: missing 'ids'";
    out.body = er;
  } else if (type == "eraseWhere") {
    OpEraseWhere f;
    for (const char* k : {"layers", "kinds"})
      if (const json::Value* a = o.get(k); a && a->arr())
        for (const auto& x : *a->arr())
          if (x.str()) (std::string(k) == "layers" ? f.layers : f.kinds).push_back(*x.str());
    out.body = f;
  } else if (type == "setCurrentLayer") out.body = OpSetCurrentLayer{str(o, "layer", "")};
  else if (type == "layerProps") {
    OpLayerProps p{str(o, "name", ""), {}, {}, {}};
    if (auto v = o.get("visible"); v && v->boolean()) p.visible = *v->boolean();
    if (auto v = o.get("locked"); v && v->boolean()) p.locked = *v->boolean();
    if (auto v = o.get("color"); v && v->str()) p.color = *v->str();
    out.body = p;
  } else ctx.error = "unknown op type '" + type + "'";
  if (!ctx.error.empty()) return std::nullopt;
  return out;
}

json::Value pt(Vec2 p) { return json::Array{p.x, p.y}; }

}  // namespace

std::variant<std::vector<CadOp>, OpsParseError> opsFromJson(const json::Value& v, std::string idPrefix) {
  Ctx ctx{std::move(idPrefix), 0, {}};
  const json::Value* list = &v;
  if (const json::Value* ops = v.get("ops")) list = ops;
  std::vector<CadOp> out;
  if (const json::Array* a = list->arr()) {
    for (const auto& o : *a) {
      auto parsed = op(o, ctx);
      if (!parsed) return OpsParseError{ctx.error};
      out.push_back(std::move(*parsed));
    }
  } else {
    auto parsed = op(*list, ctx);
    if (!parsed) return OpsParseError{ctx.error};
    out.push_back(std::move(*parsed));
  }
  if (out.empty()) return OpsParseError{"no ops"};
  return out;
}

json::Value entityToJson(const Entity& e) {
  json::Object o{{"id", e.props.id}, {"layer", e.props.layer}, {"color", e.props.color}, {"kind", kindName(e.shape)}};
  std::visit(overloaded{
                 [&](const Line& l) { o["a"] = pt(l.a); o["b"] = pt(l.b); },
                 [&](const Polyline& p) {
                   json::Array pts;
                   for (auto q : p.points) pts.push_back(pt(q));
                   o["points"] = pts;
                   o["closed"] = p.closed;
                 },
                 [&](const CircleE& c) { o["center"] = pt(c.center); o["radius"] = c.radius; },
                 [&](const Arc& a) { o["center"] = pt(a.center); o["radius"] = a.radius; o["start"] = a.start; o["end"] = a.end; },
                 [&](const Text& t) { o["position"] = pt(t.position); o["height"] = t.height; o["value"] = t.value; o["rotation"] = t.rotation; o["centered"] = t.centered; },
                 [&](const Dimension& d) {
                   o["a"] = pt(d.a); o["b"] = pt(d.b); o["offset"] = d.offset; o["textHeight"] = d.textHeight;
                   o["override"] = d.override_ ? json::Value(*d.override_) : json::Value(nullptr);
                 },
             },
             e.shape);
  return o;
}

json::Value documentToJson(const Document& d) {
  json::Array ents, layers;
  for (const auto& e : d.entities) ents.push_back(entityToJson(e));
  for (const auto& l : d.layers) layers.push_back(json::Object{{"name", l.name}, {"color", l.color}, {"visible", l.visible}, {"locked", l.locked}});
  return json::Object{{"id", d.id}, {"name", d.name}, {"currentLayer", d.currentLayer}, {"dirty", d.dirty}, {"entities", ents}, {"layers", layers}};
}

}  // namespace thcad

namespace thcad {

std::variant<Document, OpsParseError> documentFromJson(const json::Value& v) {
  Document d;
  d.id = str(v, "id", "doc");
  d.name = str(v, "name", "Drawing.dwg");
  d.currentLayer = str(v, "currentLayer", "0");
  if (const json::Value* ls = v.get("layers"); ls && ls->arr())
    for (const auto& l : *ls->arr()) {
      Layer layer{str(l, "name", "0"), str(l, "color", "#1f2937")};
      if (auto b = l.get("visible"); b && b->boolean()) layer.visible = *b->boolean();
      if (auto b = l.get("locked"); b && b->boolean()) layer.locked = *b->boolean();
      d.layers.push_back(layer);
    }
  if (d.layers.empty()) d.layers = defaultLayers();
  Ctx ctx{"doc", 0, {}};
  if (const json::Value* es = v.get("entities"); es && es->arr())
    for (const auto& e : *es->arr()) {
      auto ent = entity(e, ctx);
      if (!ent) return OpsParseError{ctx.error};
      d.entities.push_back(std::move(*ent));
    }
  return d;
}

json::Value opsToJson(const std::vector<CadOp>& ops) {
  json::Array out;
  for (const auto& op : ops) {
    json::Object o{{"label", op.label}};
    std::visit(overloaded{
                   [&](const OpAdd& a) {
                     json::Array es;
                     for (const auto& e : a.entities) es.push_back(entityToJson(e));
                     o["type"] = "add"; o["entities"] = es;
                   },
                   [&](const OpReplace& a) {
                     json::Array es;
                     for (const auto& e : a.entities) es.push_back(entityToJson(e));
                     o["type"] = "replace"; o["entities"] = es;
                   },
                   [&](const OpErase& e) {
                     json::Array ids;
                     for (const auto& i : e.ids) ids.push_back(i);
                     o["type"] = "erase"; o["ids"] = ids;
                   },
                   [&](const OpSetCurrentLayer& s) { o["type"] = "setCurrentLayer"; o["layer"] = s.layer; },
                   [&](const OpLayerProps& p) { o["type"] = "layerProps"; o["name"] = p.name; },
                   [&](const OpEraseWhere& f) {
                     json::Array l, k;
                     for (const auto& x : f.layers) l.push_back(x);
                     for (const auto& x : f.kinds) k.push_back(x);
                     o["type"] = "eraseWhere"; o["layers"] = l; o["kinds"] = k;
                   },
               },
               op.body);
    out.push_back(o);
  }
  return out;
}

}  // namespace thcad
