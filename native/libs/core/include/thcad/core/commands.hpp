#pragma once
// AutoCAD-compatible command table — the specification shared with ui/src/cad/commands.ts.
// `Status::Prototype` = implemented in the UI prototype; `Status::Native` = requires this engine.
#include <optional>
#include <span>
#include <string>
#include <string_view>

#include "thcad/core/geometry.hpp"

namespace thcad {

enum class CommandStatus { Prototype, Native };

struct CommandSpec {
  std::string_view name;
  std::span<const std::string_view> aliases;
  CommandStatus status;
};

std::span<const CommandSpec> commandTable();
/** Resolves "l", "_LINE", "Rec" … to a command (case-insensitive, AutoCAD prefixes stripped). */
const CommandSpec* resolveCommand(std::string_view input);

/** AutoCAD point input: "x,y" absolute · "@dx,dy" relative · "@d<angle" polar (degrees). */
std::optional<Vec2> parsePointInput(std::string_view text, std::optional<Vec2> last);

}  // namespace thcad
