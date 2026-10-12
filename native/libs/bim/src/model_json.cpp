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
  if (const json::Array* a = arr(v, "slabs"))
    for (const auto& sl : *a)
      if (const std::string k = s(sl, "kind"); k == "floor" || k == "roof") m.slabLevels.push_back(s(sl, "level"));
  return m;
}

}  // namespace thcad::bim
