# Umgebung für das entpackte Inkscape-AppImage mit isoliertem Profil. Mit `. env-inkscape.sh` einbinden; danach `ink <argumente>`.
WORK="${C1_WORK:-$HOME/c1work}"
IK="$WORK/app-inkscape/squashfs-root"
export INKSCAPE_PROFILE_DIR="${C1_INKPROFILE:-$WORK/prof-inkscape}"
mkdir -p "$INKSCAPE_PROFILE_DIR"
export XDG_CACHE_HOME="$WORK/prof-inkscape-cache" FONTCONFIG_FILE=/etc/fonts/fonts.conf
ink() { xvfb-run -a "$IK/AppRun" "$@" 2> >(grep -v "_INKSCAPE_GC" >&2); }
