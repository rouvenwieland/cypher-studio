---
titel: In 30 Minuten startklar
beschreibung: Von der Installation bis zum ersten Motiv: Cypher Studio installieren, Programme laden, die Cypher-Einrichtung anwenden und eine Druckdatei prüfen.
lead: Etwa eine halbe Stunde, und der größte Teil läuft im Hintergrund. Du installierst Cypher Studio, lässt vier Programme laden, wendest die Cypher-Einrichtung an und prüfst ein erstes Motiv für Shirtigo.
stand: Stand der App: im Bau. Die Schritte folgen dem Konzept für Version 0.1, Bezeichnungen können sich bis zur ersten Version noch ändern.
reihenfolge: 1
---
## Das brauchst du

- Einen Computer mit Windows 10 oder 11, macOS 13 oder neuer, oder Linux (64 Bit).
- Etwa 3 GB freien Platz, wenn du alle vier Programme laden willst (Richtwert).
- Internet zum Laden der Programme. Cypher Studio selbst läuft auch ohne.
- Optional: einen gemeinsamen Ordner, den ihr mit Syncthing, Nextcloud oder einem ähnlichen Dienst teilt. Cypher Studio synchronisiert nicht selbst.

![Zeitplan: etwa 30 Minuten, Download läuft im Hintergrund parallel zu Einrichtung und Probelauf](svg:zeitplan)

Von den 30 Minuten gehören dir etwa 10: auswählen, zustimmen, einrichten, einen Probelauf machen. Den Rest laden die Programme im Hintergrund, und du kannst nebenbei weitermachen.

## Installieren

Lade Cypher Studio für dein System im [Download](/#download) und öffne die Datei. Zeigt dein System eine Warnung, ist das erwartbar: Cypher Studio ist noch nicht signiert. Das Zertifikat kostet laufend Geld, und die Warnung sagt nur, dass das System die Datei noch nicht kennt. Mit diesen Schritten öffnest du die App trotzdem:

@@install@@

## Erststart

Beim ersten Start läuft kurz die Kennung: Das Bild schneidet im Takt durch die Kanäle und rastet auf STUDIO ein. Jede Taste überspringt sie. Danach führt dich der Assistent „In 30 Minuten startklar“ durch den Rest. Du kannst jederzeit oben rechts **Später weitermachen** wählen. Die Startseite zeigt dann, wie weit du bist.

:::::schritte
::::schritt Was machst du vor allem?
Kreuze an, was du brauchst: Malen und Foto (Krita), Vektor und Druck (Inkscape), 3D (Blender), Video (Kdenlive). Vorgewählt sind Krita und Inkscape, weil der Druck der Kern ist. Unten steht, wie viel zusammen geladen wird.
::::
::::schritt Euer gemeinsamer Ordner
Wähle den Ordner, den das Kollektiv teilt. Cypher Studio zeigt kurz, was darin liegt, etwa „3.104 Dateien · 41 GB · 12 Projekte gefunden“, und legt bei Bedarf den Unterordner `.cypher` an. Du kannst diesen Schritt mit **Später** überspringen.
::::
:::::

## Programme laden

Vor jeder Installation zeigt Cypher Studio eine Prüfungsanzeige mit sechs Feldern: **Quelle**, **Version**, **Größe**, **Lizenz**, **Prüfsumme** und **Zielordner**. Erst wenn du zustimmst, passiert etwas.

:::::schritte
::::schritt Prüfen und zustimmen
Lies die Zeile je Programm und klicke auf **Alle laden und installieren**. Cypher Studio lädt genau diese Dateien aus genau diesen Quellen, vergleicht die Prüfsumme und installiert nur, wenn sie stimmt. Das geht ohne Administratorrechte, die Programme landen in deinem Benutzerordner.
::::
::::schritt Warten, ohne zu warten
Der Download läuft im Hintergrund, bei vier Programmen 10 bis 20 Minuten. Die Zeitleiste oben rechnet die Restzeit aus der echten Geschwindigkeit. Du siehst den Stand jederzeit unter **Aufträge** (<kbd>Strg</kbd>+<kbd>J</kbd>). Scheitert ein Programm, bleibt es offen und der Rest geht weiter.
::::
:::::

:::hinweis
**Stimmt eine Prüfsumme nicht,** löscht Cypher Studio die Datei und installiert nichts. Du siehst die erwartete und die berechnete Summe nebeneinander und kannst von einem anderen Spiegel laden. Das passiert bei abgebrochenen Downloads oder einem veränderten Spiegel.
:::

## Cypher-Einrichtung

Sobald ein Programm installiert ist, richtet Cypher Studio es ein, damit es unsere Farben, Schriften und Formate kennt. Alles davon ist umkehrbar.

- **Krita:** Palette „Cypher Kollektionen“ mit 17 Farben, Dokumentvorlagen für Shirt (3898 × 5315 px bei 300 dpi), Hoodie, Post und Story, Schriften.
- **Inkscape:** Palette, Vorlagen mit der Druckfläche als Seite in Millimetern, Export-Voreinstellung 300 dpi.
- **Blender:** Asset-Bibliothek „Cypher 3D“, Mockup-Szene, das Add-on „Cypher Export“. Deine Startdatei bleibt unverändert.
- **Kdenlive:** Projektprofile 1080 × 1920 und 1080 × 1350 bei 30 fps, Titelvorlagen, Render-Profil „Reel (H.264, 1080 × 1920)“.
- **Schriften** für alle Programme: Anybody, Atkinson Hyperlegible Next und Martian Mono, im Benutzer-Schriftordner.

Du siehst eine Liste mit Status je Baustein und kannst einzelne abwählen. Hast du etwas selbst geändert, überschreibt Cypher Studio es nie still: Du wählst **Überschreiben** oder **Daneben ablegen**. Vor dem Anwenden legt es eine Sicherung an, und **Rückgängig** stellt sie wieder her. Läuft das Programm gerade, erscheinen neue Paletten erst nach einem Neustart.

## Das erste Motiv

Der Probelauf nimmt ein mitgeliefertes Probe-Motiv und öffnet es im Druckprüfer. Es hat absichtlich einen Hinweis: einen kleinen Anteil Halbtransparenz. Dafür dauert es fünf Minuten.

:::::schritte
::::schritt Urteil lesen
Rechts steht das Urteil in einem Wort: **Druckbereit**, **Druckbar mit Hinweisen** oder **Nicht druckbar**, darunter die Zählung. Fehler stehen oben, dann Hinweise, die erfüllten Regeln sind eingeklappt.
::::
::::schritt Hinweis beheben
Öffne die Zeile „Halbtransparenz“. Sie zeigt die Stelle in der Vorschau, erklärt die Regel und bietet **Beheben** an. Danach steht das Urteil auf **Druckbereit**.
::::
::::schritt In einen Probeordner exportieren
Die Ausgangsleiste unten bietet **Für Shirtigo exportieren** (<kbd>Strg</kbd>+<kbd>Enter</kbd>). Beim Probelauf geht die Datei in einen Probeordner. Bei Erfolg füllt sich die Leiste mit Cyan und zeigt den Dateinamen.
::::
:::::

Wie es mit einem eigenen Motiv weitergeht, steht auf den drei Ablaufseiten unten.

## Wenn etwas hakt

- **Das System warnt beim Öffnen.** Siehe [Installieren](#installieren). Die Warnung gehört zu einer unsignierten App und ist kein Zeichen für ein Problem mit der Datei.
- **Ich will die Datei prüfen, bevor ich sie öffne.** Rechne die [Prüfsumme](/#pruefen) nach.
- **Ein Programm lässt sich nicht laden.** Die Prüfungsanzeige zeigt Quelle und Fehler. **Von anderem Spiegel laden** und **Details kopieren** helfen weiter, und die Programmseite des Projekts steht in jedem Dialog.
- **Die App bleibt leer oder schwarz (Linux).** Starte mit `WEBKIT_DISABLE_DMABUF_RENDERER=1`, siehe [Linux](#linux).
