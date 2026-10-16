# SPDX-License-Identifier: GPL-3.0-or-later
"""Tests für Cypher Export und das App-Template cypher_ps2 (laufen in Blender, headless).

    blender -b --factory-startup --python-exit-code 1 -P tests/run.py [-- --only teilname] [--skip teilname]

Jeder Test baut seine Szene selbst (leere Datei) und prüft gezielt erzeugte Verstöße,
den Export (gültiges glTF, externe Bilder, Dreiecke im Budget) und die Startszene.
"""

import hashlib
import importlib.util
import json
import shutil
import sys
import tempfile
import time
import traceback
import warnings
from pathlib import Path

import bmesh
import bpy
import numpy as np

HERE = Path(__file__).resolve().parent
PACK = HERE.parent
sys.path.insert(0, str(PACK))
sys.path.insert(0, str(HERE))

import glb_check  # noqa: E402
import cypher_export  # noqa: E402
from cypher_export import checks, glb_post, operators, panel  # noqa: E402

warnings.simplefilter("ignore", DeprecationWarning)

TESTS = []
TMP_ROOT = Path(tempfile.mkdtemp(prefix="cypher_tests_"))


def test(fn):
    TESTS.append(fn)
    return fn


# --------------------------------------------------------------------------- Bausteine


def reset():
    """Leere Szene mit Sammlung „Export“."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    coll = bpy.data.collections.new("Export")
    bpy.context.scene.collection.children.link(coll)
    s = bpy.context.scene.cypher_export
    s.prefix, s.name = "prop-", "kiste"
    return coll


def outdir(name):
    d = TMP_ROOT / name
    if d.exists():
        shutil.rmtree(d)
    d.mkdir(parents=True)
    bpy.context.scene.cypher_export.export_dir = str(d)
    return d


def tex_image(name, w, h, alpha=False):
    img = bpy.data.images.new(name, w, h, alpha=alpha)
    yy, xx = np.mgrid[0:h, 0:w]
    arr = np.ones((h, w, 4), dtype=np.float32)
    arr[..., 0] = xx / max(w - 1, 1)
    arr[..., 1] = yy / max(h - 1, 1)
    arr[..., 2] = 0.35
    if alpha:
        arr[..., 3] = ((xx // 8 + yy // 8) % 2).astype(np.float32)
    img.pixels.foreach_set(arr.ravel())
    img.pack()
    return img


def make_mat(name, image=None, vcol=True, interpolation="Linear"):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = 1.0
    tex = None
    if image is not None:
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = image
        tex.interpolation = interpolation
        if vcol:
            col = nt.nodes.new("ShaderNodeVertexColor")
            mix = nt.nodes.new("ShaderNodeMix")
            mix.data_type = "RGBA"
            mix.blend_type = "MULTIPLY"
            mix.inputs[0].default_value = 1.0
            nt.links.new(tex.outputs["Color"], mix.inputs[6])
            nt.links.new(col.outputs["Color"], mix.inputs[7])
            nt.links.new(mix.outputs[2], bsdf.inputs["Base Color"])
        else:
            nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    return mat, bsdf, tex


def cube_bm(size=1.0, z=None, x=0.0):
    bm = bmesh.new()
    bm.loops.layers.uv.verify()
    bmesh.ops.create_cube(bm, size=size, calc_uvs=True)
    bmesh.ops.translate(bm, verts=bm.verts, vec=(x, 0.0, size / 2 if z is None else z))
    return bm


def add_object(name, bm, coll, mats=(), vcol=True):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(m)
    if vcol:
        me.color_attributes.new("Col", "BYTE_COLOR", "CORNER")
    ob = bpy.data.objects.new(name, me)
    coll.objects.link(ob)
    return ob


def crate(coll, name="kiste", px=256, vcol=True, alpha=False, interpolation="Linear"):
    img = tex_image(f"{name}-tex", px, px, alpha=alpha)
    mat, bsdf, tex = make_mat(f"{name}-mat", img, vcol, interpolation)
    ob = add_object(name, cube_bm(), coll, [mat], vcol)
    return ob, mat, bsdf, tex


def chk(prefix="prop-", name="kiste", scope="COLLECTION"):
    bpy.context.view_layer.update()  # wie die Oberfläche: Ebenen und Auswertung abgleichen
    return checks.run_checks(bpy.context, scope=scope, prefix=prefix, name=name)


def level(rep, key):
    f = rep.get(key)
    assert f is not None, f"Prüfung {key} fehlt: {[x.key for x in rep.findings]}"
    return f.level


def expect(rep, key, want):
    got = level(rep, key)
    assert got == want, f"{key}: erwartet {want}, war {got} ({rep.get(key).value} / {rep.get(key).detail})"


def grid_object(coll, name, n_x, n_y):
    """Ebene mit 2 * n_x * n_y Dreiecken."""
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=n_x, y_segments=n_y, size=1.0)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    return add_object(name, bm, coll, vcol=False)


def export(**kw):
    bpy.context.view_layer.update()
    return bpy.ops.cypher.export_glb(**kw)


def is_blocked(**kw):
    """True, wenn der Export abgelehnt wird (bpy.ops macht aus Fehlermeldungen RuntimeError)."""
    try:
        return export(**kw) == {"CANCELLED"}
    except RuntimeError:
        return True


def base_ok(rep):
    errs = [(f.key, f.value, f.detail) for f in rep.findings if f.level == "error"]
    assert not errs, f"unerwartete Fehler: {errs}"


# --------------------------------------------------------------------------- Prüfungen


@test
def baseline_is_green():
    coll = reset()
    crate(coll)
    rep = chk()
    base_ok(rep)
    assert rep.level in {"ok", "info"}, [(f.key, f.level) for f in rep.findings if f.level not in {"ok", "info"}]
    assert rep.stats["tris"] == 12 and rep.stats["draw_calls"] == 1
    expect(rep, "origin", "ok")
    expect(rep, "vertex-colors", "ok")


@test
def naming_rules():
    coll = reset()
    crate(coll)
    for bad in ("Prop_Kiste", "kiste--x", "-kiste", "kiste_2", "Kiste", ""):
        expect(chk(name=bad), "naming", "error")
    for good in ("kiste", "kiste-2", "neon-schild-gross"):
        expect(chk(name=good), "naming", "ok")


@test
def scope_empty_and_missing():
    reset()
    expect(chk(), "scope", "error")  # Export leer
    bpy.data.collections.remove(bpy.data.collections["Export"])
    rep = chk()
    expect(rep, "scope", "error")
    assert "fehlt" in rep.get("scope").value
    # Auswahl-Umfang
    coll = reset()
    ob, *_ = crate(coll)
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    expect(chk(scope="SELECTION"), "scope", "ok")
    ob.select_set(False)
    expect(chk(scope="SELECTION"), "scope", "error")


@test
def triangle_budget_per_prefix():
    coll = reset()
    n = 24  # 2 * 24 * 14 = 672 Dreiecke
    grid_object(coll, "viel", n, 14)
    rep = chk("prop-", "viel")
    assert rep.stats["tris"] == 672
    expect(rep, "tris", "error")  # > 500
    expect(chk("furn-", "viel"), "tris", "ok")
    # knapp: 0,9 * 1500 < 1400 <= 1500
    coll = reset()
    grid_object(coll, "knapp", 35, 20)  # 1400
    expect(chk("furn-", "knapp"), "tris", "warn")
    # Raum
    coll = reset()
    grid_object(coll, "raum", 100, 75)  # 15000
    expect(chk("room-", "raum"), "tris", "warn")
    coll = reset()
    grid_object(coll, "raum", 100, 76)  # 15200
    expect(chk("room-", "raum"), "tris", "error")


@test
def scene_budgets_mobile_desktop():
    coll = reset()
    grid_object(coll, "gross", 200, 125)  # 50.000
    rep = chk("room-", "gross")
    expect(rep, "scene-tris-mobile", "warn")
    expect(rep, "scene-tris-desktop", "ok")
    coll = reset()
    grid_object(coll, "riesig", 250, 260)  # 130.000
    rep = chk("room-", "riesig")
    expect(rep, "scene-tris-mobile", "warn")
    expect(rep, "scene-tris-desktop", "error")


@test
def draw_call_budgets():
    coll = reset()
    mat, *_ = make_mat("m")
    for i in range(100):
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=0.1)
        add_object(f"teil-{i}", bm, coll, [mat], vcol=False)
    rep = chk("room-", "dosen")
    assert rep.stats["draw_calls"] == 100
    expect(rep, "draw-mobile", "warn")
    expect(rep, "draw-desktop", "ok")
    for i in range(100, 200):
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=0.1)
        add_object(f"teil-{i}", bm, coll, [mat], vcol=False)
    rep = chk("room-", "dosen")
    expect(rep, "draw-desktop", "error")


@test
def material_count_and_draw_calls_per_material():
    coll = reset()
    mats = [make_mat(f"m{i}")[0] for i in range(3)]
    bm = cube_bm()
    ob = add_object("kiste", bm, coll, mats, vcol=False)
    for i, poly in enumerate(ob.data.polygons):
        poly.material_index = i % 3
    rep = chk()
    expect(rep, "materials", "error")
    assert rep.stats["draw_calls"] == 3, rep.stats
    ob.data.materials.pop(index=2)
    for poly in ob.data.polygons:
        poly.material_index = poly.index % 2
    rep = chk()
    expect(rep, "materials", "ok")
    assert rep.stats["draw_calls"] == 2


@test
def material_channels():
    coll = reset()
    ob, mat, bsdf, tex = crate(coll)
    nt = mat.node_tree
    base_ok(chk())
    # Metallic verbunden -> Fehler
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Metallic"])
    expect(chk(), "channels", "error")
    for lk in list(bsdf.inputs["Metallic"].links):
        nt.links.remove(lk)
    expect(chk(), "channels", "ok")
    # Normal-Map -> Fehler
    nm = nt.nodes.new("ShaderNodeNormalMap")
    nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    expect(chk(), "channels", "error")
    for lk in list(bsdf.inputs["Normal"].links):
        nt.links.remove(lk)
    # Metallic-Wert -> nur Hinweis
    bsdf.inputs["Metallic"].default_value = 1.0
    expect(chk(), "channels", "warn")
    bsdf.inputs["Metallic"].default_value = 0.0
    # anderer Shader am Ausgang
    out = nt.get_output_node("ALL")
    emission = nt.nodes.new("ShaderNodeEmission")
    nt.links.new(emission.outputs["Emission"], out.inputs["Surface"])
    expect(chk(), "channels", "error")


@test
def emission_is_allowed_but_strength_warns():
    coll = reset()
    ob, mat, bsdf, tex = crate(coll)
    bsdf.inputs["Emission Color"].default_value = (0.0, 0.83, 0.85, 1.0)
    bsdf.inputs["Emission Strength"].default_value = 1.0
    rep = chk()
    base_ok(rep)
    assert rep.get("emission") is None
    bsdf.inputs["Emission Strength"].default_value = 5.0
    expect(chk(), "emission", "warn")


@test
def alpha_only_as_mask():
    coll = reset()
    ob, mat, bsdf, tex = crate(coll, alpha=True)
    nt = mat.node_tree
    expect(chk(), "alpha", "ok")
    bsdf.inputs["Alpha"].default_value = 0.5
    expect(chk(), "alpha", "error")
    bsdf.inputs["Alpha"].default_value = 1.0
    nt.links.new(tex.outputs["Alpha"], bsdf.inputs["Alpha"])
    expect(chk(), "alpha", "error")  # weich = BLEND
    rnd = nt.nodes.new("ShaderNodeMath")
    rnd.operation = "ROUND"
    nt.links.new(tex.outputs["Alpha"], rnd.inputs[0])
    for lk in list(bsdf.inputs["Alpha"].links):
        nt.links.remove(lk)
    nt.links.new(rnd.outputs["Value"], bsdf.inputs["Alpha"])
    expect(chk(), "alpha", "ok")


@test
def texture_size_rules_and_fixes():
    coll = reset()
    ob, mat, bsdf, tex = crate(coll, px=300)  # keine Potenz von 2
    rep = chk()
    expect(rep, "texture-size", "error")
    assert rep.get("texture-size").fix == "cypher.fix_textures"
    assert tuple(tex.image.size) == (300, 300)
    bpy.ops.cypher.fix_textures()
    expect(chk(), "texture-size", "ok")
    assert tuple(tex.image.size) == (256, 256), tuple(tex.image.size)
    original = bpy.data.images["kiste-tex"]
    assert original.use_fake_user and tuple(original.size) == (300, 300), "Original bleibt unverändert"

    coll = reset()
    ob, mat, bsdf, tex = crate(coll, px=1024)
    expect(chk(), "texture-size", "error")
    bpy.ops.cypher.fix_textures()
    assert tuple(tex.image.size) == (512, 512)
    rep = chk()
    expect(rep, "texture-size", "info")  # 512 > Standard 256 -> Info
    assert not rep.has_errors

    coll = reset()
    ob, mat, bsdf, tex = crate(coll, px=128)
    expect(chk(), "texture-size", "ok")
    tex.image.scale(600, 200)
    tex.image.pack()
    bpy.ops.cypher.fix_textures()
    assert tuple(tex.image.size) == (512, 128), tuple(tex.image.size)


@test
def texture_filter_nearest_is_error():
    coll = reset()
    crate(coll, interpolation="Closest")
    expect(chk(), "texture-filter", "error")


@test
def uv_required_for_textures():
    coll = reset()
    ob, *_ = crate(coll)
    expect(chk(), "uv", "ok")
    ob.data.uv_layers.remove(ob.data.uv_layers[0])
    ob.data.update()  # RNA-remove markiert die Auswertung nicht; Operatoren der Oberfläche tun es
    expect(chk(), "uv", "error")
    expect(chk(), "texture-size", "ok")


@test
def vertex_colors_are_info_when_missing():
    coll = reset()
    crate(coll, vcol=False)
    expect(chk(), "vertex-colors", "info")


@test
def cameras_and_lights_warn_and_never_export():
    coll = reset()
    crate(coll)
    cam = bpy.data.objects.new("Kamera", bpy.data.cameras.new("Kamera"))
    lamp = bpy.data.objects.new("Licht", bpy.data.lights.new("Licht", "POINT"))
    coll.objects.link(cam)
    coll.objects.link(lamp)
    rep = chk()
    expect(rep, "cameras-lights", "warn")
    d = outdir("camlight")
    assert export() == {"FINISHED"}
    gltf, _ = glb_check.check_conformance(d / "prop-kiste.glb", expect_tris=12)
    assert "cameras" not in gltf and not gltf.get("extensions", {}).get("KHR_lights_punctual")


@test
def transforms_check_and_fix():
    coll = reset()
    ob, *_ = crate(coll)
    ob.scale = (2.0, 1.0, 1.0)
    ob.rotation_euler = (0.0, 0.0, 0.5)
    ob.location = (0.0, 0.0, 0.5)  # Unterkante liegt nach dem Skalieren weiter außen nicht höher
    rep = chk()
    expect(rep, "transforms", "error")
    assert rep.get("transforms").fix == "cypher.fix_transforms"
    before = rep.stats["size"]
    bpy.ops.cypher.fix_transforms()
    rep = chk()
    expect(rep, "transforms", "ok")
    after = rep.stats["size"]
    assert all(abs(a - b) < 1e-4 for a, b in zip(before, after)), (before, after)
    assert tuple(round(v, 4) for v in ob.scale) == (1.0, 1.0, 1.0) and abs(ob.rotation_euler.z) < 1e-6
    # negative Skalierung
    ob.scale = (-1.0, 1.0, 1.0)
    expect(chk(), "transforms", "error")
    # geteilte Mesh-Daten (Linked Duplicate) werden vereinzelt
    coll = reset()
    ob, *_ = crate(coll)
    twin = bpy.data.objects.new("zwilling", ob.data)
    coll.objects.link(twin)
    twin.location = (3, 0, 0)
    ob.scale = (1.5, 1.5, 1.5)
    twin.scale = (1.5, 1.5, 1.5)
    bpy.ops.cypher.fix_transforms()
    expect(chk(), "transforms", "ok")
    assert ob.data is not twin.data


@test
def empty_group_with_rotation_only_warns():
    coll = reset()
    ob, *_ = crate(coll)
    grp = bpy.data.objects.new("gruppe", None)
    coll.objects.link(grp)
    grp.rotation_euler = (0, 0, 0.3)
    expect(chk(), "transforms", "warn")


@test
def origin_must_be_on_ground_and_centered():
    coll = reset()
    ob, *_ = crate(coll)
    expect(chk(), "origin", "ok")
    ob.location = (0, 0, 1.0)  # schwebt
    rep = chk()
    expect(rep, "origin", "error")
    ob.location = (0, 0, -0.5)  # steckt im Boden
    expect(chk(), "origin", "error")
    ob.location = (3.0, 0, 0)  # nicht mittig, aber am Boden
    expect(chk(), "origin", "warn")


@test
def budgets_come_from_json():
    coll = reset()
    crate(coll)
    expect(chk(), "tris", "ok")
    data = json.loads((PACK / "cypher_export" / "budgets.json").read_text(encoding="utf-8"))
    data["prefixes"]["prop-"]["maxTris"] = 10
    data["textures"]["maxPx"] = 128
    alt = TMP_ROOT / "budgets-alt.json"
    alt.write_text(json.dumps(data), encoding="utf-8")
    original = checks._BUDGETS_PATH
    try:
        checks._BUDGETS_PATH = alt
        rep = chk()
        expect(rep, "tris", "error")
        expect(rep, "texture-size", "error")
    finally:
        checks._BUDGETS_PATH = original
    expect(chk(), "tris", "ok")


# --------------------------------------------------------------------------- Export


@test
def export_writes_valid_gltf_with_external_images():
    coll = reset()
    ob, mat, bsdf, tex = crate(coll)
    d = outdir("basic")
    s = bpy.context.scene.cypher_export
    s.author, s.source = "Test Autor", "https://example.org/quelle"
    assert export() == {"FINISHED"}
    assert sorted(p.name for p in d.iterdir()) == ["prop-kiste-basis.webp", "prop-kiste.glb", "prop-kiste.lizenz.json"]
    gltf, names = glb_check.check_conformance(d / "prop-kiste.glb", expect_tris=12, expect_images=["prop-kiste-basis.webp"])
    assert any(a == "COLOR_0" for p in gltf["meshes"][0]["primitives"] for a in p["attributes"]), "Vertexfarben fehlen"
    assert "TEXCOORD_0" in gltf["meshes"][0]["primitives"][0]["attributes"]
    # Wie gemeldet
    res = operators.LAST_RESULT
    assert res.tris == 12 and res.draw_calls == 1 and not res.issues, (res.tris, res.draw_calls, res.issues)
    assert glb_check.triangles(gltf) == chk().stats["tris"]
    # Lizenzdatei
    lic = json.loads((d / "prop-kiste.lizenz.json").read_text(encoding="utf-8"))
    assert list(lic) == ["name", "autor", "lizenz", "lizenzUrl", "quelle"]
    assert lic == {"name": "prop-kiste", "autor": "Test Autor", "lizenz": "CC0-1.0", "lizenzUrl": "https://creativecommons.org/publicdomain/zero/1.0/", "quelle": "https://example.org/quelle"}
    # +Y oben: Höhe 1 m liegt auf Y, Unterkante 0
    acc = gltf["accessors"][gltf["meshes"][0]["primitives"][0]["attributes"]["POSITION"]]
    assert abs(acc["min"][1]) < 1e-5 and abs(acc["max"][1] - 1.0) < 1e-5, (acc["min"], acc["max"])


@test
def export_twice_is_byte_identical_and_keeps_license():
    coll = reset()
    crate(coll)
    d = outdir("twice")
    export()
    first = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in d.iterdir()}
    (d / "prop-kiste.lizenz.json").write_text('{"name":"prop-kiste","autor":"Hand"}\n', encoding="utf-8")
    first["prop-kiste.lizenz.json"] = hashlib.sha256((d / "prop-kiste.lizenz.json").read_bytes()).hexdigest()
    export()
    second = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in d.iterdir()}
    assert first == second, (first, second)
    assert json.loads((d / "prop-kiste.lizenz.json").read_text(encoding="utf-8"))["autor"] == "Hand", "vorhandene Lizenzdatei überschrieben"
    assert not operators.LAST_RESULT.license_created


@test
def export_without_textures():
    coll = reset()
    mat, *_ = make_mat("m")
    add_object("kiste", cube_bm(), coll, [mat], vcol=False)
    d = outdir("notex")
    assert export() == {"FINISHED"}
    assert sorted(p.name for p in d.iterdir()) == ["prop-kiste.glb", "prop-kiste.lizenz.json"]
    gltf, _ = glb_check.check_conformance(d / "prop-kiste.glb", expect_tris=12, expect_images=[])
    assert "images" not in gltf


@test
def export_base_and_emission_textures():
    coll = reset()
    ob, mat, bsdf, tex = crate(coll, vcol=False)
    glow = tex_image("glow", 64, 64)
    emi = mat.node_tree.nodes.new("ShaderNodeTexImage")
    emi.image = glow
    mat.node_tree.links.new(emi.outputs["Color"], bsdf.inputs["Emission Color"])
    bsdf.inputs["Emission Strength"].default_value = 1.0
    d = outdir("emi")
    assert export() == {"FINISHED"}
    glb_check.check_conformance(d / "prop-kiste.glb", expect_tris=12, expect_images=["prop-kiste-basis.webp", "prop-kiste-emission.webp"])


@test
def export_blocked_by_errors_unless_forced():
    coll = reset()
    ob, mat, bsdf, tex = crate(coll, px=1024)
    d = outdir("blocked")
    assert is_blocked()
    assert not list(d.iterdir())
    # Trotzdem: Texturen werden als Kopien verkleinert, das Original bleibt
    assert export(force=True) == {"FINISHED"}
    glb_check.check_conformance(d / "prop-kiste.glb", expect_tris=12, expect_images=["prop-kiste-basis.webp"])
    assert tuple(tex.image.size) == (1024, 1024) and tex.image.name == "kiste-tex"
    assert [i.name for i in bpy.data.images] == ["kiste-tex"], "verkleinerte Kopien müssen wieder entfernt sein"
    assert operators.LAST_RESULT.forced


@test
def export_hard_errors_cannot_be_forced():
    coll = reset()
    crate(coll)
    bpy.context.scene.cypher_export.name = "Kiste_Gross"
    outdir("hard")
    assert is_blocked(force=True)
    bpy.context.scene.cypher_export.name = "kiste"
    bpy.data.collections["Export"].objects.unlink(bpy.data.objects["kiste"])
    assert is_blocked(force=True)


@test
def export_mask_alpha_and_blend_detection():
    coll = reset()
    ob, mat, bsdf, tex = crate(coll, alpha=True, vcol=False)
    nt = mat.node_tree
    rnd = nt.nodes.new("ShaderNodeMath")
    rnd.operation = "ROUND"
    nt.links.new(tex.outputs["Alpha"], rnd.inputs[0])
    nt.links.new(rnd.outputs["Value"], bsdf.inputs["Alpha"])
    d = outdir("mask")
    assert export() == {"FINISHED"}
    gltf, _ = glb_check.check_conformance(d / "prop-kiste.glb", expect_tris=12)
    assert gltf["materials"][0]["alphaMode"] == "MASK"
    # weiche Transparenz: Prüfung meldet Fehler, trotzdem exportiert -> Dateiprüfung meldet BLEND
    for lk in list(bsdf.inputs["Alpha"].links):
        nt.links.remove(lk)
    nt.links.new(tex.outputs["Alpha"], bsdf.inputs["Alpha"])
    expect(chk(), "alpha", "error")
    assert export(force=True) == {"FINISHED"}
    assert any(i.code == "alpha-blend" for i in operators.LAST_RESULT.issues), operators.LAST_RESULT.issues


@test
def export_selection_scope_and_hierarchy():
    coll = reset()
    a, *_ = crate(coll, name="a")
    b, *_ = crate(coll, name="b")
    b.location = (0.0, 5.0, 0.0)
    bpy.context.view_layer.update()
    for o in bpy.context.view_layer.objects:
        o.select_set(o is a)
    bpy.context.view_layer.objects.active = a
    s = bpy.context.scene.cypher_export
    s.scope, s.name = "SELECTION", "nur-a"
    d = outdir("sel")
    assert export() == {"FINISHED"}
    glb_check.check_conformance(d / "prop-nur-a.glb", expect_tris=12)
    assert a.select_get() and not b.select_get(), "Auswahl wurde nicht wiederhergestellt"
    assert bpy.context.view_layer.objects.active is a


@test
def glb_post_repack_keeps_buffers_consistent():
    """Direkter Test der Umpack-Logik mit mehreren Bildern vor, zwischen und nach Geometrie."""
    import struct

    gltf = {
        "asset": {"version": "2.0"},
        "buffers": [{"byteLength": 0}],
        "bufferViews": [
            {"buffer": 0, "byteOffset": 0, "byteLength": 5},  # Bild A (ungerade Länge)
            {"buffer": 0, "byteOffset": 8, "byteLength": 24},  # Geometrie
            {"buffer": 0, "byteOffset": 32, "byteLength": 7},  # Bild B
            {"buffer": 0, "byteOffset": 40, "byteLength": 12},  # Geometrie 2
        ],
        "accessors": [
            {"bufferView": 1, "componentType": 5126, "count": 2, "type": "VEC3"},
            {"bufferView": 3, "componentType": 5126, "count": 1, "type": "VEC3"},
        ],
        "images": [{"bufferView": 0, "mimeType": "image/webp"}, {"bufferView": 2, "mimeType": "image/webp"}],
        "textures": [{"source": 0}, {"source": 1}],
        "materials": [{"pbrMetallicRoughness": {"baseColorTexture": {"index": 0}}, "emissiveTexture": {"index": 1}}],
    }
    binary = b"AAAAA\0\0\0" + bytes(range(24)) + b"BBBBBBB\0" + bytes(range(100, 112))
    gltf["buffers"][0]["byteLength"] = len(binary)
    path = TMP_ROOT / "repack" / "x.glb"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(glb_post.write_glb(gltf, binary))
    files = glb_post.externalize_images(path, "x")
    assert [f.name for f in files] == ["x-basis.webp", "x-emission.webp"]
    assert files[0].read_bytes() == b"AAAAA" and files[1].read_bytes() == b"BBBBBBB"
    g, b, _ = glb_check.parse_glb(path)
    assert [i["uri"] for i in g["images"]] == ["x-basis.webp", "x-emission.webp"]
    assert all("bufferView" not in i for i in g["images"])
    assert len(g["bufferViews"]) == 2 and [a["bufferView"] for a in g["accessors"]] == [0, 1]
    v0, v1 = g["bufferViews"]
    assert b[v0.get("byteOffset", 0) : v0.get("byteOffset", 0) + 24] == bytes(range(24))
    assert b[v1["byteOffset"] : v1["byteOffset"] + 12] == bytes(range(100, 112)) and v1["byteOffset"] % 4 == 0
    # keine Bilder -> unverändert
    assert glb_post.externalize_images(path, "x") == []


@test
def glb_post_validation_catches_violations():
    d = TMP_ROOT / "val"
    d.mkdir(exist_ok=True)
    gltf = {
        "asset": {"version": "2.0"},
        "extensionsUsed": ["KHR_draco_mesh_compression", "KHR_lights_punctual", "ACME_unknown"],
        "cameras": [{"type": "perspective", "perspective": {"yfov": 1, "znear": 0.1}}],
        "images": [{"uri": "gibts-nicht.webp"}, {"uri": "../ausserhalb.webp"}, {"bufferView": 0, "mimeType": "image/webp"}],
        "materials": [{"alphaMode": "BLEND"}, {"normalTexture": {"index": 0}}],
        "samplers": [{"magFilter": 9728}],
    }
    p = d / "bad.glb"
    p.write_bytes(glb_post.write_glb(gltf, b""))
    codes = {i.code for i in glb_post.validate_glb(p, checks.load_budgets())}
    assert {"extension-forbidden", "extension-unknown", "cameras", "image-missing", "image-uri", "image-embedded", "alpha-blend", "material-maps", "filter-nearest"} <= codes, codes
    (d / "kaputt.glb").write_bytes(b"nicht glb")
    assert {i.code for i in glb_post.validate_glb(d / "kaputt.glb")} == {"glb-invalid"}


@test
def webp_and_png_size_parsers():
    coll = reset()
    ob, mat, bsdf, tex = crate(coll, px=128)
    d = outdir("size")
    export()
    blob = (d / "prop-kiste-basis.webp").read_bytes()
    assert glb_post.image_size(blob) == (128, 128) == glb_check.webp_dims(blob)
    png = TMP_ROOT / "t.png"
    img = tex.image
    img.filepath_raw = str(png)
    img.file_format = "PNG"
    img.save()
    assert glb_post.image_size(png.read_bytes()) == (128, 128)


# --------------------------------------------------------------------------- Oberfläche und Einrichtung


@test
def panel_cache_and_registration():
    coll = reset()
    crate(coll)
    rep = panel.refresh_now(bpy.context)
    assert panel.get_report() is rep and not rep.has_errors
    assert panel._on_depsgraph_update in bpy.app.handlers.depsgraph_update_post
    for cls in panel.CLASSES:
        assert cls.bl_category == "Cypher"
    panel.schedule()
    panel.schedule()  # fällt zusammen
    assert bpy.app.timers.is_registered(panel._timer)
    bpy.app.timers.unregister(panel._timer)


@test
def asset_library_follows_setup_config():
    lib_dir = TMP_ROOT / "bibliothek" / "3D"
    lib_dir.mkdir(parents=True)
    libs = bpy.context.preferences.filepaths.asset_libraries
    other = libs.new(name="Fremd", directory=str(TMP_ROOT))
    original = cypher_export._library_path
    try:
        cypher_export._library_path = lambda: None
        cypher_export._add_asset_library()
        assert not [x for x in libs if x.name == cypher_export.ASSET_LIBRARY_NAME]
        cypher_export._library_path = lambda: lib_dir
        cypher_export._add_asset_library()
        cypher_export._add_asset_library()  # nicht doppelt
        mine = [x for x in libs if x.name == cypher_export.ASSET_LIBRARY_NAME]
        assert len(mine) == 1 and Path(mine[0].path) == lib_dir
        cypher_export._remove_asset_library()
        assert not [x for x in libs if x.name == cypher_export.ASSET_LIBRARY_NAME]
        assert [x for x in libs if x.name == "Fremd"], "fremde Bibliothek darf nicht verschwinden"
    finally:
        cypher_export._library_path = original
        libs.remove(other)


# --------------------------------------------------------------------------- Startszene


def _load_build_module():
    spec = importlib.util.spec_from_file_location("cypher_build_startup", PACK / "app_template" / "cypher_ps2" / "build_startup.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules["cypher_build_startup"] = mod
    spec.loader.exec_module(mod)
    return mod


@test
def startup_scene_builds_reproducibly_and_examples_pass():
    mod = _load_build_module()
    out = TMP_ROOT / "startup.blend"
    fp1 = mod.build(out)
    fp2 = mod.build(TMP_ROOT / "startup2.blend")
    assert fp1 == fp2, "Startszene ist nicht reproduzierbar"
    # Rundlauf: gespeicherte Datei hat denselben Fingerabdruck
    bpy.ops.wm.open_mainfile(filepath=str(out))
    assert mod.fingerprint() == fp1
    sc = bpy.context.scene
    assert sc.unit_settings.system == "METRIC" and sc.unit_settings.scale_length == 1.0
    assert (sc.render.resolution_x, sc.render.resolution_y) == (640, 448)
    assert "EEVEE" in sc.render.engine
    assert {"Export", "Referenz", "Beispiele"} <= set(bpy.data.collections.keys())
    assert sc.camera is not None and sc.camera.name == "Shop-Kamera"
    assert sc.camera.users_collection[0].name == "Referenz"
    assert "Cypher Kollektionen" in bpy.data.palettes and len(bpy.data.palettes["Cypher Kollektionen"].colors) == 17
    assert {"Cypher Basis", "Cypher Neon"} <= set(bpy.data.materials.keys())
    # jedes Beispiel innerhalb seines Budgets, ohne Fehler im Prüfbericht
    examples = {c.name: c for c in bpy.data.collections["Beispiele"].children}
    assert {n.split("-")[0] + "-" for n in examples} == {"prop-", "furn-", "prod-", "room-", "fig-"}, list(examples)
    export_coll = bpy.data.collections["Export"]
    for obj in list(export_coll.objects):
        export_coll.objects.unlink(obj)
    for cname, ecoll in examples.items():
        prefix = cname.split("-")[0] + "-"
        for obj in list(export_coll.objects):
            export_coll.objects.unlink(obj)
        for obj in ecoll.all_objects:
            export_coll.objects.link(obj)
        rep = checks.run_checks(bpy.context, scope="COLLECTION", prefix=prefix, name=cname[len(prefix):])
        errs = [(f.key, f.value, f.detail) for f in rep.findings if f.level == "error"]
        assert not errs, f"{cname}: {errs}"
        limit = checks.load_budgets()["prefixes"][prefix]["maxTris"]
        assert 0 < rep.stats["tris"] <= limit, (cname, rep.stats["tris"], limit)
        for obj in ecoll.all_objects:
            export_coll.objects.unlink(obj)


@test
def startup_example_exports_and_validates():
    mod = _load_build_module()
    mod.build(TMP_ROOT / "startup3.blend")
    export_coll = bpy.data.collections["Export"]
    s = bpy.context.scene.cypher_export
    d = outdir("beispiele")
    for cname, ecoll in {c.name: c for c in bpy.data.collections["Beispiele"].children}.items():
        prefix = cname.split("-")[0] + "-"
        for obj in list(export_coll.objects):
            export_coll.objects.unlink(obj)
        for obj in ecoll.all_objects:
            export_coll.objects.link(obj)
        s.prefix, s.name = prefix, cname[len(prefix):]
        assert export() == {"FINISHED"}, cname
        gltf, _ = glb_check.check_conformance(d / f"{cname}.glb")
        assert operators.LAST_RESULT.tris == checks.run_checks(bpy.context, scope="COLLECTION", prefix=prefix, name=s.name).stats["tris"]
        for obj in ecoll.all_objects:
            export_coll.objects.unlink(obj)


# --------------------------------------------------------------------------- Lauf


def main():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    only = argv[argv.index("--only") + 1] if "--only" in argv else None
    skip = argv[argv.index("--skip") + 1] if "--skip" in argv else None
    cypher_export.register()
    failed, ran = [], 0
    for fn in TESTS:
        if (only and only not in fn.__name__) or (skip and skip in fn.__name__):
            continue
        t0 = time.time()
        ran += 1
        try:
            fn()
            print(f"  ok      {fn.__name__} ({(time.time() - t0) * 1000:.0f} ms)")
        except Exception:
            failed.append(fn.__name__)
            print(f"  FEHLER  {fn.__name__}")
            traceback.print_exc()
    print(f"\nBlender {bpy.app.version_string}: {ran - len(failed)} von {ran} Tests bestanden")
    cypher_export.unregister()
    shutil.rmtree(TMP_ROOT, ignore_errors=True)
    if failed:
        print("Fehlgeschlagen: " + ", ".join(failed))
        sys.exit(1)


main()
