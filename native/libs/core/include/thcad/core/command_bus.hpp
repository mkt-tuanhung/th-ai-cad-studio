#pragma once
// Command bus — the single mutation path for users, the AutoCAD command line and AI:
//   validate(op) → preview(op) (pure) → commit(op) → undo / redo.
// Same contract as ui/src/cad/commandBus.ts.
#include <optional>
#include <string>
#include <variant>
#include <vector>

#include "thcad/core/document.hpp"

namespace thcad {

struct OpAdd { std::vector<Entity> entities; };
struct OpErase { std::vector<std::string> ids; };
struct OpReplace { std::vector<Entity> entities; };
struct OpSetCurrentLayer { std::string layer; };
/** Selection by filter (AutoCAD QSELECT): erases every entity on `layers` (any if empty) of `kinds` (any if empty). */
struct OpEraseWhere { std::vector<std::string> layers, kinds; };
struct OpLayerProps { std::string name; std::optional<bool> visible, locked; std::optional<std::string> color; };
/** AutoCAD -LAYER Make without changing the current layer: creates the layer if it does not exist. */
struct OpAddLayer { std::string name; std::string color; };

struct CadOp {
  std::variant<OpAdd, OpErase, OpReplace, OpSetCurrentLayer, OpLayerProps, OpEraseWhere, OpAddLayer> body;
  std::string label;
};

enum class ErrorCode { LockedLayer, Degenerate, UnknownEntity, UnknownLayer };
struct ValidationError {
  ErrorCode code;
  std::string detail;
};
const char* toString(ErrorCode c);

std::optional<ValidationError> validate(const Document& doc, const CadOp& op);
/** Ids an OpEraseWhere selects in `doc`. */
std::vector<std::string> resolveFilter(const Document& doc, const OpEraseWhere& f);
/** Pure: the document as it would be after `op`. Caller must validate first. */
Document preview(const Document& doc, const CadOp& op);

class CommandBus {
 public:
  explicit CommandBus(Document doc) : doc_(std::move(doc)) {}

  const Document& document() const { return doc_; }
  /** Validates and commits as one undo step. Returns the error, if any. */
  std::optional<ValidationError> execute(const CadOp& op);
  /** Commits several ops atomically (all validate against the progressive preview) as one step. */
  std::optional<ValidationError> executeBatch(const std::vector<CadOp>& ops, const std::string& label);
  std::optional<std::string> undo();
  std::optional<std::string> redo();
  bool canUndo() const { return !undo_.empty(); }
  bool canRedo() const { return !redo_.empty(); }
  void markSaved() { doc_.dirty = false; }

 private:
  struct Step { std::string label; Document before, after; };
  Document doc_;
  std::vector<Step> undo_, redo_;
  static constexpr size_t kMaxUndo = 200;
};

}  // namespace thcad
