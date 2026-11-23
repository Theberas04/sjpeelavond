#!/bin/bash
# Emulator starten met het S25-profiel, de rooktest draaien en hem daarna uitzetten.
#
# Alles in één stap: een emulator die in stap A wordt gestart en in stap B gebruikt,
# wordt tussen die stappen vaak opgeruimd.
set -eu

SDK=${ANDROID_SDK_ROOT:-${ANDROID_HOME:?ANDROID_HOME of ANDROID_SDK_ROOT moet gezet zijn}}
AVD=${AVD:-sjpeel}
LOG=/tmp/emulator.log

# Dezelfde AVD-map als waarin maak-s25-avd.sh de AVD heeft gezet; zonder deze regel
# zoekt de emulator in $HOME/.android/avd en vindt hij hem niet.
export ANDROID_AVD_HOME="${ANDROID_AVD_HOME:-$HOME/.android/avd}"
echo "ANDROID_AVD_HOME=$ANDROID_AVD_HOME"

EMULATOR="$SDK/emulator/emulator"
if [ ! -x "$EMULATOR" ]; then
  EMULATOR=$(command -v emulator || true)
fi
if [ -z "$EMULATOR" ] || [ ! -x "$EMULATOR" ]; then
  echo "geen emulator-binary gevonden; inhoud van $SDK:" >&2
  ls -la "$SDK" >&2 || true
  exit 1
fi
echo "emulator: $EMULATOR (AVD $AVD)"

if ! "$EMULATOR" -list-avds 2>/dev/null | grep -qx "$AVD"; then
  echo "de emulator ziet de AVD $AVD niet; hij ziet wel:" >&2
  "$EMULATOR" -list-avds >&2 2>&1 || true
  ls -la "$ANDROID_AVD_HOME" >&2 || true
  exit 1
fi

# Zonder dit start de emulator op software (de bouwgebruiker mag dan niet bij /dev/kvm)
# en haalt hij de opstarttijd nooit. Een langere tijdslimiet lost dat niet op.
if [ -e /dev/kvm ]; then
  sudo chmod 666 /dev/kvm || true
  echo "/dev/kvm aanwezig: $(ls -l /dev/kvm)"
else
  echo "let op: geen /dev/kvm, de emulator draait op software-emulatie en is dan traag"
fi

rm -f "$LOG"
setsid nohup "$EMULATOR" -avd "$AVD" \
  -no-window -no-audio -no-boot-anim -no-snapshot \
  -gpu swiftshader_indirect \
  > "$LOG" 2>&1 < /dev/null &

stop_emulator() {
  adb emu kill >/dev/null 2>&1 || true
  sleep 3
  pkill -f "qemu-system-x86_64" >/dev/null 2>&1 || true
}
trap stop_emulator EXIT

# Liveness niet aflezen aan een procesnaam: de emulator gaat over in qemu-system-x86_64.
ziet_toestel() {
  adb devices 2>/dev/null | grep -q "^emulator-"
}
loggrootte() {
  wc -c < "$LOG" 2>/dev/null || echo 0
}

echo "--- wachten op de emulator ---"
adb start-server >/dev/null 2>&1 || true
BOOTED=0
for poging in $(seq 1 240); do
  if adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r' | grep -q 1; then
    BOOTED=1
    break
  fi
  if [ "$poging" -ge 12 ] && [ "$(loggrootte)" = "0" ] && ! ziet_toestel; then
    echo "de emulator heeft na een minuut niets gelogd en adb ziet geen toestel; logboek:" >&2
    tail -40 "$LOG" >&2 || true
    exit 1
  fi
  if [ "$poging" = "60" ]; then
    echo "--- al vijf minuten aan het opstarten; laatste emulatorlogregels ---"
    tail -20 "$LOG" || true
  fi
  sleep 5
done
if [ "$BOOTED" != "1" ]; then
  echo "emulator niet opgestart binnen 20 minuten; laatste logregels:" >&2
  tail -40 "$LOG" >&2 || true
  exit 1
fi
echo "--- emulator opgestart ---"
sleep 10

# Vaste animaties uit, anders bevatten de schermafdrukken halve overgangen.
adb shell settings put global window_animation_scale 0
adb shell settings put global transition_animation_scale 0
adb shell settings put global animator_duration_scale 0

bash scripts/android-rooktest.sh
