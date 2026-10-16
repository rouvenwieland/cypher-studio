# 3D-Konventionen für den Cypher-Shop (3D-Rundgang)

Quelle: Abstimmung mit der Session „Cypher-Shop zum 3D-Rundgang umbauen und deployen“, 16.10.2026. **Endgültig** nach Design-Vorlage und Leistungstest auf dem Pixel 9a. Das Add-on „Cypher Export“ liest die Grenzwerte aus `packs/blender/cypher_export/budgets.json`, damit eine spätere Änderung keinen Code-Umbau braucht.

| # | Thema | Festlegung |
|---|---|---|
| 1 | Format | `.glb` (glTF 2.0), +Y oben, Meter, Ursprung am Boden mittig. Vorderseite in glTF +Z (in Blender −Y), Standard des Blender-Exporters. Transformationen anwenden, **keine Kameras, keine Lichter** exportieren. `KHR_mesh_quantization` erlaubt. |
| 2 | **Texturen extern** | **Keine eingebetteten Bilder in der .glb.** Der three.js-`GLTFLoader` lädt eingebettete Bilder über `blob:`-Adressen, die die Shop-CSP (`img-src 'self' data:`) blockiert. Texturen als eigene `.webp` neben der `.glb`, referenziert per relativer URI (`"uri": "<name>-basis.webp"`). Der Blender-Exporter bettet bei GLB immer ein, daher schreibt das Add-on die GLB nach dem Export um (Bilder aus dem BIN-Chunk lösen, als WebP speichern, `bufferView` durch `uri` ersetzen). |
| 3 | Budget (Dreiecke) | Requisite `prop-` ≤ 500 · Möbel `furn-` ≤ 1 500 · Produkt `prod-` ≤ 1 500 · Figur `fig-` ≤ 4 000 · Raum `room-` ≤ 15 000 · Szene ≤ 45 000 (Handy) bzw. ≤ 120 000 (Desktop) · Draw-Calls ≤ 90 (Handy) bzw. ≤ 180 (Desktop) |
| 4 | Texturgröße | Potenz von 2, Standard 128–256 px, höchstens 512 px. Motivtexturen 256 px (Handy) bis 512 px (Desktop-Nahaufnahme). Filter linear mit Mipmaps (PS2, nicht PS1: kein nearest). |
| 5 | Vertexfarben | Erwünscht: Der Shop backt Licht in die Vertexfarben. |
| 6 | Material | Nur Basisfarbe, optional Emission (Neon). Kein Metall/Rauheit, keine Normal-Maps. Alpha nur als Maske (`alphaMode MASK`). Höchstens 2 Materialien pro Modell. Shop rendert Lambert bzw. unlit mit eigenem Retro-Pass. |
| 7 | Kompression | **Kein** Draco, **kein** Meshopt, **kein** KTX2 (CSP erlaubt kein WebAssembly). Loader: three.js 0.186.1 `GLTFLoader`. |
| 8 | Benennung/Ablage | kebab-case mit Präfix `prop-`, `furn-`, `prod-`, `room-`, `fig-`. Ablage (optionaler Ersatz für die prozeduralen Shop-Formen) unter `src/assets/rundgang/modelle/<name>.glb` im Shop-Repo, daneben `<name>.lizenz.json` mit `{name, autor, lizenz, lizenzUrl, quelle}`. CC0 bevorzugt, CC-BY nur mit Namensnennung, kein NC/ND. |
| 9 | Shirt/Hoodie | Kein gemeinsames Mesh. Gemeinsam bleibt nur die Druckfläche Brust 30 × 40 cm, Motiv-Textur 3:4. |
| 10 | Ladebudget | Erste 3D-Szene ≤ 2 MB Modelle/Texturen zusätzlich zum JS-Bündel; jede weitere Welt ≤ 1,5 MB; gesamt < 5 MB. |
