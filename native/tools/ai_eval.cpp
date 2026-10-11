// AI evaluation: real local model, requests with machine-checkable expected geometry.
// Each case runs on a fresh document; the proposal is approved only to inspect the result.
#include <chrono>
#include <cmath>
#include <numbers>
#include <cstdio>
#include <functional>
#include <string>
#include <vector>

#include "thcad/ai/assistant.hpp"

using namespace thcad;

namespace {

bool near(double a, double b, double tol = 1.0) { return std::abs(a - b) <= tol; }
bool samePt(Vec2 a, Vec2 b) { return near(a.x, b.x) && near(a.y, b.y); }

struct BBox { double x0 = 1e18, y0 = 1e18, x1 = -1e18, y1 = -1e18; };
void grow(BBox& b, Vec2 p) { b.x0 = std::min(b.x0, p.x); b.y0 = std::min(b.y0, p.y); b.x1 = std::max(b.x1, p.x); b.y1 = std::max(b.y1, p.y); }

/** Rectangle drawn either as a closed polyline or as 4 lines: bbox on `layer`. */
bool isRect(const Document& d, const std::string& layer, double x, double y, double w, double h) {
  BBox b;
  size_t n = 0;
  for (const auto& e : d.entities) {
    if (e.props.layer != layer) return false;
    if (auto* p = std::get_if<Polyline>(&e.shape)) { for (auto q : p->points) grow(b, q); n += p->points.size(); }
    else if (auto* l = std::get_if<Line>(&e.shape)) { grow(b, l->a); grow(b, l->b); n += 2; }
    else return false;
  }
  return n >= 4 && near(b.x0, x) && near(b.y0, y) && near(b.x1, x + w) && near(b.y1, y + h);
}

struct Case {
  std::string request;
  std::function<void(Document&)> setup;
  std::function<bool(const Document&)> expect;
};

std::vector<Case> cases() {
  auto none = [](Document&) {};
  auto withEntities = [](Document& d) {
    d.entities.push_back({{"e1", "A-Wall"}, Line{{0, 0}, {5000, 0}}});
    d.entities.push_back({{"e2", "A-Furniture"}, CircleE{{1000, 1000}, 400}});
    d.entities.push_back({{"e3", "A-Anno"}, Text{{200, 200}, 250, "KITCHEN"}});
  };
  return {
      {"Draw a rectangle 4000 mm by 3000 mm on layer A-Wall with its lower-left corner at 0,0.", none,
       [](const Document& d) { return isRect(d, "A-Wall", 0, 0, 4000, 3000); }},
      {"Vẽ hình chữ nhật 5000 x 4000 trên layer A-Wall, góc dưới trái tại 10000,0.", none,
       [](const Document& d) { return isRect(d, "A-Wall", 10000, 0, 5000, 4000); }},
      {"Draw a circle with radius 500 centered at 2000,1500 on layer A-Furniture.", none,
       [](const Document& d) {
         if (d.entities.size() != 1) return false;
         auto* c = std::get_if<CircleE>(&d.entities[0].shape);
         return c && d.entities[0].props.layer == "A-Furniture" && near(c->radius, 500) && samePt(c->center, {2000, 1500});
       }},
      {"Vẽ đường tròn bán kính 300, tâm tại 500,500, trên layer 0.", none,
       [](const Document& d) {
         if (d.entities.size() != 1) return false;
         auto* c = std::get_if<CircleE>(&d.entities[0].shape);
         return c && d.entities[0].props.layer == "0" && near(c->radius, 300) && samePt(c->center, {500, 500});
       }},
      {"Draw a line from 0,0 to 6000,0 on layer A-Grid.", none,
       [](const Document& d) {
         if (d.entities.size() != 1) return false;
         auto* l = std::get_if<Line>(&d.entities[0].shape);
         return l && d.entities[0].props.layer == "A-Grid" &&
                ((samePt(l->a, {0, 0}) && samePt(l->b, {6000, 0})) || (samePt(l->b, {0, 0}) && samePt(l->a, {6000, 0})));
       }},
      {"Draw a horizontal wall line 3600 mm long starting at 1000,2000 going right, on layer A-Wall.", none,
       [](const Document& d) {
         if (d.entities.size() != 1) return false;
         auto* l = std::get_if<Line>(&d.entities[0].shape);
         return l && d.entities[0].props.layer == "A-Wall" && samePt(l->a, {1000, 2000}) && samePt(l->b, {4600, 2000});
       }},
      {"Add the text BEDROOM 1 at 1000,1000 on layer A-Anno with height 250.", none,
       [](const Document& d) {
         if (d.entities.size() != 1) return false;
         auto* t = std::get_if<Text>(&d.entities[0].shape);
         return t && d.entities[0].props.layer == "A-Anno" && t->value.find("BEDROOM 1") != std::string::npos && samePt(t->position, {1000, 1000});
       }},
      {"Thêm chữ PHÒNG KHÁCH tại 2000,3000 trên layer A-Anno, cao 300.", none,
       [](const Document& d) {
         if (d.entities.size() != 1) return false;
         auto* t = std::get_if<Text>(&d.entities[0].shape);
         return t && d.entities[0].props.layer == "A-Anno" && t->value.find("PHÒNG KHÁCH") != std::string::npos && near(t->height, 300);
       }},
      {"Draw two parallel lines on layer A-Wall: from 0,0 to 5000,0 and from 0,200 to 5000,200.", none,
       [](const Document& d) {
         if (d.entities.size() != 2) return false;
         int ok = 0;
         for (const auto& e : d.entities)
           if (auto* l = std::get_if<Line>(&e.shape); l && e.props.layer == "A-Wall" && near(std::abs(l->b.x - l->a.x), 5000) && near(l->a.y, l->b.y))
             ++ok;
         return ok == 2;
       }},
      {"Draw a linear dimension between 0,0 and 4200,0 with offset 600 on layer A-Dims.", none,
       [](const Document& d) {
         if (d.entities.size() != 1) return false;
         auto* m = std::get_if<Dimension>(&d.entities[0].shape);
         return m && d.entities[0].props.layer == "A-Dims" && near(distance(m->a, m->b), 4200);
       }},
      {"Delete the circle.", withEntities,
       [](const Document& d) { return d.entities.size() == 2 && !d.findEntity("e2") && d.findEntity("e1") && d.findEntity("e3"); }},
      {"Xóa dòng chữ KITCHEN.", withEntities,
       [](const Document& d) { return d.entities.size() == 2 && !d.findEntity("e3"); }},
  };
}

/** Held-out set: written after prompt tuning was finished; never used to adjust prompts. */
std::vector<Case> holdout() {
  auto none = [](Document&) {};
  auto withEntities = [](Document& d) {
    d.entities.push_back({{"e1", "A-Wall"}, Line{{0, 0}, {5000, 0}}});
    d.entities.push_back({{"e2", "A-Furniture"}, CircleE{{1000, 1000}, 400}});
    d.entities.push_back({{"e3", "A-Anno"}, Text{{200, 200}, 250, "KITCHEN"}});
  };
  auto oneLine = [](const Document& d, const std::string& layer, Vec2 a, Vec2 b) {
    if (d.entities.size() != 1 || d.entities[0].props.layer != layer) return false;
    auto* l = std::get_if<Line>(&d.entities[0].shape);
    return l && ((samePt(l->a, a) && samePt(l->b, b)) || (samePt(l->a, b) && samePt(l->b, a)));
  };
  return {
      {"Draw a square with side 2500 on layer A-Furniture with its lower-left corner at 3000,3000.", none,
       [](const Document& d) { return isRect(d, "A-Furniture", 3000, 3000, 2500, 2500); }},
      {"Vẽ một đường thẳng đứng dài 4500 mm, bắt đầu từ 0,0 đi lên, trên layer A-Grid.", none,
       [=](const Document& d) { return oneLine(d, "A-Grid", {0, 0}, {0, 4500}); }},
      {"Place a circle of diameter 800 at 1200,600 on layer A-Furniture.", none,
       [](const Document& d) {
         if (d.entities.size() != 1) return false;
         auto* c = std::get_if<CircleE>(&d.entities[0].shape);
         return c && near(c->radius, 400) && samePt(c->center, {1200, 600});
       }},
      {"Draw a closed triangle with vertices 0,0 and 3000,0 and 1500,2000 on layer A-Wall.", none,
       [](const Document& d) {
         if (d.entities.size() != 1) return false;
         auto* p = std::get_if<Polyline>(&d.entities[0].shape);
         return p && p->points.size() == 3 && p->closed && samePt(p->points[2], {1500, 2000});
       }},
      {"Delete the line on layer A-Wall.", withEntities,
       [](const Document& d) { return d.entities.size() == 2 && !d.findEntity("e1"); }},
      {"Thêm nhãn WC cao 200 tại 4000,500 trên layer A-Anno.", none,
       [](const Document& d) {
         if (d.entities.size() != 1) return false;
         auto* t = std::get_if<Text>(&d.entities[0].shape);
         return t && t->value.find("WC") != std::string::npos && near(t->height, 200) && samePt(t->position, {4000, 500});
       }},
      {"Draw a 1200 mm line at 45 degrees starting from 2000,2000 on layer 0.", none,
       [=](const Document& d) { return oneLine(d, "0", {2000, 2000}, {2000 + 1200 / std::sqrt(2.0), 2000 + 1200 / std::sqrt(2.0)}); }},
      {"Switch the current layer to A-Door.", none, [](const Document& d) { return d.currentLayer == "A-Door" && d.entities.empty(); }},
      {"Draw a rectangle 6000 by 4000 at the origin on layer A-Wall, and a rectangle 900 by 200 with lower-left corner at 1000,0 on layer A-Door.", none,
       [](const Document& d) {
         Document w = d, dr = d;
         std::erase_if(w.entities, [](const Entity& e) { return e.props.layer != "A-Wall"; });
         std::erase_if(dr.entities, [](const Entity& e) { return e.props.layer != "A-Door"; });
         return isRect(w, "A-Wall", 0, 0, 6000, 4000) && isRect(dr, "A-Door", 1000, 0, 900, 200);
       }},
      {"Xóa hết các đối tượng trên layer A-Anno và A-Furniture.", withEntities,
       [](const Document& d) { return d.entities.size() == 1 && d.findEntity("e1"); }},
  };
}

/** Held-out set B: written after the rect/eraseWhere schema change, fixed before its first run. */
std::vector<Case> holdoutB() {
  auto none = [](Document&) {};
  auto withEntities = [](Document& d) {
    d.entities.push_back({{"e1", "A-Wall"}, Line{{0, 0}, {5000, 0}}});
    d.entities.push_back({{"e2", "A-Furniture"}, CircleE{{1000, 1000}, 400}});
    d.entities.push_back({{"e3", "A-Anno"}, Text{{200, 200}, 250, "KITCHEN"}});
    d.entities.push_back({{"e4", "A-Anno"}, Text{{900, 200}, 250, "DINING"}});
    d.entities.push_back({{"e5", "0"}, CircleE{{4000, 4000}, 100}});
  };
  auto oneLine = [](const Document& d, const std::string& layer, Vec2 a, Vec2 b) {
    if (d.entities.size() != 1 || d.entities[0].props.layer != layer) return false;
    auto* l = std::get_if<Line>(&d.entities[0].shape);
    return l && ((samePt(l->a, a) && samePt(l->b, b)) || (samePt(l->a, b) && samePt(l->b, a)));
  };
  return {
      {"Draw a rectangle 3200 wide and 2400 tall on layer A-Wall, lower-left corner at -1000,500.", none,
       [](const Document& d) { return isRect(d, "A-Wall", -1000, 500, 3200, 2400); }},
      {"Vẽ hình vuông cạnh 1200 trên layer A-Furniture, góc dưới trái tại 7000,7000.", none,
       [](const Document& d) { return isRect(d, "A-Furniture", 7000, 7000, 1200, 1200); }},
      {"Draw three circles of radius 250 on layer A-Furniture centered at 1000,1000 and 2000,1000 and 3000,1000.", none,
       [](const Document& d) {
         if (d.entities.size() != 3) return false;
         int ok = 0;
         for (const auto& e : d.entities)
           if (auto* c = std::get_if<CircleE>(&e.shape); c && near(c->radius, 250) && near(c->center.y, 1000) && e.props.layer == "A-Furniture") ++ok;
         return ok == 3;
       }},
      {"Remove all text from the drawing.", withEntities,
       [](const Document& d) { return d.entities.size() == 3 && !d.findEntity("e3") && !d.findEntity("e4"); }},
      {"Xóa tất cả đường tròn.", withEntities,
       [](const Document& d) { return d.entities.size() == 3 && !d.findEntity("e2") && !d.findEntity("e5"); }},
      {"Draw a vertical line on layer A-Grid from 4000,0 to 4000,9000.", none,
       [=](const Document& d) { return oneLine(d, "A-Grid", {4000, 0}, {4000, 9000}); }},
      {"Add the text STAIR with height 200 at 6000,3000 on layer A-Anno.", none,
       [](const Document& d) {
         if (d.entities.size() != 1) return false;
         auto* t = std::get_if<Text>(&d.entities[0].shape);
         return t && t->value.find("STAIR") != std::string::npos && near(t->height, 200) && samePt(t->position, {6000, 3000});
       }},
      {"Draw a 2500 mm line going straight down from 1000,5000 on layer A-Wall.", none,
       [=](const Document& d) { return oneLine(d, "A-Wall", {1000, 5000}, {1000, 2500}); }},
      {"Make A-Window the current layer.", none, [](const Document& d) { return d.currentLayer == "A-Window" && d.entities.empty(); }},
      {"Draw a room outline 4500 x 3600 on layer A-Wall at 0,0 and put the label BEDROOM 2 at its centre on layer A-Anno.", none,
       [](const Document& d) {
         Document w = d;
         std::erase_if(w.entities, [](const Entity& e) { return e.props.layer != "A-Wall"; });
         bool label = false;
         for (const auto& e : d.entities)
           if (auto* t = std::get_if<Text>(&e.shape); t && e.props.layer == "A-Anno" && t->value.find("BEDROOM 2") != std::string::npos)
             label = std::abs(t->position.x - 2250) < 400 && std::abs(t->position.y - 1800) < 400;
         return isRect(w, "A-Wall", 0, 0, 4500, 3600) && label;
       }},
  };
}

/** Held-out set C (12 cases): written for the 3B vs 7B comparison, fixed before its first run. */
std::vector<Case> holdoutC() {
  auto none = [](Document&) {};
  auto seeded = [](Document& d) {
    d.entities.push_back({{"e1", "A-Wall"}, Line{{0, 0}, {5000, 0}}});
    d.entities.push_back({{"e6", "A-Wall"}, Line{{0, 3000}, {5000, 3000}}});
    d.entities.push_back({{"e7", "A-Wall"}, Polyline{{{0, 0}, {800, 0}, {800, 800}, {0, 800}}, true}});
    d.entities.push_back({{"e8", "A-Grid"}, Line{{0, -500}, {0, 9000}}});
    d.entities.push_back({{"e9", "A-Anno"}, Text{{100, 100}, 250, "HALL"}});
  };
  auto only = [](const Document& d, size_t n) { return d.entities.size() == n; };
  return {
      {"Draw an arc with center 0,0 and radius 1000 from 0 to 90 degrees on layer A-Door.", none,
       [=](const Document& d) {
         if (!only(d, 1)) return false;
         auto* a = std::get_if<Arc>(&d.entities[0].shape);
         return a && near(a->radius, 1000) && samePt(a->center, {0, 0}) && std::abs(a->start) < 0.02 && std::abs(a->end - std::numbers::pi / 2) < 0.02;
       }},
      {"Vẽ đường gấp khúc hở đi qua các điểm 0,0 ; 2000,0 ; 2000,1500 ; 4000,1500 trên layer A-Wall.", none,
       [=](const Document& d) {
         if (!only(d, 1)) return false;
         auto* p = std::get_if<Polyline>(&d.entities[0].shape);
         return p && !p->closed && p->points.size() == 4 && samePt(p->points[3], {4000, 1500});
       }},
      {"Draw a horizontal dimension from 0,0 to 6000,0 with offset 800 on layer A-Dims.", none,
       [=](const Document& d) {
         if (!only(d, 1)) return false;
         auto* m = std::get_if<Dimension>(&d.entities[0].shape);
         return m && d.entities[0].props.layer == "A-Dims" && near(distance(m->a, m->b), 6000);
       }},
      {"Place two circles with diameter 600 on layer A-Furniture at 1000,2000 and 1800,2000.", none,
       [=](const Document& d) {
         if (!only(d, 2)) return false;
         for (const auto& e : d.entities)
           if (auto* c = std::get_if<CircleE>(&e.shape); !c || !near(c->radius, 300) || !near(c->center.y, 2000)) return false;
         return true;
       }},
      {"Erase all lines on layer A-Wall.", seeded,
       [=](const Document& d) { return only(d, 3) && !d.findEntity("e1") && !d.findEntity("e6") && d.findEntity("e7") && d.findEntity("e8"); }},
      {"Xóa mọi thứ trên layer A-Grid.", seeded, [=](const Document& d) { return only(d, 4) && !d.findEntity("e8"); }},
      {"Draw a rectangle 800 by 2100 on layer A-Door with its lower-left corner at 2400,0.", none,
       [](const Document& d) { return isRect(d, "A-Door", 2400, 0, 800, 2100); }},
      {"Thêm chữ PHÒNG NGỦ 3 cao 250 tại 8000,2000 trên layer A-Anno.", none,
       [=](const Document& d) {
         if (!only(d, 1)) return false;
         auto* t = std::get_if<Text>(&d.entities[0].shape);
         return t && t->value.find("PHÒNG NGỦ 3") != std::string::npos && samePt(t->position, {8000, 2000});
       }},
      {"Draw a line 3000 mm long at 30 degrees from 0,0 on layer 0.", none,
       [=](const Document& d) {
         if (!only(d, 1)) return false;
         auto* l = std::get_if<Line>(&d.entities[0].shape);
         return l && samePt(l->a, {0, 0}) && samePt(l->b, {3000 * std::cos(std::numbers::pi / 6), 1500});
       }},
      {"Draw a grid line from 0,-500 to 0,10500 on layer A-Grid and label it A with a text at 0,11000 on layer A-Anno.", none,
       [=](const Document& d) {
         bool line = false, label = false;
         for (const auto& e : d.entities) {
           if (auto* l = std::get_if<Line>(&e.shape); l && e.props.layer == "A-Grid" && near(distance(l->a, l->b), 11000)) line = true;
           if (auto* t = std::get_if<Text>(&e.shape); t && e.props.layer == "A-Anno" && t->value == "A" && distance(t->position, {0, 11000}) < 400) label = true;
         }
         return only(d, 2) && line && label;
       }},
      {"Set the current layer to A-Dims.", none, [=](const Document& d) { return d.currentLayer == "A-Dims" && only(d, 0); }},
      {"Draw a closed polyline on layer A-Furniture through 0,0 then 1000,0 then 1000,500 then 0,500.", none,
       [](const Document& d) { return isRect(d, "A-Furniture", 0, 0, 1000, 500); }},
  };
}

}  // namespace

int runAiEval(ai::Runtime& rt, bool constrainedToo, int set) {
  const auto list = set == 3 ? holdoutC() : set == 2 ? holdoutB() : set == 1 ? holdout() : cases();
  struct Score { int pass = 0, json = 0, valid = 0, retries = 0; double secs = 0, tps = 0; } s[3];
  const ai::DecodeMode order[] = {ai::DecodeMode::Hybrid, ai::DecodeMode::Constrained, ai::DecodeMode::Free};
  const char* names[] = {"hybrid (default)", "grammar-constrained", "free"};
  const int modes = constrainedToo ? 3 : 1;
  for (int mode = 0; mode < modes; ++mode) {
    std::printf("\n== %s ==\n", names[mode]);
    for (size_t i = 0; i < list.size(); ++i) {
      Document doc = Document::blank("eval.dwg");
      list[i].setup(doc);
      CommandBus bus(doc);
      ProposalQueue q(bus);
      const auto t0 = std::chrono::steady_clock::now();
      auto r = ai::requestEdit(rt, q, bus.document(), list[i].request, {order[mode], 768});
      const double secs = std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
      const bool json = !ai::extractJson(r.rawOutput).empty() && r.message.rfind("invalid JSON", 0) != 0;
      const bool valid = r.ok;
      bool pass = false;
      if (valid && !q.approve(r.proposalId)) pass = list[i].expect(bus.document());
      Score& sc = s[mode];
      sc.pass += pass; sc.json += json; sc.valid += valid; sc.secs += secs; sc.tps += rt.status().lastTokensPerSecond; sc.retries += r.retried;
      std::printf("%-4s %5.1fs%s  %s\n", pass ? "PASS" : "FAIL", secs, r.retried ? " (retry)" : "", list[i].request.c_str());
      if (!pass) std::printf("      %s\n      raw: %.300s\n", r.message.c_str(), r.rawOutput.c_str());
    }
  }
  std::printf("\n");
  for (int mode = 0; mode < modes; ++mode) {
    const Score& sc = s[mode];
    const int n = static_cast<int>(list.size());
    std::printf("%-20s correct %d/%d · valid JSON %d/%d · valid ops %d/%d · retries %d · avg %.1fs/request · avg %.1f tok/s\n",
                names[mode], sc.pass, n, sc.json, n, sc.valid, n, sc.retries, sc.secs / n, sc.tps / n);
  }
  return s[0].pass == static_cast<int>(list.size()) ? 0 : 1;
}
