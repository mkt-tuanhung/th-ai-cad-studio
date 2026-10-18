#include "thcad/license/issue.hpp"

#include <sodium.h>

namespace thcad::license {

IssueResult issueKey(const IssueRequest& rq, const std::uint8_t secretKey[64]) {
  IssueResult r;
  const auto code = normaliseMachineCode(rq.machineCode);
  if (!code) {
    r.error = "machine-code";
    return r;
  }
  if (rq.customer.size() > std::size_t(kMaxCustomerBytes)) {
    r.error = "customer-too-long";
    return r;
  }
  LicenceInfo& info = r.info;
  info.edition = rq.edition;
  info.machineHash = machineBinding(*code);
  info.issuedDay = rq.issuedDay ? rq.issuedDay : todayDay();
  info.expiryDay = rq.expiryDay;
  info.serial = rq.serial;
  info.customer = rq.customer;
  if (info.expiryDay != 0 && info.expiryDay < info.issuedDay) {
    r.error = "expiry-before-issue";
    return r;
  }
  const auto payload = encodePayload(info);
  const auto msg = signedMessage(payload);
  std::uint8_t sig[kSignatureBytes];
  if (payload.empty() || crypto_sign_detached(sig, nullptr, msg.data(), msg.size(), secretKey) != 0) {
    r.error = "sign";
    return r;
  }
  r.key = formatKey(payload, sig);
  r.machineCode = *code;
  r.ok = true;
  return r;
}

}  // namespace thcad::license
