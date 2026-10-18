#pragma once
// MD CAD AI STUDIO — offline per-machine licence keys (verification side).
//
// A licence key is an Ed25519-signed payload bound to one machine code. The app embeds only the PUBLIC
// key, so a key can never be forged without the owner's private seed (kept in the keygen vault). See
// qa/v2_4/QA_LICENSE.md for the design and the threat model.
//
// Machine code:  "MDCA-XXXXX-XXXXX-XXXXX-XXXXX-C"  — 20 Crockford base32 symbols (100 bits of a keyed BLAKE2b
//                hash of the OS / hardware identifiers) + one check symbol (weighted mod 31).
// Key text:      "MDK1-XXXXX-XXXXX-…"  — Crockford base32 of  payload ‖ signature(64) ‖ check(2).
//                The signature covers "MDCADAI-LICENSE|v1|" ‖ payload.
// Payload v1:    ver(1)=1 · edition(1) · machineHash(16) · issuedDay(u16 LE) · expiryDay(u16 LE, 0 = perpetual)
//                · serial(u32 LE) · nameLen(1, ≤ 48) · name (UTF-8).   Days are counted from 1970-01-01 (UTC).
#include <array>
#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace thcad::license {

constexpr int kPublicKeyBytes = 32;
constexpr int kSignatureBytes = 64;
constexpr int kMachineHashBytes = 16;
constexpr int kMaxCustomerBytes = 48;
constexpr std::uint8_t kFormatVersion = 1;
constexpr std::uint8_t kEditionFull = 1;

/** libsodium must be initialised once before any other call (thread-safe, idempotent). false = no crypto. */
bool init();

// ---------------------------------------------------------------- Crockford base32
/** Upper-case Crockford base32 of `bytes` (no padding; trailing bits are zero). */
std::string base32Encode(const std::uint8_t* bytes, std::size_t n);
/** Normalises typing variants (lower case, O→0, I/L→1) and drops spaces, dashes, underscores and line breaks.
 *  Returns nullopt for any other character. */
std::optional<std::string> base32Normalise(std::string_view text);
/** Decodes a normalised symbol string. Rejects non-canonical input (non-zero padding bits, impossible length). */
std::optional<std::vector<std::uint8_t>> base32Decode(std::string_view symbols);

// ---------------------------------------------------------------- machine code
/** The 100-bit machine fingerprint as a display code with check symbol, from raw OS identifiers. */
std::string machineCodeFromIdentifiers(const std::vector<std::string>& identifiers);
/** This computer's machine code (macOS: IOPlatformUUID + serial number; Windows: MachineGuid + system volume
 *  serial; others: /etc/machine-id). Empty string when no identifier could be read. */
std::string machineCode();
/** Validates a typed machine code (check symbol) and returns its canonical "MDCA-…-C" form. */
std::optional<std::string> normaliseMachineCode(std::string_view text);
/** The 16-byte binding hash a key carries for a canonical machine code. */
std::array<std::uint8_t, kMachineHashBytes> machineBinding(std::string_view canonicalCode);

// ---------------------------------------------------------------- keys
struct LicenceInfo {
  std::uint8_t version = kFormatVersion;
  std::uint8_t edition = kEditionFull;
  std::array<std::uint8_t, kMachineHashBytes> machineHash{};
  std::uint16_t issuedDay = 0;
  std::uint16_t expiryDay = 0;  // 0 = perpetual
  std::uint32_t serial = 0;
  std::string customer;         // UTF-8, ≤ 48 bytes
};

enum class Reason {
  Ok,
  Empty,             // nothing pasted
  Malformed,         // not a key at all (bad characters, wrong prefix, impossible length)
  Corrupted,         // check bytes do not match: a typo or a truncated / damaged key ("key hỏng")
  UnsupportedVersion,
  BadSignature,      // not signed by the owner ("sai key")
  WrongMachine,      // a genuine key for another computer ("key của máy khác")
  Expired,
  NoMachineCode,     // this computer's identifiers could not be read
};

/** Stable machine-readable reason ("ok", "malformed", "corrupted", "version", "signature", "machine", "expired", …). */
const char* reasonCode(Reason r);

struct VerifyResult {
  bool ok = false;
  Reason reason = Reason::Malformed;
  LicenceInfo info;  // filled once the signature is valid (also for WrongMachine / Expired)
};

/** Days since 1970-01-01 UTC, today. */
std::uint16_t todayDay();
/** "YYYY-MM-DD" of a day number. */
std::string dayToIso(std::uint16_t day);
/** Day number of "YYYY-MM-DD" (nullopt when invalid). */
std::optional<std::uint16_t> isoToDay(std::string_view iso);

/** Binary payload of `info` (the signed bytes, without the domain prefix). Empty if the name is too long. */
std::vector<std::uint8_t> encodePayload(const LicenceInfo& info);
/** The exact message the signature covers: domain ‖ payload. */
std::vector<std::uint8_t> signedMessage(const std::vector<std::uint8_t>& payload);
/** Key text "MDK1-…" from payload + signature (adds the check bytes, groups of 5). */
std::string formatKey(const std::vector<std::uint8_t>& payload, const std::uint8_t signature[kSignatureBytes]);
/** Extracts the key symbols from pasted text or a .mdkey file (header lines starting with '#', the BEGIN/END
 *  armour lines and any line without key symbols are ignored). */
std::string extractKeyText(std::string_view fileOrText);
/** The text of a .mdkey file: human-readable comment header + the key between armour lines. */
std::string formatKeyFile(const std::string& keyText, const LicenceInfo& info, const std::string& machineCode);

/** Full verification: decode → check bytes → version → Ed25519 signature (`publicKey`, 32 bytes) → machine
 *  binding (constant-time) → expiry against `today`. Never throws; any malformed input is rejected. */
VerifyResult verifyKey(std::string_view keyText, std::string_view machineCode, const std::uint8_t publicKey[kPublicKeyBytes], std::uint16_t today);

}  // namespace thcad::license
