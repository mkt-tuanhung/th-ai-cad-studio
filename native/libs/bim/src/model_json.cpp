#include "thcad/bim/model_json.hpp"

namespace thcad::bim {

namespace {
std::string s(const json::Value& o, std::string_view k) {
  const json::Value* v = o.get(k);
  return v && v->str() ? *v->str() : std::string();
}
double n(const json::Value& o, std::string_view k, double d = 0) {
  const json::Value* v = o.get(k);
  return v && v->num() ? *v->num() : d;
}
const json::Array* arr(const json::Value& o, std::string_view k) {
  const json::Value* v = o.get(k);
  return v ? v->arr() : nullptr;
}
}  // namespace

std::optional<Model> modelFromJson(const json::Value& v, const Model& placements, std::string* error) {
  const json::Array *levels = arr(v, "levels"), *types = arr(v, "wallTypes"), *walls = arr(v, "walls");
  if (!levels || !types || !walls) {
    if (error) *error = "missing levels / wallTypes / walls";
    return std::nullopt;
  }
  Model m;
  for (const auto& l : *levels) m.levels.push_back({s(l, "id"), s(l, "name"), n(l, "elevation")});
  for (const auto& t : *types)
    m.wallTypes.push_back({s(t, "id"), s(t, "family"), s(t, "name"), n(t, "thickness"), s(t, "structure"), s(t, "finishExt"), s(t, "finishInt"), s(t, "description")});
  for (const auto& w : *walls) {
    Wall x{s(w, "id"), s(w, "mark"), s(w, "typeId"), s(w, "baseLevel"), n(w, "baseOffset"), s(w, "topLevel"), n(w, "topOffset"), n(w, "length")};
    if (w.get("x") && w.get("x")->num()) {
      // placed in the UI (drawn walls, and the seed walls once upgraded)
      x.x = n(w, "x");
      x.y = n(w, "y");
      x.angleDeg = n(w, "angle");
    } else if (const Wall* p = placements.wall(x.id)) {
      x.x = p->x;
      x.y = p->y;
      x.angleDeg = p->angleDeg;
    }
    m.walls.push_back(x);
  }
  auto openings = [&](std::string_view key, Opening::Cat cat, std::vector<Opening>& out) {
    if (const json::Array* a = arr(v, key))
      for (const auto& o : *a)
        out.push_back({s(o, "id"), cat, s(o, "mark"), s(o, "family"), s(o, "type"), s(o, "hostWall"), n(o, "offset"), n(o, "width"), n(o, "height"), n(o, "sill")});
  };
  openings("doors", Opening::Cat::Door, m.doors);
  openings("windows", Opening::Cat::Window, m.windows);
  if (const json::Array* a = arr(v, "rooms"))
    for (const auto& r : *a) m.rooms.push_back({s(r, "id"), s(r, "number"), s(r, "name"), s(r, "level"), n(r, "area")});
  // [[x, y], …] (P2 in ui/src/bim/model.ts)
  auto polygon = [](const json::Value* v) {
    std::vector<P2> out;
    if (const json::Array* a = v ? v->arr() : nullptr)
      for (const auto& p : *a)
        if (const json::Array* xy = p.arr(); xy && xy->size() >= 2 && (*xy)[0].num() && (*xy)[1].num()) out.push_back({*(*xy)[0].num(), *(*xy)[1].num()});
    return out;
  };
  if (const json::Array* a = arr(v, "slabs"))
    for (const auto& sl : *a) {
      Slab x;
      x.id = s(sl, "id");
      const std::string k = s(sl, "kind");
      x.kind = k == "roof" ? Slab::Kind::Roof : k == "ceiling" ? Slab::Kind::Ceiling : Slab::Kind::Floor;
      x.level = s(sl, "level");
      x.offset = n(sl, "offset");
      x.outline = polygon(sl.get("outline"));
      if (const json::Array* holes = arr(sl, "openings"))
        for (const auto& h : *holes) x.openings.push_back(polygon(&h));
      const json::Value* landing = sl.get("landing");
      x.landing = landing && landing->boolean() && *landing->boolean();
      m.slabs.push_back(std::move(x));
    }
  return m;
}

}  // namespace thcad::bim
