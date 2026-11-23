#!/bin/bash
# Zet een AVD klaar met het schermprofiel van een Samsung Galaxy S25.
#
# S25 (niet-Ultra): 6,2 inch, 1080 x 2340 px (19,5:9), dichtheid 480 dpi.
# Die 480 dpi is geen gok: 1080/480*160 = 360 dp en 2340/480*160 = 780 dp, precies
# het logische venster (360 x 780 dp) dat apps op een S25 te zien krijgen.
#
# De systeemimage is Android 16 (API 36): de Android-versie onder One UI 8, waar
# de S25 op zit. Dit blijft wel Androids eigen systeemimage — Samsung levert geen
# One UI-image voor de emulator, dus de statusbalk, het meldingsvenster en het
# instellingenscherm zien er anders uit dan op een echte S25. De app zelf is
# identiek.
#
# API=${API:-36} om een andere versie te kiezen; valt terug op 35 als die image
# niet beschikbaar is.
set -eu

SDK=${ANDROID_SDK_ROOT:-${ANDROID_HOME:?ANDROID_HOME of ANDROID_SDK_ROOT moet gezet zijn}}
AVD=sjpeel
API=${API:-36}
ABI=x86_64

# Waar de AVD komt te staan. Dit moet voor avdmanager én voor de emulator
# hetzelfde zijn: avdmanager schrijft de AVD weg onder $XDG_CONFIG_HOME
# (.config/.android/avd op de CI-runner) terwijl de emulator alleen
# $ANDROID_AVD_HOME, $ANDROID_SDK_HOME/avd en $HOME/.android/avd doorzoekt.
# Zonder deze regel maakt de ene stap de AVD en vindt de andere hem niet.
export ANDROID_AVD_HOME="${ANDROID_AVD_HOME:-$HOME/.android/avd}"
mkdir -p "$ANDROID_AVD_HOME"
echo "ANDROID_AVD_HOME=$ANDROID_AVD_HOME"

if [ ! -x "$SDK/cmdline-tools/latest/bin/avdmanager" ]; then
  echo "avdmanager niet gevonden in $SDK/cmdline-tools/latest/bin" >&2
  exit 1
fi

IMAGE="system-images;android-$API;google_apis;$ABI"
# Alleen een *geinstalleerd* systeemimage werkt voor avdmanager. `sdkmanager --list`
# noemt ook wat er te downloaden is, en daar ging het mis: op de bouwmachine stond
# alleen android-35 terwijl android-36 beschikbaar (maar niet geinstalleerd) was, en
# dan zakt avdmanager met "Package path is not valid". Dus in de map kijken.
if [ ! -d "$SDK/system-images/android-$API/google_apis/$ABI" ]; then
  GEVONDEN=
  for kandidaat in 36 35 34 33; do
    if [ -d "$SDK/system-images/android-$kandidaat/google_apis/$ABI" ]; then
      GEVONDEN=$kandidaat
      break
    fi
  done
  if [ -z "$GEVONDEN" ]; then
    echo "geen geinstalleerd systeemimage voor $ABI in $SDK/system-images" >&2
    echo "installeer er een, bijvoorbeeld: sdkmanager 'system-images;android-35;google_apis;$ABI'" >&2
    exit 1
  fi
  echo "let op: android-$API is niet geinstalleerd; ik gebruik android-$GEVONDEN"
  API=$GEVONDEN
  IMAGE="system-images;android-$API;google_apis;$ABI"
fi
echo "systeemimage: $IMAGE"

echo "no" | "$SDK/cmdline-tools/latest/bin/avdmanager" create avd \
  --name "$AVD" \
  --package "$IMAGE" \
  --device "pixel_6" \
  --force >/dev/null

# Vraag avdmanager waar hij de AVD heeft neergezet; zelf zoeken is de terugval als
# de uitvoer er anders uitziet dan verwacht.
AVDPAD=$("$SDK/cmdline-tools/latest/bin/avdmanager" list avd 2>/dev/null \
  | awk -v naam="$AVD" '$1 == "Name:" && $2 == naam { gezien = 1 } gezien && $1 == "Path:" { print $2; exit }')
if [ -z "$AVDPAD" ] || [ ! -d "$AVDPAD" ]; then
  AVDPAD=$(find "$ANDROID_AVD_HOME" "$HOME/.config/.android/avd" "$SDK/.android/avd" \
    /root/.android/avd -maxdepth 2 -type d -name "$AVD.avd" 2>/dev/null | head -1)
fi
if [ -z "$AVDPAD" ] || [ ! -d "$AVDPAD" ]; then
  echo "kon de AVD-map van $AVD niet vinden; avdmanager zegt:" >&2
  "$SDK/cmdline-tools/latest/bin/avdmanager" list avd >&2 2>&1 || true
  exit 1
fi

DOEL="$ANDROID_AVD_HOME/$AVD.avd"
if [ "$AVDPAD" != "$DOEL" ]; then
  echo "AVD stond in $AVDPAD; verplaats naar $DOEL zodat de emulator hem vindt"
  rm -rf "$DOEL"
  mv "$AVDPAD" "$DOEL"
  BRON_INI="$(dirname "$AVDPAD")/$AVD.ini"
  if [ -f "$BRON_INI" ]; then mv "$BRON_INI" "$ANDROID_AVD_HOME/$AVD.ini"; fi
  # Het .ini-bestand naast de .avd-map vertelt de emulator waar de AVD staat.
  printf 'path=%s\npath.rel=avd/%s.avd\ntarget=android-%s\n' \
    "$DOEL" "$AVD" "$API" > "$ANDROID_AVD_HOME/$AVD.ini"
fi
echo "AVD-map: $DOEL"

CONFIG="$DOEL/config.ini"
[ -f "$CONFIG" ] || { echo "geen config.ini in $DOEL" >&2; ls -la "$DOEL" >&2; exit 1; }

# Bestaande schermregels weghalen en die van de S25 terugzetten.
# skin.path=_no_skin met skin.name=<WxH> is de manier om een eigen resolutie af
# te dwingen; zonder dat blijft de resolutie van het gekozen toestel staan.
sed -i '/^hw\.lcd\./d;/^skin\./d;/^hw\.ramSize/d' "$CONFIG"
cat >> "$CONFIG" <<'EOF'
hw.lcd.width=1080
hw.lcd.height=2340
hw.lcd.density=480
skin.name=1080x2340
skin.path=_no_skin
hw.ramSize=3072
vm.heapSize=256
hw.keyboard=yes
EOF

echo "--- AVD $AVD ingesteld (Android $API) ---"
grep -E "^hw\.lcd|^skin\.|^hw\.ramSize" "$CONFIG"
echo "--- wat er in $ANDROID_AVD_HOME staat ---"
ls -la "$ANDROID_AVD_HOME"
