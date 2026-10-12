#include "thcad/core/dxf.hpp"

#include "number.hpp"

#include <charconv>
#include <cmath>
#include <numbers>
#include <set>
#include <sstream>
#include <vector>

namespace thcad {

namespace {

template <class... Ts>
struct overloaded : Ts... { using Ts::operator()...; };

constexpr double kDeg = 180.0 / std::numbers::pi;

std::string fmt(double v) {
  if (v == std::floor(v) && std::abs(v) < 1e15) return std::to_string(static_cast<long long>(v));
  char buf[32];
  std::snprintf(buf, sizeof buf, "%.6f", v);
  return buf;
}

int aci(const std::string& hex) {
  if (hex == "#0f766e") return 4;
  if (hex == "#2563eb") return 5;
  if (hex == "#6b7280" || hex == "#3f4654") return 8;
  if (hex == "#9aa1ab" || hex == "#9ca3af") return 9;
  return 7;
}

struct Writer {
  std::ostringstream o;
  void g(int code, const std::string& v) {
    char c[8];
    std::snprintf(c, sizeof c, "%3d", code);
    o << c << "\r\n" << v << "\r\n";
  }
  void g(int code, double v) { g(code, fmt(v)); }
  void pt(int base, Vec2 p) { g(base, p.x); g(base + 10, p.y); g(base + 20, 0.0); }
};

}  // namespace

std::string toDxf(const Document& doc) {
  Writer w;
  w.g(999, "MD CAD AI STUDIO native export — " + doc.name);
  w.g(0, "SECTION"); w.g(2, "HEADER"); w.g(9, "$ACADVER"); w.g(1, "AC1009"); w.g(9, "$INSUNITS"); w.g(70, 4.0); w.g(0, "ENDSEC");
  w.g(0, "SECTION"); w.g(2, "TABLES"); w.g(0, "TABLE"); w.g(2, "LAYER"); w.g(70, static_cast<double>(doc.layers.size()));
  for (const auto& l : doc.layers) {
    w.g(0, "LAYER"); w.g(2, l.name); w.g(70, l.locked ? 4.0 : 0.0); w.g(62, static_cast<double>(aci(l.color) * (l.visible ? 1 : -1)));
    w.g(6, l.linetype == Linetype::Dashed ? "DASHED" : l.linetype == Linetype::DashDot ? "DASHDOT" : "CONTINUOUS");
  }
  w.g(0, "ENDTAB"); w.g(0, "ENDSEC");
  w.g(0, "SECTION"); w.g(2, "ENTITIES");
  for (const auto& e : doc.entities) {
    auto head = [&](const char* t) { w.g(0, t); w.g(8, e.props.layer); };
    std::visit(overloaded{
                   [&](const Line& l) { head("LINE"); w.pt(10, l.a); w.pt(11, l.b); },
                   [&](const Polyline& p) {
                     head("POLYLINE"); w.g(66, 1.0); w.g(70, p.closed ? 1.0 : 0.0);
                     for (auto q : p.points) { w.g(0, "VERTEX"); w.g(8, e.props.layer); w.pt(10, q); }
                     w.g(0, "SEQEND"); w.g(8, e.props.layer);
                   },
                   [&](const CircleE& c) { head("CIRCLE"); w.pt(10, c.center); w.g(40, c.radius); },
                   [&](const Arc& a) { head("ARC"); w.pt(10, a.center); w.g(40, a.radius); w.g(50, a.start * kDeg); w.g(51, a.end * kDeg); },
                   [&](const Text& t) {
                     head("TEXT"); w.pt(10, t.position); w.g(40, t.height); w.g(1, t.value); w.g(50, t.rotation * kDeg);
                     if (t.centered) { w.g(72, 1.0); w.pt(11, t.position); }
                   },
                   [&](const Dimension& d) {
                     // exploded, like the UI prototype (R12 dimensions need anonymous blocks)
                     const Vec2 n = perpendicular(normalized(d.b - d.a));
                     const Vec2 da = d.a + n * d.offset, db = d.b + n * d.offset;
                     for (auto [p, q] : {std::pair{d.a, da}, std::pair{d.b, db}, std::pair{da, db}}) { head("LINE"); w.pt(10, p); w.pt(11, q); }
                     head("TEXT"); w.pt(10, midpoint(da, db)); w.g(40, d.textHeight);
                     w.g(1, d.override_.value_or(fmt(std::round(distance(d.a, d.b)))));
                     w.g(72, 1.0); w.pt(11, midpoint(da, db));
                   },
               },
               e.shape);
  }
  w.g(0, "ENDSEC"); w.g(0, "EOF");
  return w.o.str();
}

DxfImport fromDxf(std::string_view text, std::string name) {
  std::vector<std::pair<int, std::string>> pairs;
  {
    std::vector<std::string> lines;
    size_t s = 0;
    while (s <= text.size()) {
      size_t e = text.find('\n', s);
      if (e == std::string_view::npos) e = text.size();
      std::string l(text.substr(s, e - s));
      while (!l.empty() && (l.back() == '\r' || l.back() == ' ')) l.pop_back();
      size_t f = l.find_first_not_of(' ');
      lines.push_back(f == std::string::npos ? "" : l.substr(f));
      s = e + 1;
    }
    for (size_t i = 0; i + 1 < lines.size(); i += 2) {
      int code = 0;
      std::from_chars(lines[i].data(), lines[i].data() + lines[i].size(), code);
      pairs.emplace_back(code, lines[i + 1]);
    }
  }
  DxfImport out{Document::blank(std::move(name)), {}};
  std::set<std::string> knownLayers;
  for (const auto& l : out.document.layers) knownLayers.insert(l.name);
  size_t i = 0;
  for (; i + 1 < pairs.size(); ++i)
    if (pairs[i].first == 0 && pairs[i].second == "SECTION" && pairs[i + 1].second == "ENTITIES") break;
  if (i + 1 >= pairs.size()) return out;
  i += 2;
  int seq = 0;
  auto num = [](const std::vector<std::pair<int, std::string>>& props, int code, double def = 0) {
    for (const auto& [c, v] : props)
      if (c == code) return detail::parseDouble(v).value_or(std::pair{def, 0}).first;
    return def;
  };
  auto str = [](const std::vector<std::pair<int, std::string>>& props, int code, std::string def = "") {
    for (const auto& [c, v] : props)
      if (c == code) return v;
    return def;
  };
  while (i < pairs.size() && !(pairs[i].first == 0 && pairs[i].second == "ENDSEC")) {
    const std::string type = pairs[i].second;
    std::vector<std::pair<int, std::string>> props;
    ++i;
    while (i < pairs.size() && pairs[i].first != 0) props.push_back(pairs[i++]);
    Entity e;
    e.props.id = "dxf-" + std::to_string(++seq);
    e.props.layer = str(props, 8, "0");
    bool ok = true;
    if (type == "LINE") e.shape = Line{{num(props, 10), num(props, 20)}, {num(props, 11), num(props, 21)}};
    else if (type == "CIRCLE") e.shape = CircleE{{num(props, 10), num(props, 20)}, num(props, 40)};
    else if (type == "ARC") e.shape = Arc{{num(props, 10), num(props, 20)}, num(props, 40), num(props, 50) / kDeg, num(props, 51) / kDeg};
    else if (type == "TEXT" || type == "MTEXT")
      e.shape = Text{{num(props, 10), num(props, 20)}, num(props, 40, 250), str(props, 1), num(props, 50) / kDeg, num(props, 72) == 1};
    else if (type == "LWPOLYLINE") {
      Polyline p;
      std::vector<double> xs, ys;
      for (const auto& [c, v] : props) {
        if (c == 10) xs.push_back(detail::parseDouble(v).value_or(std::pair{0.0, 0}).first);
        if (c == 20) ys.push_back(detail::parseDouble(v).value_or(std::pair{0.0, 0}).first);
      }
      for (size_t k = 0; k < xs.size() && k < ys.size(); ++k) p.points.push_back({xs[k], ys[k]});
      p.closed = (static_cast<int>(num(props, 70)) & 1) == 1;
      e.shape = p;
    } else if (type == "POLYLINE") {
      Polyline p;
      p.closed = (static_cast<int>(num(props, 70)) & 1) == 1;
      while (i < pairs.size() && pairs[i].second == "VERTEX") {
        ++i;
        std::vector<std::pair<int, std::string>> vp;
        while (i < pairs.size() && pairs[i].first != 0) vp.push_back(pairs[i++]);
        p.points.push_back({num(vp, 10), num(vp, 20)});
      }
      if (i < pairs.size() && pairs[i].second == "SEQEND") {
        ++i;
        while (i < pairs.size() && pairs[i].first != 0) ++i;
      }
      e.shape = p;
    } else {
      ++out.skipped[type];
      ok = false;
    }
    if (ok) {
      if (!knownLayers.contains(e.props.layer)) {
        out.document.layers.push_back({e.props.layer});
        knownLayers.insert(e.props.layer);
      }
      out.document.entities.push_back(std::move(e));
    }
  }
  return out;
}

}  // namespace thcad
