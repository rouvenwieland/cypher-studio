#!/usr/bin/env bash
# Lädt Krita, Inkscape und Kdenlive (AppImage, Linux x86_64) aus den offiziellen Quellen, prüft sie und entpackt sie nach ~/c1work.
# Nur für die Paket-Entwicklung in der WSL (BAU-REGELN 9): kein Eingriff in Windows. Prüfung:
#   Krita:    SHA-256 von download.kde.org und OpenPGP-Signatur (Schlüssel E9FB 29E7 4ADE ACC5 E303 5B8A B69E B4CF 7468 332F)
#   Kdenlive: SHA-256 von download.kde.org
#   Inkscape: OpenPGP-Signatur des AppImage (DSA-1024/SHA-1, schwach) und festgenagelte SHA-256 (cypherPinned)
set -euo pipefail
WORK="${C1_WORK:-$HOME/c1work}"
mkdir -p "$WORK/dl" && cd "$WORK/dl"

get() { [ -f "$2" ] || { curl -fL --retry 3 -sS -C - -o "$2.part" "$1" && mv "$2.part" "$2"; }; }

KRITA=krita-5.3.4.1-x86_64.AppImage
KDENLIVE=kdenlive-26.08.2-x86_64.AppImage
INKSCAPE=Inkscape-1.4.4.AppImage
INKSCAPE_SHA256=d217fe05c92faaed5c3af46856b6299c98933dc722819cb5bc2ca052c5522166

get "https://download.kde.org/stable/krita/5.3.4.1/$KRITA" "$KRITA"
curl -fsSL -o "$KRITA.sha256" "https://download.kde.org/stable/krita/5.3.4.1/$KRITA.sha256"
curl -fsSL -o "$KRITA.sig" "https://download.kde.org/stable/krita/5.3.4.1/$KRITA.sig"
curl -fsSL -o dmitry_kazakov.gpg "https://files.kde.org/krita/dmitry_kazakov.gpg"
sha256sum -c "$KRITA.sha256"
GNUPGHOME="$(mktemp -d)"; export GNUPGHOME; chmod 700 "$GNUPGHOME"
gpg --quiet --import dmitry_kazakov.gpg 2>/dev/null
gpg --status-fd 1 --verify "$KRITA.sig" "$KRITA" 2>/dev/null | grep -q "VALIDSIG E9FB29E74ADEACC5E3035B8AB69EB4CF7468332F" && echo "Krita: Signatur gültig (E9FB 29E7 …)"

get "https://download.kde.org/stable/kdenlive/26.08/linux/$KDENLIVE" "$KDENLIVE"
curl -fsSL -o "$KDENLIVE.sha256" "https://download.kde.org/stable/kdenlive/26.08/linux/$KDENLIVE.sha256"
sha256sum -c "$KDENLIVE.sha256"

get "https://media.inkscape.org/dl/resources/file/$INKSCAPE" "$INKSCAPE"
curl -fsSL -o inkscape.sig "https://media.inkscape.org/media/resources/sigs/Inkscape-dcaf3e7-x86_64.AppImage.sig"
curl -fsSL -o inkscape-jeanmougin.gpg "https://inkscape.org/~MarcJeanmougin/gpg/"
GNUPGHOME="$(mktemp -d)"; export GNUPGHOME; chmod 700 "$GNUPGHOME"
gpg --quiet --import inkscape-jeanmougin.gpg 2>/dev/null
gpg --status-fd 1 --verify inkscape.sig "$INKSCAPE" 2>/dev/null | grep -q "VALIDSIG 74E8DA1398055A8120B276EB5FCB204EF882B07A" && echo "Inkscape: Signatur gültig (74E8 DA13 …, DSA-1024/SHA-1)"
echo "$INKSCAPE_SHA256  $INKSCAPE" | sha256sum -c

cd "$WORK"
for spec in "$KRITA:app-krita" "$INKSCAPE:app-inkscape" "$KDENLIVE:app-kdenlive"; do
  img="${spec%%:*}"; dir="${spec##*:}"
  if [ ! -d "$dir/squashfs-root" ]; then
    mkdir -p "$dir" && (cd "$dir" && chmod +x "../dl/$img" && "../dl/$img" --appimage-extract >/dev/null)
  fi
  echo "entpackt: $dir"
done
