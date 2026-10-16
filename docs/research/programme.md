# Cypher Studio – Faktenbasis Programm-Katalog

Stand: 16.10.2026 (alle Quellen am 16.10.2026 abgerufen). Erstellt für: Krita, Inkscape, Blender, Kdenlive, plus optionale Kandidaten und Affinity.
Maschinenlesbarer Entwurf: `catalog-draft.json` (gleicher Ordner).

Konventionen:
- `[Qn]` verweist auf die Quellenliste am Ende (jede Aussage hat damit eine URL).
- **verifiziert** = direkt aus Verzeichnisliste, Datei, Quellcode oder Doku gelesen. **Annahme** = plausibel, aber nicht belegt (ohne Download nicht prüfbar). Alle Annahmen sind in Abschnitt 9 als Smoke-Tests gesammelt.
- Es wurde nichts außer Textdateien (Prüfsummen, Schlüssel, Signaturen, Verzeichnislisten, Quelltext) geladen und nichts installiert.

---

## 0. Die wichtigsten Befunde auf einen Blick

1. **Aktuelle Versionen (Okt 2026):** Blender **5.2.2 LTS** (15.09.2026) [Q2][Q5], Krita **5.3.4.1** (07.10.2026; Qt5, „suitable for productive work“) und **6.0.4.1** (Qt6, „more experimental“) [Q20][Q28][Q27], Inkscape **1.4.4** [Q50][Q56], Kdenlive **26.08.2** (13.10.2026) [Q70][Q72].
2. **Blender 5.x hat keinen Intel-Mac-Build.** Für Intel-Macs bleibt nur **Blender 4.5 LTS (4.5.14)**, laut Blender „the last release to support Intel“ [Q4][Q7]. Katalog braucht dafür einen Serien-Override.
3. **Signaturen sind die Ausnahme.** GPG gibt es nur bei Krita-AppImage (Dmitry Kazakov) und Inkscape-AppImage (Marc Jeanmougin, schwacher DSA-1024/SHA-1-Schlüssel). Blender, Kdenlive, Krita-Windows/macOS und Inkscape-Windows/macOS haben nur **SHA-256**. Blender/Krita/Kdenlive liefern SHA-256 von der Hauptquelle, Inkscape von `media.inkscape.org` [Q3][Q23][Q24][Q53][Q71].
4. **KDE-Hosts (Krita, Kdenlive):** Die Artefakte werden per HTTP 302 auf Mirror umgeleitet (Mirrorbits), `<datei>.sha256` kommt aber direkt (HTTP 200) von `download.kde.org`; `.sig` ebenfalls von der Hauptquelle. Prüfsumme immer von `download.kde.org`, nie vom Mirror holen [Q23][Q24][Q71].
5. **Inkscape ist der Sonderfall bei der URL-Ermittlung:** Windows-/AppImage-Dateinamen enthalten Datum, Git-Hash und zufällige Suffixe (`inkscape-1.4.4_2026-05-05_dcaf3e7-x64_mHK170m.7z`). Die URL muss aus der `/dl/`-HTML-Seite (Meta-Refresh) gelesen werden [Q52].
6. **Portabel (ohne Admin) gibt es für alle vier:** Windows: Blender-ZIP, Krita-ZIP, Inkscape-7z, Kdenlive-Standalone-SFX. Linux: Blender-tar.xz, AppImages. macOS: überall nur dmg → die .app in einen Benutzerordner kopieren (kein Admin nötig).
7. **Inkscape macOS 1.4.3/1.4.4 (offizielle dmg): Extensions funktionieren nicht, wenn Inkscape „von der Kommandozeile“ gestartet wird** (Sicherheitsfeature zu CVE-2025-15523) [Q56]. Cypher startet Programme aus einer App heraus – Startweg auf macOS früh testen (`open -a`).
8. **Kdenlive-macOS ist nicht notarisiert** (Gatekeeper-Warnung laut Doku) [Q73].
9. **Fonts:** Inkscape lädt `<profil>/fonts` standardmäßig (Quellcode belegt) [Q59]; Krita lädt `<ressourcen>/fonts` [Q40]; Kdenlive (Qt) und Blender lesen Systemschriften bzw. brauchen eigene Pfade → Benutzer-Schriftordner des Betriebssystems ist der gemeinsame Nenner (Abschnitt 6).
10. **Firecrawl-Guthaben ist leer** (Anfrage wurde abgelehnt); alle Ergebnisse stammen aus WebFetch/WebSearch/curl.

---

## 1. Gemeinsame Grundlagen

### 1.1 Vertrauensmodell pro Programm

| Programm | Artefakt-Host | Prüfsumme (Host) | Signatur | Hinweis |
|---|---|---|---|---|
| Blender | `download.blender.org` (Cloudflare, direkt) [Q2] | `blender-<v>.sha256` von `download.blender.org`, sha256sum-Format, eine Datei für alle Plattformen [Q3] | keine (kein `.asc/.sig` im Verzeichnis) [Q2] | `www.blender.org/download/release/...` → `mirror.blender.org` → 302 auf `mirror.dotsrc.org` [Q16]; Mirror nicht nutzen |
| Krita | `download.kde.org` → 302 auf Mirror [Q23] | `<datei>.sha256` direkt von `download.kde.org` [Q23] | GPG nur für AppImage + Quell-Tarballs, `.sig` (binär, OpenPGP) von `download.kde.org` [Q24] | Windows-ZIP/setup/dmg: nur SHA-256 |
| Inkscape | `inkscape.org/gallery/item/...` → 302 `media.inkscape.org/dl/resources/file/...` [Q52] | `.sha256` auf `media.inkscape.org/media/resources/sigs/` [Q53] | nur AppImage: `.sig` (DSA-1024, SHA-1) [Q54] | Link-Text „sig“ führt bei Windows/macOS auf eine reine `.sha256`-Textdatei [Q52] |
| Kdenlive | `download.kde.org` → 302 auf Mirror [Q71] | `<datei>.sha256` direkt von `download.kde.org` [Q71] | keine (`.sig` → 404) [Q71] | – |

### 1.2 Archivformate, die der Rust-Client können muss

`.zip` (Blender-Win, Krita-Win), `.7z` (Inkscape-Win; evtl. Kdenlive-SFX), `.tar.xz` (Blender-Linux), `.dmg` (macOS: `hdiutil attach -nobrowse -readonly -mountpoint …`, dann `ditto` der `.app`), `.AppImage` (nur `chmod +x`). Passende Bausteine statt Eigenbau: Crates `zip`, `sevenz-rust2`, `tar` + `xz2`/`liblzma`, `sha2`, für GPG `gpgv` des Systems oder eine OpenPGP-Bibliothek mit gelockerter Policy (Inkscape-Signatur: DSA-1024/SHA-1 [Q54]). Annahme (nicht geprüft): Crate-Namen/Eignung.

### 1.3 Download-Größen (je Plattform)

| Programm | Windows x64 | macOS arm64 | macOS x86_64 | Linux x86_64 |
|---|---|---|---|---|
| Blender 5.2.2 | ZIP 404 MB (MSI 365 MB) [Q2] | dmg 346 MB [Q2] | 4.5.14 dmg 340 MB [Q4] | tar.xz 383 MB [Q2] |
| Krita 5.3.4.1 | ZIP 228 MB (setup 165 MB) [Q22] | dmg 392 MB [Q22] | gleiche dmg [Q22] | AppImage 382 MB [Q22] |
| Inkscape 1.4.4 | 7z 110 MB (exe 119 MB, msi 170 MB) [Q52] | dmg 157 MB [Q52] | dmg 160 MB [Q52] | AppImage 120 MB [Q52] |
| Kdenlive 26.08.2 | standalone 135 MB (exe 136 MB) [Q70] | dmg 144 MB [Q70] | dmg 158 MB [Q70] | AppImage 215 MB [Q70] |

Summe aller vier je Windows/Linux ca. 0,9–1,1 GB, macOS ca. 1,0 GB. → Download-Fortschritt, Resume (HTTP Range) und Plattenplatz-Vorprüfung einplanen.

### 1.4 Fallstricke Betriebssystem

| Thema | Befund | Quelle |
|---|---|---|
| AppImage auf Ubuntu 24.04 | Paket `libfuse2` heißt dort `libfuse2t64`; ohne FUSE 2 starten AppImages nicht. Notlösung: `./x.AppImage --appimage-extract-and-run` oder `APPIMAGE_EXTRACT_AND_RUN=1`; dauerhaft entpacken mit `--appimage-extract` (→ `squashfs-root/AppRun`). Extrahieren ist teuer, nur Fallback. | [Q90] |
| AppImage-Launcher | Krita warnt: manche AppImageLauncher-Versionen sind mit neuen AppImage-Runtimes inkompatibel | [Q27] |
| Krita auf Wayland | nur gegen KDE KWin getestet | [Q27] |
| macOS-Gatekeeper | Apps ohne bekannte Entwicklerprüfung werden blockiert; manuell über Systemeinstellungen > Datenschutz & Sicherheit > „Trotzdem öffnen“. | [Q91] |
| macOS-Quarantäne (Annahme) | Das Attribut `com.apple.quarantine` setzen Browser/LaunchServices, nicht ein eigener HTTP-Client. Lädt Cypher die dmg selbst und kopiert die `.app` per `ditto`, entfällt die Quarantäne vermutlich – nicht getestet. Als zweite Absicherung `codesign --verify --deep --strict` / `spctl -a -vv` auf der kopierten `.app`. | Annahme |
| Windows-Installer brauchen Admin | Krita setup.exe (HKLM, Program Files) [Q38], Blender MSI (per Maschine) [Q15], Kdenlive-Installer [Q73]. Portable-Varianten brauchen kein Admin. | siehe Einzelabschnitte |
| Blender-„portable“ auf macOS | `portable`-Ordner liegt in `Blender.app/Contents/Resources` und verändert damit das signierte App-Bundle | [Q8] |
| Versionierte Konfig bei Blender | Konfig hängt an Major.Minor (`5.2`); jede neue Serie startet leer | [Q8] |
| Krita-ZIP teilt Daten mit Installer | „share your settings and custom resources with your regular installed version“ | [Q27] |

### 1.5 Erkennung bereits vorhandener Installationen (Zusammenfassung)

Strategie: eigene Installationen aus dem Cypher-Manifest; fremde Installationen nur lesend erkennen und **nie** verändern. Prüfreihenfolge je OS: Standardpfade → Registry (Windows Uninstall-Schlüssel, `HKLM` und `HKCU`) / Spotlight-Bundle-ID (macOS: `mdfind`) → `PATH` → Flatpak (`flatpak info <id>`) / Snap (`snap list`).

| Programm | Windows | macOS | Linux |
|---|---|---|---|
| Blender | `%ProgramFiles%\Blender Foundation\Blender <X.Y>\blender.exe` (Installer; Doku nennt `…\Blender Foundation\Blender\blender.exe` [Q14]), Store `%ProgramFiles%\WindowsApps\BlenderFoundation.Blender<HASH>\Blender\` [Q8], Steam | `/Applications/Blender.app` [Q14] | `blender` im PATH, `/usr/bin/blender` (Distro-Paket `/usr/share/blender/<X.Y>` [Q8]), Snap `blender`, Flatpak `org.blender.Blender` |
| Krita | Registry `HKLM\Software\Microsoft\Windows\CurrentVersion\Uninstall\Krita_x64` und `HKLM\Software\Krita`, Pfad `%ProgramFiles%\Krita (x64)\bin\krita.exe` (alles aus NSIS-Skript, verifiziert) [Q38]; Store-Paket `49800Krita_*` [Q31] | `/Applications/krita.app` (Annahme) | `krita`, Flatpak `org.kde.krita`, Snap `krita` |
| Inkscape | `%ProgramFiles%\Inkscape\bin\inkscape.exe` (Annahme), Uninstall-Eintrag | `/Applications/Inkscape.app` (Annahme) | `inkscape`, Flatpak `org.inkscape.Inkscape`, Snap `inkscape` |
| Kdenlive | `%ProgramFiles%\kdenlive\bin\kdenlive.exe` (Annahme) | `/Applications/kdenlive.app` (Annahme) | `kdenlive`, Flatpak `org.kde.kdenlive` [Q73] |

Pfade, die nicht aus Quelltext/Doku stammen, sind in `catalog-draft.json` mit `verified:false` markiert.

---

## 2. Blender

### 2.1 Lizenz, Version, Ermittlung

| Punkt | Befund | Quelle |
|---|---|---|
| Lizenz | GPL v3 (Gesamtwerk, Einzeldateien kompatibel) | [Q19] |
| Aktuell | 5.2.2 LTS, 15.09.2026; „2 years of LTS updates“; zweite gepflegte LTS: 4.5 LTS (4.5.14, 15.09.2026) | [Q2][Q5][Q6] |
| Vorgänger-Serien im Verzeichnis | 5.0, 5.1, 5.2 (ab 5.0 nur arm64-Mac) | [Q1] |
| Systemvoraussetzungen | Windows 8.1+ (Win 11 empfohlen), macOS 13+ nur Apple Silicon, Linux glibc ≥ 2.28 | [Q7] |
| Maschinelle Ermittlung | 1) Serien: `https://download.blender.org/release/` → Regex `Blender(\d+\.\d+)/`. 2) Patch: `…/Blender5.2/` → Regex `blender-(5\.2\.\d+)-windows-x64\.zip`, höchste nehmen. LTS-Status steht nur als Text auf der LTS-Seite → Serie im Katalog pinnen, neue Serie nur manuell freigeben. | [Q1][Q2][Q5] |

### 2.2 Artefakte (5.2.2)

| OS/Arch | Art | URL-Muster | Größe |
|---|---|---|---|
| Windows x64 | **portable ZIP** (bevorzugt) | `https://download.blender.org/release/Blender{series}/blender-{version}-windows-x64.zip` | 404.453.484 B |
| Windows x64 | MSI / MSIX | `…-windows-x64.msi`, `…-windows-x64.msix` | 364.822.528 / 421.698.707 B |
| macOS arm64 | dmg | `…/blender-{version}-macos-arm64.dmg` | 346.286.611 B |
| macOS x86_64 | **nur 4.5 LTS**: dmg | `https://download.blender.org/release/Blender4.5/blender-{version}-macos-x64.dmg` (Dateiname `x64`, nicht `x86_64`) | 340.090.796 B (4.5.14) |
| Linux x86_64 | tar.xz | `…/blender-{version}-linux-x64.tar.xz` | 383.295.504 B |

Quellen: [Q2][Q4]. Zusätzlich im Verzeichnis: Windows-ARM64 (ZIP/MSI/MSIX), nicht im Umfang.

### 2.3 Prüfsummen und Signatur

- Datei: `https://download.blender.org/release/Blender{series}/blender-{version}.sha256` (außerdem `.md5`). Format: **sha256sum** (`<hash>␣␣<dateiname>`), **eine Datei listet alle Plattformen**, Zeile per Dateiname wählen [Q3].
- Aktuelle Werte 5.2.2 (verifiziert aus [Q3]): Windows ZIP `3849d17a682cba006075aaa3f3597ecb5c9c30ec31035b2e092c53e40679b535`, Linux `84098912789dc450e95697c4184fb8a90acbe5111c2ba4aede3fecb57806a168`, macOS arm64 `dc4125399b8bfefe283cc1624d6cfc7809d1cac20ace51072127eb371f31f210`. 4.5.14 macOS x64: `613e73339e97bd113adeeb28d9155beeacf2df7119ee4dbd6bdce234843645f6` [Q4].
- **Keine GPG-Signatur**, kein `.asc/.sig` im Verzeichnis [Q2][Q4]. Prüfsumme und Datei kommen vom selben Host (TLS ist die einzige Vertrauensbasis).
- Weitere Prüfung (Annahme, nicht verifiziert ob signiert): Windows `Get-AuthenticodeSignature`, macOS `codesign`/`spctl`.

### 2.4 Unbeaufsichtigte Installation / portable Nutzung / Start

- **Portable ZIP** in einen Benutzerordner entpacken, kein Admin [Q12]. „Blender downloads can be extracted to any directory … self contained installation. Multiple versions can co-exist.“
- Installer-Variante: MSI-Eigenschaft `INSTALL_ROOT` (WIXUI_INSTALLDIR) [Q15]; `msiexec /i … /qn INSTALL_ROOT="…"` ist **Annahme**; MSI ist per Maschine → Admin.
- Startpfade: macOS `Blender.app/Contents/MacOS/Blender` (verifiziert) [Q14]; Windows `blender.exe` im entpackten Ordner, Linux `./blender` [Q14]. Top-Level-Ordnername der Archive ist **nicht** belegt (Annahme `blender-{version}-windows-x64/`), daher per Glob `**/blender.exe` suchen.
- Argumente (alle verifiziert aus Handbuch [Q9]):

| Zweck | Argument |
|---|---|
| Datei öffnen | `blender [args] datei.blend [args]` |
| App-Vorlage | `--app-template <Name>` („matching the directory name“, `default` für keine) |
| Werkseinstellungen | `-X` / `--factory-startup` (startup.blend nicht lesen) |
| Python | `--python datei.py`, `--python-expr "<code>"`, `--python-exit-code <0..255>`, `-y/--enable-autoexec` |
| Offline | `--offline-mode` / `--online-mode` |
| Kommandos | `-c` / `--command <cmd>` (impliziert `--background`) |
| Fenster | `--window-geometry`, `--no-window-focus`, `--window-maximized` |
| Reihenfolge | Argumente werden **in der Reihenfolge ausgeführt**; Datei laden überschreibt zuvor gesetzte Render-Optionen |

### 2.5 Konfig- und Ressourcenordner

Benutzerverzeichnis (X.Y = Major.Minor, z. B. `5.2`) [Q8]:

| OS | Pfad |
|---|---|
| Windows | `%USERPROFILE%\AppData\Roaming\Blender Foundation\Blender\<X.Y>\` |
| macOS | `/Users/$USER/Library/Application Support/Blender/<X.Y>/` |
| Linux | `$HOME/.config/blender/<X.Y>/` (bzw. `$XDG_CONFIG_HOME/blender/<X.Y>/`) |
| Portable | Ordner `portable` neben `blender.exe`/`blender` (macOS: in `Blender.app/Contents/Resources`) → dort liegen dann Einstellungen, Startup-Datei, Extensions, Presets |
| Override | `BLENDER_USER_RESOURCES` ersetzt das gesamte Benutzerverzeichnis; `BLENDER_USER_CONFIG`, `_SCRIPTS`, `_EXTENSIONS`, `_DATAFILES` überschreiben einzeln [Q8][Q9] |

Unterstruktur [Q8]: `config/startup.blend`, `config/userpref.blend`, `config/<APP_TEMPLATE_ID>/startup.blend|userpref.blend`, `scripts/addons/`, `scripts/startup/` (darin `bl_app_templates_user/<ID>`), `scripts/presets/`, `extensions/`, `datafiles/`.

**Empfehlung für Cypher (Blender):** Die Hauptauslieferung als **App-Vorlage** `CypherStudio` mit `__init__.py` (Defaults per `load_factory_preferences_post`/`load_factory_startup_post`-Handler), optional `startup.blend`, `userpref.blend`, `splash.png` (1000×500) [Q11]. Start: `blender --app-template CypherStudio`. Vorteil: stört die persönliche Standardkonfiguration nicht. Nachteil: nur eine Teilmenge der Einstellungen (Themes, Add-ons, Keymaps, Viewport-Licht) wird aus `userpref.blend` der Vorlage übernommen [Q11]. Wegen Versionsordner (`5.2`) Vorlage bei jeder Serie neu ablegen; alternativ `BLENDER_USER_SCRIPTS` auf einen versionsunabhängigen Cypher-Ordner setzen (nur für von Cypher gestartete Instanzen; Blender dann ohne Cypher = Standardzustand). Systemweite Variante: `$BLENDER_SYSTEM_SCRIPTS/startup/bl_app_templates_system/MyTemplate/` [Q12].

### 2.6 Extensions (ab 4.2)

- Repositories: `user_default` (lokal, „User Default“) und `blender_org` (online) – belegt im Blender-Quelltext (`BKE_preferences_extension_repo_add_default_user`: Name „User Default“, ID `user_default`) [Q13].
- Offline installieren: `blender --command extension install-file -r user_default -e <paket>.zip` (`-e` aktiviert; `--no-prefs` lässt Preferences unverändert) [Q10]. Weitere Befehle: `extension list|sync|update|install|remove|repo-add|repo-list|build|validate` [Q10].
- Paketformat: ZIP mit `blender_manifest.toml` (`schema_version = "1.0.0"`, `id`, `version`, `name`, `tagline`, `maintainer`, `type` = add-on/theme/asset-library, `blender_version_min`, `license` SPDX) [Q21].
- Systemweit mitliefern: `$BLENDER_SYSTEM_EXTENSIONS/system/<id>/blender_manifest.toml` [Q12].
- Offen (Annahme): ob `install-file -r user_default` auf einem völlig frischen Profil ohne vorherigen GUI-Start funktioniert → Smoke-Test.

### 2.7 Paletten, Schriften, Export

- Paletten: Blender hat keine .gpl-Palettendatei zum Ablegen; Paint-Paletten werden per Python (`bpy.data.palettes`) im App-Template angelegt (Annahme, API nicht eigens geprüft).
- Schriften: Text-Objekte laden Schrift per Dateipfad; kein automatisches Lesen von Systemschriften belegt (nicht verifiziert). Pfad im Template/Startup-Skript setzen.
- Export-Voreinstellungen: Operator-Presets liegen als `.py` in `scripts/presets/<kategorie>/` [Q8].
- Splash/Branding: `BLENDER_CUSTOM_SPLASH` / `BLENDER_CUSTOM_SPLASH_BANNER` [Q12].

---

## 3. Krita

### 3.1 Lizenz, Versionen, Ermittlung

| Punkt | Befund | Quelle |
|---|---|---|
| Lizenz | GPL v3 | [Q32b] |
| Aktuell | **5.3.4.1** (Qt5) und **6.0.4.1** (Qt6) am 07.10.2026; 5.3.4 „suitable for productive work“, 6.0.4 „more experimental“ | [Q27][Q28] |
| Minimum | Windows 8.1, macOS 10.15 (5.3.4 hob von 10.14 an), Linux; 32-Bit-Windows eingestellt | [Q27][Q30] |
| Ermittlung | `https://download.kde.org/stable/krita/` → Regex `href="(5\.3\.\d+(?:\.\d+)?)/"`, **vierstellige Versionen** (5.3.4.1 > 5.3.4) beachten; 6.0.x als optionalen Kanal führen | [Q20] |
| Empfehlung Katalog | Standardkanal **5.3.x**, Kanal „experimentell“ 6.0.x | [Q27] |

### 3.2 Artefakte (5.3.4.1)

| OS/Arch | Art | URL-Muster | Größe |
|---|---|---|---|
| Windows x64 | **portable ZIP** | `https://download.kde.org/stable/krita/{version}/krita-x64-{version}.zip` | 227.787.916 B |
| Windows x64 | Installer (NSIS) | `…/krita-x64-{version}-setup.exe` | 165.471.576 B |
| macOS | dmg (beide Architekturen) | `…/krita-{version}-signed.dmg` | 392.023.759 B |
| Linux x86_64 | AppImage | `…/krita-{version}-x86_64.AppImage` | 381.635.064 B |
| (Debug) | `krita-x64-{version}-dbg.zip` | nicht nötig | – |

Quelle: [Q22]. Die dmg ist seit 4.4.3 universal (arm64+x86_64) [Q42]; für 5.3/6.0 nur über Drittseiten belegt → `lipo -archs` im Smoke-Test.

### 3.3 Prüfsummen und Signatur

- `<datei>.sha256` direkt von `download.kde.org` (HTTP 200, Mirrorbits), **sha256sum-Format** (`<hash>␣␣<name>`); zusätzlich Hashes (MD5/SHA1/SHA256) auf der `.mirrorlist`-Seite („Details“) [Q23].
- 5.3.4.1 (verifiziert): ZIP `eda810059a120171d30d4661c7684c73a8feb72b01ad5709531cbebe6b84d032`, setup `025523cf1751ff209faf7ecfe1cff851f2cdab64acb8c555b307b349ad56ce8f`, AppImage `e315dfb3da81cdb8bddc4bb3fcd4d9bacd0630fc7065d8ed07de758b267573f0`, dmg `531e261da1fd8d5c468cfcd4eebd16e9edf6ab320e89406d2875f2e43c1148de` [Q22]. 6.0.4.1: ZIP `f85eeaba95c947bf7efa31f9723f1458aa985f2f89e26afca8bf98628ce41413`, setup `f4b18257…b94b`, AppImage `9ab5a789…1f91`, dmg `67f8a473…da5b` [Q21].
- **GPG nur AppImage und Quell-Tarballs** („The Linux AppImage and the source tarballs are signed“) [Q27]. Signatur: `<datei>.sig`, **binäre OpenPGP-Detached-Signatur** (RSA, SHA-512, erstellt 2026-10-01), von `download.kde.org` (Apache-Origin, HTTP 200) [Q24].
- Signaturschlüssel (aus der Signatur gelesen **und** gegen den veröffentlichten Schlüssel geprüft): **`E9FB 29E7 4ADE ACC5 E303 5B8A B69E B4CF 7468 332F`**, „Dmitry Kazakov (main key) <dimula73@gmail.com>“, RSA-2048, gültig bis 2028-08-14; Schlüsseldatei `https://files.kde.org/krita/dmitry_kazakov.gpg` [Q24][Q25]. Dieselbe Fingerprint steckt in den Signaturen von 5.2.16, 5.3.4.1, 6.0.3, 6.0.4.1.
- Daneben liegt `https://files.kde.org/krita/4DA79EDA231C852B` (Stichting Krita Foundation, `0641 8244 0C67 4D9F 8D0F 6F8B 4DA7 9EDA 231C 852B`); dieser Schlüssel hat die geprüften aktuellen Releases **nicht** signiert [Q26].
- Die Release-Seite verlinkt den Schlüssel, nennt aber keinen Fingerprint [Q27][Q30] → **Fingerprint im Cypher-Katalog hinterlegen und den Schlüssel in die App einbetten**, statt ihn zur Laufzeit zu holen.

### 3.4 Unbeaufsichtigte Installation / portabel / Start

- **ZIP ohne Admin entpacken**, „portable zip files … drag the folder somewhere“; teilt aber Einstellungen/Ressourcen mit einer installierten Krita [Q27].
- Installer: NSIS-Skript → `/S` (Silent) und `/D=<Pfad>` sind NSIS-Standard (Annahme), Standardpfad `$PROGRAMFILES64\Krita (x64)`, schreibt `HKLM` → Admin [Q38].
- Start: Windows `bin\krita.exe` (für Installer belegt [Q38]; ZIP-Layout Annahme), macOS `krita.app` (Annahme), Linux AppImage direkt.
- Kommandozeile (alles aus Doku [Q33]):

| Zweck | Argument |
|---|---|
| Datei öffnen | `krita datei.kra` |
| Vorlage öffnen | `krita --template pfad/vorlage.kra` (auch PNG/JPG) |
| Arbeitsfläche | `krita --workspace <Name>` |
| Start | `--nosplash`, `--canvasonly`, `--fullscreen`, `--new-image RGBA,U8,1000,1000`, `--file-layer <bild>` |
| Export | `krita in.png --export --export-filename out.jpg`; Animation: `--export-sequence` |

### 3.5 Ordner

Ressourcenordner (frei per `kritarc`-Schlüssel `ResourceDirectory` verlegbar) [Q31][Q37]:

| OS | Ressourcen | kritarc |
|---|---|---|
| Windows | `%APPDATA%\krita\` | `%LOCALAPPDATA%\kritarc` |
| macOS | `~/Library/Application Support/Krita/` | `~/Library/Preferences/kritarc` |
| Linux | `$HOME/.local/share/krita/` | `~/.config/kritarc` |
| Windows Store | `%LOCALAPPDATA%\Packages\49800Krita_<ZUFALL>\LocalCache\Roaming\krita` | `…\LocalCache\Local\kritarc` |

[Q31][Q32]. Benutzerdefinierte Kürzel: `kritashortcutsrc` im gleichen Ordner wie `kritarc` [Q32].

### 3.6 Ressourcen-Bundle (.bundle) – Format und Import ohne GUI

- Format laut Quellcode [Q35]: **ZIP** (KoStore Zip, Mime `application/x-krita-resourcebundle`) mit
  `mimetype`, `META-INF/manifest.xml`, `meta.xml`, `preview.png`, sowie je Ressourcentyp ein Unterordner mit den Dateien (`palettes/…`, `workspaces/…`, `paintoppresets/…`, `brushes/…`, `gradients/…`, `patterns/…` u. a.; Typnamen aus `KisResourceTypes` [Q35b]).
- `manifest.xml`: Wurzel `manifest:manifest` (`xmlns:manifest`, `manifest:version="1.2"`), erster Eintrag `/` mit Mime-Typ, dann je Ressource `manifest:file-entry` mit `media-type`, `full-path`, `md5sum` und optional `<manifest:tags><manifest:tag>…`; fehlende Dateien lassen Krita den Eintrag verwerfen [Q35].
- `meta.xml`: `meta:meta` mit u. a. `meta:generator`, `meta:bundle-version`, `dc:author`, `dc:title`, `dc:description`, `meta:license`, `meta:website`, Tags als `meta:meta-userdefined meta:name="tag"` [Q35].
- **Import ohne GUI: ja.** Beim Start durchsucht Krita den Ressourcenordner rekursiv nach `*.bundle`, `*.abr`, `*.asl` und registriert sie als Speicher (`KisResourceLocator::findStorages`); danach `synchronizeDb` [Q36]. Dazu die Doku: Bundles liegen im Ordner `bundles/` [Q31]. → Datei in `<ressourcen>/bundles/` legen, Krita beim nächsten Start neu starten.
- Empfehlung: Bundle **einmal in Krita erzeugen** (Einstellungen > Ressourcen verwalten > Bundle erstellen; Assistent seit 5.3 überarbeitet) [Q31] und fertig ins Repo legen; Handbau wegen `md5sum`-Pflicht fehleranfällig.

### 3.7 Paletten, Vorlagen, Arbeitsflächen, Schriften

| Ressource | Format / Ablage | Quelle |
|---|---|---|
| Paletten | Nativ `.kpl`; Import außerdem `.gpl`, `.aco`, `.act`, `.ase`, `.xml`, `.sbz`; Ablage `<ressourcen>/palettes/` oder im Bundle | [Q41] |
| Vorlagen | Ordnerstruktur unter `<ressourcen>/templates/<Gruppe>/`: `.directory` (Desktop Entry, `Name=`, optional `X-KDE-DefaultTab=true`, `X-KDE-SortingWeight`), je Vorlage `<Name>.desktop` (`Type=Link`, `Name=`, `Icon=`, `URL=.source/<Name>.kra`, `X-KDE-Hidden=false`) und `.source/<Name>.kra`. Mitgelieferte Beispiele: `web_design.desktop` mit `URL[$e]=.source/web_design.kra`. `.kra` per „Vorlage aus Bild erstellen“ erzeugen. | [Q34][Q39] |
| Arbeitsflächen | `.kws` in `<ressourcen>/workspaces/` (Import-Datei laut Doku); nur per GUI erzeugbar | [Q31b] |
| Schriften | Systemschriften **und** Ordner `fonts/` im Ressourcenordner („useful when on a system that doesn't allow installing fonts“); neue Schriften werden dynamisch erkannt, geänderte erst nach Neustart; Font-Families sind seit 5.3 ein Ressourcentyp | [Q40] |

Alle losen Ressourcen in den Typ-Ordnern werden beim Start synchronisiert [Q36] (Annahme für Detailverhalten bei Namenskonflikten).

---

## 4. Inkscape

### 4.1 Lizenz, Version, Ermittlung

| Punkt | Befund | Quelle |
|---|---|---|
| Lizenz | GPL (Quelldateien `GPL-2.0-or-later`; Lizenzseite zeigt GPL-Text) | [Q58][Q65] |
| Aktuell | **1.4.4**, Build 2026-05-05 (`dcaf3e7`) | [Q50][Q52] |
| Ermittlung | `GET https://inkscape.org/release/` → Weiterleitung auf `/release/inkscape-<version>/`; Regex `/release/inkscape-(\d+\.\d+(?:\.\d+)?)/` auf End-URL; Plattformseiten `/release/<v>/windows/64-bit/`, `/mac-os-x/`, `/gnulinux/`. Es gibt kein offenes Verzeichnis, keine JSON-API. | [Q50] |

### 4.2 Artefakte (1.4.4)

| OS/Arch | Art | Ermittlung | Größe |
|---|---|---|---|
| Windows x64 | **7z (portabel)** | `https://inkscape.org/release/inkscape-{v}/windows/64-bit/compressed-7z/dl/` → HTML mit `<meta http-equiv="Refresh" content="2; url=/gallery/item/59503/inkscape-1.4.4_2026-05-05_dcaf3e7-x64_mHK170m.7z">`; Datei dann 302 → `https://media.inkscape.org/dl/resources/file/inkscape-1.4.4_2026-05-05_dcaf3e7-x64_mHK170m.7z` | 110.359.970 B |
| Windows x64 | exe (signiert) / msi (signiert) | `…/64-bit/exe/dl/` → `inkscape-1.4.4_2026-05-05_dcaf3e7-x64.signed.exe`; `…/msi/dl/` → `…x64.signed_xMx7DJV.msi` | 118.507.928 / 170.323.968 B |
| macOS arm64 | dmg | `https://media.inkscape.org/dl/resources/file/Inkscape-{v}_arm64.dmg` | 156.920.591 B |
| macOS x86_64 | dmg | `https://media.inkscape.org/dl/resources/file/Inkscape-{v}_x86_64.dmg` | 160.146.603 B |
| Linux x86_64 | AppImage | `https://media.inkscape.org/dl/resources/file/Inkscape-{v}.AppImage` (Seite: `/gnulinux/appimage/dl/`) | 120.236.536 B |
| Linux | Flatpak, Snap, PPA | nur Links, nicht für Cypher | – |

Quellen: [Q51][Q52]. macOS- und AppImage-URLs sind deterministisch (per HEAD-Anfrage mit HTTP 200 bestätigt), Windows nicht (Datum, Git-Hash, zufälliger Suffix). Windows-ARM64-Seiten verlinken Dateien mit „x64“ im Namen (vermutlich Seitenfehler; ARM nicht im Umfang) [Q52].

### 4.3 Prüfsummen und Signatur

- Windows/macOS: `.sha256` auf `https://media.inkscape.org/media/resources/sigs/<datei>.sha256`, sha256sum-Format, Link steht auf der `/dl/`-Seite als „sig“ [Q52][Q53]. Werte 1.4.4: 7z `c4dbd64a92628abe7d7316c43f9325396e4d48417866027ee3d993d4f5b54c6a`, exe `fa21d25e56dbfe41e9b014a4f37689edda4bb41d5a3597fe2787dff6c10e651f`, msi `2fa033e95113ae83d6430b2479e7e63e4266d0632a5b03f99ee3db9360e3b8b8`, dmg x86_64 `17ff9f49b60115237cad9b60605950e26b11b04600e726a4513224aa373aee11`, dmg arm64 `eacca94ab01e59467cdd5452a2867c3734450f9a4cfb3346956cc9b07f34f3f1` [Q53].
- **Linux-AppImage:** keine `.sha256`, nur `Inkscape-dcaf3e7-x86_64.AppImage.sig` (95 Byte, binäre OpenPGP-Signatur, DSA, **SHA-1**-Digest), Aussteller `74E8 DA13 9805 5A81 20B2 76EB 5FCB 204E F882 B07A` = Marc Jeanmougin (DSA-1024, gültig bis 2028-05-22), Schlüssel unter `https://inkscape.org/~MarcJeanmougin/gpg/` [Q54][Q55]. Das ist der Schlüssel des Uploaders, kein Projekt-Release-Schlüssel; moderne OpenPGP-Bibliotheken lehnen DSA-1024/SHA-1 per Voreinstellung ab → `gpgv` nutzen oder Policy lockern, und die Schwäche dokumentieren.
- Windows-Installer sind laut Dateiname „.signed.“ (Authenticode, Annahme zur Art).

### 4.4 Unbeaufsichtigte Installation / portabel / Start

- **7z entpacken** („For parallel installations … use the compressed .7z archives. Make sure to extract them into an empty folder … create program shortcuts manually“) [Q51]. Installer-Hinweis: vor Updates alte Version entfernen [Q51].
- Startdatei: `bin\inkscape.exe` im entpackten Ordner (Annahme, nicht belegt); macOS `Inkscape.app/Contents/MacOS/inkscape` (Annahme).
- **Warnung macOS 1.4.3/1.4.4:** „if Inkscape has been started from the command line, extensions will not work“ (GUI und CLI; viele Import/Export-Formate betroffen) – Sicherheitsfeature zu CVE-2025-15523 für offizielle dmg [Q56]. → Auf macOS Startweg testen (`open -a … --args`).
- Kommandozeile [Q64]: `inkscape datei.svg`; `--export-type=png|pdf|svg|…`, `-o/--export-filename=`, `-d/--export-dpi=`, `-T/--export-text-to-path`, `-C/--export-area-page`, `--export-id=`, `--actions=…`, `--shell`, `--user-data-directory` (gibt Profilordner aus), `--system-data-directory`, `-V/--version`.

### 4.5 Benutzerprofil (Konfiguration + Ressourcen)

Quellcode `profile_path()` [Q58]: Umgebungsvariable **`INKSCAPE_PROFILE_DIR`** hat Vorrang; sonst Windows `%APPDATA%\inkscape` (CSIDL_APPDATA), sonst `<XDG-Config>/inkscape` (Linux `~/.config/inkscape`). macOS: `~/Library/Application Support/org.inkscape.Inkscape/config/inkscape/` (nur über Forenbeitrag belegt; mit `inkscape --user-data-directory` bestätigen) [Q66].
Beim ersten Start legt Inkscape an: `keys`, `templates`, `icons`, `extensions`, `ui`, `symbols`, `paint`, `themes`, `palettes`, `fontcollections` [Q58]. Zusätzlich lädt es `fonts` (siehe 4.6).
Einstellungen: `preferences.xml` im Profilordner, Aufbau `<inkscape version="1"><group id="…" attr="…"/></inkscape>`; relevante Gruppen: `export` (`default`, `append_extension`, `path`, Untergruppe `defaultxdpi`), `save_as`, `template`, `palette`, `theme`, `ui language=""` [Q62].

### 4.6 Paletten, Vorlagen, Schriften, Export

| Ressource | Format / Ablage | Quelle |
|---|---|---|
| Paletten | GIMP-Palette `.gpl` in `<profil>/palettes/` (gleiche Datei auch für Krita nutzbar) | [Q58][Q66] |
| Vorlagen | SVG in `<profil>/templates/`. Metadaten in `<inkscape:templateinfo>` bzw. in der Programmauslieferung `<inkscape:_templateinfo>` mit `_name`, `label`, `author`, `_shortdesc`, `date`, `icon`, `category`, `priority`. Seit 1.4 können eigene Vorlagen **Kategorie und Label** haben. `default.svg` (auch `default.<locale>.svg`) im Profil überschreibt die Standardvorlage. Empfohlen: „Datei > Vorlage speichern“. | [Q57][Q60][Q61] |
| Schriften | `<profil>/fonts/` wird standardmäßig geladen (`/options/font/use_fontsdir_user` = true) und `<datadir>/fonts`; neu installierte Schriften erscheinen unter Linux ohne Neustart, unter **Windows/macOS erst nach Neustart** | [Q59][Q57] |
| Export-Voreinstellungen | Export-Hinweise im SVG (`inkscape:export-filename/-xdpi/-ydpi`) und Gruppe `export` in `preferences.xml`; per Vorlage am robustesten | [Q62] (Details Annahme) |
| Erweiterungen | `<profil>/extensions/` (überschreibbar `INKSCAPE_EXTENSIONS_DIR`) | [Q58] |

Strategie `preferences.xml`: nur anlegen, wenn nicht vorhanden; Schlüssel per Diff aus einem Probelauf mit leerem `INKSCAPE_PROFILE_DIR` ableiten (siehe `catalog-draft.json`, Feld `preferences`).

---

## 5. Kdenlive

### 5.1 Lizenz, Version, Ermittlung

| Punkt | Befund | Quelle |
|---|---|---|
| Lizenz | `GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL` (SPDX in `main.cpp`) | [Q75] |
| Aktuell | **26.08.2** (Dateien vom 13.10.2026); 26.08.0 am 28.08.2026, 26.08.1 am 10.09.2026 | [Q70][Q72] |
| Systemvoraussetzungen | Windows 10 (1809+), macOS 13+ (Intel und Apple Silicon), Linux: AppImage oder Flatpak offiziell | [Q72][Q73] |
| Ermittlung | `https://download.kde.org/stable/kdenlive/` → Serie `^\d{2}\.\d{2}/` (derzeit `26.08/`), dann `…/26.08/windows/` → Regex `kdenlive-(\d+\.\d+\.\d+)_standalone\.exe`; höchste Version | [Q70] |

### 5.2 Artefakte (26.08.2)

| OS/Arch | Art | URL | Größe |
|---|---|---|---|
| Windows x64 | **Standalone-EXE (selbstentpackend, portabel)** | `https://download.kde.org/stable/kdenlive/26.08/windows/kdenlive-{v}_standalone.exe` | 134.973.971 B |
| Windows x64 | Installer | `…/windows/kdenlive-{v}.exe` | 135.679.104 B |
| macOS arm64 | dmg | `…/macOS/kdenlive-{v}-arm64.dmg` | 144.286.250 B |
| macOS x86_64 | dmg | `…/macOS/kdenlive-{v}-x86_64.dmg` | 158.286.259 B |
| Linux x86_64 | AppImage | `…/linux/kdenlive-{v}-x86_64.AppImage` | 215.427.576 B |

Quellen: [Q70][Q71]. Ältere Patch-Stände (26.08.0/.1) liegen im selben Ordner.

### 5.3 Prüfsummen und Signatur

- `<datei>.sha256` direkt von `download.kde.org` (HTTP 200), sha256sum-Format [Q71]. Werte 26.08.2: standalone `43526e50770fb306b12a8d7f6a7bb5829f8ca546390bd169fb3c3cc222874487`, installer `9f89d8ac53b190ba506af86fb37b31f17b60a532394bd5303af4e505b3a5bee6`, AppImage `3194c0979bcfb7ec4a0b33ebc05178a51cffdf5b180c3a89bcf4da94e025bc78`, dmg arm64 `ffcbff6d6e6651fe7a7cd2b00cb7304c8ef049da8287c389dbda146d5e8928ac`, dmg x86_64 `45e07f190581eeba8e87a12d2e879b3f754a83df19787dc9fdea389a51259b33` [Q71].
- **Keine GPG-Signaturen** (`.sig` → 404) [Q71]. Auf der Download-Seite stehen keine Prüfhinweise [Q72].

### 5.4 Installation / portabel / Start

- **Standalone:** „Does not need administrator rights and isn't installed … not listed as a program“; Doppelklick auf die Datei → „self-extracting archive“, Zielordner wählen, danach `bin\kdenlive.exe` [Q73]. Silent-Schalter des SFX **nicht belegt** (Annahme: 7-Zip-SFX, `-y -o"<Ordner>"`); sauberere Alternative: die EXE mit einer 7z-Bibliothek direkt öffnen. Einstellungen und Downloads liegen weiterhin im Benutzerprofil des Rechners [Q73].
- Installer: braucht Admin; ab 26.04.0 registriert nur der Installer die Dateiendung `.kdenlive` [Q73][Q79].
- macOS: nur dmg, per Drag & Drop in Programme. Die Doku beschreibt die Meldung „Apple cannot search for malware in it“ (Rechtsklick > Öffnen) → **nicht notarisiert** [Q73].
- Linux AppImage: ausführbar machen und starten; Konfig-Besonderheit `kdenlive-appimagerc` [Q73][Q74].
- Kommandozeile (aus `main.cpp`, verifiziert [Q75]): positionale Argumente `<Datei>` (Projekt) und `<Ausgabedatei>` (Render); `--config <name>` (eigener Konfigurationsdatei-Name), `--mlt-path`, `--mlt-log`, `-i <clip1,clip2>`, `--render`, `--render-preset <Name>`, `--render-async`, `--no-welcome`, `--debug`, `--setup-report <Datei>`, `--verify-file`.

### 5.5 Ordner

| Zweck | Windows | macOS | Linux | Quelle |
|---|---|---|---|---|
| Einstellungen | `%LOCALAPPDATA%\kdenliverc` | `~/Library/Preferences/kdenliverc` | `~/.config/kdenliverc` | [Q74] |
| Daten (Titel, Profile, Library, Modelle) | `%APPDATA%\kdenlive\` | `~/Library/Application Support/kdenlive/` | `~/.local/share/kdenlive/` | [Q74] |
| Cache/Proxy/Thumbnails | `%LOCALAPPDATA%\kdenlive\` | `~/Library/Caches/kdenlive/` | `~/.cache/kdenlive/` | [Q74] |
| Autosave | `%APPDATA%\kdenlive\.backup\` | `~/Library/Application Support/kdenlive/.backup/` | `~/.local/share/kdenlive/.backup/` | [Q74] |
| UI | `%LOCALAPPDATA%\kxmlgui5\kdenlive\kdenliveui.rc` | `~/Library/Application Support/kxmlgui5/kdenlive/` | `~/.local/share/kxmlgui5/kdenlive/` | [Q74] |

### 5.6 Titelvorlagen, Projektprofile, Render-Voreinstellungen

| Ressource | Format / Ablage | Quelle |
|---|---|---|
| **Titelvorlagen** | `.kdenlivetitle` (XML), Ablage `<daten>/titles/` (Windows `%AppData%\kdenlive\titles`); Standardvorlagen im Repo `data/titles/` (`simple.kdenlivetitle`, `simple-with-date…`, `simple-scroll…`) | [Q80][Q81] |
| **Projektprofile** | MLT-Profil: reine Textdatei **ohne Endung** (key=value: `description`, `frame_rate_num/den`, `width`, `height`, `progressive`, `sample_aspect_num/den`, `display_aspect_num/den`, `colorspace`), Ablage `<daten>/profiles/`; Quellcode lädt `profiles/` aus `AppDataLocation` | [Q77] (Formatangabe nach MLT-Konvention, Annahme) |
| **Render-Presets** | XML `<profiles version="1">` mit `<profile name=… category=… extension=… args=…>`; Quellcode liest `export/*.xml` aus **`AppLocalDataLocation/export/`**, `customprofiles.xml` zuletzt (überschreibt, editierbar). Stock-Beispiel `data/profiles.xml` (Gruppen/Args wie `f=mp4 vcodec=libx264 crf=%quality …`). | [Q76][Q78] |

Achtung: Die Doku-Tabelle nennt `export` unter `%AppData%\kdenlive` (Roaming), der Quellcode nutzt `AppLocalDataLocation` (unter Windows `%LOCALAPPDATA%\kdenlive\export\`) [Q74][Q76] → Smoke-Test, im Zweifel beide Orte prüfen oder Preset über GUI erzeugen und Datei ablesen.

Schriften: Kdenlive nutzt Qt-Schrift-Erkennung (Systemschriften), kein eigener Ordner belegt (Annahme).

---

## 6. Schriften (Querschnitt, OFL-Pakete)

| OS | Benutzer-Schriftordner | Registrierung | Quelle |
|---|---|---|---|
| Windows (≥ 10 1809) | `%LOCALAPPDATA%\Microsoft\Windows\Fonts\` | Registry `HKCU\Software\Microsoft\Windows NT\CurrentVersion\Fonts`, Wert = Anzeigename (z. B. „Name (TrueType)“), Daten = **voller Pfad**; ohne Registry-Eintrag verschwindet die Schrift nach Neustart. Per-User-Installation seit 1809 ohne Admin. Manche Programme lesen nur die HKLM-Stelle. | [Q92] (Forum/Q&A; offizielle API-Doku `AddFontResourceEx` nur teilweise) |
| macOS | `~/Library/Fonts/` | keine | Standard (Annahme, nicht eigens belegt) |
| Linux | `$XDG_DATA_HOME/fonts` = `~/.local/share/fonts` (`~/.fonts` veraltet) | `fc-cache -f` aktualisiert den Cache | [Q93] |

Welche Programme was lesen:

| Programm | Liest | Konsequenz |
|---|---|---|
| Krita | Systemschriften + `<ressourcen>/fonts/` [Q40] | Bei fehlendem Systemzugriff genügt der Ressourcenordner |
| Inkscape | Systemschriften + `<profil>/fonts/` + `<datadir>/fonts` [Q59] | Eigener Profil-Ordner funktioniert plattformübergreifend; Windows/macOS: Neustart nach Änderung [Q57] |
| Kdenlive | Qt/Systemschriften (kein eigener Ordner belegt) | Systemweit/benutzerweit installieren (Windows per HKCU) |
| Blender | eigener Pfadmechanismus (nicht verifiziert) | Pfad im App-Template/Startskript setzen |

Empfehlung: Schriften einmal im **Cypher-Ordner** halten (Single Source), für Inkscape/Krita zusätzlich dorthin kopieren oder verlinken, für OS-weite Nutzung in den Benutzer-Schriftordner installieren (Windows mit HKCU-Eintrag). Immer Rückbau (Deinstallation) im Manifest vermerken.

---

## 7. Optionale Kandidaten

| Programm | Version / Lizenz | Plattform-Artefakte | Prüfsummen | Eignung |
|---|---|---|---|---|
| **GIMP 3.2** | 3.2.6 (10.09.2026), GPL-3.0-or-later | Win: `gimp-3.2.6-setup.exe` (182 MB, kein Portable); macOS: `gimp-3.2.6-arm64.dmg` (177 MB), `…-x86_64.dmg` (187 MB); Linux: `GIMP-3.2.6-x86_64.AppImage` (232 MB) | `SHA256SUMS`/`SHA512SUMS` unter `download.gimp.org/gimp/v3.2/` | **empfohlen**, siehe Abschnitt 8 [Q94] |
| **Scribus 1.6** | 1.6.6 (13.04.2026 laut Wikipedia), GPL-2.0-or-later | Dateien auf SourceForge, Namen **nicht verifiziert** (scribus.net blockt Abrufe mit Anubis) | nicht geprüft | **empfohlen unter Vorbehalt** [Q97] |
| Pixelorama | 1.2.3 (15.09.2026), MIT | GitHub: Win-ZIP 41 MB, Mac-dmg 71 MB, Linux-tar.gz 31 MB, Win-Setup | GitHub-API liefert `digest: sha256:…` je Asset | gut katalogisierbar, aber Nische (Pixel-Art) [Q95] |
| Audacity | 4.0.1 (30.09.2026), GPL (GitHub: NOASSERTION) | Win: x86_64 `.7z` portabel 44 MB, `.msi`; macOS: arm64 50 MB, x86_64 54 MB, universal 92 MB; Linux: AppImage 74 MB | `CHECKSUMS.txt` als Release-Asset (SHA-256) | sehr leicht einzubinden, aber Audio (kein Kern-Design) [Q95] |
| darktable | 5.6.2 (04.10.2026), GPL-3.0 | Win: Setup-EXE 139 MB (kein Portable), macOS **nur arm64**, Linux AppImage x86_64 172–178 MB | nur Quell-Tarball hat `.asc` | Foto-Entwicklung, Mac-Intel fehlt, nicht Kern [Q95] |
| Upscayl | 2.15.0 (**25.12.2024**), AGPL-3.0 | 250–390 MB je Plattform, GPU nötig | `latest*.yml` | **nicht empfohlen** (alt, groß, GPU-Pflicht) [Q95] |

---

## 8. Affinity (Canva) – nur als Link

- Aktueller Stand: „Affinity is free for individuals (seriously)“; Mac läuft nativ auf Apple Silicon und Intel; Windows-Version vorhanden; iPad „not yet released“; ein Update-Beitrag vom September 2026 („Blend Tool, Scripting, and over 60 updates“) [Q96].
- Offizielle Download-Seite: `https://www.affinity.studio/en/download`; der Download-Button leitet über eine **Canva-Anmeldung** (`canva.com/product-suite-integration/authn/affinity?...`) → Konto nötig [Q96]. KI-Funktionen (Generative Fill u. ä.) hängen laut Berichten an kostenpflichtigen Canva-Plänen (Drittquellen, Preise widersprüchlich).
- Konsequenz für Cypher Studio: nur Verlinkung (Button „Offizielle Seite öffnen“), kein automatischer Download, kein Katalogeintrag mit Prüfsumme (kein offenes Artefakt, kein Konto-Handling durch die App).

---

## 9. Empfehlung für den Katalog

### 9.1 Aufnahme (Pflichtumfang)

| Programm | Standardkanal | Windows | macOS | Linux |
|---|---|---|---|---|
| Blender | 5.2 LTS (5.2.2) | portable ZIP | arm64 dmg 5.2; **Intel: 4.5 LTS (4.5.14) als Fallback, Hinweis auf Support-Ende ca. Juli 2027** | tar.xz |
| Krita | 5.3.x (5.3.4.1); Kanal „experimentell“ 6.0.x | portable ZIP | dmg (universal, prüfen) | AppImage (GPG-Prüfung) |
| Inkscape | 1.4.x (1.4.4) | 7z (portabel) | dmg je Architektur | AppImage (nur DSA/SHA-1-Signatur, daneben keine Prüfsumme!) |
| Kdenlive | 26.08.x (26.08.2) | Standalone-SFX | dmg je Architektur | AppImage |

Für Inkscape-Linux gibt es nur die schwache Signatur; empfohlen: Download zusätzlich mit eigener, im Cypher-Katalog hinterlegter SHA-256 absichern (Cypher kann die Summe nach dem ersten manuellen Prüfen pinnen) oder Flatpak als Alternative anbieten.

### 9.2 Optionale Kandidaten – Empfehlung (höchstens 2)

1. **GIMP 3.2:** Standard-Werkzeug für Foto-Retusche und Compositing, ergänzt Krita (Malen) und Inkscape (Vektor); breite Plattformabdeckung (Win/macOS arm64+Intel/Linux), offizielle SHA-256/SHA-512-Listen auf der Hauptquelle. Einschränkung: kein Windows-Portable (Installer, Admin-Verhalten prüfen).
2. **Scribus 1.6 – unter Vorbehalt:** schließt die Lücke Druck-Layout/DTP (Zine, Plakat, Broschüre), die Inkscape/Krita nur eingeschränkt abdecken. **Aber:** Quellen waren nicht abrufbar, SourceForge-Hosting; erst aufnehmen, wenn Dateinamen, Plattformen und Prüfsummen manuell verifiziert sind. Wenn das scheitert, Ersatz: Audacity (Video-Workflow zu Kdenlive, sehr gut katalogisierbar).
Nicht empfohlen: Upscayl (veraltet, schwer), darktable (Mac nur arm64, kein Portable), Pixelorama (Nische).

### 9.3 Architektur-Empfehlungen für den Katalog (aus der Recherche)

1. **Konfigurationsschema** = `catalog-draft.json`: Quellen mit `versionDiscovery`, Artefakte je `os-arch`, `checksum`/`signature`-Objekte, `resolve` (HTML-Scrape) nur für Inkscape-Windows/Linux. Platzhalter `{series}`, `{version}`.
2. **Prüfpipeline:** (1) Version ermitteln, (2) Prüfsumme/Signatur von der **Hauptquelle** holen (KDE: `download.kde.org`, nie Mirror), (3) Datei streamend laden, SHA-256 mitrechnen, (4) bei GPG: Signatur mit eingebettetem Schlüssel prüfen, (5) erst dann entpacken/installieren, (6) vor Start Vorschau und Rückfrage („Was wird installiert?“) mit Größe, Quelle, Hash.
3. **Fremde Daten nie überschreiben:** Paletten/Vorlagen/Schriften additiv; `preferences.xml`/`kritarc`/`kdenliverc` nur anlegen, wenn nicht vorhanden; Blender über App-Vorlage.
4. **Binäre Assets** (Krita `.bundle`/`.kws`/Vorlagen-`.kra`, Blender `startup.blend`) einmal in den Programmen erzeugen und im Repo ablegen; sie sind nicht sinnvoll per Hand schreibbar.
5. **Aufräumen:** Manifest je Installation (Pfade, Hashes, Version) für Deinstallation und Updates; Updates = neuer Ordner, alte Version erst nach Erfolg entfernen (Inkscape und Blender erlauben Parallelversionen).
6. **Erst schauen, dann bauen:** Winget-Manifeste (`microsoft/winget-pkgs`) und Scoop-Buckets (`checkver`/`autoupdate`/`hash`) enthalten ähnliche Versions-/Hash-Regeln und können als Gegenprobe dienen; Cypher bleibt bei offiziellen Quellen.

### 9.4 Offene Smoke-Tests (Annahmen, die nur ein Download klärt)

| # | Zu klären | Wie |
|---|---|---|
| 1 | Archiv-Layout: Top-Ordner und Exe-Pfad von Blender-ZIP/-tar.xz, Krita-ZIP, Inkscape-7z, Kdenlive-Standalone | Verzeichnis des Archivs listen (z. B. `7z l`, `unzip -l`, `tar tf`) auf Testrechner; im Katalog `exeGlob` nutzen |
| 2 | Kdenlive-Standalone: SFX-Typ, Silent-Schalter | Datei mit 7-Zip öffnen / `-y -o` testen |
| 3 | macOS: Quarantäne bei Selbst-Download, App-Namen (`krita.app`, `Inkscape.app`, `kdenlive.app`), Krita-dmg universal (`lipo -archs`) | auf macOS mit `xattr`, `codesign`, `spctl` |
| 4 | Inkscape macOS: Extensions bei Start aus fremder App (CVE-2025-15523-Schutz) | Start per Prozess vs. `open -a` vergleichen |
| 5 | Inkscape macOS-Profilpfad, Windows-Installer-Registry | `inkscape --user-data-directory`, Registry nach Install |
| 6 | Blender `install-file -r user_default` auf frischem Profil | `blender --command extension install-file …` mit leerem `BLENDER_USER_RESOURCES` |
| 7 | Kdenlive-Render-Presets: Roaming vs. Local | `customprofiles.xml` an beiden Orten testen |
| 8 | Krita: kopiert Cypher ein `.bundle` in `bundles/` — erscheinen Paletten/Arbeitsflächen nach Start? Verhalten bei Konflikt mit vorhandener Krita | Test mit frischem und mit bestehendem Profil |
| 9 | Authenticode/Code-Signatur der Windows-Pakete (Blender, Krita, Kdenlive) | `Get-AuthenticodeSignature` |
| 10 | Windows-Registry der Installer (Blender, Inkscape, Kdenlive) für die Erkennung | Testinstallation in VM |
| 11 | Scribus: Dateinamen und Prüfsummen | manuell im Browser |

---

## 10. Quellen (alle abgerufen am 16.10.2026)

**Blender**
- [Q1] https://download.blender.org/release/ (Serien-Verzeichnisse bis Blender5.2)
- [Q2] https://download.blender.org/release/Blender5.2/ (Dateiliste 5.2.0–5.2.2, Größen)
- [Q3] https://download.blender.org/release/Blender5.2/blender-5.2.2.sha256
- [Q4] https://download.blender.org/release/Blender4.5/ und https://download.blender.org/release/Blender4.5/blender-4.5.14.sha256
- [Q5] https://www.blender.org/download/lts/
- [Q6] https://www.blender.org/download/
- [Q7] https://www.blender.org/download/requirements/
- [Q8] https://docs.blender.org/manual/en/latest/advanced/blender_directory_layout.html (Quelle: https://projects.blender.org/blender/blender-manual/raw/branch/main/manual/advanced/blender_directory_layout.rst)
- [Q9] https://docs.blender.org/manual/en/latest/advanced/command_line/arguments.html (Quelle: …/manual/advanced/command_line/arguments.rst)
- [Q10] https://docs.blender.org/manual/en/latest/advanced/command_line/extension_arguments.html (Quelle: …/manual/advanced/command_line/extension_arguments.rst)
- [Q11] https://docs.blender.org/manual/en/latest/advanced/app_templates.html (Quelle: …/manual/advanced/app_templates.rst)
- [Q12] https://docs.blender.org/manual/en/latest/advanced/deploying_blender.html (Quelle: …/manual/advanced/deploying_blender.rst)
- [Q13] https://projects.blender.org/blender/blender/raw/branch/main/source/blender/blenkernel/intern/preferences.cc (`user_default`)
- [Q14] https://docs.blender.org/manual/en/latest/advanced/command_line/launch/macos.html, …/launch/windows.html, …/launch/linux.html (Quelle: https://projects.blender.org/blender/blender-manual/raw/branch/main/manual/advanced/command_line/launch/macos.rst bzw. windows.rst, linux.rst)
- [Q15] https://projects.blender.org/blender/blender/raw/branch/main/release/windows/installer_wix/WIX.template (`INSTALL_ROOT`)
- [Q16] https://www.blender.org/download/release/Blender5.2/blender-5.2.2-windows-x64.zip/ sowie HTTP-Header von https://mirror.blender.org/release/Blender5.2/blender-5.2.2.sha256 (302 → mirror.dotsrc.org)
- [Q19] https://projects.blender.org/blender/blender/raw/branch/main/README.md (Lizenz)
- [Q21] https://projects.blender.org/blender/blender-manual/raw/branch/main/manual/advanced/extensions/getting_started.rst

**Krita**
- [Q20] https://download.kde.org/stable/krita/
- [Q21] https://download.kde.org/stable/krita/6.0.4.1/
- [Q22] https://download.kde.org/stable/krita/5.3.4.1/ (+ `.sha256`, `.mirrorlist`)
- [Q23] https://download.kde.org/stable/krita/5.3.4.1/krita-x64-5.3.4.1.zip.sha256 und https://download.kde.org/stable/krita/6.0.4.1/krita-x64-6.0.4.1.zip.mirrorlist
- [Q24] https://download.kde.org/stable/krita/5.3.4.1/krita-5.3.4.1-x86_64.AppImage.sig (und 6.0.4.1, 6.0.3, 5.2.16)
- [Q25] https://files.kde.org/krita/dmitry_kazakov.gpg
- [Q26] https://files.kde.org/krita/ und https://files.kde.org/krita/4DA79EDA231C852B
- [Q27] https://krita.org/en/posts/2026/krita-5.3.4-released/
- [Q28] https://krita.org/en/release-history/
- [Q29] https://krita.org/en/release-notes/krita-5-3-release-notes/
- [Q30] https://krita.org/en/download/
- [Q31] https://docs.krita.org/en/reference_manual/resource_management.html (Quelle: https://invent.kde.org/documentation/docs-krita-org/-/raw/master/reference_manual/resource_management.rst); [Q31b] …/reference_manual/resource_management/resource_workspace.rst
- [Q32] https://docs.krita.org/en/reference_manual/preferences.html; [Q32b] https://invent.kde.org/graphics/krita/-/raw/master/README.md (Lizenz)
- [Q33] https://docs.krita.org/en/reference_manual/linux_command_line.html (Quelle: …/reference_manual/linux_command_line.rst)
- [Q34] https://invent.kde.org/graphics/krita/-/raw/master/libs/ui/KisTemplateTree.cpp und https://docs.krita.org/en/user_manual/templates.html
- [Q35] https://invent.kde.org/graphics/krita/-/raw/master/libs/resources/KoResourceBundle.cpp und …/KoResourceBundleManifest.cpp; [Q35b] …/KisResourceTypes.cpp
- [Q36] https://invent.kde.org/graphics/krita/-/raw/master/libs/resources/KisResourceLocator.cpp
- [Q37] https://invent.kde.org/graphics/krita/-/raw/master/libs/resources/KoResourcePaths.cpp
- [Q38] https://invent.kde.org/graphics/krita/-/raw/master/packaging/windows/installer/installer_krita.nsi
- [Q39] https://invent.kde.org/graphics/krita/-/raw/master/krita/data/templates/design/web_design.desktop
- [Q40] https://invent.kde.org/documentation/docs-krita-org/-/raw/master/reference_manual/resource_management/resource_font_families.rst
- [Q41] https://invent.kde.org/documentation/docs-krita-org/-/raw/master/reference_manual/dockers/palette_docker.rst
- [Q42] https://krita.org/en/posts/2021/krita-4-4-3-released/ (universal macOS-Build seit 4.4.3)

**Inkscape**
- [Q50] https://inkscape.org/release/ (→ /release/inkscape-1.4.4/)
- [Q51] https://inkscape.org/release/1.4.4/windows/64-bit/ (auch /mac-os-x/, /gnulinux/)
- [Q52] https://inkscape.org/release/inkscape-1.4.4/windows/64-bit/compressed-7z/dl/ (sowie …/exe/dl/, …/msi/dl/, …/mac-os-x/dmg/dl/, …/dmg-arm64/dl/, …/gnulinux/appimage/dl/)
- [Q53] https://media.inkscape.org/media/resources/sigs/inkscape-1.4.4_2026-05-05_dcaf3e7-x64.7z_BKqiyKW.sha256 und die `.sha256`-Dateien der übrigen Pakete (siehe Tabelle 4.3)
- [Q54] https://media.inkscape.org/media/resources/sigs/Inkscape-dcaf3e7-x86_64.AppImage.sig
- [Q55] https://inkscape.org/~MarcJeanmougin/gpg/
- [Q56] https://inkscape.org/doc/release_notes/1.4.4/Inkscape_1.4.4.html
- [Q57] https://inkscape.org/doc/release_notes/1.4/Inkscape_1.4.html
- [Q58] https://gitlab.com/inkscape/inkscape/-/raw/1.4.x/src/io/resource.cpp
- [Q59] https://gitlab.com/inkscape/inkscape/-/raw/1.4.x/src/inkscape.cpp (Zeilen zu `use_fontsdir_user`)
- [Q60] https://gitlab.com/inkscape/inkscape/-/raw/1.4.x/share/templates/README
- [Q61] https://gitlab.com/inkscape/inkscape/-/raw/1.4.x/share/templates/zine-template_A4.svg (`inkscape:_templateinfo`)
- [Q62] https://gitlab.com/inkscape/inkscape/-/raw/1.4.x/src/preferences-skeleton.h
- [Q63] https://wiki.inkscape.org/wiki/Environment_variables
- [Q64] https://man.archlinux.org/man/inkscape.1.en.txt
- [Q65] https://inkscape.org/about/license/
- [Q66] https://inkscape.org/forums/questions/macos-crash-on-launch-fix/ (Forenbeitrag: macOS-Profilpfad `~/Library/Application Support/org.inkscape.Inkscape/config/inkscape/preferences.xml`; nur Sekundärbeleg); Palettenformat .gpl: https://inkscape.org/forums/questions/building-a-custom-palette-out-of-an-images-colours (Suchtreffer, Seite beim Abruf nicht erreichbar)

**Kdenlive**
- [Q70] https://download.kde.org/stable/kdenlive/ und …/26.08/windows/, …/26.08/macOS/, …/26.08/linux/
- [Q71] https://download.kde.org/stable/kdenlive/26.08/windows/kdenlive-26.08.2_standalone.exe.sha256 (und `.exe`, AppImage, beide dmg; `.mirrorlist` für Größen; `.sig` → 404)
- [Q72] https://kdenlive.org/download/
- [Q73] https://docs.kdenlive.org/en/getting_started/installation.html
- [Q74] https://docs.kdenlive.org/en/getting_started/configure_kdenlive/configuration_info.html
- [Q75] https://invent.kde.org/multimedia/kdenlive/-/raw/master/src/main.cpp
- [Q76] https://invent.kde.org/multimedia/kdenlive/-/raw/master/src/renderpresets/renderpresetrepository.cpp
- [Q77] https://invent.kde.org/multimedia/kdenlive/-/raw/master/src/profiles/profilerepository.cpp
- [Q78] https://invent.kde.org/multimedia/kdenlive/-/raw/master/data/profiles.xml
- [Q79] https://discuss.kde.org/t/kdenlive-portable-vs-installer-on-windows/46565
- [Q80] https://docs.kdenlive.org/en/titles_and_graphics/titles/title_template_titles.html
- [Q81] https://invent.kde.org/api/v4/projects/multimedia%2Fkdenlive/repository/tree?path=data/titles&ref=master

**Allgemein / Optional / Affinity**
- [Q90] https://docs.appimage.org/user-guide/troubleshooting/fuse.html
- [Q91] https://support.apple.com/guide/mac-help/open-a-mac-app-from-an-unidentified-developer-mh40616/mac
- [Q92] https://learn.microsoft.com/en-us/archive/msdn-technet-forums/e5eacd26-8d6e-4af1-b45c-bb9b66353ff2 und https://learn.microsoft.com/en-us/answers/questions/1133052/windows-user-font-directory-knownfolder-api-and-th
- [Q93] https://bugs.kde.org/show_bug.cgi?id=367650 (XDG-Fonts-Ordner statt `~/.fonts`)
- [Q94] https://download.gimp.org/gimp/v3.2/ (+ `SHA256SUMS`, `windows/`, `macos/`, `linux/`)
- [Q95] https://api.github.com/repos/Orama-Interactive/Pixelorama/releases/latest, …/audacity/audacity/releases/latest, https://github.com/audacity/audacity/releases/download/Audacity-4.0.1/CHECKSUMS.txt, …/darktable-org/darktable/releases/latest, …/upscayl/upscayl/releases/latest
- [Q96] https://www.affinity.studio/ (Download-Link über Canva-Anmeldung) und https://www.canva.com/newsroom/news/all-new-affinity/ (nicht abrufbar, 403)
- [Q97] https://en.wikipedia.org/wiki/Scribus (Version/Datum); https://www.scribus.net/downloads/stable-branch/ war nicht abrufbar (Anubis-Schutz)
