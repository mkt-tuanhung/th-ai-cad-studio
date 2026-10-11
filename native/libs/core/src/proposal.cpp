#include "thcad/core/proposal.hpp"

#include "thcad/core/ops_json.hpp"

#include <algorithm>
#include <unordered_map>
#include <unordered_set>

namespace thcad {

DiffSummary diff(const Document& before, const Document& after) {
  // multiset by id: drawings imported from older versions may contain duplicate ids
  std::unordered_multimap<std::string, const Entity*> b;
  for (const auto& e : before.entities) b.emplace(e.id(), &e);
  DiffSummary d;
  for (const auto& e : after.entities) {
    auto it = b.find(e.id());
    if (it == b.end()) { ++d.added; continue; }
    // prefer an identical twin so unchanged duplicates are not reported as modified
    const std::string js = json::stringify(entityToJson(e));
    auto [lo, hi] = b.equal_range(e.id());
    auto same = std::find_if(lo, hi, [&](const auto& kv) { return json::stringify(entityToJson(*kv.second)) == js; });
    if (same != hi) b.erase(same);
    else { ++d.modified; b.erase(it); }
  }
  d.erased = b.size();
  return d;
}

const Proposal& ProposalQueue::propose(std::string title, std::string source, std::vector<CadOp> ops) {
  Proposal p;
  p.id = "proposal-" + std::to_string(++seq_);
  p.title = std::move(title);
  p.source = std::move(source);
  p.ops = std::move(ops);
  // Entity ids are the engine's responsibility: an added entity whose id already exists in the
  // drawing (or earlier in this proposal) gets a fresh unique id, so erase/replace stay unambiguous.
  {
    std::unordered_set<std::string> used;
    for (const auto& e : bus_.document().entities) used.insert(e.id());
    for (auto& op : p.ops)
      if (auto* add = std::get_if<OpAdd>(&op.body))
        for (auto& e : add->entities) {
          std::string id = e.props.id.empty() ? p.id : e.props.id;
          for (int k = 2; used.contains(id); ++k) id = e.props.id + "~" + std::to_string(k);
          e.props.id = id;
          used.insert(id);
        }
  }
  // Resolve filter selections to concrete ids now, so the preview/approval is explicit about what goes.
  for (auto& op : p.ops)
    if (const auto* f = std::get_if<OpEraseWhere>(&op.body)) {
      if (validate(bus_.document(), op)) continue;  // reported below
      op.body = OpErase{resolveFilter(bus_.document(), *f)};
    }
  Document next = bus_.document();
  for (const auto& op : p.ops) {
    if (auto err = validate(next, op)) {
      p.status = ProposalStatus::Invalid;
      p.error = err;
      break;
    }
    next = preview(next, op);
  }
  if (p.status == ProposalStatus::Pending) {
    p.diff = diff(bus_.document(), next);
    p.preview = std::move(next);
  }
  items_.push_back(std::move(p));
  return items_.back();
}

std::optional<ValidationError> ProposalQueue::approve(const std::string& id) {
  for (auto& p : items_) {
    if (p.id != id) continue;
    if (p.status != ProposalStatus::Pending) return ValidationError{ErrorCode::UnknownEntity, "proposal is not pending"};
    if (auto err = bus_.executeBatch(p.ops, "AI: " + p.title)) {
      p.status = ProposalStatus::Invalid;
      p.error = err;
      return err;
    }
    p.status = ProposalStatus::Approved;
    return std::nullopt;
  }
  return ValidationError{ErrorCode::UnknownEntity, "no such proposal"};
}

bool ProposalQueue::reject(const std::string& id) {
  for (auto& p : items_)
    if (p.id == id && p.status == ProposalStatus::Pending) {
      p.status = ProposalStatus::Rejected;
      return true;
    }
  return false;
}

const Proposal* ProposalQueue::find(const std::string& id) const {
  for (const auto& p : items_)
    if (p.id == id) return &p;
  return nullptr;
}

}  // namespace thcad
