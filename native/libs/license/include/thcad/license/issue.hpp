#pragma once
// Licence key ISSUING (signing). Linked only by the owner's keygen (native/tools/keygen) and the unit tests —
// never by the app, which carries verification only (license.hpp).
#include <cstdint>
#include <optional>
#include <string>

#include "thcad/license/license.hpp"

namespace thcad::license {

struct IssueRequest {
  std::string machineCode;      // as typed; validated and normalised
  std::string customer;         // UTF-8, ≤ kMaxCustomerBytes (shown in the app's Settings)
  std::uint16_t issuedDay = 0;  // 0 = today
  std::uint16_t expiryDay = 0;  // 0 = perpetual
  std::uint32_t serial = 0;
  std::uint8_t edition = kEditionFull;
};

struct IssueResult {
  bool ok = false;
  std::string error;            // "machine-code" | "customer-too-long" | "expiry-before-issue" | "sign"
  std::string key;              // "MDK1-…"
  std::string machineCode;      // canonical
  LicenceInfo info;
};

/** Signs a key for one machine with the Ed25519 secret key (libsodium format, 64 bytes). */
IssueResult issueKey(const IssueRequest& request, const std::uint8_t secretKey[64]);

}  // namespace thcad::license
