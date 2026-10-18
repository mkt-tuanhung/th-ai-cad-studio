// Licence keys: round trip with a TEST keypair generated here (the app trusts only the owner's real public key).
#include <sodium.h>

#include <cstring>
#include <random>

#include "check.hpp"
#include "thcad/license/issue.hpp"
#include "thcad/license/license.hpp"

using namespace thcad::license;

namespace {
struct TestKeys {
  std::uint8_t pk[32], sk[64];
  TestKeys() {
    init();
    crypto_sign_keypair(pk, sk);
  }
};
const TestKeys& keys() {
  static TestKeys k;
  return k;
}
const std::string kMachineA = machineCodeFromIdentifiers({"test:uuid=AAAA-1111", "test:serial=C02TEST"});
const std::string kMachineB = machineCodeFromIdentifiers({"test:uuid=BBBB-2222", "test:serial=C02TEST"});

std::string issue(const std::string& machine, std::uint16_t expiry = 0, const std::string& customer = "Xưởng Mộc An Phát") {
  IssueRequest rq;
  rq.machineCode = machine;
  rq.customer = customer;
  rq.issuedDay = 20000;
  rq.expiryDay = expiry;
  rq.serial = 7;
  return issueKey(rq, keys().sk).key;
}
}  // namespace

TEST("licence: machine code is stable, typo-checked and normalised") {
  CHECK(kMachineA.rfind("MDCA-", 0) == 0);
  CHECK(kMachineA.size() == std::strlen("MDCA-XXXXX-XXXXX-XXXXX-XXXXX-C"));
  CHECK(kMachineA == machineCodeFromIdentifiers({"test:uuid=AAAA-1111", "test:serial=C02TEST"}));
  CHECK(kMachineA != kMachineB);
  CHECK(machineCodeFromIdentifiers({}).empty());
  // lower case, spaces, missing dashes, O for 0 / l for 1 are accepted
  std::string typed;
  for (char c : kMachineA) typed += c == '-' ? ' ' : char(std::tolower(static_cast<unsigned char>(c)));
  for (char& c : typed) if (c == '0') c = 'o';
  CHECK(normaliseMachineCode(typed) == kMachineA);
  // one wrong symbol → rejected by the check symbol
  std::string wrong = kMachineA;
  wrong[6] = wrong[6] == 'A' ? 'B' : 'A';
  CHECK(!normaliseMachineCode(wrong));
  CHECK(!normaliseMachineCode("MDCA-"));
  CHECK(!normaliseMachineCode("hello world"));
  CHECK(!machineCode().empty());  // this computer's identifiers can be read
  CHECK(normaliseMachineCode(machineCode()) == machineCode());
}

TEST("licence: a key issued for a machine verifies there and only there") {
  const std::string key = issue(kMachineA);
  CHECK(key.rfind("MDK1-", 0) == 0);
  auto r = verifyKey(key, kMachineA, keys().pk, 20001);
  CHECK(r.ok);
  CHECK(r.reason == Reason::Ok);
  CHECK(r.info.serial == 7);
  CHECK(r.info.customer == "Xưởng Mộc An Phát");
  CHECK(r.info.issuedDay == 20000);
  CHECK(r.info.expiryDay == 0);
  // pasted in lower case with line breaks, or as a .mdkey file
  std::string messy;
  for (std::size_t i = 0; i < key.size(); ++i) {
    messy += char(std::tolower(static_cast<unsigned char>(key[i])));
    if (i % 37 == 36) messy += "\r\n  ";
  }
  CHECK(verifyKey(messy, kMachineA, keys().pk, 20001).ok);
  const std::string file = formatKeyFile(key, r.info, kMachineA);
  CHECK(file.find("# Machine code: " + kMachineA) != std::string::npos);
  CHECK(verifyKey(file, kMachineA, keys().pk, 20001).ok);
  // another computer
  auto other = verifyKey(key, kMachineB, keys().pk, 20001);
  CHECK(!other.ok);
  CHECK(other.reason == Reason::WrongMachine);
}

TEST("licence: forged, tampered, truncated and garbage keys are rejected") {
  const std::string key = issue(kMachineA);
  // a different signer (someone's own keypair) → wrong key
  std::uint8_t pk2[32], sk2[64];
  crypto_sign_keypair(pk2, sk2);
  IssueRequest rq;
  rq.machineCode = kMachineA;
  rq.serial = 1;
  const std::string forged = issueKey(rq, sk2).key;
  CHECK(verifyKey(forged, kMachineA, keys().pk, 20001).reason == Reason::BadSignature);
  // every single-symbol change is caught (check bytes or signature)
  int caught = 0, tried = 0;
  for (std::size_t i = 5; i < key.size(); ++i) {
    if (key[i] == '-') continue;
    std::string t = key;
    t[i] = t[i] == 'Z' ? 'Y' : 'Z';
    ++tried;
    if (!verifyKey(t, kMachineA, keys().pk, 20001).ok) ++caught;
  }
  CHECK(caught == tried);
  // truncated / extended
  CHECK(!verifyKey(key.substr(0, key.size() - 1), kMachineA, keys().pk, 20001).ok);
  CHECK(!verifyKey(key.substr(0, key.size() / 2), kMachineA, keys().pk, 20001).ok);
  CHECK(!verifyKey(key + "A", kMachineA, keys().pk, 20001).ok);
  CHECK(verifyKey("", kMachineA, keys().pk, 20001).reason == Reason::Empty);
  CHECK(verifyKey("xin chào", kMachineA, keys().pk, 20001).reason == Reason::Malformed);
  CHECK(verifyKey("MDK1-", kMachineA, keys().pk, 20001).reason == Reason::Corrupted);
  // fuzz: random symbols, random bytes — never accepted, never crashes
  std::mt19937 rng(42);
  const char* alpha = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  for (int n = 0; n < 3000; ++n) {
    std::string s = "MDK1-";
    const int len = int(rng() % 260);
    for (int i = 0; i < len; ++i) s += alpha[rng() % 32];
    CHECK(!verifyKey(s, kMachineA, keys().pk, 20001).ok);
    std::string b(std::size_t(rng() % 400), '\0');
    for (char& c : b) c = char(rng() & 0xff);
    CHECK(!verifyKey(b, kMachineA, keys().pk, 20001).ok);
  }
}

TEST("licence: expiry, version and edition") {
  const std::string timed = issue(kMachineA, 20030);
  CHECK(verifyKey(timed, kMachineA, keys().pk, 20030).ok);
  auto late = verifyKey(timed, kMachineA, keys().pk, 20031);
  CHECK(!late.ok);
  CHECK(late.reason == Reason::Expired);
  IssueRequest rq;
  rq.machineCode = kMachineA;
  rq.issuedDay = 20000;
  rq.expiryDay = 19999;
  CHECK(!issueKey(rq, keys().sk).ok);
  // a future format version, correctly signed, is refused (not misread)
  LicenceInfo info;
  info.version = 2;
  info.machineHash = machineBinding(kMachineA);
  auto payload = encodePayload(info);
  auto msg = signedMessage(payload);
  std::uint8_t sig[64];
  crypto_sign_detached(sig, nullptr, msg.data(), msg.size(), keys().sk);
  CHECK(verifyKey(formatKey(payload, sig), kMachineA, keys().pk, 20001).reason == Reason::UnsupportedVersion);
  // a signed key without the full-edition flag unlocks nothing
  rq.expiryDay = 0;
  rq.edition = 0;
  CHECK(!verifyKey(issueKey(rq, keys().sk).key, kMachineA, keys().pk, 20001).ok);
  // customer name limit
  rq.edition = kEditionFull;
  rq.customer = std::string(kMaxCustomerBytes + 1, 'x');
  CHECK(issueKey(rq, keys().sk).error == "customer-too-long");
  IssueRequest bad;
  bad.machineCode = "MDCA-bad";
  CHECK(!issueKey(bad, keys().sk).ok);
  // dates
  CHECK(dayToIso(0) == "1970-01-01");
  CHECK(isoToDay("2026-10-18") && dayToIso(*isoToDay("2026-10-18")) == "2026-10-18");
  CHECK(!isoToDay("2026-02-30"));
}
