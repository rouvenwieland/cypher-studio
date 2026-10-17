#!/bin/bash
# Startet das per apt installierte Cypher Studio (.deb) kopflos unter Xvfb in der WSL und fotografiert den ersten Bildschirm.
# Vorher: sudo apt install ./dist-builds/Cypher Studio_<version>_amd64.deb (in der WSL). Ausgabe: docs/shots/echt/linux/.
OUT=/mnt/c/Users/Nevuor/Code/cypher-studio/docs/shots/echt/linux
mkdir -p "$OUT"
rm -rf ~/.local/share/de.cypherxcypher.studio ~/.config/de.cypherxcypher.studio
Xvfb :99 -screen 0 1600x1000x24 >/dev/null 2>&1 &
XV=$!
sleep 2
export DISPLAY=:99 WEBKIT_DISABLE_DMABUF_RENDERER=1 WEBKIT_DISABLE_COMPOSITING_MODE=1 LIBGL_ALWAYS_SOFTWARE=1 GDK_BACKEND=x11
dbus-run-session -- cypher-studio >/tmp/cs.log 2>&1 &
APP=$!
for i in $(seq 1 30); do sleep 1; W=$(xdotool search --name "Cypher Studio" 2>/dev/null | head -1); [ -n "$W" ] && break; done
echo "Fenster nach ${i}s: ${W:-keins}"
sleep 8
xwininfo -root -tree | grep -i -E "cypher|tauri" | head -5
import -window root "$OUT/deb-erststart.png" && echo "Foto gespeichert"
echo "--- Log:"; tail -8 /tmp/cs.log
pgrep -a cypher-studio | head -3
kill $APP 2>/dev/null; pkill -f cypher-studio; kill $XV 2>/dev/null
ls ~/.local/share/de.cypherxcypher.studio/data 2>/dev/null | sed 's/^/Daten: /'
