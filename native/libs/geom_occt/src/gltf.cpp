// glTF 2.0 binary (GLB) writer for the discipline scenes (SP38). Written here rather than with OCCT's
// RWGltf_CafWriter: that writer needs RapidJSON (absent from the Windows vcpkg OCCT feature set used by CI)
// and an XCAF document; this one tessellates the same exact B-rep with BRepMesh and writes plain glTF.
//
// Conventions (glTF 2.0 §3.4): metres, +Y up, right-handed. The scene is mm with +Z up, so a scene point
// (x, y, z) mm is written as (x, z, −y) / 1000 — a proper rotation, triangle winding is kept. Blender's
// glTF importer maps it back to (x, y, z) / 1000 m, Z up.
#include "gltf_impl.hpp"

#include <BRepBndLib.hxx>
#include <BRepLib_ToolTriangulatedShape.hxx>
#include <BRepMesh_IncrementalMesh.hxx>
#include <BRep_Tool.hxx>
#include <Bnd_Box.hxx>
#include <Poly_Triangulation.hxx>
#include <TopExp_Explorer.hxx>
#include <TopLoc_Location.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Face.hxx>

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <limits>
#include <map>
#include <sstream>

namespace thcad::occt {

namespace {

std::string esc(const std::string& s) {
  std::string o;
  o.reserve(s.size() + 2);
  for (unsigned char c : s) {
    if (c == '"' || c == '\\') o += '\\', o += char(c);
    else if (c < 0x20) {
      char b[8];
      std::snprintf(b, sizeof b, "\\u%04x", c);
      o += b;
    } else o += char(c);
  }
  return o;
}

std::string num(double v) {
  if (!std::isfinite(v)) v = 0;
  char b[32];
  std::snprintf(b, sizeof b, "%.9g", v);
  return b;
}

int byte(double c) { return int(std::lround(std::clamp(c, 0.0, 1.0) * 255)); }

struct Mesh {
  std::vector<float> pos, nrm;
  std::vector<uint32_t> idx;
  float lo[3]{std::numeric_limits<float>::max(), std::numeric_limits<float>::max(), std::numeric_limits<float>::max()};
  float hi[3]{-std::numeric_limits<float>::max(), -std::numeric_limits<float>::max(), -std::numeric_limits<float>::max()};
};

/** Triangles of a shape in glTF space (metres, Y up). */
Mesh tessellate(const TopoDS_Shape& shape, double bmm[6]) {
  Mesh m;
  Bnd_Box box;
  BRepBndLib::Add(shape, box);
  double diag = 1000;
  if (!box.IsVoid()) diag = std::sqrt(box.SquareExtent());
  // ~0.15 % of the item size, 0.5 … 20 mm: furniture stays smooth, a 30 m slab stays light
  const double lin = std::clamp(diag * 0.0015, 0.5, 20.0);
  BRepMesh_IncrementalMesh(shape, lin, false, 0.35, true);
  for (TopExp_Explorer ex(shape, TopAbs_FACE); ex.More(); ex.Next()) {
    const TopoDS_Face& f = TopoDS::Face(ex.Current());
    TopLoc_Location loc;
    Handle(Poly_Triangulation) tri = BRep_Tool::Triangulation(f, loc);
    if (tri.IsNull() || tri->NbTriangles() == 0) continue;
    if (!tri->HasNormals()) BRepLib_ToolTriangulatedShape::ComputeNormals(f, tri);
    const gp_Trsf T = loc.Transformation();
    const bool rev = f.Orientation() == TopAbs_REVERSED;
    const uint32_t base = uint32_t(m.pos.size() / 3);
    for (int i = 1; i <= tri->NbNodes(); ++i) {
      const gp_Pnt p = tri->Node(i).Transformed(T);
      gp_Dir n = tri->HasNormals() ? tri->Normal(i) : gp_Dir(0, 0, 1);
      n.Transform(T);
      if (rev) n.Reverse();
      bmm[0] = std::min(bmm[0], p.X()), bmm[1] = std::min(bmm[1], p.Y()), bmm[2] = std::min(bmm[2], p.Z());
      bmm[3] = std::max(bmm[3], p.X()), bmm[4] = std::max(bmm[4], p.Y()), bmm[5] = std::max(bmm[5], p.Z());
      const float g[3] = {float(p.X() / 1000), float(p.Z() / 1000), float(-p.Y() / 1000)};
      for (int k = 0; k < 3; ++k) {
        m.pos.push_back(g[k]);
        m.lo[k] = std::min(m.lo[k], g[k]);
        m.hi[k] = std::max(m.hi[k], g[k]);
      }
      m.nrm.push_back(float(n.X())), m.nrm.push_back(float(n.Z())), m.nrm.push_back(float(-n.Y()));
    }
    for (int t = 1; t <= tri->NbTriangles(); ++t) {
      int a, b, c;
      tri->Triangle(t).Get(a, b, c);
      if (rev) std::swap(b, c);
      m.idx.push_back(base + uint32_t(a - 1)), m.idx.push_back(base + uint32_t(b - 1)), m.idx.push_back(base + uint32_t(c - 1));
    }
  }
  return m;
}

/** PBR parameters of a path-tracer surface model (matte / glossy / metal / glass / emissive). */
std::string materialJson(const std::string& name, const std::string& mat, const std::array<double, 3>& rgb, double transparency, bool* transmission, bool* emissive) {
  double metallic = 0, rough = 0.85, alpha = 1;
  bool blend = false;
  std::string ext;
  if (mat == "glossy") rough = 0.3;
  else if (mat == "metal") metallic = 1, rough = 0.28;
  else if (mat == "glass") {
    rough = 0.04, alpha = 0.25, blend = true;
    ext = "\"KHR_materials_transmission\":{\"transmissionFactor\":0.92},\"KHR_materials_ior\":{\"ior\":1.5}";
    *transmission = true;
  } else if (mat == "emissive") {
    ext = "\"KHR_materials_emissive_strength\":{\"emissiveStrength\":6}";
    *emissive = true;
  }
  if (mat != "glass" && transparency > 0) alpha = std::clamp(1 - transparency, 0.02, 1.0), blend = true;
  std::ostringstream o;
  o << "{\"name\":\"" << esc(name) << "\",\"pbrMetallicRoughness\":{\"baseColorFactor\":[" << num(rgb[0]) << ',' << num(rgb[1]) << ',' << num(rgb[2]) << ',' << num(alpha)
    << "],\"metallicFactor\":" << num(metallic) << ",\"roughnessFactor\":" << num(rough) << "},\"doubleSided\":true";
  if (blend) o << ",\"alphaMode\":\"BLEND\"";
  if (mat == "emissive") o << ",\"emissiveFactor\":[" << num(rgb[0]) << ',' << num(rgb[1]) << ',' << num(rgb[2]) << ']';
  if (!ext.empty()) o << ",\"extensions\":{" << ext << '}';
  o << ",\"extras\":{\"mdMat\":\"" << esc(mat) << "\",\"presentationOnly\":true}}";
  return o.str();
}

}  // namespace

std::string glbMaterialName(const std::string& mat, const std::array<double, 3>& rgb, double transparency) {
  char hex[8];
  std::snprintf(hex, sizeof hex, "%02x%02x%02x", byte(rgb[0]), byte(rgb[1]), byte(rgb[2]));
  std::string n = "md:" + (mat.empty() ? std::string("matte") : mat) + ":" + hex;
  const int t = int(std::lround(std::clamp(transparency, 0.0, 1.0) * 100));
  if (t > 0) n += ":t" + std::to_string(t);
  return n;
}

std::string writeGlbFile(const std::vector<GlbItem>& items, const std::string& path, GlbStats* stats) {
  if (items.empty()) return "empty scene";
  std::vector<unsigned char> bin;
  auto append = [&](const void* p, size_t n) {
    const auto* c = static_cast<const unsigned char*>(p);
    bin.insert(bin.end(), c, c + n);
    while (bin.size() % 4) bin.push_back(0);
  };
  std::map<std::string, int> matIndex;
  std::vector<std::string> matJson, matNames;
  bool transmission = false, emissive = false;
  std::ostringstream nodes, meshes, accessors, views;
  int nNodes = 0, nAcc = 0, nViews = 0, nTris = 0, nVerts = 0;
  double bmm[6] = {1e300, 1e300, 1e300, -1e300, -1e300, -1e300};
  for (const GlbItem& it : items) {
    if (it.shape.IsNull()) continue;
    Mesh m = tessellate(it.shape, bmm);
    if (m.idx.empty()) continue;
    const std::string mname = glbMaterialName(it.mat, it.rgb, it.transparency);
    auto [mi, fresh] = matIndex.try_emplace(mname, int(matJson.size()));
    if (fresh) {
      matJson.push_back(materialJson(mname, it.mat.empty() ? "matte" : it.mat, it.rgb, it.transparency, &transmission, &emissive));
      matNames.push_back(mname);
    }
    const size_t vOff = bin.size();
    append(m.pos.data(), m.pos.size() * 4);
    const size_t nOff = bin.size();
    append(m.nrm.data(), m.nrm.size() * 4);
    const size_t iOff = bin.size();
    append(m.idx.data(), m.idx.size() * 4);
    const int nv = int(m.pos.size() / 3);
    auto view = [&](size_t off, size_t len, int target) {
      if (nViews) views << ',';
      views << "{\"buffer\":0,\"byteOffset\":" << off << ",\"byteLength\":" << len << ",\"target\":" << target << '}';
      return nViews++;
    };
    const int bvP = view(vOff, m.pos.size() * 4, 34962), bvN = view(nOff, m.nrm.size() * 4, 34962), bvI = view(iOff, m.idx.size() * 4, 34963);
    auto acc = [&](int bv, int count, const char* type, int comp, const std::string& minmax) {
      if (nAcc) accessors << ',';
      accessors << "{\"bufferView\":" << bv << ",\"componentType\":" << comp << ",\"count\":" << count << ",\"type\":\"" << type << '"' << minmax << '}';
      return nAcc++;
    };
    const std::string mm = ",\"min\":[" + num(m.lo[0]) + ',' + num(m.lo[1]) + ',' + num(m.lo[2]) + "],\"max\":[" + num(m.hi[0]) + ',' + num(m.hi[1]) + ',' + num(m.hi[2]) + ']';
    const int aP = acc(bvP, nv, "VEC3", 5126, mm), aN = acc(bvN, nv, "VEC3", 5126, ""), aI = acc(bvI, int(m.idx.size()), "SCALAR", 5125, "");
    if (nNodes) meshes << ',', nodes << ',';
    meshes << "{\"name\":\"" << esc(it.id) << "\",\"primitives\":[{\"attributes\":{\"POSITION\":" << aP << ",\"NORMAL\":" << aN << "},\"indices\":" << aI << ",\"material\":" << mi->second << ",\"mode\":4}]}";
    nodes << "{\"name\":\"" << esc(it.id) << "\",\"mesh\":" << nNodes << ",\"extras\":{\"mdId\":\"" << esc(it.id) << "\",\"mdMat\":\"" << esc(it.mat) << "\",\"mdGroup\":\"" << esc(it.group) << "\",\"mdMaterial\":\"" << esc(mname) << "\"}}";
    ++nNodes;
    nTris += int(m.idx.size() / 3);
    nVerts += nv;
  }
  if (!nNodes) return "nothing to export (no triangles)";
  std::ostringstream js;
  js << "{\"asset\":{\"version\":\"2.0\",\"generator\":\"MD CAD AI STUDIO glTF writer (Open CASCADE tessellation)\",\"extras\":{\"units\":\"m\",\"sourceUnits\":\"mm\",\"upAxis\":\"Y\",\"sourceUpAxis\":\"Z\",\"presentationOnly\":true,\"note\":\"Presentation geometry. Not for BOM, quantities or CNC.\"}}";
  std::vector<std::string> used;
  if (transmission) used.push_back("KHR_materials_transmission"), used.push_back("KHR_materials_ior");
  if (emissive) used.push_back("KHR_materials_emissive_strength");
  if (!used.empty()) {
    js << ",\"extensionsUsed\":[";
    for (size_t i = 0; i < used.size(); ++i) js << (i ? "," : "") << '"' << used[i] << '"';
    js << ']';
  }
  js << ",\"scene\":0,\"scenes\":[{\"name\":\"MD CAD scene\",\"nodes\":[";
  for (int i = 0; i < nNodes; ++i) js << (i ? "," : "") << i;
  js << "]}],\"nodes\":[" << nodes.str() << "],\"meshes\":[" << meshes.str() << "],\"materials\":[";
  for (size_t i = 0; i < matJson.size(); ++i) js << (i ? "," : "") << matJson[i];
  js << "],\"accessors\":[" << accessors.str() << "],\"bufferViews\":[" << views.str() << "],\"buffers\":[{\"byteLength\":" << bin.size() << "}]}";
  std::string json = js.str();
  while (json.size() % 4) json += ' ';
  const uint32_t total = uint32_t(12 + 8 + json.size() + 8 + bin.size());
  std::ofstream f(path, std::ios::binary | std::ios::trunc);
  if (!f) return "cannot write " + path;
  auto u32 = [&](uint32_t v) { f.write(reinterpret_cast<const char*>(&v), 4); };  // little-endian hosts (arm64, x64)
  u32(0x46546C67), u32(2), u32(total);
  u32(uint32_t(json.size())), u32(0x4E4F534A);
  f.write(json.data(), std::streamsize(json.size()));
  u32(uint32_t(bin.size())), u32(0x004E4942);
  f.write(reinterpret_cast<const char*>(bin.data()), std::streamsize(bin.size()));
  f.close();
  if (!f) return "cannot write " + path;
  if (stats) {
    stats->nodes = nNodes, stats->triangles = nTris, stats->vertices = nVerts, stats->materials = matNames, stats->bytes = total;
    for (int k = 0; k < 6; ++k) stats->boundsMm[k] = bmm[k];
  }
  return {};
}

}  // namespace thcad::occt
