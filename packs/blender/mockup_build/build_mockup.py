# SPDX-License-Identifier: GPL-3.0-or-later
"""Rendert die Mockup-Grundlagen eines Kleidungsstücks in Blender (Cycles, Draufsicht).

    blender -b --factory-startup --python build_mockup.py -- --garment tee-front --work ~/mock/work [--scale 0.5] [--samples 96]

Das Skript modelliert das Flatlay aus Schnittmuster, Falten und Nähten (garments.py), rendert drei
Durchgänge (weißer Stoff, schwarzer Stoff, Höhe) als EXR und legt sie als .npy im Arbeitsordner ab.
`maps.py` macht daraus die fertigen PNG-Ebenen. Eigene Arbeit, keine fremden Modelle oder Texturen.
"""

import math
import os
import sys
import time
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import garments  # noqa: E402
import meshing  # noqa: E402
import surface  # noqa: E402
from fields import nearest_on_polyline, resample, signed_distance_polygon, smoothstep  # noqa: E402

H_INT = 0.0042
H_EDGE = 0.0021


# --------------------------------------------------------------------------- Netze


def make_panel_object(panel, index, h_int=H_INT):
    xy, tris, nb = meshing.triangulate_outline(panel.outline, h_int, h_int / 2, seed=5 + index)
    edge_d, *_ = nearest_on_polyline(xy, surface.closed(panel.outline))
    z = surface.surface_z(panel, xy, edge_d)
    band_id, rib_s, rib_dn = surface.band_attributes(panel, xy)
    me = bpy.data.meshes.new(panel.name)
    verts = np.column_stack([xy, z])
    me.from_pydata(verts.tolist(), [], tris.tolist())
    me.update()
    for p in me.polygons:
        p.use_smooth = True
    uv = me.uv_layers.new(name="UVMap")
    rib = me.uv_layers.new(name="RibUV")
    loop_v = np.empty(len(me.loops), dtype=np.int32)
    me.loops.foreach_get("vertex_index", loop_v)
    uv.data.foreach_set("uv", np.column_stack([xy[loop_v, 0], xy[loop_v, 1]]).ravel())
    rib.data.foreach_set("uv", np.column_stack([rib_s[loop_v], rib_dn[loop_v]]).ravel())
    attr = me.attributes.new("Band", "FLOAT", "POINT")
    attr.data.foreach_set("value", band_id)
    ob = bpy.data.objects.new(panel.name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def seam_geometry(panel):
    """Nähte und Stiche als Bänder auf der Oberfläche: (Punkte, Dreiecke)."""
    verts, faces = [], []

    def ribbon(line, width, height, profile_n=5, closed=False):
        line = resample(line, 0.0006)
        if len(line) < 2:
            return
        tang = np.gradient(line, axis=0)
        tang /= np.maximum(np.hypot(*tang.T), 1e-12)[:, None]
        nrm = np.stack([-tang[:, 1], tang[:, 0]], axis=1)
        offs = np.linspace(-1.0, 1.0, profile_n)
        base = len(verts)
        pts = []
        for o in offs:
            pts.append(line + nrm * (o * width / 2))
        pts = np.stack(pts, axis=1)  # (n, profile_n, 2)
        flat = pts.reshape(-1, 2)
        z = surface.surface_z(panel, flat).reshape(len(line), profile_n)
        prof = np.sqrt(np.clip(1 - offs**2, 0, 1)) * height
        z = z + prof[None, :] + 0.00025
        end_fade = np.minimum(smoothstep(np.arange(len(line)) / 3.0), smoothstep((len(line) - 1 - np.arange(len(line))) / 3.0))
        if closed:
            end_fade = np.ones(len(line))
        z = z - (1 - end_fade)[:, None] * (prof[None, :] + 0.0003)
        for i in range(len(line)):
            for j in range(profile_n):
                verts.append((flat[i * profile_n + j][0], flat[i * profile_n + j][1], z[i, j]))
        for i in range(len(line) - 1):
            for j in range(profile_n - 1):
                a = base + i * profile_n + j
                b = a + 1
                c = base + (i + 1) * profile_n + j
                d = c + 1
                faces.append((a, b, d))
                faces.append((a, d, c))

    def inside_runs(line, margin=0.0045):
        """Teilstücke einer Linie, die mindestens `margin` innerhalb des Umrisses liegen."""
        line = resample(line, 0.0003)
        keep = signed_distance_polygon(line, panel.outline) < -margin
        runs, start = [], None
        for i, k in enumerate(keep):
            if k and start is None:
                start = i
            if (not k) and start is not None:
                runs.append(line[start:i]); start = None
        if start is not None:
            runs.append(line[start:])
        return [r for r in runs if len(r) > 3]

    def dashes(line, width, height, dash, gap):
        for run in inside_runs(line):
            seg = np.hypot(*(run[1:] - run[:-1]).T)
            cum = np.concatenate([[0.0], np.cumsum(seg)])
            total = cum[-1]
            pos = gap / 2
            while pos + dash <= total:
                sel = (cum >= pos) & (cum <= pos + dash)
                part = run[sel]
                if len(part) >= 2:
                    ribbon(part, width, height, 3)
                pos += dash + gap

    for s in panel.seams:
        if s.kind == "ridge":
            ribbon(s.line, s.width, s.height, 5, closed=s.closed)
        elif s.kind == "stitch":
            dashes(s.line, s.width, s.height, s.dash, s.gap)
        elif s.kind == "double":
            for sgn in (-1, 1):
                dashes(offset_line(s.line, sgn * s.gap_rows / 2), s.width * 0.55, s.height * 0.6, s.dash, s.gap)
    return np.array(verts, float).reshape(-1, 3), np.array(faces, np.int64).reshape(-1, 3)


def offset_line(line, dist):
    from fields import offset_polyline

    return offset_polyline(resample(line, 0.001), dist)


def make_seam_object(panel, index):
    verts, faces = seam_geometry(panel)
    if len(faces) == 0:
        return None
    me = bpy.data.meshes.new(f"{panel.name}-naehte")
    me.from_pydata(verts.tolist(), [], faces.tolist())
    me.update()
    for p in me.polygons:
        p.use_smooth = True
    ob = bpy.data.objects.new(f"{panel.name}-naehte", me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


# --------------------------------------------------------------------------- Materialien


def _tex_wave(nt, scale, direction, uvnode, distortion=0.0, detail=0.0):
    w = nt.nodes.new("ShaderNodeTexWave")
    w.wave_type = "BANDS"
    w.bands_direction = direction
    w.wave_profile = "SIN"
    w.inputs["Scale"].default_value = scale
    w.inputs["Distortion"].default_value = distortion
    w.inputs["Detail"].default_value = detail
    nt.links.new(uvnode.outputs["UV"], w.inputs["Vector"])
    return w


def cloth_material(kind):
    """kind: "light" (weißer Stoff), "dark" (schwarzer Stoff mit Glanz), "height" (Höhenkodierung)."""
    mat = bpy.data.materials.new(f"stoff-{kind}")
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    if kind == "height":
        geo = nt.nodes.new("ShaderNodeNewGeometry")
        sep = nt.nodes.new("ShaderNodeSeparateXYZ")
        comb = nt.nodes.new("ShaderNodeCombineColor")
        em = nt.nodes.new("ShaderNodeEmission")
        nt.links.new(geo.outputs["Position"], sep.inputs["Vector"])
        for ch in ("Red", "Green", "Blue"):
            nt.links.new(sep.outputs["Z"], comb.inputs[ch])
        nt.links.new(comb.outputs["Color"], em.inputs["Color"])
        nt.links.new(em.outputs["Emission"], out.inputs["Surface"])
        return mat
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    light = kind == "light"
    bsdf.inputs["Base Color"].default_value = (0.80, 0.80, 0.80, 1.0) if light else (0.018, 0.018, 0.018, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.82 if light else 0.62
    bsdf.inputs["Specular IOR Level"].default_value = 0.25 if light else 0.35
    bsdf.inputs["Sheen Weight"].default_value = 0.45 if light else 1.0
    bsdf.inputs["Sheen Roughness"].default_value = 0.35
    bsdf.inputs["Sheen Tint"].default_value = (1.0, 1.0, 1.0, 1.0)

    uv = nt.nodes.new("ShaderNodeUVMap")
    uv.uv_map = "UVMap"
    ribuv = nt.nodes.new("ShaderNodeUVMap")
    ribuv.uv_map = "RibUV"
    # Strick: Maschenstäbchen (senkrecht, ~2,1 mm) mal Maschenreihen (waagerecht, ~1,6 mm)
    wale = _tex_wave(nt, 1.0 / 0.0019, "X", uv, distortion=2.4, detail=1.0)
    course = _tex_wave(nt, 1.0 / 0.0016, "Y", uv, distortion=0.8)
    knit = nt.nodes.new("ShaderNodeMath")
    knit.operation = "MULTIPLY"
    nt.links.new(wale.outputs["Fac"], knit.inputs[0])
    mix = nt.nodes.new("ShaderNodeMath")
    mix.operation = "MULTIPLY_ADD"
    mix.inputs[1].default_value = 0.45
    mix.inputs[2].default_value = 0.55
    nt.links.new(course.outputs["Fac"], mix.inputs[0])
    nt.links.new(mix.outputs["Value"], knit.inputs[1])
    bump_knit = nt.nodes.new("ShaderNodeBump")
    bump_knit.inputs["Strength"].default_value = 0.12
    bump_knit.inputs["Distance"].default_value = 0.0007
    nt.links.new(knit.outputs["Value"], bump_knit.inputs["Height"])
    # Rippen im Band: sin(2 pi s / Abstand) innerhalb |d/halbe Breite| < 1
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(ribuv.outputs["UV"], sep.inputs["Vector"])
    arg = nt.nodes.new("ShaderNodeMath")
    arg.operation = "MULTIPLY"
    arg.inputs[1].default_value = 2 * math.pi / 0.0032
    nt.links.new(sep.outputs["X"], arg.inputs[0])
    sine = nt.nodes.new("ShaderNodeMath")
    sine.operation = "SINE"
    nt.links.new(arg.outputs["Value"], sine.inputs[0])
    pattern = nt.nodes.new("ShaderNodeMath")
    pattern.operation = "MULTIPLY_ADD"
    pattern.inputs[1].default_value = 0.5
    pattern.inputs[2].default_value = 0.5
    nt.links.new(sine.outputs["Value"], pattern.inputs[0])
    absd = nt.nodes.new("ShaderNodeMath")
    absd.operation = "ABSOLUTE"
    nt.links.new(sep.outputs["Y"], absd.inputs[0])
    inside = nt.nodes.new("ShaderNodeMath")
    inside.operation = "LESS_THAN"
    inside.inputs[1].default_value = 0.92
    nt.links.new(absd.outputs["Value"], inside.inputs[0])
    battr = nt.nodes.new("ShaderNodeAttribute")
    battr.attribute_name = "Band"
    isband = nt.nodes.new("ShaderNodeMath")
    isband.operation = "GREATER_THAN"
    isband.inputs[1].default_value = 0.5
    nt.links.new(battr.outputs["Fac"], isband.inputs[0])
    gate = nt.nodes.new("ShaderNodeMath")
    gate.operation = "MULTIPLY"
    nt.links.new(inside.outputs["Value"], gate.inputs[0])
    nt.links.new(isband.outputs["Value"], gate.inputs[1])
    ribh = nt.nodes.new("ShaderNodeMath")
    ribh.operation = "MULTIPLY"
    nt.links.new(pattern.outputs["Value"], ribh.inputs[0])
    nt.links.new(gate.outputs["Value"], ribh.inputs[1])
    bump_rib = nt.nodes.new("ShaderNodeBump")
    bump_rib.inputs["Strength"].default_value = 0.9
    bump_rib.inputs["Distance"].default_value = 0.0008
    nt.links.new(ribh.outputs["Value"], bump_rib.inputs["Height"])
    nt.links.new(bump_knit.outputs["Normal"], bump_rib.inputs["Normal"])
    nt.links.new(bump_rib.outputs["Normal"], bsdf.inputs["Normal"])
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return mat


# --------------------------------------------------------------------------- Szene und Rendern


def setup_render(scale, samples, gpu=True):
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    cy = sc.cycles
    cy.samples = samples
    cy.use_denoising = True
    cy.denoiser = "OPENIMAGEDENOISE"
    cy.max_bounces = 6
    cy.diffuse_bounces = 4
    cy.glossy_bounces = 3
    cy.use_adaptive_sampling = True
    cy.adaptive_threshold = 0.004
    if gpu:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        prefs.compute_device_type = "CUDA"
        prefs.get_devices()
        for d in prefs.devices:
            d.use = d.type == "CUDA"
        cy.device = "GPU"
    w, h = garments.CANVAS
    sc.render.resolution_x = int(round(w * scale))
    sc.render.resolution_y = int(round(h * scale))
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = True
    sc.render.filter_size = 1.1
    sc.render.image_settings.file_format = "OPEN_EXR"
    sc.render.image_settings.color_mode = "RGBA"
    sc.render.image_settings.color_depth = "32"
    sc.view_settings.view_transform = "Standard"
    return sc


def setup_camera_and_light(g, floor_mat):
    sc = bpy.context.scene
    w, h = garments.CANVAS
    cam_data = bpy.data.cameras.new("kamera")
    cam_data.type = "ORTHO"
    cam_data.sensor_fit = "HORIZONTAL"
    cam_data.ortho_scale = w / g.px_per_m
    cam_data.clip_start, cam_data.clip_end = 0.05, 5.0
    cam = bpy.data.objects.new("kamera", cam_data)
    cam.location = (g.center[0], g.center[1], 1.2)
    sc.collection.objects.link(cam)
    sc.camera = cam
    # Boden: fängt Streulicht, ist aber für die Kamera unsichtbar
    me = bpy.data.meshes.new("boden")
    me.from_pydata([(-2, -2, 0), (2, -2, 0), (2, 2, 0), (-2, 2, 0)], [], [(0, 1, 2, 3)])
    floor = bpy.data.objects.new("boden", me)
    sc.collection.objects.link(floor)
    floor.data.materials.append(floor_mat)
    floor.visible_camera = False
    # Licht: große, weiche Fläche links oben (Schatten fallen nach rechts unten), dazu schwacher Himmel
    ld = bpy.data.lights.new("fenster", "AREA")
    ld.shape = "RECTANGLE"
    ld.size, ld.size_y = 1.6, 1.2
    ld.energy = 260.0
    lo = bpy.data.objects.new("fenster", ld)
    sc.collection.objects.link(lo)
    lo.location = (g.center[0] - 0.95, g.center[1] + 0.80, 0.95)
    d = Vector((g.center[0], g.center[1], 0.0)) - lo.location
    lo.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    world = bpy.data.worlds.new("himmel")
    sc.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (1.0, 1.0, 1.0, 1.0)
    bg.inputs["Strength"].default_value = 0.30
    return cam


def floor_material():
    mat = bpy.data.materials.new("boden")
    mat.use_nodes = True
    mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.55, 0.55, 0.55, 1.0)
    return mat


def render_exr(path):
    sc = bpy.context.scene
    sc.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(str(path))
    w, h = img.size
    arr = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(arr)
    bpy.data.images.remove(img)
    return arr.reshape(h, w, 4)[::-1].copy()  # Zeile 0 = oben


def main():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []

    def arg(name, default=None):
        return argv[argv.index(name) + 1] if name in argv else default

    gid = arg("--garment", "tee-front")
    work = Path(os.path.expanduser(arg("--work", "~/mock/work"))) / gid
    work.mkdir(parents=True, exist_ok=True)
    scale = float(arg("--scale", "1.0"))
    samples = int(arg("--samples", "96"))
    only = arg("--only")
    border = arg("--border")
    cpu = "--cpu" in argv

    bpy.ops.wm.read_factory_settings(use_empty=True)
    g = garments.build(gid)
    t0 = time.time()
    objs = []
    for i, panel in enumerate(g.panels):
        objs.append(make_panel_object(panel, i, g.mesh_h))
        so = make_seam_object(panel, i)
        if so is not None:
            objs.append(so)
    print(f"Netze: {len(objs)} Objekte, {sum(len(o.data.polygons) for o in objs)} Dreiecke, {time.time() - t0:.1f} s")
    sc = setup_render(scale, samples, gpu=not cpu)
    if border:
        x0, y0, x1, y1 = (float(v) for v in border.split(","))
        sc.render.use_border = True
        sc.render.use_crop_to_border = True
        sc.render.border_min_x, sc.render.border_max_x = x0, x1
        sc.render.border_min_y, sc.render.border_max_y = 1.0 - y1, 1.0 - y0
    setup_camera_and_light(g, floor_material())
    mats = {k: cloth_material(k) for k in ("light", "dark", "height")}
    passes = [only] if only else ["light", "dark", "height"]
    for kind in passes:
        for ob in objs:
            ob.data.materials.clear()
            ob.data.materials.append(mats[kind])
        sc.cycles.samples = samples if kind != "height" else 24
        sc.cycles.use_denoising = kind != "height"
        sc.view_settings.view_transform = "Standard" if kind != "height" else "Raw"
        if kind == "height":
            sc.world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.0
            for ob in bpy.data.objects:
                if ob.type == "LIGHT":
                    ob.hide_render = True
        t1 = time.time()
        arr = render_exr(work / f"{kind}.exr")
        np.save(work / f"{kind}.npy", arr)
        print(f"Durchgang {kind}: {arr.shape} in {time.time() - t1:.1f} s")
    (work / "info.txt").write_text(f"{gid} scale={scale} samples={samples}\n", encoding="utf-8")
    bpy.ops.wm.save_as_mainfile(filepath=str(work / "szene.blend"))


if __name__ == "__main__":
    main()
