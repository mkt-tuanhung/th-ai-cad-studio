#pragma once
// CAD assistant: turns a natural-language request into CadOps and files them as a PROPOSAL.
// It never commits — the user approves through ProposalQueue::approve (UI: "Approve & Apply").
#include <string>

#include "thcad/ai/runtime.hpp"
#include "thcad/core/proposal.hpp"

namespace thcad::ai {

struct AssistantResult {
  bool ok = false;
  std::string proposalId;   // set when a proposal was filed
  std::string message;      // explanation or error for the UI
  std::string rawOutput;    // model output (for the log)
  bool retried = false;     // hybrid mode needed the constrained retry
};

/** System prompt describing the op JSON schema (see core/ops_json.hpp). */
std::string cadSystemPrompt(const Document& doc);
/** GBNF grammar for {"title", "ops"} whose layer names are restricted to the document's layers. */
std::string cadOpsGrammar(const Document& doc);
/** Extracts the first balanced JSON object/array from model text. */
std::string extractJson(const std::string& text);

enum class DecodeMode {
  Hybrid,       // free decoding, retried under the grammar if invalid (production default)
  Constrained,  // grammar-constrained only (always valid JSON, slower sampling)
  Free,         // unconstrained only (for evaluation)
};
struct RequestOptions {
  DecodeMode mode = DecodeMode::Hybrid;
  int maxTokens = 768;
};
AssistantResult requestEdit(Runtime& rt, ProposalQueue& queue, const Document& doc, const std::string& request, RequestOptions o = {});
/** Same pipeline without a model: files `opsJson` as a proposal (used by tests and the bridge). */
AssistantResult fileProposal(ProposalQueue& queue, const std::string& title, const std::string& source, const std::string& opsJson);

}  // namespace thcad::ai
