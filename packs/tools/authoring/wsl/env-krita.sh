# Umgebung für das entpackte Krita-AppImage mit isoliertem Profil. Mit `. env-krita.sh` einbinden.
WORK="${C1_WORK:-$HOME/c1work}"
KR="$WORK/app-krita/squashfs-root"
PYV="$(ls -d "$KR"/usr/lib/python3.* | head -1 | xargs basename)"
export LD_LIBRARY_PATH="$KR/usr/lib:$KR/usr/lib/x86_64-linux-gnu:${LD_LIBRARY_PATH:-}"
export PYTHONHOME="$KR/usr"
export PYTHONPATH="$KR/usr/lib/$PYV:$KR/usr/lib/$PYV/lib-dynload:$KR/usr/lib/$PYV/site-packages:$KR/usr/share/krita/pykrita:$KR/usr/lib/krita-python-libs${CYPHER_PYTHONPATH:+:$CYPHER_PYTHONPATH}"
export QT_PLUGIN_PATH="$KR/usr/plugins"
export QML2_IMPORT_PATH="$KR/usr/qml"
export XDG_DATA_DIRS="$KR/usr/share:/usr/share"
PROFILE="${C1_PROFILE:-$WORK/prof-krita}"
export XDG_DATA_HOME="$PROFILE/data" XDG_CONFIG_HOME="$PROFILE/config" XDG_CACHE_HOME="$PROFILE/cache"
mkdir -p "$XDG_DATA_HOME" "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME"
export KRITA_PATH="$KR/usr" FONTCONFIG_FILE=/etc/fonts/fonts.conf
