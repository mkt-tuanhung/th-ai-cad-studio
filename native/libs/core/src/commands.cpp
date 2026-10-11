#include "thcad/core/commands.hpp"

#include "number.hpp"

#include <algorithm>
#include <array>
#include <cctype>
#include <charconv>
#include <numbers>
#include <string>

namespace thcad {

namespace {
using SV = std::string_view;
constexpr std::array<SV, 1> L_{"L"};
constexpr std::array<SV, 1> PL_{"PL"};
constexpr std::array<SV, 2> REC_{"REC", "RECTANGLE"};
constexpr std::array<SV, 1> C_{"C"};
constexpr std::array<SV, 1> A_{"A"};
constexpr std::array<SV, 1> TR_{"TR"};
constexpr std::array<SV, 1> O_{"O"};
constexpr std::array<SV, 2> H_{"H", "BH"};
constexpr std::array<SV, 4> DIM_{"DIM", "DLI", "DIMALIGNED", "DAL"};
constexpr std::array<SV, 4> T_{"T", "DT", "MTEXT", "MT"};
constexpr std::array<SV, 1> M_{"M"};
constexpr std::array<SV, 1> E_{"E"};
constexpr std::array<SV, 1> U_{"U"};
constexpr std::array<SV, 1> Z_{"Z"};
constexpr std::array<SV, 1> OS_{"OS"};
constexpr std::array<SV, 1> SN_{"SN"};
constexpr std::array<SV, 1> LA_{"LA"};
constexpr std::array<SV, 2> PR_{"PR", "PROPS"};
constexpr std::array<SV, 1> SAVE_{"SAVE"};
constexpr std::array<SV, 1> QNEW_{"QNEW"};
constexpr std::array<SV, 1> EXPORT_{"EXPORT"};
constexpr std::array<SV, 1> PRINT_{"PRINT"};
constexpr std::span<const SV> none{};

using enum CommandStatus;
const std::array<CommandSpec, 28> kTable{{
    {"SELECT", none, Prototype}, {"LINE", L_, Prototype}, {"PLINE", PL_, Prototype}, {"RECTANG", REC_, Prototype},
    {"CIRCLE", C_, Prototype}, {"ARC", A_, Prototype}, {"TRIM", TR_, Native}, {"OFFSET", O_, Prototype},
    {"HATCH", H_, Native}, {"DIMLINEAR", DIM_, Prototype}, {"TEXT", T_, Prototype}, {"MOVE", M_, Prototype},
    {"ERASE", E_, Prototype}, {"UNDO", U_, Prototype}, {"REDO", none, Prototype}, {"ZOOM", Z_, Prototype},
    {"ORTHO", none, Prototype}, {"OSNAP", OS_, Prototype}, {"GRID", none, Prototype}, {"SNAP", SN_, Prototype},
    {"LAYER", LA_, Prototype}, {"PROPERTIES", PR_, Prototype}, {"QSAVE", SAVE_, Prototype}, {"SAVEAS", none, Prototype},
    {"NEW", QNEW_, Prototype}, {"OPEN", none, Prototype}, {"DXFOUT", EXPORT_, Prototype}, {"PLOT", PRINT_, Native},
}};

std::string upper(SV s) {
  std::string out(s);
  for (auto& c : out) c = static_cast<char>(std::toupper(static_cast<unsigned char>(c)));
  return out;
}

std::optional<double> number(SV s) { return detail::toDouble(s); }
}  // namespace

std::span<const CommandSpec> commandTable() { return kTable; }

const CommandSpec* resolveCommand(std::string_view input) {
  std::string k = upper(input);
  k.erase(0, k.find_first_not_of(" \t"));
  k.erase(k.find_last_not_of(" \t") + 1);
  k.erase(0, k.find_first_not_of("_.-"));  // _LINE, .LINE, -LAYER
  for (const auto& c : kTable) {
    if (c.name == k) return &c;
    if (std::find(c.aliases.begin(), c.aliases.end(), SV(k)) != c.aliases.end()) return &c;
  }
  return nullptr;
}

std::optional<Vec2> parsePointInput(std::string_view text, std::optional<Vec2> last) {
  std::string s;
  for (char c : text)
    if (!std::isspace(static_cast<unsigned char>(c))) s += c;
  const bool rel = !s.empty() && s[0] == '@';
  SV body = rel ? SV(s).substr(1) : SV(s);
  if (auto lt = body.find('<'); lt != SV::npos) {
    auto d = number(body.substr(0, lt));
    auto a = number(body.substr(lt + 1));
    if (!d || !a) return std::nullopt;
    const double r = *a * std::numbers::pi / 180;
    Vec2 v{*d * std::cos(r), *d * std::sin(r)};
    return last ? *last + v : v;
  }
  auto comma = body.find(',');
  if (comma == SV::npos) return std::nullopt;
  auto x = number(body.substr(0, comma));
  auto y = number(body.substr(comma + 1));
  if (!x || !y) return std::nullopt;
  Vec2 p{*x, *y};
  if (rel) return last ? std::optional<Vec2>(*last + p) : std::nullopt;
  return p;
}

}  // namespace thcad
