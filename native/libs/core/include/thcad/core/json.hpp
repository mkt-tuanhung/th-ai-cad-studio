#pragma once
// Minimal JSON value + parser/serializer (RFC 8259 subset sufficient for the bridge and AI tool calls).
// Kept dependency-free so thcad_core builds without Qt.
#include <map>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <variant>
#include <vector>

namespace thcad::json {

struct Value;
using Array = std::vector<Value>;
using Object = std::map<std::string, Value, std::less<>>;

struct Value {
  std::variant<std::nullptr_t, bool, double, std::string, std::shared_ptr<Array>, std::shared_ptr<Object>> v = nullptr;

  Value() = default;
  Value(std::nullptr_t) {}
  Value(bool b) : v(b) {}
  Value(double d) : v(d) {}
  Value(int i) : v(static_cast<double>(i)) {}
  Value(std::string s) : v(std::move(s)) {}
  Value(const char* s) : v(std::string(s)) {}
  Value(Array a) : v(std::make_shared<Array>(std::move(a))) {}
  Value(Object o) : v(std::make_shared<Object>(std::move(o))) {}

  bool isNull() const { return std::holds_alternative<std::nullptr_t>(v); }
  const std::string* str() const { return std::get_if<std::string>(&v); }
  const double* num() const { return std::get_if<double>(&v); }
  const bool* boolean() const { return std::get_if<bool>(&v); }
  const Array* arr() const { auto p = std::get_if<std::shared_ptr<Array>>(&v); return p ? p->get() : nullptr; }
  const Object* obj() const { auto p = std::get_if<std::shared_ptr<Object>>(&v); return p ? p->get() : nullptr; }
  const Value* get(std::string_view key) const;
};

struct ParseError {
  size_t offset;
  std::string message;
};

std::variant<Value, ParseError> parse(std::string_view text);
std::string stringify(const Value& v);

}  // namespace thcad::json
