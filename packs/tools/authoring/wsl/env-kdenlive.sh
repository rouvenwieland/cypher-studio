# Umgebung für das entpackte Kdenlive-AppImage (melt, kdenlive) mit isoliertem Profil. Mit `. env-kdenlive.sh` einbinden; danach `melt <argumente>`.
WORK="${C1_WORK:-$HOME/c1work}"
this_dir="$WORK/app-kdenlive/squashfs-root"
export this_dir
set +e +u
. "$this_dir/apprun-hooks/craft-runenv-hook.sh"
. "$this_dir/apprun-hooks/linuxdeploy-plugin-qt-hook.sh"
export LD_LIBRARY_PATH="$this_dir/usr/lib:$this_dir/usr/lib/x86_64-linux-gnu:${LD_LIBRARY_PATH:-}"
export QT_QPA_PLATFORM=xcb QT_PLUGIN_PATH="$this_dir/usr/plugins" QML2_IMPORT_PATH="$this_dir/usr/qml"
unset WAYLAND_DISPLAY
set -u
PROFILE="${C1_KDPROFILE:-$WORK/prof-kdenlive}"
export XDG_DATA_HOME="$PROFILE/data" XDG_CONFIG_HOME="$PROFILE/config" XDG_CACHE_HOME="$PROFILE/cache"
mkdir -p "$XDG_DATA_HOME" "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME"
melt() { xvfb-run -a -s "-screen 0 1920x1200x24" "$this_dir/usr/bin/melt" "$@"; }
