#include "thcad/core/json.hpp"

#include "number.hpp"

#include <charconv>
#include <cmath>
#include <cmath>
#include <cstdio>

namespace thcad::json {

const Value* Value::get(std::string_view key) const {
  const Object* o = obj();
  if (!o) return nullptr;
  auto it = o->find(key);
  return it == o->end() ? nullptr : &it->second;
}

namespace {

struct Parser {
  std::string_view s;
  size_t i = 0;
  std::optional<ParseError> err;

  void ws() {
    while (i < s.size() && (s[i] == ' ' || s[i] == '\n' || s[i] == '\r' || s[i] == '\t')) ++i;
  }
  Value fail(std::string m) {
    if (!err) err = ParseError{i, std::move(m)};
    return {};
  }
  bool lit(std::string_view w) {
    if (s.substr(i, w.size()) != w) return false;
    i += w.size();
    return true;
  }
  static void utf8(std::string& out, unsigned cp) {
    if (cp < 0x80) out += static_cast<char>(cp);
    else if (cp < 0x800) { out += static_cast<char>(0xC0 | (cp >> 6)); out += static_cast<char>(0x80 | (cp & 0x3F)); }
    else if (cp < 0x10000) { out += static_cast<char>(0xE0 | (cp >> 12)); out += static_cast<char>(0x80 | ((cp >> 6) & 0x3F)); out += static_cast<char>(0x80 | (cp & 0x3F)); }
    else { out += static_cast<char>(0xF0 | (cp >> 18)); out += static_cast<char>(0x80 | ((cp >> 12) & 0x3F)); out += static_cast<char>(0x80 | ((cp >> 6) & 0x3F)); out += static_cast<char>(0x80 | (cp & 0x3F)); }
  }
  std::optional<std::string> string() {
    if (i >= s.size() || s[i] != '"') return std::nullopt;
    ++i;
    std::string out;
    while (i < s.size() && s[i] != '"') {
      char c = s[i++];
      if (c != '\\') { out += c; continue; }
      if (i >= s.size()) return std::nullopt;
      char e = s[i++];
      switch (e) {
        case '"': out += '"'; break;
        case '\\': out += '\\'; break;
        case '/': out += '/'; break;
        case 'b': out += '\b'; break;
        case 'f': out += '\f'; break;
        case 'n': out += '\n'; break;
        case 'r': out += '\r'; break;
        case 't': out += '\t'; break;
        case 'u': {
          if (i + 4 > s.size()) return std::nullopt;
          unsigned cp = 0;
          std::from_chars(s.data() + i, s.data() + i + 4, cp, 16);
          i += 4;
          if (cp >= 0xD800 && cp < 0xDC00 && i + 6 <= s.size() && s[i] == '\\' && s[i + 1] == 'u') {
            unsigned lo = 0;
            std::from_chars(s.data() + i + 2, s.data() + i + 6, lo, 16);
            i += 6;
            cp = 0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00);
          }
          utf8(out, cp);
          break;
        }
        default: return std::nullopt;
      }
    }
    if (i >= s.size()) return std::nullopt;
    ++i;
    return out;
  }
  Value value(int depth = 0) {
    if (depth > 64) return fail("nesting too deep");
    ws();
    if (i >= s.size()) return fail("unexpected end");
    char c = s[i];
    if (c == '{') {
      ++i;
      Object o;
      ws();
      if (i < s.size() && s[i] == '}') { ++i; return o; }
      while (true) {
        ws();
        auto k = string();
        if (!k) return fail("expected key");
        ws();
        if (i >= s.size() || s[i] != ':') return fail("expected ':'");
        ++i;
        o[*k] = value(depth + 1);
        if (err) return {};
        ws();
        if (i < s.size() && s[i] == ',') { ++i; continue; }
        if (i < s.size() && s[i] == '}') { ++i; return o; }
        return fail("expected ',' or '}'");
      }
    }
    if (c == '[') {
      ++i;
      Array a;
      ws();
      if (i < s.size() && s[i] == ']') { ++i; return a; }
      while (true) {
        a.push_back(value(depth + 1));
        if (err) return {};
        ws();
        if (i < s.size() && s[i] == ',') { ++i; continue; }
        if (i < s.size() && s[i] == ']') { ++i; return a; }
        return fail("expected ',' or ']'");
      }
    }
    if (c == '"') {
      auto str = string();
      return str ? Value(*str) : fail("bad string");
    }
    if (lit("true")) return true;
    if (lit("false")) return false;
    if (lit("null")) return nullptr;
    auto num = detail::parseDouble(s.substr(i));
    if (!num) return fail("unexpected character");
    i += num->second;
    return num->first;
  }
};

void write(std::string& out, const Value& v) {
  if (v.isNull()) out += "null";
  else if (auto b = v.boolean()) out += *b ? "true" : "false";
  else if (auto n = v.num()) {
    if (!std::isfinite(*n)) { out += "null"; return; }
    char buf[32];
    if (*n == std::floor(*n) && std::abs(*n) < 1e15) std::snprintf(buf, sizeof buf, "%.0f", *n);
    else std::snprintf(buf, sizeof buf, "%.17g", *n);
    out += buf;
  } else if (auto s = v.str()) {
    out += '"';
    for (unsigned char c : *s) {
      switch (c) {
        case '"': out += "\\\""; break;
        case '\\': out += "\\\\"; break;
        case '\n': out += "\\n"; break;
        case '\r': out += "\\r"; break;
        case '\t': out += "\\t"; break;
        default:
          if (c < 0x20) { char b[8]; std::snprintf(b, sizeof b, "\\u%04x", c); out += b; }
          else out += static_cast<char>(c);
      }
    }
    out += '"';
  } else if (auto a = v.arr()) {
    out += '[';
    for (size_t k = 0; k < a->size(); ++k) { if (k) out += ','; write(out, (*a)[k]); }
    out += ']';
  } else if (auto o = v.obj()) {
    out += '{';
    bool first = true;
    for (const auto& [k, val] : *o) {
      if (!first) out += ',';
      first = false;
      write(out, Value(k));
      out += ':';
      write(out, val);
    }
    out += '}';
  }
}

}  // namespace

std::variant<Value, ParseError> parse(std::string_view text) {
  Parser p{text, 0, std::nullopt};
  Value v = p.value();
  if (!p.err) {
    p.ws();
    if (p.i != text.size()) p.fail("trailing characters");
  }
  if (p.err) return *p.err;
  return v;
}

std::string stringify(const Value& v) {
  std::string out;
  write(out, v);
  return out;
}

}  // namespace thcad::json
