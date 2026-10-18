#include "thcad/license/license.hpp"

#include <sodium.h>

#include <cstdio>
#include <cstring>
#include <ctime>

namespace thcad::license {

namespace {

constexpr char kAlphabet[] = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";  // Crockford: no I, L, O, U
constexpr char kKeyPrefix[] = "MDK1";
constexpr char kCodePrefix[] = "MDCA";
constexpr int kCodeSymbols = 20;  // 100 bits
constexpr int kCheckBytes = 2;
constexpr std::size_t kHeaderBytes = 27;  // ver, edition, hash(16), issued(2), expiry(2), serial(4), nameLen(1)
constexpr std::size_t kMaxKeyText = 8192;
constexpr char kSigDomain[] = "MDCADAI-LICENSE|v1|";
constexpr char kArmourBegin[] = "-----BEGIN MD CAD AI STUDIO KEY-----";
constexpr char kArmourEnd[] = "-----END MD CAD AI STUDIO KEY-----";

// keys of the keyed BLAKE2b hashes (domain separation; not secret)
constexpr char kMachineKey[] = "MDCADAI-MACHINE-ID-v1-domain-key";
constexpr char kBindKey[] = "MDCADAI-KEY-MACHINE-BIND-v1-key";
constexpr char kCheckKey[] = "MDCADAI-KEY-CHECK-BYTES-v1-key!";

int symbolValue(char c) {
  for (int i = 0; i < 32; ++i)
    if (kAlphabet[i] == c) return i;
  return -1;
}

void hashKeyed(std::uint8_t* out, std::size_t outLen, const void* in, std::size_t inLen, const char* key) {
  crypto_generichash(out, outLen, static_cast<const unsigned char*>(in), inLen, reinterpret_cast<const unsigned char*>(key), std::strlen(key));
}

char checkSymbol(std::string_view symbols) {
  unsigned sum = 0;
  for (std::size_t i = 0; i < symbols.size(); ++i) sum += unsigned(i + 1) * unsigned(symbolValue(symbols[i]));
  return kAlphabet[sum % 31];
}

std::string group5(std::string_view s) {
  std::string out;
  for (std::size_t i = 0; i < s.size(); i += 5) {
    if (i) out += '-';
    out.append(s.substr(i, 5));
  }
  return out;
}

void putU16(std::vector<std::uint8_t>& v, std::uint16_t x) {
  v.push_back(std::uint8_t(x & 0xff));
  v.push_back(std::uint8_t(x >> 8));
}
void putU32(std::vector<std::uint8_t>& v, std::uint32_t x) {
  for (int i = 0; i < 4; ++i) v.push_back(std::uint8_t((x >> (8 * i)) & 0xff));
}
std::uint16_t getU16(const std::uint8_t* p) { return std::uint16_t(p[0] | (p[1] << 8)); }
std::uint32_t getU32(const std::uint8_t* p) { return std::uint32_t(p[0]) | (std::uint32_t(p[1]) << 8) | (std::uint32_t(p[2]) << 16) | (std::uint32_t(p[3]) << 24); }

// Howard Hinnant's civil-date algorithms (proleptic Gregorian)
long daysFromCivil(long y, unsigned m, unsigned d) {
  y -= m <= 2;
  const long era = (y >= 0 ? y : y - 399) / 400;
  const unsigned yoe = unsigned(y - era * 400);
  const unsigned doy = (153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1;
  const unsigned doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
  return era * 146097 + long(doe) - 719468;
}

}  // namespace

bool init() { return sodium_init() >= 0; }

// ---------------------------------------------------------------- base32
std::string base32Encode(const std::uint8_t* bytes, std::size_t n) {
  std::string out;
  out.reserve((n * 8 + 4) / 5);
  unsigned buffer = 0;
  int bits = 0;
  for (std::size_t i = 0; i < n; ++i) {
    buffer = (buffer << 8) | bytes[i];
    bits += 8;
    while (bits >= 5) {
      out += kAlphabet[(buffer >> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += kAlphabet[(buffer << (5 - bits)) & 31];
  return out;
}

std::optional<std::string> base32Normalise(std::string_view text) {
  std::string out;
  out.reserve(text.size());
  for (char c : text) {
    if (c == ' ' || c == '-' || c == '_' || c == '\t' || c == '\r' || c == '\n') continue;
    if (c >= 'a' && c <= 'z') c = char(c - 'a' + 'A');
    if (c == 'O') c = '0';
    else if (c == 'I' || c == 'L') c = '1';
    if (symbolValue(c) < 0) return std::nullopt;
    out += c;
  }
  return out;
}

std::optional<std::vector<std::uint8_t>> base32Decode(std::string_view symbols) {
  const std::size_t totalBits = symbols.size() * 5;
  const std::size_t n = totalBits / 8;
  if (totalBits - n * 8 >= 5) return std::nullopt;  // a whole extra symbol: no canonical encoder emits that
  std::vector<std::uint8_t> out;
  out.reserve(n);
  unsigned buffer = 0;
  int bits = 0;
  for (char c : symbols) {
    const int v = symbolValue(c);
    if (v < 0) return std::nullopt;
    buffer = ((buffer << 5) | unsigned(v)) & 0xfff;
    bits += 5;
    if (bits >= 8) {
      out.push_back(std::uint8_t((buffer >> (bits - 8)) & 0xff));
      bits -= 8;
    }
  }
  if (bits > 0 && (buffer & ((1u << bits) - 1)) != 0) return std::nullopt;  // padding bits must be zero
  return out;
}

// ---------------------------------------------------------------- machine code
std::string machineCodeFromIdentifiers(const std::vector<std::string>& identifiers) {
  std::string joined;
  for (const auto& id : identifiers) {
    if (id.empty()) continue;
    joined += id;
    joined += '\x1f';
  }
  if (joined.empty()) return {};
  std::uint8_t h[32];
  hashKeyed(h, sizeof h, joined.data(), joined.size(), kMachineKey);
  const std::string sym = base32Encode(h, 13).substr(0, kCodeSymbols);
  sodium_memzero(h, sizeof h);
  return std::string(kCodePrefix) + "-" + group5(sym) + "-" + checkSymbol(sym);
}

std::optional<std::string> normaliseMachineCode(std::string_view text) {
  if (text.size() > 128) return std::nullopt;
  auto norm = base32Normalise(text);
  if (!norm) return std::nullopt;
  std::string s = *norm;
  if (s.size() == kCodeSymbols + 1 + 4 && s.compare(0, 4, kCodePrefix) == 0) s.erase(0, 4);
  if (s.size() != kCodeSymbols + 1) return std::nullopt;
  const std::string sym = s.substr(0, kCodeSymbols);
  if (checkSymbol(sym) != s.back()) return std::nullopt;
  return std::string(kCodePrefix) + "-" + group5(sym) + "-" + s.back();
}

std::array<std::uint8_t, kMachineHashBytes> machineBinding(std::string_view canonicalCode) {
  std::array<std::uint8_t, kMachineHashBytes> out{};
  hashKeyed(out.data(), out.size(), canonicalCode.data(), canonicalCode.size(), kBindKey);
  return out;
}

// ---------------------------------------------------------------- days
std::uint16_t todayDay() {
  const std::time_t now = std::time(nullptr);
  const long d = long(now / 86400);
  return std::uint16_t(d < 0 ? 0 : d > 0xffff ? 0xffff : d);
}

std::string dayToIso(std::uint16_t day) {
  long z = long(day) + 719468;
  const long era = z / 146097;
  const unsigned doe = unsigned(z - era * 146097);
  const unsigned yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
  long y = long(yoe) + era * 400;
  const unsigned doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
  const unsigned mp = (5 * doy + 2) / 153;
  const unsigned d = doy - (153 * mp + 2) / 5 + 1;
  const unsigned m = mp < 10 ? mp + 3 : mp - 9;
  y += m <= 2;
  char buf[16];
  std::snprintf(buf, sizeof buf, "%04ld-%02u-%02u", y, m, d);
  return buf;
}

std::optional<std::uint16_t> isoToDay(std::string_view iso) {
  if (iso.size() != 10 || iso[4] != '-' || iso[7] != '-') return std::nullopt;
  auto num = [&](std::size_t at, std::size_t len) -> long {
    long v = 0;
    for (std::size_t i = at; i < at + len; ++i) {
      if (iso[i] < '0' || iso[i] > '9') return -1;
      v = v * 10 + (iso[i] - '0');
    }
    return v;
  };
  const long y = num(0, 4), m = num(5, 2), d = num(8, 2);
  if (y < 1970 || m < 1 || m > 12 || d < 1 || d > 31) return std::nullopt;
  const long days = daysFromCivil(y, unsigned(m), unsigned(d));
  if (days < 0 || days > 0xffff || dayToIso(std::uint16_t(days)) != iso) return std::nullopt;  // e.g. 02-30
  return std::uint16_t(days);
}

// ---------------------------------------------------------------- keys
const char* reasonCode(Reason r) {
  switch (r) {
    case Reason::Ok: return "ok";
    case Reason::Empty: return "empty";
    case Reason::Malformed: return "malformed";
    case Reason::Corrupted: return "corrupted";
    case Reason::UnsupportedVersion: return "version";
    case Reason::BadSignature: return "signature";
    case Reason::WrongMachine: return "machine";
    case Reason::Expired: return "expired";
    case Reason::NoMachineCode: return "no-machine-code";
  }
  return "malformed";
}

std::vector<std::uint8_t> encodePayload(const LicenceInfo& info) {
  if (info.customer.size() > kMaxCustomerBytes) return {};
  std::vector<std::uint8_t> p;
  p.reserve(kHeaderBytes + info.customer.size());
  p.push_back(info.version);
  p.push_back(info.edition);
  p.insert(p.end(), info.machineHash.begin(), info.machineHash.end());
  putU16(p, info.issuedDay);
  putU16(p, info.expiryDay);
  putU32(p, info.serial);
  p.push_back(std::uint8_t(info.customer.size()));
  p.insert(p.end(), info.customer.begin(), info.customer.end());
  return p;
}

std::vector<std::uint8_t> signedMessage(const std::vector<std::uint8_t>& payload) {
  std::vector<std::uint8_t> m(kSigDomain, kSigDomain + std::strlen(kSigDomain));
  m.insert(m.end(), payload.begin(), payload.end());
  return m;
}

std::string formatKey(const std::vector<std::uint8_t>& payload, const std::uint8_t signature[kSignatureBytes]) {
  std::vector<std::uint8_t> blob = payload;
  blob.insert(blob.end(), signature, signature + kSignatureBytes);
  std::uint8_t check[kCheckBytes];
  hashKeyed(check, kCheckBytes, blob.data(), blob.size(), kCheckKey);
  blob.insert(blob.end(), check, check + kCheckBytes);
  return std::string(kKeyPrefix) + "-" + group5(base32Encode(blob.data(), blob.size()));
}

std::string extractKeyText(std::string_view text) {
  if (text.size() > kMaxKeyText * 4) return {};
  // armoured file: only what is between the markers
  const auto b = text.find(kArmourBegin);
  if (b != std::string_view::npos) {
    const auto from = b + std::strlen(kArmourBegin);
    const auto e = text.find(kArmourEnd, from);
    text = text.substr(from, e == std::string_view::npos ? std::string_view::npos : e - from);
  }
  std::string out;
  std::size_t pos = 0;
  while (pos <= text.size()) {
    auto nl = text.find('\n', pos);
    if (nl == std::string_view::npos) nl = text.size();
    std::string_view line = text.substr(pos, nl - pos);
    pos = nl + 1;
    std::size_t s = 0;
    while (s < line.size() && (line[s] == ' ' || line[s] == '\t' || line[s] == '\r')) ++s;
    line.remove_prefix(s);
    if (line.empty() || line[0] == '#' || line.rfind("-----", 0) == 0) continue;
    out.append(line);
    out += '\n';
  }
  return out;
}

std::string formatKeyFile(const std::string& keyText, const LicenceInfo& info, const std::string& machineCode) {
  std::string f;
  f += "# MD CAD AI STUDIO - licence key (.mdkey)\n";
  f += "# Machine code: " + machineCode + "\n";
  if (!info.customer.empty()) f += "# Licensed to: " + info.customer + "\n";
  f += "# Key serial: " + std::to_string(info.serial) + "\n";
  f += "# Issued: " + dayToIso(info.issuedDay) + "\n";
  f += "# Expires: " + (info.expiryDay ? dayToIso(info.expiryDay) : std::string("never")) + "\n";
  f += "# The lines starting with '#' are only for people; the app reads the key below.\n";
  f += std::string(kArmourBegin) + "\n";
  for (std::size_t i = 0; i < keyText.size(); i += 60) f += keyText.substr(i, 60) + "\n";
  f += std::string(kArmourEnd) + "\n";
  return f;
}

VerifyResult verifyKey(std::string_view keyText, std::string_view machineCodeText, const std::uint8_t publicKey[kPublicKeyBytes], std::uint16_t today) {
  VerifyResult r;
  if (keyText.size() > kMaxKeyText * 4) return r;  // Malformed
  const std::string extracted = extractKeyText(keyText);
  auto norm = base32Normalise(extracted);
  if (!norm) return r;
  if (norm->empty()) {
    r.reason = Reason::Empty;
    return r;
  }
  if (norm->size() > kMaxKeyText || norm->compare(0, 4, kKeyPrefix) != 0) return r;
  auto blob = base32Decode(std::string_view(*norm).substr(4));
  if (!blob) {
    r.reason = Reason::Corrupted;  // a missing / extra symbol leaves an impossible length
    return r;
  }
  r.reason = Reason::Corrupted;
  const std::size_t minLen = kHeaderBytes + kSignatureBytes + kCheckBytes;
  if (blob->size() < minLen || blob->size() > minLen + kMaxCustomerBytes) return r;
  const std::size_t body = blob->size() - kCheckBytes;
  std::uint8_t check[kCheckBytes];
  hashKeyed(check, kCheckBytes, blob->data(), body, kCheckKey);
  if (sodium_memcmp(check, blob->data() + body, kCheckBytes) != 0) return r;
  const std::uint8_t* p = blob->data();
  const std::size_t nameLen = p[26];
  if (nameLen > kMaxCustomerBytes || kHeaderBytes + nameLen + kSignatureBytes + kCheckBytes != blob->size()) return r;
  if (p[0] != kFormatVersion) {
    r.reason = Reason::UnsupportedVersion;
    return r;
  }
  const std::size_t payloadLen = kHeaderBytes + nameLen;
  const std::vector<std::uint8_t> payload(p, p + payloadLen);
  const std::vector<std::uint8_t> msg = signedMessage(payload);
  if (crypto_sign_verify_detached(p + payloadLen, msg.data(), msg.size(), publicKey) != 0) {
    r.reason = Reason::BadSignature;
    return r;
  }
  LicenceInfo& info = r.info;
  info.version = p[0];
  info.edition = p[1];
  std::memcpy(info.machineHash.data(), p + 2, kMachineHashBytes);
  info.issuedDay = getU16(p + 18);
  info.expiryDay = getU16(p + 20);
  info.serial = getU32(p + 22);
  info.customer.assign(reinterpret_cast<const char*>(p + kHeaderBytes), nameLen);
  const auto code = normaliseMachineCode(machineCodeText);
  if (!code) {
    r.reason = Reason::NoMachineCode;
    return r;
  }
  const auto bind = machineBinding(*code);
  if (sodium_memcmp(bind.data(), info.machineHash.data(), kMachineHashBytes) != 0) {
    r.reason = Reason::WrongMachine;
    return r;
  }
  if (info.expiryDay != 0 && today > info.expiryDay) {
    r.reason = Reason::Expired;
    return r;
  }
  if ((info.edition & kEditionFull) == 0) {
    r.reason = Reason::BadSignature;  // a signed key without the full edition flag unlocks nothing
    return r;
  }
  r.ok = true;
  r.reason = Reason::Ok;
  return r;
}

}  // namespace thcad::license
