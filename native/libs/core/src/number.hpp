#pragma once
// Locale-independent double parsing (libc++ on macOS < 26 lacks floating-point from_chars).
#include <cstdlib>
#include <optional>
#include <string>
#include <string_view>
#if defined(_WIN32)
#include <locale.h>
#elif defined(__APPLE__)
#include <xlocale.h>
#else
#include <locale.h>
#endif

namespace thcad::detail {

/** Parses a JSON/DXF style number at the start of `s`; returns value and characters consumed. */
inline std::optional<std::pair<double, size_t>> parseDouble(std::string_view s) {
  size_t n = 0;
  auto digit = [&](size_t i) { return i < s.size() && s[i] >= '0' && s[i] <= '9'; };
  if (n < s.size() && (s[n] == '-' || s[n] == '+')) ++n;
  const size_t intStart = n;
  while (digit(n)) ++n;
  if (n < s.size() && s[n] == '.') { ++n; while (digit(n)) ++n; }
  if (n == intStart || (n == intStart + 1 && s[intStart] == '.')) return std::nullopt;
  if (n < s.size() && (s[n] == 'e' || s[n] == 'E')) {
    size_t m = n + 1;
    if (m < s.size() && (s[m] == '-' || s[m] == '+')) ++m;
    if (digit(m)) { n = m; while (digit(n)) ++n; }
  }
  const std::string tmp(s.substr(0, n));
#if defined(_WIN32)
  static _locale_t c = _create_locale(LC_NUMERIC, "C");
  return std::pair{_strtod_l(tmp.c_str(), nullptr, c), n};
#else
  static locale_t c = newlocale(LC_NUMERIC_MASK, "C", nullptr);
  return std::pair{strtod_l(tmp.c_str(), nullptr, c), n};
#endif
}

/** Whole-string parse. */
inline std::optional<double> toDouble(std::string_view s) {
  auto r = parseDouble(s);
  if (!r || r->second != s.size()) return std::nullopt;
  return r->first;
}

}  // namespace thcad::detail
