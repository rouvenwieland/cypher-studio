# Schriften: Herkunft, Lizenz und Änderungen

Alle drei Familien stehen unter der SIL Open Font License 1.1 (`OFL.txt` je Familie, byteidentisch mit dem Upstream-Text). Keine der drei Urheberzeilen
nennt einen „Reserved Font Name“; die Namen dürfen also auch in abgeleiteten Dateien bleiben. Die Lizenz bleibt in jedem Fall beigelegt (OFL 2.1).

| Familie | Upstream | Stand (Commit) |
|---|---|---|
| Anybody | https://github.com/Etcetera-Type-Co/Anybody | `fe7b55cf9d1563348ad95ac8e05f43b81a420c31` (10.03.2023) |
| Atkinson Hyperlegible Next | https://github.com/googlefonts/atkinson-hyperlegible-next | `7925f50f649b3813257faf2f4c0b381011f434f1` (21.02.2025) |
| Martian Mono | https://github.com/evilmartians/mono | `8babba8a76cabf54543dca3a994d7af85e425f98` (23.07.2026) |

## Dateien

| Ordner | Inhalt | Herkunft |
|---|---|---|
| `<familie>/*-Variable.ttf` (auch `-Italic-Variable`) | variable Schriften (Anybody `wdth` 50–150 und `wght` 100–900, Atkinson `wght`, Martian Mono `wdth` und `wght`) | **unverändert** aus `fonts/variable/` des Upstream-Repos (SHA-256 geprüft, `SHA256SUMS`) |
| `atkinson-hyperlegible-next/static/` (Regular, Italic, Medium, SemiBold, Bold, BoldItalic) | statische Schnitte | **unverändert** aus `fonts/ttf/` des Upstream-Repos |
| `martian-mono/static/` (Regular, Medium, SemiBold, Bold) | statische Schnitte, normale Breite | **unverändert** aus `fonts/ttf/` des Upstream-Repos |
| `anybody/static/` (Regular, Medium, SemiBold, Bold, ExtraBold, Black; UltraCondensed und ExtraExpanded je ExtraBold und Black) | statische Schnitte | **abgeleitet** aus `Anybody-Variable.ttf`, siehe unten |

Warum statische Schnitte zusätzlich: Kdenlive (Qt-Titler) und Blender wählen Schnitte über den Familiennamen bzw. laden eine Datei; variable Schriften mit
mehreren Achsen erscheinen dort nur als Standardinstanz (bei Anybody „Thin“). Krita und Inkscape laden die variablen Dateien, Kdenlive und Blender
(über das Paket `fonts`) die statischen.

## Anybody: statische Schnitte aus dem variablen Original abgeleitet

Die statischen Dateien des Upstream-Repos (`fonts/ttf/Anybody-*.ttf`, Stand oben) sind fehlerhaft: Die Glyphendaten (`glyf`) und `post` von
`Anybody-Regular.ttf` und `Anybody-Italic.ttf` sind **bytegleich**, in allen „aufrechten“ Dateien steht `post.italicAngle = -10`, und sie zeichnen schräg
(gemessen mit `fc-query` und beim Rendern in Inkscape 1.4.4 und Kdenlive/Qt). Die variable Datei ist dagegen korrekt (`italicAngle` 0). Die Upstream-Statics
wurden deshalb **nicht** übernommen.

Stattdessen erzeugt `packs/tools/authoring/fonts/instance_anybody.py` die gebrauchten Schnitte mit dem fontTools-Instancer (fontTools 4.67, MIT) aus der
unveränderten `Anybody-Variable.ttf` (Achsenwerte fest, Umrisse unverändert). Namens-, Gewichts-, Breiten- und Stilangaben folgen der Benennung der
Upstream-Statics (z. B. Familie „Anybody ExtraBold“, typografische Familie „Anybody“, Stil „ExtraBold“); Urheberrechts- und Lizenzeinträge der Quelle
bleiben erhalten. Die Ausgabe ist deterministisch (gleiche Bytes bei jedem Lauf). Das ist ein abgeleitetes Werk im Sinne der OFL und steht ebenfalls unter OFL-1.1.

Aufruf (WSL, `~/c1work/fonttools-venv` mit `pip install "fonttools>=4.50,<5"`):
`python packs/tools/authoring/fonts/instance_anybody.py packs/shared/fonts/anybody/Anybody-Variable.ttf packs/shared/fonts/anybody/static`
