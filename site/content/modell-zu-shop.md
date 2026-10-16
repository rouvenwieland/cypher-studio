---
titel: 3D-Modell zum Shop
beschreibung: Ein Modell in Blender mit dem Add-on Cypher Export prüfen, als GLB mit externen Texturen exportieren und im Shop-Rundgang einsetzen.
lead: Der Shop zeigt seine Räume als 3D-Rundgang im Browser. Modelle dafür baust du in Blender. Das Add-on „Cypher Export“ prüft sie gegen die Budgets und schreibt eine Datei, die der Shop laden kann.
stand: Stand der App: im Bau. Das Add-on gehört zum Blender-Paket der Cypher-Einrichtung; die Grenzwerte stehen in einer Datei (budgets.json) und können sich nach den Leistungstests auf dem Handy noch ändern.
reihenfolge: 4
---
![Ablauf: Modell in Blender prüfen, als GLB mit externen Texturen exportieren, Lizenzdatei ablegen, im Shop-Rundgang einsetzen](svg:flow-3d)

## Vorbereiten

Lade Blender über **Programme** in Cypher Studio und wende die **Einrichtung** an. Sie legt drei Dinge an: die Asset-Bibliothek „Cypher 3D“, das App-Template `cypher_ps2` und das Add-on „Cypher Export“. Das Add-on braucht Blender 4.2 oder neuer, Cypher Studio lädt die LTS-Version.

In Blender wählst du **Datei → Neu → Cypher PS2**. Die Szene ist metrisch (Maßstab 1) und hat zwei Sammlungen: `Export` wird exportiert, `Referenz` nie. In `Referenz` stehen eine Figur von 1,75 m, ein Bodenraster und die Kamera des Shops zum Abgleichen.

## Nach den Konventionen bauen

Der Shop zeichnet im Look der PlayStation-2-Zeit, also wenige Dreiecke und kleine Texturen. Die wichtigsten Grenzen:

| Teil | Name beginnt mit | Höchstens |
|---|---|---|
| Requisite | `prop-` | 500 Dreiecke |
| Möbel | `furn-` | 1.500 Dreiecke |
| Produkt | `prod-` | 1.500 Dreiecke |
| Figur | `fig-` | 4.000 Dreiecke |
| Raum | `room-` | 15.000 Dreiecke |

Ganze Szene: 45.000 Dreiecke und 90 Draw-Calls auf dem Handy, 120.000 und 180 am Computer. Namen schreibst du in kebab-case, zum Beispiel `furn-sofa-gold`.

- **Achsen und Maß:** Y zeigt nach oben, 1 Einheit ist 1 Meter, der Ursprung liegt am Boden in der Mitte. Wende alle Transformationen an.
- **Texturen:** Potenz von 2, meist 128 oder 256 px, höchstens 512 px, linear gefiltert mit Mipmaps (nicht „nearest“).
- **Material:** nur Basisfarbe und optional Emission für Neon, höchstens zwei Materialien je Modell. Kein Metall, keine Rauheit, keine Normal-Maps. Alpha nur als Maske.
- **Vertexfarben** sind erwünscht: Der Shop backt das Licht hinein.
- **Keine Kameras und keine Lichter** in der Auswahl.
- **Keine Kompression:** kein Draco, kein Meshopt, kein KTX2. Die Sicherheitsregeln des Shops erlauben kein WebAssembly.

## Prüfen

Im 3D-Viewport zeigt die Seitenleiste „Cypher“ die Prüfungen live. Wähle zuerst das Präfix. Dann steht für jeden Punkt eine Ampel, mit Wort und Form, nie nur in Farbe: Dreiecke (mit Modifikatoren ausgewertet), Materialien, Kanäle, Alpha, Texturgröße, UV-Karte, angewendete Transformationen, Ursprung. Ist etwas rot, steht dort, was fehlt und wie viel.

## Exportieren

Klicke in der Seitenleiste auf **Als GLB exportieren**. Das Add-on prüft noch einmal, verkleinert Texturen auf das Budget und schreibt die Datei im glTF-Format.

Wichtig ist, was danach passiert: Blender bettet Bilder immer in die `.glb` ein. Der Shop lädt solche Bilder aber nicht, seine Sicherheitsregeln blocken sie. Darum löst das Add-on die Bilder wieder heraus und legt sie als `<name>-basis.webp` neben die `.glb`. Außerdem entsteht eine Lizenzdatei, falls noch keine da ist:

```json
{
  "name": "furn-sofa-gold",
  "autor": "…",
  "lizenz": "CC0-1.0",
  "lizenzUrl": "https://creativecommons.org/publicdomain/zero/1.0/",
  "quelle": "eigenes Modell"
}
```

Zum Schluss zeigt ein Dialog den Bericht. Zweimal exportieren ergibt zwei gleiche Dateien.

:::achtung
**Fremde Modelle:** CC0 ist erste Wahl, CC-BY nur mit Namensnennung in der Lizenzdatei. Modelle mit NC oder ND (nicht kommerziell, keine Bearbeitung) nimmt der Shop nicht, denn das Kollektiv verkauft.
:::

## Im Shop einsetzen

Lege die Dateien im Shop-Repository ab:

```text
src/assets/rundgang/modelle/<name>.glb
src/assets/rundgang/modelle/<name>-basis.webp
src/assets/rundgang/modelle/<name>.lizenz.json
```

Sie ersetzen dort die prozeduralen Formen. Der Ladeumfang ist knapp bemessen: Die erste 3D-Szene bekommt höchstens 2 MB an Modellen und Texturen, jede weitere Welt 1,5 MB, alles zusammen bleibt unter 5 MB. Das Add-on meldet, wenn dein Modell zu viel davon braucht.

Weiter: [Motiv zur Druckdatei zu Shirtigo](/anleitung/motiv-zu-shirtigo/) oder [Social und Reels](/anleitung/social-und-reels/).
