# SPDX-License-Identifier: GPL-3.0-or-later
"""Einstellungen von Cypher Export (liegen an der Szene: `scene.cypher_export`).

Kein `from __future__ import annotations` in Dateien mit Blender-Eigenschaften:
Blender liest die Annotationen zur Laufzeit.
"""

import bpy
from bpy.props import BoolProperty, EnumProperty, StringProperty

from .checks import PREFIXES


def _changed(_self, _context):
    """Prüfbericht nach einer Änderung der Einstellungen neu berechnen."""
    from . import panel

    panel.schedule()


LICENSES = {
    "CC0-1.0": "https://creativecommons.org/publicdomain/zero/1.0/",
    "CC-BY-4.0": "https://creativecommons.org/licenses/by/4.0/",
    "CC-BY-3.0": "https://creativecommons.org/licenses/by/3.0/",
}


class CypherExportSettings(bpy.types.PropertyGroup):
    scope: EnumProperty(
        name="Umfang",
        description="Was exportiert wird",
        items=[
            ("COLLECTION", "Sammlung „Export“", "Alle sichtbaren Objekte der Sammlung „Export“"),
            ("SELECTION", "Auswahl", "Nur die ausgewählten Objekte"),
        ],
        default="COLLECTION",
        update=_changed,
    )  # type: ignore[valid-type]
    prefix: EnumProperty(
        name="Präfix",
        description="Art des Modells; bestimmt das Dreiecksbudget",
        items=[
            ("prop-", "prop- Requisite", "Kleine Dinge, bis 500 Dreiecke"),
            ("furn-", "furn- Möbel", "Möbel, bis 1.500 Dreiecke"),
            ("prod-", "prod- Produkt", "Shirt, Hoodie, Cap, bis 1.500 Dreiecke"),
            ("fig-", "fig- Figur", "Figuren, bis 4.000 Dreiecke"),
            ("room-", "room- Raum", "Ganze Räume, bis 15.000 Dreiecke"),
        ],
        default="prop-",
        update=_changed,
    )  # type: ignore[valid-type]
    name: StringProperty(
        name="Name",
        description="Rest des Dateinamens in kebab-case, ohne Präfix (z. B. laterne-neon)",
        default="beispiel-kiste",
        update=_changed,
    )  # type: ignore[valid-type]
    export_dir: StringProperty(
        name="Ordner",
        description="Zielordner; leer = neben der .blend-Datei",
        subtype="DIR_PATH",
        default="",
    )  # type: ignore[valid-type]
    author: StringProperty(name="Autor", default="Cypher Kollektiv")  # type: ignore[valid-type]
    license_id: EnumProperty(
        name="Lizenz",
        items=[
            ("CC0-1.0", "CC0 1.0", "Gemeinfrei, bevorzugt"),
            ("CC-BY-4.0", "CC BY 4.0", "Mit Namensnennung"),
            ("CC-BY-3.0", "CC BY 3.0", "Mit Namensnennung"),
        ],
        default="CC0-1.0",
    )  # type: ignore[valid-type]
    source: StringProperty(name="Quelle", description="Woher das Modell stammt (Adresse oder „Eigenes Werk“)", default="Eigenes Werk")  # type: ignore[valid-type]
    live: BoolProperty(name="Live-Prüfung", description="Prüfbericht bei jeder Änderung neu berechnen", default=True)  # type: ignore[valid-type]

    @property
    def full_name(self) -> str:
        return f"{self.prefix}{self.name}"

    @property
    def license_url(self) -> str:
        return LICENSES[self.license_id]


__all__ = ["CypherExportSettings", "LICENSES", "PREFIXES"]
