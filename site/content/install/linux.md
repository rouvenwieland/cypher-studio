---
titel: Linux
kurz: AppImage ausführbar machen · oder .deb und .rpm
kurzSigniert: AppImage ausführbar machen · oder .deb und .rpm
---
:::::schritte
::::schritt AppImage ausführbar machen
Im Dateimanager: Rechtsklick auf `{{file.linux-appimage}}` → Eigenschaften → Zugriffsrechte → **Datei als Programm ausführen**. Oder im Terminal:

![Dateieigenschaften: bei „Zugriffsrechte“ den Haken „Datei als Programm ausführen“ setzen](svg:linux-eigenschaften)

```sh
chmod +x {{file.linux-appimage}}
```
::::
::::schritt Starten
Doppelklick auf die Datei oder im Terminal:

```sh
./{{file.linux-appimage}}
```
::::
::::schritt Falls FUSE fehlt
Meldet der Start `dlopen(): error loading libfuse.so.2`, fehlt FUSE 2. Auf Ubuntu 24.04 und neuer heißt das Paket `libfuse2t64`, auf Ubuntu 22.04 und Debian `libfuse2`.

![Terminal: AppImage ausführbar machen und starten; bei fehlendem FUSE libfuse2t64 installieren](svg:linux-terminal)

```sh
sudo apt install libfuse2t64
```

Ohne FUSE geht es auch, nur etwas langsamer beim Start:

```sh
./{{file.linux-appimage}} --appimage-extract-and-run
```
::::
::::schritt Oder als Paket installieren
Das Paket zieht die benötigten Bibliotheken (WebKitGTK 4.1) selbst nach.

```sh
sudo apt install ./{{file.linux-deb}}
```

```sh
sudo dnf install ./{{file.linux-rpm}}
```
::::
:::::

:::tipp
Bleibt das Fenster schwarz oder leer (häufig mit NVIDIA-Treibern unter Wayland), starte mit `WEBKIT_DISABLE_DMABUF_RENDERER=1 ./{{file.linux-appimage}}`. Hilft das nicht, probiere zusätzlich `WEBKIT_DISABLE_COMPOSITING_MODE=1`.
:::

:::hinweis
Die Updates für `.deb` und `.rpm` fragen nach deinem Passwort (über `pkexec`). Das AppImage aktualisiert sich ohne Administratorrechte.
:::
