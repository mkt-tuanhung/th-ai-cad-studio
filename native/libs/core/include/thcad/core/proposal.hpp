#pragma once
// Proposal queue: how AI (or any automated source) changes a drawing.
//   propose(ops) → validated against the current document and previewed (nothing changes)
//   approve(id)  → re-validated against the *current* document and committed as ONE undo step
//   reject(id)   → discarded
// There is deliberately no API to commit an AI op without approve().
#include <optional>
#include <string>
#include <vector>

#include "thcad/core/command_bus.hpp"

namespace thcad {

enum class ProposalStatus { Pending, Approved, Rejected, Invalid };

struct DiffSummary {
  size_t added = 0, erased = 0, modified = 0;
};

struct Proposal {
  std::string id;
  std::string title;
  std::string source;  // "ai:<model>" / "user"
  std::vector<CadOp> ops;
  ProposalStatus status = ProposalStatus::Pending;
  std::optional<ValidationError> error;
  Document preview;
  DiffSummary diff;
};

class ProposalQueue {
 public:
  explicit ProposalQueue(CommandBus& bus) : bus_(bus) {}
  const Proposal& propose(std::string title, std::string source, std::vector<CadOp> ops);
  /** Returns the error if the proposal no longer applies (it is then marked Invalid). */
  std::optional<ValidationError> approve(const std::string& id);
  bool reject(const std::string& id);
  const Proposal* find(const std::string& id) const;
  const std::vector<Proposal>& all() const { return items_; }

 private:
  CommandBus& bus_;
  std::vector<Proposal> items_;
  int seq_ = 0;
};

DiffSummary diff(const Document& before, const Document& after);

}  // namespace thcad
