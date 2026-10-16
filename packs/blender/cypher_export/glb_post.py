# SPDX-License-Identifier: GPL-3.0-or-later
"""Nachbearbeitung und Prüfung von GLB-Dateien (reines Python, ohne bpy).

Der Blender-Exporter bettet Bilder bei GLB immer in den BIN-Chunk ein. Die
Shop-CSP (`img-src 'self' data:`) blockiert die daraus entstehenden `blob:`-Adressen
des three.js-GLTFLoader (research/3d-konventionen.md, Punkt 2). Darum löst
`externalize_images` die Bilder heraus, schreibt sie als eigene Dateien neben die
.glb und ersetzt `bufferView` durch eine relative `uri`.
"""

from __future__ import annotations

import json
import os
import struct
from dataclasses import dataclass
from pathlib import Path
from typing import Any

GLB_MAGIC = 0x46546C67  # "glTF"
CHUNK_JSON = 0x4E4F534A  # "JSON"
CHUNK_BIN = 0x004E4942  # "BIN\0"

# Texturrollen -> Dateinamenbestandteil (`<name>-basis.webp`, `<name>-emission.webp` ...)
ROLE_LABELS = {
    "baseColor": "basis",
    "emissive": "emission",
    "normal": "normal",
    "occlusion": "occlusion",
    "metallicRoughness": "metallrauheit",
    "other": "textur",
}
MIME_EXT = {"image/webp": ".webp", "image/png": ".png", "image/jpeg": ".jpg"}
FORBIDDEN_EXTENSIONS = {
    "KHR_draco_mesh_compression": "Draco",
    "EXT_meshopt_compression": "Meshopt",
    "KHR_meshopt_compression": "Meshopt",
    "KHR_texture_basisu": "KTX2",
    "KHR_lights_punctual": "Lichter",
}
ALLOWED_EXTENSIONS = {
    "EXT_texture_webp",
    "KHR_mesh_quantization",
    "KHR_texture_transform",
    "KHR_materials_emissive_strength",
    "KHR_materials_unlit",
    "KHR_materials_specular",
    "KHR_materials_ior",
}


class GlbError(Exception):
    """Die Datei ist keine gültige GLB oder lässt sich nicht umschreiben."""


@dataclass
class Issue:
    """Befund der Dateiprüfung. `level` ist "error" oder "warn"."""

    level: str
    code: str
    message: str


# --------------------------------------------------------------------------- GLB lesen/schreiben


def read_glb(data: bytes) -> tuple[dict[str, Any], bytes]:
    """Liest eine GLB und liefert (JSON-Dokument, BIN-Inhalt oder leer)."""
    if len(data) < 20:
        raise GlbError("Datei zu kurz für eine GLB")
    magic, version, length = struct.unpack_from("<III", data, 0)
    if magic != GLB_MAGIC:
        raise GlbError("Kopfkennung 'glTF' fehlt")
    if version != 2:
        raise GlbError(f"GLB-Version {version} wird nicht unterstützt")
    if length != len(data):
        raise GlbError(f"Längenangabe {length} passt nicht zur Dateigröße {len(data)}")
    pos = 12
    gltf: dict[str, Any] | None = None
    bin_data = b""
    while pos + 8 <= len(data):
        chunk_len, chunk_type = struct.unpack_from("<II", data, pos)
        pos += 8
        body = data[pos : pos + chunk_len]
        if len(body) != chunk_len:
            raise GlbError("Chunk reicht über das Dateiende")
        pos += chunk_len
        if chunk_type == CHUNK_JSON and gltf is None:
            gltf = json.loads(body.decode("utf-8"))
        elif chunk_type == CHUNK_BIN and not bin_data:
            bin_data = bytes(body)
    if gltf is None:
        raise GlbError("JSON-Chunk fehlt")
    return gltf, bin_data


def write_glb(gltf: dict[str, Any], bin_data: bytes) -> bytes:
    """Packt JSON und BIN zu einer GLB (4-Byte-Ausrichtung, JSON mit Leerzeichen aufgefüllt)."""
    js = json.dumps(gltf, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    js += b" " * (-len(js) % 4)
    out = bytearray()
    total = 12 + 8 + len(js)
    padded_bin = bin_data + b"\0" * (-len(bin_data) % 4)
    if padded_bin:
        total += 8 + len(padded_bin)
    out += struct.pack("<III", GLB_MAGIC, 2, total)
    out += struct.pack("<II", len(js), CHUNK_JSON) + js
    if padded_bin:
        out += struct.pack("<II", len(padded_bin), CHUNK_BIN) + padded_bin
    return bytes(out)


# --------------------------------------------------------------------------- Bildgrößen


def image_size(data: bytes) -> tuple[int, int] | None:
    """Breite und Höhe aus dem Dateikopf von WebP, PNG oder JPEG (None, wenn unbekannt)."""
    if data[:8] == b"\x89PNG\r\n\x1a\n" and len(data) >= 24:
        return struct.unpack(">II", data[16:24])
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP" and len(data) >= 30:
        tag = data[12:16]
        if tag == b"VP8X":
            return (1 + int.from_bytes(data[24:27], "little"), 1 + int.from_bytes(data[27:30], "little"))
        if tag == b"VP8L" and data[20] == 0x2F:
            bits = int.from_bytes(data[21:25], "little")
            return ((bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1)
        if tag == b"VP8 ":
            w = int.from_bytes(data[26:28], "little") & 0x3FFF
            h = int.from_bytes(data[28:30], "little") & 0x3FFF
            return (w, h)
        return None
    if data[:2] == b"\xff\xd8":
        pos = 2
        while pos + 9 < len(data):
            if data[pos] != 0xFF:
                pos += 1
                continue
            marker = data[pos + 1]
            if marker in (0xC0, 0xC1, 0xC2):
                h, w = struct.unpack(">HH", data[pos + 5 : pos + 9])
                return (w, h)
            seg = struct.unpack(">H", data[pos + 2 : pos + 4])[0]
            pos += 2 + seg
    return None


# --------------------------------------------------------------------------- Helfer


def _texture_image_index(texture: dict[str, Any]) -> int | None:
    if "source" in texture:
        return int(texture["source"])
    for ext in ("EXT_texture_webp", "KHR_texture_basisu", "EXT_texture_avif"):
        src = texture.get("extensions", {}).get(ext, {}).get("source")
        if src is not None:
            return int(src)
    return None


def image_roles(gltf: dict[str, Any]) -> dict[int, str]:
    """Ordnet jedem Bild seine erste Verwendung zu (baseColor, emissive, ...)."""
    textures = gltf.get("textures", [])
    roles: dict[int, str] = {}

    def claim(tex_info: Any, role: str) -> None:
        if not isinstance(tex_info, dict) or "index" not in tex_info:
            return
        idx = int(tex_info["index"])
        if 0 <= idx < len(textures):
            image = _texture_image_index(textures[idx])
            if image is not None:
                roles.setdefault(image, role)

    for mat in gltf.get("materials", []):
        pbr = mat.get("pbrMetallicRoughness", {})
        claim(pbr.get("baseColorTexture"), "baseColor")
        claim(mat.get("emissiveTexture"), "emissive")
        claim(mat.get("normalTexture"), "normal")
        claim(mat.get("occlusionTexture"), "occlusion")
        claim(pbr.get("metallicRoughnessTexture"), "metallicRoughness")
        for ext in mat.get("extensions", {}).values():
            if isinstance(ext, dict):
                for key, value in ext.items():
                    if key.endswith("Texture"):
                        claim(value, "other")
    return roles


def _remap_buffer_views(node: Any, remap: dict[int, int], removed: set[int]) -> None:
    """Passt alle `bufferView`-Verweise im Dokument an (Zugriffe, Sparse, Erweiterungen)."""
    if isinstance(node, dict):
        for key, value in list(node.items()):
            if key == "bufferView" and isinstance(value, int):
                if value in removed:
                    raise GlbError(f"bufferView {value} wird noch verwendet")
                node[key] = remap[value]
            else:
                _remap_buffer_views(value, remap, removed)
    elif isinstance(node, list):
        for item in node:
            _remap_buffer_views(item, remap, removed)


# --------------------------------------------------------------------------- Umschreiben


def externalize_images(glb_path: Path, base_name: str) -> list[Path]:
    """Löst eingebettete Bilder aus der GLB und referenziert sie per relativer `uri`.

    Schreibt `<base_name>-basis.webp` (bzw. `-emission`, ...) neben die Datei, entfernt die
    zugehörigen bufferViews, packt den BIN-Chunk neu und schreibt die GLB atomar zurück.
    Liefert die geschriebenen Bilddateien (leer, wenn es keine eingebetteten Bilder gab).
    """
    glb_path = Path(glb_path)
    gltf, bin_data = read_glb(glb_path.read_bytes())
    images: list[dict[str, Any]] = gltf.get("images", [])
    views: list[dict[str, Any]] = gltf.get("bufferViews", [])
    embedded = [i for i, img in enumerate(images) if "bufferView" in img]
    if not embedded:
        return []

    roles = image_roles(gltf)
    per_role: dict[str, int] = {}
    files: dict[int, tuple[str, bytes]] = {}
    removed: set[int] = set()
    for i in embedded:
        img = images[i]
        view = views[img["bufferView"]]
        if view.get("buffer", 0) != 0:
            raise GlbError("Bild liegt nicht im GLB-Puffer")
        start = view.get("byteOffset", 0)
        blob = bin_data[start : start + view["byteLength"]]
        mime = img.get("mimeType", "image/png")
        ext = MIME_EXT.get(mime)
        if ext is None:
            raise GlbError(f"Bildtyp {mime} wird nicht unterstützt")
        role = roles.get(i, "other")
        label = ROLE_LABELS[role]
        count = per_role.get(role, 0)
        per_role[role] = count + 1
        suffix = label if count == 0 else f"{label}-{count + 1}"
        files[i] = (f"{base_name}-{suffix}{ext}", blob)
        removed.add(img["bufferView"])

    # BIN ohne die Bild-Views neu aufbauen
    remap: dict[int, int] = {}
    new_views: list[dict[str, Any]] = []
    out = bytearray()
    for old, view in enumerate(views):
        if old in removed:
            continue
        if view.get("buffer", 0) != 0:
            raise GlbError("mehrere Puffer werden nicht unterstützt")
        out += b"\0" * (-len(out) % 4)
        start = view.get("byteOffset", 0)
        new_view = dict(view)
        if len(out):
            new_view["byteOffset"] = len(out)
        else:
            new_view.pop("byteOffset", None)
        out += bin_data[start : start + view["byteLength"]]
        remap[old] = len(new_views)
        new_views.append(new_view)

    for i, (filename, _) in files.items():
        img = images[i]
        img.pop("bufferView", None)
        img["uri"] = filename
    _remap_buffer_views({k: v for k, v in gltf.items() if k != "images"}, remap, removed)

    out += b"\0" * (-len(out) % 4)
    if new_views:
        gltf["bufferViews"] = new_views
        gltf["buffers"] = [{"byteLength": len(out)}]
    else:
        gltf.pop("bufferViews", None)
        gltf.pop("buffers", None)

    written: list[Path] = []
    for _, (filename, blob) in sorted(files.items()):
        target = glb_path.with_name(filename)
        target.write_bytes(blob)
        written.append(target)
    tmp = glb_path.with_name(glb_path.name + ".tmp")
    tmp.write_bytes(write_glb(gltf, bytes(out)))
    os.replace(tmp, glb_path)
    return written


# --------------------------------------------------------------------------- Prüfung der fertigen Datei


def _accessor_count(gltf: dict[str, Any], index: int | None) -> int:
    if index is None:
        return 0
    return int(gltf["accessors"][index].get("count", 0))


def count_geometry(gltf: dict[str, Any]) -> tuple[int, int]:
    """(Dreiecke, Zeichenaufrufe) aller Knoten mit Mesh; Instanzen zählen mehrfach."""
    tris = 0
    draws = 0
    for node in gltf.get("nodes", []):
        if "mesh" not in node:
            continue
        for prim in gltf["meshes"][node["mesh"]].get("primitives", []):
            if prim.get("mode", 4) != 4:
                continue
            draws += 1
            if "indices" in prim:
                tris += _accessor_count(gltf, prim["indices"]) // 3
            else:
                tris += _accessor_count(gltf, prim.get("attributes", {}).get("POSITION")) // 3
    return tris, draws


def validate_glb(glb_path: Path, budgets: dict[str, Any] | None = None) -> list[Issue]:
    """Prüft die fertige Ausgabe gegen die Shop-Konventionen (3d-konventionen.md)."""
    glb_path = Path(glb_path)
    issues: list[Issue] = []
    try:
        gltf, _ = read_glb(glb_path.read_bytes())
    except (GlbError, ValueError, OSError) as exc:
        return [Issue("error", "glb-invalid", f"GLB nicht lesbar: {exc}")]

    tex_cfg = (budgets or {}).get("textures", {})
    max_px = int(tex_cfg.get("maxPx", 512))
    for ext in gltf.get("extensionsUsed", []):
        if ext in FORBIDDEN_EXTENSIONS:
            issues.append(Issue("error", "extension-forbidden", f"{FORBIDDEN_EXTENSIONS[ext]} ({ext}) ist nicht erlaubt"))
        elif ext not in ALLOWED_EXTENSIONS:
            issues.append(Issue("warn", "extension-unknown", f"Erweiterung {ext} wird vom Shop evtl. nicht gelesen"))
    if gltf.get("cameras"):
        issues.append(Issue("error", "cameras", "GLB enthält Kameras"))

    for i, img in enumerate(gltf.get("images", [])):
        if "bufferView" in img:
            issues.append(Issue("error", "image-embedded", f"Bild {i} ist eingebettet (bufferView) statt per uri"))
            continue
        uri = img.get("uri", "")
        if not uri or uri.startswith("data:") or "://" in uri or uri.startswith("/") or ".." in uri.split("/"):
            issues.append(Issue("error", "image-uri", f"Bild {i}: uri '{uri[:40]}' ist nicht relativ und lokal"))
            continue
        target = glb_path.with_name(uri)
        if not target.is_file():
            issues.append(Issue("error", "image-missing", f"Bilddatei {uri} fehlt neben der GLB"))
            continue
        size = image_size(target.read_bytes())
        if size is None:
            issues.append(Issue("error", "image-unreadable", f"Bildkopf von {uri} nicht lesbar"))
            continue
        w, h = size
        if (w & (w - 1)) or (h & (h - 1)):
            issues.append(Issue("error", "image-pot", f"{uri}: {w} x {h} ist keine Potenz von 2"))
        if max(w, h) > max_px:
            issues.append(Issue("error", "image-max", f"{uri}: {w} x {h} überschreitet {max_px} px"))
        if not uri.endswith(".webp"):
            issues.append(Issue("warn", "image-format", f"{uri} ist kein WebP"))

    for i, mat in enumerate(gltf.get("materials", [])):
        if mat.get("alphaMode", "OPAQUE") == "BLEND":
            issues.append(Issue("error", "alpha-blend", f"Material {mat.get('name', i)}: alphaMode BLEND (erlaubt ist nur MASK)"))
        if mat.get("normalTexture") or mat.get("occlusionTexture"):
            issues.append(Issue("error", "material-maps", f"Material {mat.get('name', i)}: Normal-/Occlusion-Map nicht erlaubt"))
        if mat.get("pbrMetallicRoughness", {}).get("metallicRoughnessTexture"):
            issues.append(Issue("error", "material-maps", f"Material {mat.get('name', i)}: Metall/Rauheit-Textur nicht erlaubt"))
    for sampler in gltf.get("samplers", []):
        if sampler.get("magFilter") == 9728:
            issues.append(Issue("error", "filter-nearest", "Texturfilter NEAREST (Shop erwartet linear)"))
    return issues
