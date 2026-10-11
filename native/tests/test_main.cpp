#include "check.hpp"

int main() {
  int failedCases = 0;
  for (auto& c : t::registry()) {
    const int before = t::failures();
    c.fn();
    const bool ok = t::failures() == before;
    std::printf("%s %s\n", ok ? "PASS" : "FAIL", c.name);
    if (!ok) ++failedCases;
  }
  std::printf("%zu tests, %d failed\n", t::registry().size(), failedCases);
  return failedCases ? 1 : 0;
}
