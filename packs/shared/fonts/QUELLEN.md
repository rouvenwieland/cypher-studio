# Schriften: Herkunft und Lizenz

Alle drei Familien stehen unter der SIL Open Font License 1.1 (siehe `OFL.txt` je Familie). Keine der drei Lizenzen deklariert einen
„Reserved Font Name“ (die Urheberzeile enthält keinen Zusatz „with Reserved Font Name“). Trotzdem wurde nichts umbenannt, instanziiert
oder verändert: Alle Dateien sind byteidentisch mit dem Upstream-Stand (Prüfsummen in `SHA256SUMS`).

| Familie | Upstream | Stand (Commit) | Dateien hier |
|---|---|---|---|
| Anybody | https://github.com/Etcetera-Type-Co/Anybody | `fe7b55cf9d1563348ad95ac8e05f43b81a420c31` (10.03.2023) | variabel (`wdth` 50–150, `wght` 100–900) und `static/` (Regular, Medium, SemiBold, Bold, ExtraBold, Black; UltraCondensed und ExtraExpanded je ExtraBold und Black) |
| Atkinson Hyperlegible Next | https://github.com/googlefonts/atkinson-hyperlegible-next | `7925f50f649b3813257faf2f4c0b381011f434f1` (21.02.2025) | variabel (`wght`) und `static/` (Regular, Italic, Medium, SemiBold, Bold, BoldItalic) |
| Martian Mono | https://github.com/evilmartians/mono | `8babba8a76cabf54543dca3a994d7af85e425f98` (23.07.2026) | variabel (`wdth`, `wght`) und `static/` (Regular, Medium, SemiBold, Bold) |

Warum zusätzlich statische Schnitte: Kdenlive (Qt-Titler) und Blender wählen Schnitte über den Familiennamen; variable Schriften
mit mehreren Achsen werden dort nur als Standardinstanz angeboten. Die statischen TTFs stammen unverändert aus `fonts/ttf/` der Upstream-Repos.
Krita und Inkscape laden die variablen Dateien; Kdenlive und Blender (über das Paket `fonts`) die statischen.
