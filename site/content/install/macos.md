---
titel: macOS
kurz: „Dennoch öffnen“ in den Systemeinstellungen
kurzSigniert: Beglaubigt · öffnet ohne Warnung
---
:::::schritte
::::schritt Abbild öffnen und installieren
Öffne `{{file.macos}}` mit einem Doppelklick und ziehe **Cypher Studio** in den Ordner **Programme**. Das Abbild läuft auf Apple Silicon und auf Intel-Macs.

![Das Disk-Image öffnen und Cypher Studio in den Ordner „Programme“ ziehen](svg:mac-dmg)
::::
::::schritt-unsigned Erster Start: auf „Fertig“ klicken
Öffne Cypher Studio aus dem Ordner „Programme“. macOS meldet, dass es die App nicht überprüfen konnte. Das liegt daran, dass Cypher Studio noch nicht von Apple beglaubigt ist. Klicke auf **Fertig**.

![Beim ersten Öffnen meldet macOS, die App nicht überprüfen zu können: auf „Fertig“ klicken](svg:mac-blockiert)
::::
::::schritt-unsigned In den Systemeinstellungen freigeben
Öffne **Systemeinstellungen → Datenschutz & Sicherheit** und scrolle ganz nach unten zum Abschnitt „Sicherheit“. Dort steht, dass „Cypher Studio“ blockiert wurde. Klicke auf **Dennoch öffnen** und bestätige mit deinem Passwort oder Touch ID.

![Systemeinstellungen, Datenschutz & Sicherheit, ganz unten bei „Cypher Studio“ auf „Dennoch öffnen“ klicken](svg:mac-einstellungen)

Seit macOS 15 reicht Rechtsklick → Öffnen nicht mehr. Der Knopf erscheint erst, nachdem du die App einmal geöffnet hast, und bleibt dann etwa eine Stunde sichtbar. Fehlt er, öffne die App noch einmal.
::::
::::schritt-unsigned Nur falls macOS „beschädigt“ meldet
Meldet macOS, die App sei „beschädigt“, öffne das Terminal und entferne die Download-Markierung. Das ändert sonst nichts an der App.

![Terminal: nur falls macOS „beschädigt“ meldet, die Download-Markierung mit xattr entfernen](svg:mac-terminal)

```sh
xattr -dr com.apple.quarantine "/Applications/Cypher Studio.app"
```
::::
:::::
