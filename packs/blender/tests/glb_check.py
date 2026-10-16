# SPDX-License-Identifier: GPL-3.0-or-later
"""Eigener, vom Add-on unabhängiger GLB-Leser für die Tests (nur Standardbibliothek).

Prüft, was der Shop braucht (research/3d-konventionen.md): keine eingebetteten Bilder,
Bilder per relativer uri und vorhanden, keine Kameras/Lichter, keine Kompression,
Dreiecke im Budget, stimmige Puffer.
"""

import json
import struct
from pathlib import Path

ELEMENT_SIZES = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4}
TYPE_COMPONENTS = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT2": 4, "MAT3": 9, "MAT4": 16}
FORBIDDEN = {"KHR_draco_mesh_compression", "EXT_meshopt_compression", "KHR_meshopt_compression", "KHR_texture_basisu", "KHR_lights_punctual"}


def parse_glb(path):
    """Liefert (json, bin_bytes, chunk_typen). Wirft AssertionError bei Formfehlern."""
    data = Path(path).read_bytes()
    magic, version, length = struct.unpack_from("<4sII", data, 0)
    assert magic == b"glTF", "Kopfkennung"
    assert version == 2, "Version"
    assert length == len(data), f"Länge {length} != {len(data)}"
    pos, chunks, gltf, binary = 12, [], None, b""
    while pos < len(data):
        clen, ctype = struct.unpack_from("<I4s", data, pos)
        pos += 8
        assert clen % 4 == 0, "Chunk nicht 4-Byte-ausgerichtet"
        body = data[pos : pos + clen]
        assert len(body) == clen, "Chunk abgeschnitten"
        pos += clen
        chunks.append(ctype)
        if ctype == b"JSON":
            gltf = json.loads(body.decode("utf-8"))
        elif ctype == b"BIN\x00":
            binary = body
    assert gltf is not None, "JSON-Chunk fehlt"
    assert chunks[0] == b"JSON", "JSON-Chunk muss zuerst kommen"
    return gltf, binary, chunks


def webp_dims(blob):
    assert blob[:4] == b"RIFF" and blob[8:12] == b"WEBP", "kein WebP"
    tag = blob[12:16]
    if tag == b"VP8X":
        return 1 + int.from_bytes(blob[24:27], "little"), 1 + int.from_bytes(blob[27:30], "little")
    if tag == b"VP8L":
        bits = int.from_bytes(blob[21:25], "little")
        return (bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1
    return int.from_bytes(blob[26:28], "little") & 0x3FFF, int.from_bytes(blob[28:30], "little") & 0x3FFF


def triangles(gltf):
    """Dreiecke aller Knoten (Instanzen zählen mehrfach)."""
    total = 0
    for node in gltf.get("nodes", []):
        if "mesh" not in node:
            continue
        for prim in gltf["meshes"][node["mesh"]]["primitives"]:
            assert prim.get("mode", 4) == 4, "nur Dreiecke erwartet"
            acc = prim.get("indices", prim["attributes"]["POSITION"])
            total += gltf["accessors"][acc]["count"] // 3
    return total


def check_conformance(path, *, max_tex_px=512, expect_tris=None, expect_images=None):
    """Stellt die Shop-Konventionen fest; liefert (gltf, Bildnamen)."""
    path = Path(path)
    gltf, binary, chunks = parse_glb(path)

    # Puffer-Integrität (prüft das Umpacken des BIN-Chunks unabhängig vom Add-on)
    views = gltf.get("bufferViews", [])
    if views:
        assert chunks[-1] == b"BIN\x00", "BIN-Chunk fehlt"
        assert gltf["buffers"][0]["byteLength"] <= len(binary), "buffer.byteLength größer als BIN-Chunk"
        assert len(binary) - gltf["buffers"][0]["byteLength"] < 4, "BIN-Chunk hat mehr als Auffüllbytes"
    for i, view in enumerate(views):
        off = view.get("byteOffset", 0)
        assert off % 4 == 0, f"bufferView {i} nicht ausgerichtet"
        assert off + view["byteLength"] <= len(binary), f"bufferView {i} reicht über den BIN-Chunk"
    for i, acc in enumerate(gltf.get("accessors", [])):
        if "bufferView" not in acc:
            continue
        view = views[acc["bufferView"]]
        size = ELEMENT_SIZES[acc["componentType"]] * TYPE_COMPONENTS[acc["type"]]
        stride = view.get("byteStride", size)
        need = acc.get("byteOffset", 0) + stride * (acc["count"] - 1) + size
        assert need <= view["byteLength"], f"Zugriff {i} reicht über seinen bufferView"
    # Nur bufferViews, die jemand benutzt (keine Reste von Bildern)
    used = {a["bufferView"] for a in gltf.get("accessors", []) if "bufferView" in a}
    assert used == set(range(len(views))), f"ungenutzte bufferViews: {sorted(set(range(len(views))) - used)}"

    # Bilder extern
    names = []
    for i, img in enumerate(gltf.get("images", [])):
        assert "bufferView" not in img, f"Bild {i} ist eingebettet"
        uri = img.get("uri")
        assert uri and not uri.startswith(("data:", "/", "http")) and ".." not in uri and "/" not in uri, f"uri {uri!r}"
        assert uri.endswith(".webp"), f"{uri} ist kein .webp"
        file = path.with_name(uri)
        assert file.is_file(), f"{uri} fehlt"
        w, h = webp_dims(file.read_bytes())
        assert w & (w - 1) == 0 and h & (h - 1) == 0, f"{uri} {w}x{h} keine Potenz von 2"
        assert max(w, h) <= max_tex_px, f"{uri} {w}x{h} > {max_tex_px}"
        names.append(uri)
    if expect_images is not None:
        assert sorted(names) == sorted(expect_images), f"Bilder {sorted(names)} != {sorted(expect_images)}"

    # Verbotenes
    assert not gltf.get("cameras"), "Kameras in der GLB"
    for ext in gltf.get("extensionsUsed", []) + gltf.get("extensionsRequired", []):
        assert ext not in FORBIDDEN, f"verbotene Erweiterung {ext}"
    for node in gltf.get("nodes", []):
        assert "camera" not in node, "Kamera-Knoten"
        assert "KHR_lights_punctual" not in node.get("extensions", {}), "Licht-Knoten"
    for mat in gltf.get("materials", []):
        assert mat.get("alphaMode", "OPAQUE") in {"OPAQUE", "MASK"}, f"alphaMode {mat.get('alphaMode')}"
    assert len(gltf.get("materials", [])) <= 2, "mehr als 2 Materialien"
    for samp in gltf.get("samplers", []):
        assert samp.get("magFilter", 9729) == 9729, "magFilter nicht linear"

    if expect_tris is not None:
        assert triangles(gltf) == expect_tris, f"Dreiecke {triangles(gltf)} != {expect_tris}"
    return gltf, names
