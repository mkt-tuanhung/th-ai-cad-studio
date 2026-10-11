#include "thcad/ai/assistant.hpp"

#include "thcad/core/ops_json.hpp"

#include <chrono>

namespace thcad::ai {

std::string cadSystemPrompt(const Document& doc) {
  std::string layers;
  for (const auto& l : doc.layers) layers += (layers.empty() ? "" : ", ") + l.name;
  std::string ents;
  size_t n = 0;
  for (const auto& e : doc.entities) {
    if (++n > 60) { ents += "  ...\n"; break; }
    ents += "  " + e.id() + ": " + kindName(e.shape) + " on " + e.props.layer + "\n";
  }
  return "You are the CAD assistant of TH AI CAD Studio (2D drafting, AutoCAD conventions).\n"
         "Units are millimetres. X to the right, Y up. Points are [x, y].\n"
         "Reply with ONLY one JSON object: {\"title\": string, \"ops\": [op, ...]} and nothing else.\n"
         "op is one of:\n"
         "  {\"type\":\"add\",\"entities\":[entity, ...]}\n"
         "  {\"type\":\"erase\",\"ids\":[id, ...]}   (specific entities; only ids listed below)\n"
         "  {\"type\":\"eraseWhere\",\"layers\":[L, ...],\"kinds\":[kind, ...]}   (erase by layer and/or kind; [] = any)\n"
         "  {\"type\":\"setCurrentLayer\",\"layer\":name}\n"
         "entity is one of (every entity has \"layer\"):\n"
         "  {\"kind\":\"line\",\"layer\":L,\"a\":[x,y],\"b\":[x,y]}\n"
         "  {\"kind\":\"rect\",\"layer\":L,\"corner\":[x,y],\"width\":W,\"height\":H}   (corner = lower-left)\n"
         "  {\"kind\":\"polyline\",\"layer\":L,\"points\":[[x,y],...],\"closed\":true|false}\n"
         "  {\"kind\":\"circle\",\"layer\":L,\"center\":[x,y],\"radius\":r}\n"
         "  {\"kind\":\"arc\",\"layer\":L,\"center\":[x,y],\"radius\":r,\"startDeg\":a0,\"endDeg\":a1}   (degrees, counter-clockwise)\n"
         "  {\"kind\":\"text\",\"layer\":L,\"position\":[x,y],\"height\":h,\"value\":string}\n"
         "  {\"kind\":\"dimension\",\"layer\":L,\"a\":[x,y],\"b\":[x,y],\"offset\":d}\n"
         "A point may be written as AutoCAD relative input, measured from the previous point of the SAME entity: "
         "\"@dx,dy\" or \"@length<angle\" (degrees, 0 = +X, 90 = +Y). Prefer it for lengths and directions; "
         "the engine computes the coordinates. Example: a 3600 mm line going right from 1000,2000 is "
         "{\"kind\":\"line\",\"layer\":\"A-Wall\",\"a\":[1000,2000],\"b\":\"@3600<0\"}.\n"
         "Use kind \"rect\" for rectangles and squares. To erase everything on some layers or of some kinds, use eraseWhere.\n"
         "Layers (use exactly these names): " + layers + ".\n"
         "Existing entities (" + std::to_string(doc.entities.size()) + "):\n" + (ents.empty() ? "  (none)\n" : ents) +
         "The user may write in Vietnamese or English.\n"
         "Create ONLY the entities the user asks for: no extra dimensions, labels or helper lines unless requested.\n"
         "Examples (different values from any real request):\n"
         "User: Draw a 2000 x 1500 rectangle on layer A-Furniture, lower-left corner at 500,500.\n"
         "{\"title\":\"Rectangle 2000x1500\",\"ops\":[{\"type\":\"add\",\"entities\":[{\"kind\":\"rect\",\"layer\":\"A-Furniture\","
         "\"corner\":[500,500],\"width\":2000,\"height\":1500}]}]}\n"
         "User: Ghi kích thước giữa 100,100 và 2600,100, cách 400, layer A-Dims.\n"
         "{\"title\":\"Dimension 2500\",\"ops\":[{\"type\":\"add\",\"entities\":[{\"kind\":\"dimension\",\"layer\":\"A-Dims\","
         "\"a\":[100,100],\"b\":[2600,100],\"offset\":400}]}]}";
}

std::string cadOpsGrammar(const Document& doc) {
  auto q = [](const std::string& s) {
    std::string out = "\"\\\"";
    for (char c : s) {
      if (c == '"' || c == '\\') out += '\\';
      out += c;
    }
    return out + "\\\"\"";
  };
  std::string layers, ids;
  for (const auto& l : doc.layers) layers += (layers.empty() ? "" : " | ") + q(l.name);
  for (const auto& e : doc.entities) ids += (ids.empty() ? "" : " | ") + q(e.id());
  std::string g = R"G(root ::= "{" ws "\"title\"" ws ":" ws str ws "," ws "\"ops\"" ws ":" ws "[" ws op (ws "," ws op)* ws "]" ws "}"
op ::= add | setlayer)G";
  if (!ids.empty()) g += " | erase | erasewhere";
  g += R"G(
add ::= "{" ws "\"type\"" ws ":" ws "\"add\"" ws "," ws "\"entities\"" ws ":" ws "[" ws entity (ws "," ws entity)* ws "]" ws "}"
setlayer ::= "{" ws "\"type\"" ws ":" ws "\"setCurrentLayer\"" ws "," ws "\"layer\"" ws ":" ws layer ws "}"
entity ::= line | rect | polyline | circle | arc | text | dimension
rect ::= "{" ws "\"kind\"" ws ":" ws "\"rect\"" ws "," ws lay ws "," ws "\"corner\"" ws ":" ws pt ws "," ws "\"width\"" ws ":" ws num ws "," ws "\"height\"" ws ":" ws num ws "}"
line ::= "{" ws "\"kind\"" ws ":" ws "\"line\"" ws "," ws lay ws "," ws "\"a\"" ws ":" ws pt ws "," ws "\"b\"" ws ":" ws pt ws "}"
polyline ::= "{" ws "\"kind\"" ws ":" ws "\"polyline\"" ws "," ws lay ws "," ws "\"points\"" ws ":" ws "[" ws pt (ws "," ws pt)* ws "]" ws "," ws "\"closed\"" ws ":" ws ("true" | "false") ws "}"
circle ::= "{" ws "\"kind\"" ws ":" ws "\"circle\"" ws "," ws lay ws "," ws "\"center\"" ws ":" ws pt ws "," ws "\"radius\"" ws ":" ws num ws "}"
arc ::= "{" ws "\"kind\"" ws ":" ws "\"arc\"" ws "," ws lay ws "," ws "\"center\"" ws ":" ws pt ws "," ws "\"radius\"" ws ":" ws num ws "," ws "\"startDeg\"" ws ":" ws num ws "," ws "\"endDeg\"" ws ":" ws num ws "}"
text ::= "{" ws "\"kind\"" ws ":" ws "\"text\"" ws "," ws lay ws "," ws "\"position\"" ws ":" ws pt ws "," ws "\"height\"" ws ":" ws num ws "," ws "\"value\"" ws ":" ws str ws "}"
dimension ::= "{" ws "\"kind\"" ws ":" ws "\"dimension\"" ws "," ws lay ws "," ws "\"a\"" ws ":" ws pt ws "," ws "\"b\"" ws ":" ws pt ws "," ws "\"offset\"" ws ":" ws num ws "}"
lay ::= "\"layer\"" ws ":" ws layer
pt ::= "[" ws num ws "," ws num ws "]" | "\"@" num ("," num | "<" num) "\""
num ::= "-"? [0-9]{1,7} ("." [0-9]{1,4})?
str ::= "\"" ([^"\\\x00-\x1F] | "\\" ["\\/nt])* "\""
ws ::= [ \t\n]{0,6}
)G";
  g += "layer ::= " + layers + "\n";
  if (!ids.empty()) {
    g += R"G(erase ::= "{" ws "\"type\"" ws ":" ws "\"erase\"" ws "," ws "\"ids\"" ws ":" ws "[" ws eid (ws "," ws eid)* ws "]" ws "}")G";
    g += "\neid ::= " + ids + "\n";
    g += R"G(erasewhere ::= "{" ws "\"type\"" ws ":" ws "\"eraseWhere\"" ws "," ws "\"layers\"" ws ":" ws "[" ws (layer (ws "," ws layer)*)? ws "]" ws "," ws "\"kinds\"" ws ":" ws "[" ws (kind (ws "," ws kind)*)? ws "]" ws "}"
kind ::= "\"line\"" | "\"polyline\"" | "\"circle\"" | "\"arc\"" | "\"text\"" | "\"dimension\""
)G";
  }
  return g;
}

std::string extractJson(const std::string& text) {
  size_t start = text.find_first_of("{[");
  while (start != std::string::npos) {
    int depth = 0;
    bool inStr = false, esc = false;
    for (size_t i = start; i < text.size(); ++i) {
      char c = text[i];
      if (inStr) {
        if (esc) esc = false;
        else if (c == '\\') esc = true;
        else if (c == '"') inStr = false;
        continue;
      }
      if (c == '"') inStr = true;
      else if (c == '{' || c == '[') ++depth;
      else if (c == '}' || c == ']') {
        if (--depth == 0) return text.substr(start, i - start + 1);
      }
    }
    start = text.find_first_of("{[", start + 1);
  }
  return {};
}

AssistantResult fileProposal(ProposalQueue& queue, const std::string& title, const std::string& source, const std::string& opsJson) {
  AssistantResult r;
  auto parsed = json::parse(opsJson);
  if (auto* e = std::get_if<json::ParseError>(&parsed)) {
    r.message = "invalid JSON: " + e->message;
    return r;
  }
  const json::Value& v = std::get<json::Value>(parsed);
  auto ops = opsFromJson(v, "ai-" + std::to_string(std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count() % 100000000));
  if (auto* e = std::get_if<OpsParseError>(&ops)) {
    r.message = "invalid ops: " + e->message;
    return r;
  }
  std::string t = title;
  if (const json::Value* tv = v.get("title"); tv && tv->str()) t = *tv->str();
  const Proposal& p = queue.propose(t, source, std::move(std::get<std::vector<CadOp>>(ops)));
  r.proposalId = p.id;
  if (p.status == ProposalStatus::Invalid) {
    r.message = std::string("proposal does not validate: ") + toString(p.error->code) + " " + p.error->detail;
    return r;
  }
  r.ok = true;
  r.message = "proposal " + p.id + ": +" + std::to_string(p.diff.added) + " / -" + std::to_string(p.diff.erased) + " / ~" +
              std::to_string(p.diff.modified) + " — awaiting approval";
  return r;
}

AssistantResult requestEdit(Runtime& rt, ProposalQueue& queue, const Document& doc, const std::string& request, RequestOptions o) {
  AssistantResult r;
  const RuntimeStatus st = rt.status();
  if (!st.ready) {
    r.message = st.modelPath.empty() ? "no local model installed" : "model not ready: " + st.error;
    return r;
  }
  GenerateOptions opt;
  opt.system = cadSystemPrompt(doc);
  opt.temperature = 0;
  opt.maxTokens = o.maxTokens;
  auto attempt = [&](bool constrained) {
    opt.grammar = constrained ? cadOpsGrammar(doc) : std::string();
    AssistantResult a;
    a.rawOutput = rt.generate(request, opt);
    if (opt.grammarError) { a.message = "grammar failed to compile"; return a; }
    const std::string js = extractJson(a.rawOutput);
    if (js.empty()) { a.message = "model reply contained no JSON"; return a; }
    AssistantResult f = fileProposal(queue, request, "ai:" + st.modelName, js);
    f.rawOutput = a.rawOutput;
    return f;
  };
  switch (o.mode) {
    case DecodeMode::Constrained: return attempt(true);
    case DecodeMode::Free: return attempt(false);
    case DecodeMode::Hybrid: {
      // fast unconstrained pass; if it does not produce a valid proposal, retry under the grammar
      AssistantResult first = attempt(false);
      if (first.ok) return first;
      AssistantResult second = attempt(true);
      second.retried = true;
      return second;
    }
  }
  return r;
}

}  // namespace thcad::ai
