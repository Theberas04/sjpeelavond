#!/bin/bash
# Emulatorrooktest voor de Android-app van Sjpeelavond.
#
# Draait op de GitHub-runner terwijl de emulator aan staat en controleert de hele
# keten in plaats van alleen "de app startte":
#   1. de app installeert en de pagina komt uit de bundel (marker met aantal nummers),
#   2. de schil meldt zich als lokale versie (geen server),
#   3. elk scherm opent via zijn eigen diepe link en tekent echt inhoud,
#   4. een kaart trekken haalt via de schil een fragment op bij Deezer,
#   5. van elk scherm komt een schermafdruk die geen leeg vlak is.
#
# set -eu is geen detail: zonder die vlag loopt het script na een mislukte controle
# door en eindigt het tóch goed.
set -eu

PKG=nl.werdens.sjpeelavond
UIT=${UIT:-screenshots}
APK=${APK:-apk/app-debug.apk}
mkdir -p "$UIT"
rm -f "$UIT"/*.png "$UIT"/*.txt

echo "--- app installeren ---"
adb install -r "$APK" || { sleep 8; adb install -r "$APK"; }
adb shell pm clear "$PKG" >/dev/null

echo "--- schermprofiel vastleggen ---"
{ adb shell wm size; adb shell wm density; adb shell getprop ro.build.version.release; } \
  | tr -d '\r' > "$UIT/scherm.txt"
cat "$UIT/scherm.txt"

logcat_naar() {
  adb logcat -d -s Sjpeelavond:I > "$1" 2>/dev/null || true
  tr -d '\r' < "$1" > "$1.schoon" && mv "$1.schoon" "$1"
}

wacht_op_marker() {
  patroon="$1"
  pogingen="$2"
  for _ in $(seq 1 "$pogingen"); do
    if adb logcat -d -s Sjpeelavond:I 2>/dev/null | grep -qE "$patroon"; then
      return 0
    fi
    sleep 2
  done
  return 1
}

schiet() {
  naam="$1"
  for _ in $(seq 1 8); do
    adb exec-out screencap -p > "$UIT/$naam.png"
    if python3 scripts/check-screenshot.py "$UIT/$naam.png" >/dev/null 2>&1; then
      return 0
    fi
    sleep 4
  done
  python3 scripts/check-screenshot.py "$UIT/$naam.png"
}

# opent_scherm <naam> <verwacht scherm-id> [extra marker]
opent_scherm() {
  naam="$1"
  verwacht="$2"
  extra="${3:-}"
  echo "--- scherm $naam ---"
  adb logcat -c || true
  adb shell am start -W -n "$PKG/.MainActivity" -e scherm "$naam" >/dev/null
  if ! wacht_op_marker "scherm=$verwacht" 45; then
    echo "scherm $naam bleef op iets anders staan dan $verwacht; logcat:" >&2
    adb logcat -d -s Sjpeelavond:I >&2 || true
    exit 1
  fi
  if [ -n "$extra" ]; then
    if ! wacht_op_marker "$extra" 45; then
      echo "marker '$extra' kwam niet bij scherm $naam; logcat:" >&2
      adb logcat -d -s Sjpeelavond:I >&2 || true
      exit 1
    fi
  fi
  sleep 2
  schiet "$naam"
  logcat_naar "$UIT/logcat-$naam.txt"
}

echo "--- eerste keer starten (geen diepe link) ---"
adb logcat -c || true
adb shell am start -W -n "$PKG/.MainActivity" >/dev/null
wacht_op_marker "Sjpeelavond klaar versie=" 60 || { echo "de app meldde zich niet" >&2; adb logcat -d >&2; exit 1; }
# De pagina laadt de muziekdatabase uit de bundel; dat bewijst dat de bundel compleet is.
wacht_op_marker "SJPEELAVOND_KLAAR nummers=[0-9]+" 60 || { echo "de muziekdatabase kwam niet uit de bundel" >&2; adb logcat -d -s Sjpeelavond:I >&2; exit 1; }
# En dat de schil zich als lokale versie meldt: dit is de app zonder server.
wacht_op_marker "SJPEELAVOND_SCHIL lokaal=ja" 20 || { echo "de schil meldde zich niet als lokaal" >&2; adb logcat -d -s Sjpeelavond:I >&2; exit 1; }
wacht_op_marker "scherm=view-start" 30 || { echo "het startscherm tekende niet" >&2; adb logcat -d -s Sjpeelavond:I >&2; exit 1; }
wacht_op_marker "spelkaarten=3" 20 || { echo "de startpagina toont niet drie spellen" >&2; adb logcat -d -s Sjpeelavond:I >&2; exit 1; }
sleep 2
schiet "apk-start"
logcat_naar "$UIT/logcat-start.txt"

opent_scherm instellen view-instellen
opent_scherm spel view-spel "bordtekst=[1-9][0-9]*"
# Een kaart trekken: hier moet de schil een fragment bij Deezer ophalen.
opent_scherm spel-kaart view-spel "SJPEELAVOND_FRAGMENT (deezer|itunes)"
opent_scherm hittepetit view-spel
opent_scherm muziek view-muziek
opent_scherm uitleg view-uitleg

echo "--- de schermafdrukken zijn geen lege vlakken ---"
for beeld in "$UIT"/apk-*.png; do
  python3 scripts/check-screenshot.py "$beeld" >/dev/null
done
ls -la "$UIT"/apk-*.png

echo "Rooktest klaar: alle schermen getekend, fragment via de schil opgehaald."
