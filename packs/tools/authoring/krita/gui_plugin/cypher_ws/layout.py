# -*- coding: utf-8 -*-
"""Arbeitsfläche "Cypher Druck": Werkzeugleiste links; rechts Übersicht (große Leinwände), Palette mit Farbwähler, darunter Ebenen,
Pinsel-Voreinstellungen und Werkzeugeinstellungen. Alles andere ist ausgeblendet."""
from PyQt5.QtCore import Qt

KEEP = ["ToolBox", "OverviewDocker", "PaletteDocker", "ColorSelectorNg", "KisLayerBox", "PresetDocker", "sharedtooldocker"]


def arrange(main, dockers, log):
    for name, d in dockers.items():
        if name not in KEEP:
            d.setVisible(False)
    missing = [n for n in KEEP if n not in dockers]
    if missing:
        raise RuntimeError("Docker fehlen: " + ", ".join(missing))
    toolbox, overview, palette, color, layers, presets, tool_options = (dockers[n] for n in KEEP)
    for d in (toolbox, overview, palette, color, layers, presets, tool_options):
        d.setFloating(False)
    main.addDockWidget(Qt.LeftDockWidgetArea, toolbox)
    main.addDockWidget(Qt.RightDockWidgetArea, overview)
    main.splitDockWidget(overview, palette, Qt.Vertical)
    main.tabifyDockWidget(palette, color)
    main.splitDockWidget(palette, layers, Qt.Vertical)
    main.tabifyDockWidget(layers, presets)
    main.tabifyDockWidget(layers, tool_options)
    for d in (toolbox, overview, palette, color, layers, presets, tool_options):
        d.setVisible(True)
    palette.raise_()
    layers.raise_()
    main.resizeDocks([overview, palette, layers], [180, 300, 380], Qt.Vertical)
    main.resizeDocks([overview], [320], Qt.Horizontal)
    log({"arrange": "ok"})
