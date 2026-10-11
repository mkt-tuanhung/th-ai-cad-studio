#include "thcad/bim/model.hpp"

#include <algorithm>
#include <tuple>

namespace thcad::bim {

const Level* Model::level(const std::string& id) const {
  auto it = std::find_if(levels.begin(), levels.end(), [&](const Level& l) { return l.id == id; });
  return it == levels.end() ? nullptr : &*it;
}
const WallType* Model::type(const std::string& id) const {
  auto it = std::find_if(wallTypes.begin(), wallTypes.end(), [&](const WallType& t) { return t.id == id; });
  return it == wallTypes.end() ? nullptr : &*it;
}
const Wall* Model::wall(const std::string& id) const {
  auto it = std::find_if(walls.begin(), walls.end(), [&](const Wall& w) { return w.id == id; });
  return it == walls.end() ? nullptr : &*it;
}

Model villaRiverside() {
  Model m;
  m.levels = {{"L1", "Level 1", 0}, {"L2", "Level 2", 3000}, {"L3", "Level 3", 6000}, {"RF", "Roof", 9000}};
  m.wallTypes = {
      {"C200", "Basic Wall", "Generic - 200mm Concrete", 200, "Concrete - C30", "Paint - Light Gray", "Paint - White", "Exterior wall with insulation"},
      {"P150", "Basic Wall", "Generic - 150mm Partition", 150, "Masonry - AAC Block", "Paint - White", "Paint - White", "Interior partition"},
      {"I250", "Basic Wall", "Generic - 250mm Insulated Concrete", 250, "Concrete - C30 + 50mm PIR", "Paint - Light Gray", "Paint - White", "Exterior wall, improved insulation"},
  };
  const std::tuple<const char*, const char*, const char*, const char*, double> walls[] = {
      {"W1", "C200", "L1", "L2", 4250}, {"W2", "C200", "L1", "L2", 3600}, {"W3", "P150", "L1", "L2", 2800},
      {"W4", "C200", "L2", "L3", 4200}, {"W5", "C200", "L2", "L3", 3900}, {"W6", "C200", "L1", "L2", 13800},
      {"W7", "C200", "L1", "L2", 9800}, {"W8", "C200", "L1", "L2", 13800}, {"W9", "C200", "L1", "L2", 9800},
      {"W10", "P150", "L1", "L2", 3200}, {"W11", "P150", "L1", "L2", 4200}, {"W12", "P150", "L1", "L2", 3000},
      {"W13", "P150", "L1", "L2", 3600}, {"W14", "C200", "L2", "L3", 13800}, {"W15", "C200", "L2", "L3", 9800},
      {"W16", "C200", "L2", "L3", 13800}, {"W17", "C200", "L2", "L3", 9800}, {"W18", "P150", "L2", "L3", 4200},
      {"W19", "P150", "L2", "L3", 3000}, {"W20", "P150", "L2", "L3", 3600}, {"W21", "C200", "L3", "RF", 11400},
      {"W22", "C200", "L3", "RF", 7400}, {"W23", "C200", "L3", "RF", 11400}, {"W24", "C200", "L3", "RF", 7400},
  };
  for (auto [mark, type, base, top, len] : walls) m.walls.push_back({mark, mark, type, base, 0, top, 0, len});
  // Location lines (plan, mm): perimeter 13800 x 9800 on L1/L2, 11400 x 7400 penthouse on L3.
  const std::tuple<const char*, double, double, double> place[] = {
      {"W6", 0, 0, 0}, {"W7", 13800, 0, 90}, {"W8", 13800, 9800, 180}, {"W9", 0, 9800, 270},
      {"W1", 4200, 0, 90}, {"W2", 7200, 9800, 270}, {"W3", 4200, 6200, 0}, {"W10", 0, 3600, 0},
      {"W11", 9600, 0, 90}, {"W12", 9600, 4200, 0}, {"W13", 4200, 9800, 270},
      {"W14", 0, 0, 0}, {"W15", 13800, 0, 90}, {"W16", 13800, 9800, 180}, {"W17", 0, 9800, 270},
      {"W4", 4200, 0, 90}, {"W5", 9600, 9800, 270}, {"W18", 9600, 0, 90}, {"W19", 0, 4200, 0}, {"W20", 4200, 9800, 270},
      {"W21", 1200, 1200, 0}, {"W22", 12600, 1200, 90}, {"W23", 12600, 8600, 180}, {"W24", 1200, 8600, 270},
  };
  for (auto [mark, x, y, a] : place)
    for (auto& w : m.walls)
      if (w.mark == mark) { w.x = x; w.y = y; w.angleDeg = a; }
  const std::tuple<const char*, const char*, double, double> doors[] = {
      {"D1", "W6", 1200, 1000}, {"D2", "W1", 900, 900}, {"D3", "W2", 600, 900}, {"D4", "W3", 400, 800},
      {"D5", "W10", 600, 800}, {"D6", "W11", 1700, 800}, {"D7", "W12", 1100, 800}, {"D8", "W13", 1400, 800},
      {"D9", "W2", 1300, 900}, {"D10", "W18", 1700, 800}, {"D11", "W19", 1100, 800}, {"D12", "W20", 3200, 900},
  };
  int k = 0;
  for (auto [mark, host, off, w] : doors)
    m.doors.push_back({"door-" + std::to_string(++k), Opening::Cat::Door, mark, "Single-Flush", std::to_string(static_cast<int>(w)) + " x 2100mm", host, off, w, 2100, 0});
  const std::tuple<const char*, const char*, double, double> windows[] = {
      {"WN1", "W6", 3200, 1800}, {"WN2", "W6", 7400, 1800}, {"WN3", "W6", 10800, 1800}, {"WN4", "W7", 1500, 1500},
      {"WN5", "W7", 6200, 1500}, {"", "W8", 1800, 1800}, {"WN7", "W8", 6000, 2400}, {"", "W8", 10400, 1800},
      {"WN9", "W9", 2400, 1500}, {"WN10", "W14", 2400, 1800}, {"", "W14", 7400, 1800}, {"WN12", "W15", 3000, 1500},
      {"", "W16", 2000, 1800}, {"WN14", "W16", 8400, 2400}, {"WN15", "W17", 3600, 1500}, {"", "W21", 2400, 1800},
      {"WN17", "W22", 2000, 1500}, {"WN18", "W22", 3000, 1500},
  };
  k = 0;
  for (auto [mark, host, off, w] : windows)
    m.windows.push_back({"window-" + std::to_string(++k), Opening::Cat::Window, mark, "Fixed", std::to_string(static_cast<int>(w)) + " x 1500mm", host, off, w, 1500, 900});
  m.rooms = {{"room-101", "101", "Living Room", "L1", 28.6}, {"room-102", "102", "Kitchen", "L1", 12.8}, {"room-103", "103", "Bedroom 1", "L1", 14.5},
             {"room-104", "104", "Bedroom 2", "L1", 13.2}, {"room-105", "105", "Bath", "L1", 5.2}, {"room-106", "106", "Terrace", "L1", 12.0},
             {"room-201", "201", "Master Bedroom", "L2", 22.4}, {"room-202", "202", "Family Room", "L2", 26.0}};
  return m;
}

double wallHeight(const Model& m, const Wall& w) {
  const Level* b = m.level(w.baseLevel);
  const Level* t = m.level(w.topLevel);
  return ((t ? t->elevation : 0) + w.topOffset) - ((b ? b->elevation : 0) + w.baseOffset);
}
double wallArea(const Model& m, const Wall& w) { return w.length * wallHeight(m, w) / 1e6; }
double wallVolume(const Model& m, const Wall& w) {
  const WallType* t = m.type(w.typeId);
  return wallArea(m, w) * (t ? t->thickness : 0) / 1000;
}

std::vector<CheckResult> runModelChecks(const Model& m) {
  using K = CheckResult::Key;
  using S = CheckResult::Status;
  CheckResult health{K::Health, S::Ok, {}}, clash{K::Clash, S::Ok, {}}, standards{K::Standards, S::Ok, {}}, rooms{K::Rooms, S::Ok, {}}, params{K::Params, S::Ok, {}};
  for (const auto& w : m.walls) {
    if (wallHeight(m, w) <= 0) health.messages.push_back(w.mark + ": top constraint is not above base");
    if (w.length <= 0) health.messages.push_back(w.mark + ": zero length");
    const WallType* t = m.type(w.typeId);
    if (!t || t->structure.empty()) params.messages.push_back(w.mark + ": structure material missing");
  }
  std::vector<const Opening*> openings;
  for (const auto& o : m.doors) openings.push_back(&o);
  for (const auto& o : m.windows) openings.push_back(&o);
  auto label = [](const Opening* o) { return o->mark.empty() ? o->id : o->mark; };
  for (const Opening* o : openings) {
    const Wall* host = m.wall(o->hostWall);
    if (!host) { health.messages.push_back(label(o) + ": host wall missing"); continue; }
    if (o->offset < 0 || o->offset + o->width > host->length) clash.messages.push_back(label(o) + " extends beyond host wall " + host->mark);
  }
  for (size_t i = 0; i < openings.size(); ++i)
    for (size_t j = i + 1; j < openings.size(); ++j) {
      const Opening *a = openings[i], *b = openings[j];
      if (a->hostWall != b->hostWall) continue;
      const bool ox = a->offset < b->offset + b->width && b->offset < a->offset + a->width;
      const bool oy = a->sill < b->sill + b->height && b->sill < a->sill + a->height;
      if (ox && oy) clash.messages.push_back(label(a) + " <-> " + label(b) + " overlap on " + a->hostWall);
    }
  for (const Opening* o : openings)
    if (o->mark.empty()) standards.messages.push_back(std::string(o->category == Opening::Cat::Door ? "Door" : "Window") + " on " + o->hostWall + " has no Mark");
  for (const auto& r : m.rooms)
    if (!m.level(r.level) || !(r.area > 0)) rooms.messages.push_back("Room " + r.number + " not placed");
  health.status = health.count() ? S::Error : S::Ok;
  clash.status = clash.count() ? S::Error : S::Ok;
  standards.status = standards.count() ? S::Warning : S::Ok;
  rooms.status = rooms.count() ? S::Warning : S::Ok;
  params.status = params.count() ? S::Warning : S::Ok;
  return {health, clash, standards, rooms, params};
}

}  // namespace thcad::bim
