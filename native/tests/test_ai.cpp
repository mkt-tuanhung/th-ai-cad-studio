#include "check.hpp"
#include "thcad/ai/assistant.hpp"

using namespace thcad;

TEST("assistant extracts JSON from chatty model output") {
  CHECK(ai::extractJson("Sure! ```json\n{\"title\":\"x\",\"ops\":[{\"a\":\"}\"}]}\n``` done") == "{\"title\":\"x\",\"ops\":[{\"a\":\"}\"}]}");
  CHECK(ai::extractJson("no json here").empty());
}

TEST("AI output becomes a pending proposal, never a commit") {
  CommandBus bus(Document::blank("t"));
  ProposalQueue q(bus);
  auto r = ai::fileProposal(q, "fallback", "ai:test",
                            R"({"title":"Add partition","ops":[{"type":"add","entities":[{"kind":"line","layer":"A-Wall","a":[0,0],"b":[3600,0]}]}]})");
  CHECK(r.ok);
  CHECK(bus.document().entities.empty());
  CHECK(q.find(r.proposalId)->title == "Add partition");
  CHECK(!q.approve(r.proposalId));
  CHECK(bus.document().entities.size() == 1);
}

TEST("invalid AI output is rejected with a reason") {
  CommandBus bus(Document::blank("t"));
  ProposalQueue q(bus);
  CHECK(!ai::fileProposal(q, "x", "ai:test", "{not json").ok);
  CHECK(!ai::fileProposal(q, "x", "ai:test", R"({"ops":[{"type":"add","entities":[{"kind":"line","layer":"NOPE","a":[0,0],"b":[1,0]}]}]})").ok);
  CHECK(bus.document().entities.empty());
}

TEST("runtime without a model reports not ready instead of answering") {
  auto rt = ai::createRuntime();
  CommandBus bus(Document::blank("t"));
  ProposalQueue q(bus);
  auto r = ai::requestEdit(*rt, q, bus.document(), "draw a wall");
  CHECK(!r.ok);
  CHECK(q.all().empty());
  CHECK(rt->status().memoryTotalBytes > 0);
}
