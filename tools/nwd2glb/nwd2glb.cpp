// nwd2glb — NWD / NWC / NWF → GLB without Navisworks or Autodesk services.
// Uses the independent nwd-reader library (https://github.com/1817716374/nwd-reader,
// PolyForm Noncommercial 1.0.0 — commercial use needs a licence from its author).
//
// Output: one glTF node per Navisworks object instance (name = nearest named ancestor),
// one mesh per (geometry, material) pair, metres, recentred near the origin.
// The removed offset (metres, glTF axes) is stored in asset.extras.nexus.origin.
//
// Usage: nwd2glb input.nwd output.glb
#include <nwd/reader.hpp>

#include <algorithm>
#include <array>
#include <filesystem>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <fstream>
#include <iostream>
#include <map>
#include <sstream>
#include <string>
#include <unordered_map>
#include <vector>

namespace {

std::string json_escape(std::string_view s) {
  std::string o;
  o.reserve(s.size() + 8);
  for (unsigned char c : s) {
    switch (c) {
    case '"': o += "\\\""; break;
    case '\\': o += "\\\\"; break;
    case '\n': o += "\\n"; break;
    case '\r': o += "\\r"; break;
    case '\t': o += "\\t"; break;
    default:
      if (c < 0x20) { char b[8]; std::snprintf(b, sizeof b, "\\u%04x", c); o += b; }
      else o += static_cast<char>(c);
    }
  }
  return o;
}

std::string num(double v) {
  if (!std::isfinite(v)) v = 0;
  char b[32];
  std::snprintf(b, sizeof b, "%.9g", v);
  return b;
}

struct MeshOut {
  uint32_t pos_view = 0, idx_view = 0, vertex_count = 0, index_count = 0;
  std::array<float, 3> mn{}, mx{};
  uint32_t material = 0;
};

struct Bin {
  std::vector<uint8_t> data;
  struct View { size_t offset, length; int target; };
  std::vector<View> views;
  uint32_t add(const void* p, size_t n, int target) {
    while (data.size() % 4) data.push_back(0);
    size_t off = data.size();
    const auto* b = static_cast<const uint8_t*>(p);
    data.insert(data.end(), b, b + n);
    views.push_back({off, n, target});
    return static_cast<uint32_t>(views.size() - 1);
  }
};

int run(const std::filesystem::path& input, const std::filesystem::path& output) {
  nwd::Options options;
  options.threads = 0;  // automatic
  nwd::Document document(input, options);
  auto scene = document.read_scene();

  Bin bin;
  std::vector<MeshOut> meshes;
  std::map<std::array<uint32_t, 4>, uint32_t> material_ids;  // rgba*255 → index
  std::vector<std::array<float, 4>> materials;
  struct NodeOut { std::string name, layer, klass; uint32_t mesh; std::array<double, 16> m; };
  std::vector<NodeOut> nodes;
  double gmin[3] = {1e300, 1e300, 1e300}, gmax[3] = {-1e300, -1e300, -1e300};
  size_t skipped_lines = 0, skipped_other = 0, triangles = 0;

  for (const auto& model : scene.models) {
    const double scale = model.meters_per_unit > 0 ? model.meters_per_unit : 1.0;
    // names: nearest ancestor with a non-empty name; layer = child of the root
    auto raw_name = [&](nwd::Id path) -> std::string {
      auto ref = nwd::path_reference(model, path);
      const auto& ob = nwd::resolve_object(model, ref);
      return std::string(nwd::resolve_string(model.graphs.at(ref.graph), ob.name));
    };
    auto klass = [&](nwd::Id path) -> std::string {
      auto ref = nwd::path_reference(model, path);
      const auto& ob = nwd::resolve_object(model, ref);
      return std::string(nwd::resolve_string(model.graphs.at(ref.graph), ob.class_name));
    };
    std::unordered_map<nwd::Id, std::string> name_cache;
    auto display = [&](nwd::Id path) -> std::string {
      nwd::Id p = path;
      for (int guard = 0; p != nwd::none && guard < 64; ++guard) {
        if (auto it = name_cache.find(p); it != name_cache.end()) return it->second;
        auto n = raw_name(p);
        if (!n.empty()) { name_cache[path] = n; return n; }
        p = model.paths.at(p).parent;
      }
      return "Object";
    };
    auto layer_of = [&](nwd::Id path) -> std::string {
      nwd::Id p = path, prev = path;
      for (int guard = 0; p != nwd::none && guard < 64; ++guard) {
        auto parent = model.paths.at(p).parent;
        if (parent == nwd::none || model.paths.at(parent).parent == nwd::none) { prev = p; break; }
        prev = p;
        p = parent;
      }
      return raw_name(prev);
    };

    std::map<std::pair<uint32_t, uint32_t>, uint32_t> mesh_for;  // (geometry, material) → mesh
    for (const auto& inst : model.instances) {
      if (inst.geometry_reference == nwd::none) continue;
      const auto& gref = model.geometry_references.at(inst.geometry_reference);
      if (gref.geometry == nwd::none) continue;
      const auto& g = model.geometries.at(gref.geometry);
      if (g.external) { ++skipped_other; continue; }
      if (g.type == 95) { ++skipped_lines; continue; }
      if (g.type != 94) { ++skipped_other; continue; }

      // material
      std::array<float, 4> rgba{0.62f, 0.66f, 0.72f, 1.f};
      if (inst.appearance != nwd::none && inst.appearance < model.appearances.size()) {
        auto mat = model.appearances[inst.appearance].material;
        if (mat != nwd::none && mat < model.materials.size()) {
          auto d = model.materials[mat].diffuse();
          rgba = {d[0], d[1], d[2], 1.f - std::clamp(model.materials[mat].transparency(), 0.f, 1.f)};
        }
      }
      std::array<uint32_t, 4> key{};
      for (int i = 0; i < 4; ++i) key[i] = static_cast<uint32_t>(std::lround(std::clamp(rgba[i], 0.f, 1.f) * 255));
      auto [mit, fresh] = material_ids.try_emplace(key, static_cast<uint32_t>(materials.size()));
      if (fresh) materials.push_back(rgba);

      auto mk = std::make_pair(static_cast<uint32_t>(gref.geometry), mit->second);
      auto found = mesh_for.find(mk);
      uint32_t mesh_index;
      if (found == mesh_for.end()) {
        auto tri = nwd::triangle_indices(g);
        if (tri.empty()) { ++skipped_other; continue; }
        // compact the used slots into a vertex array
        std::unordered_map<uint32_t, uint32_t> remap;
        std::vector<float> pos;
        std::vector<uint32_t> idx;
        idx.reserve(tri.size());
        MeshOut mo;
        mo.mn = {1e30f, 1e30f, 1e30f};
        mo.mx = {-1e30f, -1e30f, -1e30f};
        for (auto slot : tri) {
          auto [it, inserted] = remap.try_emplace(slot, static_cast<uint32_t>(pos.size() / 3));
          if (inserted) {
            uint32_t ci = g.coordinate_indices[slot];
            for (int k = 0; k < 3; ++k) {
              float v = g.coordinates[ci * 3 + k];
              pos.push_back(v);
              mo.mn[k] = std::min(mo.mn[k], v);
              mo.mx[k] = std::max(mo.mx[k], v);
            }
          }
          idx.push_back(it->second);
        }
        mo.vertex_count = static_cast<uint32_t>(pos.size() / 3);
        mo.index_count = static_cast<uint32_t>(idx.size());
        mo.pos_view = bin.add(pos.data(), pos.size() * 4, 34962);
        mo.idx_view = bin.add(idx.data(), idx.size() * 4, 34963);
        mo.material = mit->second;
        triangles += idx.size() / 3;
        mesh_index = static_cast<uint32_t>(meshes.size());
        meshes.push_back(mo);
        mesh_for.emplace(mk, mesh_index);
      } else {
        mesh_index = found->second;
        triangles += meshes[mesh_index].index_count / 3;
      }

      auto w = nwd::world_matrix(model, inst);
      // to metres
      for (int i = 0; i < 16; ++i) if (i % 4 != 3) w[i] *= scale;
      // world bbox from the mesh box corners
      const auto& mo = meshes[mesh_index];
      for (int c = 0; c < 8; ++c) {
        double p[3] = {c & 1 ? mo.mx[0] : mo.mn[0], c & 2 ? mo.mx[1] : mo.mn[1], c & 4 ? mo.mx[2] : mo.mn[2]};
        for (int r = 0; r < 3; ++r) {
          double v = w[r] * p[0] + w[4 + r] * p[1] + w[8 + r] * p[2] + w[12 + r];
          gmin[r] = std::min(gmin[r], v);
          gmax[r] = std::max(gmax[r], v);
        }
      }
      nodes.push_back({display(inst.path), layer_of(inst.path), klass(inst.path), mesh_index, w});
    }
  }
  if (nodes.empty()) throw std::runtime_error("no triangle geometry found in the file");

  // Always emit Y-up (glTF convention). Navisworks scenes are usually Z-up; DWF-derived ones may already be Y-up.
  const double ext0[3] = {gmax[0] - gmin[0], gmax[1] - gmin[1], gmax[2] - gmin[2]};
  const bool z_up = ext0[2] < ext0[1] * 0.5 && ext0[2] < ext0[0] * 0.5;  // flat in Z → Z is vertical
  if (z_up) {
    // R = rotation −90° about X: (x, y, z) → (x, z, −y), applied on the left of every node matrix
    for (auto& n : nodes)
      for (int c = 0; c < 4; ++c) {
        double y = n.m[c * 4 + 1], z = n.m[c * 4 + 2];
        n.m[c * 4 + 1] = z;
        n.m[c * 4 + 2] = -y;
      }
    double y0 = gmin[1], y1 = gmax[1];
    gmin[1] = gmin[2]; gmax[1] = gmax[2];
    gmin[2] = -y1; gmax[2] = -y0;
  }
  const double ext[3] = {gmax[0] - gmin[0], gmax[1] - gmin[1], gmax[2] - gmin[2]};
  double origin[3];
  for (int k = 0; k < 3; ++k) origin[k] = std::floor((gmin[k] + gmax[k]) / 2.0);
  origin[1] = 0;  // recentre horizontally only; keep true elevations

  std::ostringstream js;
  js << "{\"asset\":{\"version\":\"2.0\",\"generator\":\"NEXUS nwd2glb (nwd-reader)\",\"extras\":{\"nexus\":{\"source\":\""
     << json_escape(input.filename().string()) << "\",\"units\":\"m\",\"zUp\":false,\"sourceZUp\":" << (z_up ? "true" : "false")
     << ",\"origin\":[" << num(origin[0]) << "," << num(origin[1]) << "," << num(origin[2]) << "],\"triangles\":" << triangles
     << ",\"objects\":" << nodes.size() << "}}},";
  js << "\"scene\":0,\"scenes\":[{\"nodes\":[";
  for (size_t i = 0; i < nodes.size(); ++i) js << (i ? "," : "") << i;
  js << "]}],\"nodes\":[";
  for (size_t i = 0; i < nodes.size(); ++i) {
    auto m = nodes[i].m;
    for (int k = 0; k < 3; ++k) m[12 + k] -= origin[k];
    js << (i ? "," : "") << "{\"name\":\"" << json_escape(nodes[i].name) << "\",\"mesh\":" << nodes[i].mesh << ",\"matrix\":[";
    for (int k = 0; k < 16; ++k) js << (k ? "," : "") << num(m[k]);
    js << "],\"extras\":{\"layer\":\"" << json_escape(nodes[i].layer) << "\",\"class\":\"" << json_escape(nodes[i].klass) << "\"}}";
  }
  js << "],\"meshes\":[";
  std::vector<std::string> accessors;
  for (size_t i = 0; i < meshes.size(); ++i) {
    const auto& mo = meshes[i];
    uint32_t a_pos = static_cast<uint32_t>(accessors.size());
    accessors.push_back("{\"bufferView\":" + std::to_string(mo.pos_view) + ",\"componentType\":5126,\"count\":" + std::to_string(mo.vertex_count) +
                        ",\"type\":\"VEC3\",\"min\":[" + num(mo.mn[0]) + "," + num(mo.mn[1]) + "," + num(mo.mn[2]) + "],\"max\":[" + num(mo.mx[0]) + "," +
                        num(mo.mx[1]) + "," + num(mo.mx[2]) + "]}");
    uint32_t a_idx = static_cast<uint32_t>(accessors.size());
    accessors.push_back("{\"bufferView\":" + std::to_string(mo.idx_view) + ",\"componentType\":5125,\"count\":" + std::to_string(mo.index_count) + ",\"type\":\"SCALAR\"}");
    js << (i ? "," : "") << "{\"primitives\":[{\"attributes\":{\"POSITION\":" << a_pos << "},\"indices\":" << a_idx << ",\"material\":" << mo.material << "}]}";
  }
  js << "],\"materials\":[";
  for (size_t i = 0; i < materials.size(); ++i) {
    const auto& c = materials[i];
    js << (i ? "," : "") << "{\"name\":\"NW-" << i << "\",\"pbrMetallicRoughness\":{\"baseColorFactor\":[" << num(c[0]) << "," << num(c[1]) << "," << num(c[2]) << ","
       << num(c[3]) << "],\"metallicFactor\":0.15,\"roughnessFactor\":0.7},\"doubleSided\":true" << (c[3] < 0.99f ? ",\"alphaMode\":\"BLEND\"" : "") << "}";
  }
  js << "],\"accessors\":[";
  for (size_t i = 0; i < accessors.size(); ++i) js << (i ? "," : "") << accessors[i];
  js << "],\"bufferViews\":[";
  for (size_t i = 0; i < bin.views.size(); ++i)
    js << (i ? "," : "") << "{\"buffer\":0,\"byteOffset\":" << bin.views[i].offset << ",\"byteLength\":" << bin.views[i].length << ",\"target\":" << bin.views[i].target << "}";
  while (bin.data.size() % 4) bin.data.push_back(0);
  js << "],\"buffers\":[{\"byteLength\":" << bin.data.size() << "}]}";

  std::string json = js.str();
  while (json.size() % 4) json.push_back(' ');
  std::ofstream out(output, std::ios::binary);
  auto u32 = [&](uint32_t v) { out.write(reinterpret_cast<const char*>(&v), 4); };
  u32(0x46546C67); u32(2); u32(static_cast<uint32_t>(12 + 8 + json.size() + 8 + bin.data.size()));
  u32(static_cast<uint32_t>(json.size())); u32(0x4E4F534A); out.write(json.data(), json.size());
  u32(static_cast<uint32_t>(bin.data.size())); u32(0x004E4942); out.write(reinterpret_cast<const char*>(bin.data.data()), bin.data.size());
  out.close();

  std::cout << "{\"objects\":" << nodes.size() << ",\"meshes\":" << meshes.size() << ",\"materials\":" << materials.size()
            << ",\"triangles\":" << triangles << ",\"skippedLines\":" << skipped_lines << ",\"skippedOther\":" << skipped_other
            << ",\"zUp\":false,\"sourceZUp\":" << (z_up ? "true" : "false") << ",\"origin\":[" << num(origin[0]) << "," << num(origin[1]) << "," << num(origin[2]) << "]"
            << ",\"sizeMetres\":[" << num(ext[0]) << "," << num(ext[1]) << "," << num(ext[2]) << "]}\n";
  return 0;
}

}  // namespace

int main(int argc, char** argv) {
  if (argc != 3) {
    std::cerr << "usage: nwd2glb input.nwd output.glb\n";
    return 2;
  }
  try {
    return run(argv[1], argv[2]);
  } catch (const std::exception& e) {
    std::cerr << "nwd2glb: " << e.what() << "\n";
    return 1;
  }
}
