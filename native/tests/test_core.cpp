#include "check.hpp"
#include "thcad/core/checks.hpp"
#include "thcad/core/command_bus.hpp"
#include "thcad/core/commands.hpp"
#include "thcad/core/dxf.hpp"
#include "thcad/core/ops_json.hpp"
#include "thcad/core/proposal.hpp"

#include <unordered_set>

using namespace thcad;

static Entity line(std::string id, Vec2 a, Vec2 b, std::string layer = "0") { return {{std::move(id), std::move(layer)}, Line{a, b}}; }

TEST("command table resolves AutoCAD aliases and prefixes") {
  CHECK(resolveCommand("l")->name == "LINE");
  CHECK(resolveCommand("_LINE")->name == "LINE");
  CHECK(resolveCommand("rec")->name == "RECTANG");
  CHECK(resolveCommand("Dim")->name == "DIMLINEAR");
  CHECK(resolveCommand(".erase")->name == "ERASE");
  CHECK(resolveCommand("TR")->status == CommandStatus::Native);
  CHECK(resolveCommand("FOO") == nullptr);
}

TEST("point input: absolute, relative, polar") {
  auto a = parsePointInput("100,200", std::nullopt);
  CHECK(a && a->x == 100 && a->y == 200);
  auto r = parsePointInput("@50,-20", Vec2{100, 200});
  CHECK(r && r->x == 150 && r->y == 180);
  auto p = parsePointInput("@1000<90", Vec2{0, 0});
  CHECK(p && std::abs(p->x) < 1e-9 && std::abs(p->y - 1000) < 1e-9);
  CHECK(!parsePointInput("@5,5", std::nullopt));
  CHECK(!parsePointInput("abc", std::nullopt));
}

TEST("command bus: commit, undo, redo") {
  CommandBus bus(Document::blank("t"));
  CHECK(!bus.execute({OpAdd{{line("a", {0, 0}, {10, 0})}}, "LINE"}));
  CHECK(!bus.execute({OpAdd{{line("b", {0, 0}, {0, 10})}}, "LINE"}));
  CHECK(bus.document().entities.size() == 2);
  CHECK(bus.undo() == std::optional<std::string>("LINE"));
  CHECK(bus.document().entities.size() == 1);
  CHECK(bus.redo().has_value());
  CHECK(bus.document().entities.size() == 2);
  CHECK(!bus.execute({OpErase{{"a"}}, "ERASE"}));
  CHECK(!bus.canRedo());
  CHECK(bus.document().entities.size() == 1);
}

TEST("validation: locked layer, degenerate geometry, unknown entity/layer") {
  CommandBus bus(Document::blank("t"));
  CHECK(!bus.execute({OpLayerProps{"A-Wall", std::nullopt, true, std::nullopt}, "LOCK"}));
  auto e1 = bus.execute({OpAdd{{line("x", {0, 0}, {1, 0}, "A-Wall")}}, "LINE"});
  CHECK(e1 && e1->code == ErrorCode::LockedLayer);
  auto e2 = bus.execute({OpAdd{{line("y", {5, 5}, {5, 5})}}, "LINE"});
  CHECK(e2 && e2->code == ErrorCode::Degenerate);
  auto e3 = bus.execute({OpErase{{"nope"}}, "ERASE"});
  CHECK(e3 && e3->code == ErrorCode::UnknownEntity);
  auto e4 = bus.execute({OpSetCurrentLayer{"Z-Missing"}, "CLAYER"});
  CHECK(e4 && e4->code == ErrorCode::UnknownLayer);
  CHECK(bus.document().entities.empty());
}

TEST("batch is atomic: one invalid op commits nothing") {
  CommandBus bus(Document::blank("t"));
  auto err = bus.executeBatch({{OpAdd{{line("a", {0, 0}, {1, 0})}}, "LINE"}, {OpErase{{"missing"}}, "ERASE"}}, "batch");
  CHECK(err.has_value());
  CHECK(bus.document().entities.empty());
  CHECK(!bus.canUndo());
}

TEST("ops JSON: parse add/erase, generated ids, errors") {
  auto v = std::get<json::Value>(json::parse(R"({"ops":[{"type":"add","entities":[{"kind":"line","layer":"A-Wall","a":[0,0],"b":[1000,0]},{"kind":"circle","center":[0,0],"radius":5}]},{"type":"setCurrentLayer","layer":"A-Door"}]})"));
  auto ops = std::get<std::vector<CadOp>>(opsFromJson(v, "t"));
  CHECK(ops.size() == 2);
  const auto& add = std::get<OpAdd>(ops[0].body);
  CHECK(add.entities.size() == 2 && add.entities[0].props.id == "t-1" && add.entities[0].props.layer == "A-Wall");
  auto bad = opsFromJson(std::get<json::Value>(json::parse(R"({"type":"add","entities":[{"kind":"spline"}]})")));
  CHECK(std::holds_alternative<OpsParseError>(bad));
  CHECK(std::holds_alternative<json::ParseError>(json::parse("{\"a\":}")));
}

TEST("JSON round trip with unicode") {
  auto v = std::get<json::Value>(json::parse(R"({"s":"Phòng họp é","n":[1,2.5,-3e2],"b":true,"z":null})"));
  CHECK(*v.get("s")->str() == "Phòng họp é");
  auto again = std::get<json::Value>(json::parse(json::stringify(v)));
  CHECK(json::stringify(again) == json::stringify(v));
  CHECK(*(*v.get("n")->arr())[2].num() == -300);
}

TEST("proposal queue: preview does not mutate; approve = one undo step; reject") {
  CommandBus bus(Document::blank("t"));
  ProposalQueue q(bus);
  const auto& p = q.propose("two lines", "ai:test", {{OpAdd{{line("a", {0, 0}, {1, 0}), line("b", {0, 0}, {0, 1})}}, "add"}});
  const std::string id = p.id;
  CHECK(p.status == ProposalStatus::Pending);
  CHECK(p.diff.added == 2);
  CHECK(bus.document().entities.empty());  // nothing committed by propose()
  CHECK(!q.approve(id));
  CHECK(bus.document().entities.size() == 2);
  CHECK(bus.undo() == std::optional<std::string>("AI: two lines"));
  CHECK(bus.document().entities.empty());
  const auto& p2 = q.propose("erase", "ai:test", {{OpErase{{"ghost"}}, "erase"}});
  CHECK(p2.status == ProposalStatus::Invalid);
  const std::string id3 = q.propose("one", "ai:test", {{OpAdd{{line("c", {0, 0}, {2, 0})}}, "add"}}).id;
  CHECK(q.reject(id3));
  CHECK(q.approve(id3).has_value());  // rejected proposals cannot be approved
}

TEST("approve re-validates against the current document") {
  CommandBus bus(Document::blank("t"));
  CHECK(!bus.execute({OpAdd{{line("a", {0, 0}, {1, 0})}}, "LINE"}));
  ProposalQueue q(bus);
  const std::string id = q.propose("erase a", "ai:test", {{OpErase{{"a"}}, "erase"}}).id;
  CHECK(!bus.execute({OpErase{{"a"}}, "ERASE"}));  // user erased it meanwhile
  CHECK(q.approve(id).has_value());
  CHECK(q.find(id)->status == ProposalStatus::Invalid);
}

TEST("DXF R12 round trip keeps geometry and layers") {
  CommandBus bus(Document::blank("rt"));
  Polyline pl{{{0, 0}, {1000, 0}, {1000, 500}, {0, 500}}, true};
  CHECK(!bus.execute({OpAdd{{line("l", {0, 0}, {3000, 0}, "A-Wall"), {{"p", "A-Wall"}, pl}, {{"c", "0"}, CircleE{{5, 5}, 750}}, {{"t", "A-Anno"}, Text{{1, 2}, 250, "BEDROOM 1"}}}}, "add"}));
  const std::string dxf = toDxf(bus.document());
  CHECK(dxf.find("AC1009") != std::string::npos);
  auto imp = fromDxf(dxf, "rt.dxf");
  CHECK(imp.document.entities.size() == 4);
  const auto* c = std::get_if<CircleE>(&imp.document.entities[2].shape);
  CHECK(c && c->radius == 750);
  const auto* p = std::get_if<Polyline>(&imp.document.entities[1].shape);
  CHECK(p && p->closed && p->points.size() == 4);
  CHECK(std::get<Text>(imp.document.entities[3].shape).value == "BEDROOM 1");
  CHECK(imp.document.entities[0].props.layer == "A-Wall");
}

TEST("checks flag dimension text that disagrees with geometry") {
  Document d = Document::blank("t");
  d.entities.push_back({{"d1", "A-Dims"}, Dimension{{0, 0}, {3000, 0}, 0, std::string("3000"), 250}});
  d.entities.push_back({{"d2", "A-Dims"}, Dimension{{0, 0}, {3000, 0}, 0, std::string("3200"), 250}});
  auto f = runChecks(d);
  CHECK(f.size() == 1 && f[0].entityId == "d2");
}

TEST("ops JSON: AutoCAD relative points are resolved by the engine") {
  auto v = std::get<json::Value>(json::parse(R"({"type":"add","entities":[{"kind":"line","layer":"0","a":[1000,2000],"b":"@3600<0"},{"kind":"polyline","layer":"0","points":[[0,0],"@4000,0","@0,3000","@-4000,0"],"closed":true}]})"));
  auto ops = std::get<std::vector<CadOp>>(opsFromJson(v));
  const auto& add = std::get<OpAdd>(ops[0].body);
  const auto& l = std::get<Line>(add.entities[0].shape);
  CHECK(std::abs(l.b.x - 4600) < 1e-9 && std::abs(l.b.y - 2000) < 1e-9);
  const auto& p = std::get<Polyline>(add.entities[1].shape);
  CHECK(p.points.size() == 4 && p.points[2].x == 4000 && p.points[2].y == 3000 && p.points[3].x == 0);
}

TEST("closed polyline repeating its first vertex is normalised") {
  auto v = std::get<json::Value>(json::parse(R"({"type":"add","entities":[{"kind":"polyline","layer":"0","points":[[0,0],[3000,0],[1500,2000],[0,0]],"closed":true}]})"));
  auto ops = std::get<std::vector<CadOp>>(opsFromJson(v));
  CHECK(std::get<Polyline>(std::get<OpAdd>(ops[0].body).entities[0].shape).points.size() == 3);
}

TEST("proposal re-ids added entities that collide with the drawing") {
  CommandBus bus(Document::blank("t"));
  CHECK(!bus.execute({OpAdd{{line("ai-1", {0, 0}, {1, 0})}}, "LINE"}));
  ProposalQueue q(bus);
  const std::string id = q.propose("dup", "ai:test", {{OpAdd{{line("ai-1", {0, 5}, {1, 5}), line("ai-1", {0, 9}, {1, 9})}}, "add"}}).id;
  CHECK(q.find(id)->diff.added == 2);
  CHECK(!q.approve(id));
  std::unordered_set<std::string> ids;
  for (const auto& e : bus.document().entities) ids.insert(e.id());
  CHECK(ids.size() == 3);
}

TEST("diff counts correctly when the drawing already has duplicate ids") {
  Document a = Document::blank("t");
  a.entities.push_back(line("ai-1", {0, 0}, {1, 0}));
  a.entities.push_back(line("ai-1", {0, 0}, {1, 0}));
  a.entities.push_back(line("ai-1", {0, 5}, {1, 5}));
  Document b = a;
  b.entities.push_back(line("new", {0, 9}, {1, 9}));
  auto d = diff(a, b);
  CHECK(d.added == 1 && d.erased == 0 && d.modified == 0);
}

TEST("rect kind and eraseWhere filter are resolved by the engine") {
  CommandBus bus(Document::blank("t"));
  auto v = std::get<json::Value>(json::parse(R"({"ops":[{"type":"add","entities":[{"kind":"rect","layer":"A-Wall","corner":[1000,0],"width":900,"height":200},{"kind":"circle","layer":"A-Furniture","center":[0,0],"radius":5},{"kind":"text","layer":"A-Anno","position":[0,0],"value":"X"}]}]})"));
  auto ops = std::get<std::vector<CadOp>>(opsFromJson(v));
  CHECK(!bus.executeBatch(ops, "add"));
  const auto& r = std::get<Polyline>(bus.document().entities[0].shape);
  CHECK(r.closed && r.points[2].x == 1900 && r.points[2].y == 200);
  ProposalQueue q(bus);
  auto w = std::get<json::Value>(json::parse(R"({"type":"eraseWhere","layers":["A-Anno","A-Furniture"],"kinds":[]})"));
  const auto& p = q.propose("erase", "ai:test", std::get<std::vector<CadOp>>(opsFromJson(w)));
  CHECK(p.status == ProposalStatus::Pending && p.diff.erased == 2);
  CHECK(std::holds_alternative<OpErase>(p.ops[0].body));  // resolved to explicit ids for the preview
  auto none = std::get<json::Value>(json::parse(R"({"type":"eraseWhere","layers":["A-Door"],"kinds":[]})"));
  CHECK(q.propose("none", "ai:test", std::get<std::vector<CadOp>>(opsFromJson(none))).status == ProposalStatus::Invalid);
}

TEST("arc angles in degrees (AI schema) are converted to radians") {
  auto v = std::get<json::Value>(json::parse(R"({"type":"add","entities":[{"kind":"arc","layer":"0","center":[0,0],"radius":1000,"startDeg":0,"endDeg":90}]})"));
  const auto ops = std::get<std::vector<CadOp>>(opsFromJson(v));  // keep the ops alive (no dangling ref)
  const auto& a = std::get<Arc>(std::get<OpAdd>(ops[0].body).entities[0].shape);
  CHECK(std::abs(a.end - 1.5707963267948966) < 1e-12);
}

TEST("addLayer creates a missing layer once (LAYER Make) and entities can then use it") {
  CommandBus bus(Document::blank("t"));
  CHECK(!bus.execute({OpAddLayer{"A-FURN-FIXT", "#1f2937"}, "LAYER"}));
  CHECK(!bus.execute({OpAddLayer{"A-FURN-FIXT", "#ff0000"}, "LAYER"}));  // idempotent
  size_t n = 0;
  for (const auto& l : bus.document().layers) n += l.name == "A-FURN-FIXT";
  CHECK(n == 1);
  CHECK(!bus.execute({OpAdd{{{{"s1", "A-FURN-FIXT"}, Line{{0, 0}, {100, 0}}}}}, "INSERT"}));
  CHECK(bus.execute({OpAddLayer{"", ""}, "LAYER"}).has_value());
}
