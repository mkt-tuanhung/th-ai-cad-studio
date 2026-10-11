#pragma once
// JSON wire format for CadOps — used by the Qt bridge (UI ↔ engine) and by AI tool calls.
//   {"type":"add","label":"LINE","entities":[{"kind":"line","layer":"A-Wall","a":[0,0],"b":[1000,0]}]}
//   {"type":"erase","ids":["e1"]}  {"type":"setCurrentLayer","layer":"A-Door"}
// Arc angles are radians (same as the UI prototype).
// A point may also be an AutoCAD point string relative to the previous point of the same entity:
//   "b":"@3600<0" (3600 mm at 0°), "@0,2800" — the engine does the arithmetic, not the model.
#include <string>
#include <variant>
#include <vector>

#include "thcad/core/command_bus.hpp"
#include "thcad/core/json.hpp"

namespace thcad {

struct OpsParseError {
  std::string message;
};

/** Accepts one op object, an array of ops, or {"ops":[...]}. Missing entity ids are generated. */
std::variant<std::vector<CadOp>, OpsParseError> opsFromJson(const json::Value& v, std::string idPrefix = "op");
json::Value entityToJson(const Entity& e);
json::Value documentToJson(const Document& d);
/** Inverse of documentToJson (entities + layers). */
std::variant<Document, OpsParseError> documentFromJson(const json::Value& v);
json::Value opsToJson(const std::vector<CadOp>& ops);

}  // namespace thcad
