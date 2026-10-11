#include "thcad/core/command_bus.hpp"

#include <algorithm>
#include <unordered_map>
#include <unordered_set>

namespace thcad {

const char* toString(ErrorCode c) {
  switch (c) {
    case ErrorCode::LockedLayer: return "locked-layer";
    case ErrorCode::Degenerate: return "degenerate";
    case ErrorCode::UnknownEntity: return "unknown-entity";
    case ErrorCode::UnknownLayer: return "unknown-layer";
  }
  return "?";
}

namespace {

template <class... Ts>
struct overloaded : Ts... { using Ts::operator()...; };

bool isDegenerate(const Shape& s) {
  return std::visit(overloaded{
                        [](const Line& l) { return distance(l.a, l.b) < 1e-6; },
                        [](const Polyline& p) { return p.points.size() < 2; },
                        [](const CircleE& c) { return !(c.radius > 1e-6); },
                        [](const Arc& a) { return !(a.radius > 1e-6); },
                        [](const Text& t) { return t.value.find_first_not_of(" \t") == std::string::npos; },
                        [](const Dimension& d) { return distance(d.a, d.b) < 1e-6; },
                    },
                    s);
}

std::optional<ValidationError> checkLayer(const Document& doc, const std::string& layer) {
  const Layer* l = doc.findLayer(layer);
  if (!l) return ValidationError{ErrorCode::UnknownLayer, layer};
  if (l->locked) return ValidationError{ErrorCode::LockedLayer, layer};
  return std::nullopt;
}

}  // namespace

std::vector<std::string> resolveFilter(const Document& doc, const OpEraseWhere& f) {
  std::vector<std::string> ids;
  for (const auto& e : doc.entities) {
    const bool layerOk = f.layers.empty() || std::find(f.layers.begin(), f.layers.end(), e.props.layer) != f.layers.end();
    const bool kindOk = f.kinds.empty() || std::find(f.kinds.begin(), f.kinds.end(), kindName(e.shape)) != f.kinds.end();
    if (layerOk && kindOk) ids.push_back(e.id());
  }
  return ids;
}

std::optional<ValidationError> validate(const Document& doc, const CadOp& op) {
  return std::visit(
      overloaded{
          [&](const OpAdd& a) -> std::optional<ValidationError> {
            for (const auto& e : a.entities) {
              if (auto err = checkLayer(doc, e.props.layer)) return err;
              if (isDegenerate(e.shape)) return ValidationError{ErrorCode::Degenerate, kindName(e.shape)};
            }
            return std::nullopt;
          },
          [&](const OpErase& er) -> std::optional<ValidationError> {
            for (const auto& id : er.ids) {
              const Entity* e = doc.findEntity(id);
              if (!e) return ValidationError{ErrorCode::UnknownEntity, id};
              if (auto err = checkLayer(doc, e->props.layer)) return err;
            }
            return std::nullopt;
          },
          [&](const OpReplace& r) -> std::optional<ValidationError> {
            for (const auto& e : r.entities) {
              const Entity* prev = doc.findEntity(e.id());
              if (!prev) return ValidationError{ErrorCode::UnknownEntity, e.id()};
              if (auto err = checkLayer(doc, prev->props.layer)) return err;  // was editable
              if (auto err = checkLayer(doc, e.props.layer)) return err;      // target editable
              if (isDegenerate(e.shape)) return ValidationError{ErrorCode::Degenerate, kindName(e.shape)};
            }
            return std::nullopt;
          },
          [&](const OpSetCurrentLayer& s) -> std::optional<ValidationError> {
            if (!doc.findLayer(s.layer)) return ValidationError{ErrorCode::UnknownLayer, s.layer};
            return std::nullopt;
          },
          [&](const OpLayerProps& p) -> std::optional<ValidationError> {
            if (!doc.findLayer(p.name)) return ValidationError{ErrorCode::UnknownLayer, p.name};
            return std::nullopt;
          },
          [&](const OpEraseWhere& f) -> std::optional<ValidationError> {
            for (const auto& l : f.layers)
              if (!doc.findLayer(l)) return ValidationError{ErrorCode::UnknownLayer, l};
            const auto ids = resolveFilter(doc, f);
            if (ids.empty()) return ValidationError{ErrorCode::UnknownEntity, "filter selects nothing"};
            for (const auto& id : ids)
              if (auto err = checkLayer(doc, doc.findEntity(id)->props.layer)) return err;
            return std::nullopt;
          },
      },
      op.body);
}

Document preview(const Document& doc, const CadOp& op) {
  Document out = doc;
  std::visit(overloaded{
                 [&](const OpAdd& a) {
                   out.entities.insert(out.entities.end(), a.entities.begin(), a.entities.end());
                   out.dirty = true;
                 },
                 [&](const OpErase& er) {
                   std::unordered_set<std::string> ids(er.ids.begin(), er.ids.end());
                   std::erase_if(out.entities, [&](const Entity& e) { return ids.contains(e.id()); });
                   out.dirty = true;
                 },
                 [&](const OpReplace& r) {
                   std::unordered_map<std::string, const Entity*> byId;
                   for (const auto& e : r.entities) byId[e.id()] = &e;
                   for (auto& e : out.entities)
                     if (auto it = byId.find(e.id()); it != byId.end()) e = *it->second;
                   out.dirty = true;
                 },
                 [&](const OpSetCurrentLayer& s) { out.currentLayer = s.layer; },
                 [&](const OpEraseWhere& f) {
                   const auto v = resolveFilter(doc, f);
                   std::unordered_set<std::string> ids(v.begin(), v.end());
                   std::erase_if(out.entities, [&](const Entity& e) { return ids.contains(e.id()); });
                   out.dirty = true;
                 },
                 [&](const OpLayerProps& p) {
                   for (auto& l : out.layers)
                     if (l.name == p.name) {
                       if (p.visible) l.visible = *p.visible;
                       if (p.locked) l.locked = *p.locked;
                       if (p.color) l.color = *p.color;
                     }
                   out.dirty = true;
                 },
             },
             op.body);
  return out;
}

std::optional<ValidationError> CommandBus::execute(const CadOp& op) { return executeBatch({op}, op.label); }

std::optional<ValidationError> CommandBus::executeBatch(const std::vector<CadOp>& ops, const std::string& label) {
  Document next = doc_;
  for (const auto& op : ops) {
    if (auto err = validate(next, op)) return err;  // nothing is committed on failure
    next = preview(next, op);
  }
  undo_.push_back({label, doc_, next});
  if (undo_.size() > kMaxUndo) undo_.erase(undo_.begin());
  redo_.clear();
  doc_ = std::move(next);
  return std::nullopt;
}

std::optional<std::string> CommandBus::undo() {
  if (undo_.empty()) return std::nullopt;
  Step s = std::move(undo_.back());
  undo_.pop_back();
  doc_ = s.before;
  doc_.dirty = true;
  std::string label = s.label;
  redo_.push_back(std::move(s));
  return label;
}

std::optional<std::string> CommandBus::redo() {
  if (redo_.empty()) return std::nullopt;
  Step s = std::move(redo_.back());
  redo_.pop_back();
  doc_ = s.after;
  std::string label = s.label;
  undo_.push_back(std::move(s));
  return label;
}

}  // namespace thcad
