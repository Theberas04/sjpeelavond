#!/usr/bin/env bash
# Sjpeelavond — installatie op een Proxmox VE-host, in één opdracht.
#
# Draai dit als root in de shell van de Proxmox-host:
#
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/Theberas04/sjpeelavond/main/deploy/proxmox/install.sh)"
#
# Wat het doet:
#   1. haalt de kit als tarball op via codeload.github.com naar een vaste map,
#   2. controleert dat de kit compleet is,
#   3. draait create-sjpeelavond-lxc.sh, dat de LXC maakt en inricht.
#
# De kit blijft staan in /opt/sjpeelavond-kit, zodat check-sjpeelavond.sh en
# update-from-github.sh daarna bij de hand zijn.
#
# Eerst alleen ophalen en controleren, zonder Proxmox nodig:
#   FETCH_ONLY=1 bash -c "$(curl -fsSL .../deploy/proxmox/install.sh)"
set -euo pipefail

REPO="${REPO:-Theberas04/sjpeelavond}"
TAK="${TAK:-main}"
# Vaste kit-map: niet mktemp, zodat de kit na de installatie blijft liggen.
KIT="${KIT_DIR:-/opt/sjpeelavond-kit}"
TOKEN="${GH_TOKEN:-${GITHUB_TOKEN:-${TOKEN:-}}}"
FETCH_ONLY="${FETCH_ONLY:-0}"

log()  { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[!]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[fout]\033[0m %s\n' "$*" >&2; exit 1; }

# De kit komt als tarball van codeload.github.com. Dat is de archief-URL van GitHub
# zelf: één verzoek, nooit de api (die is per IP gelimiteerd en geeft bij drukte 403).
haal_kit() {
  # Standaard de tarball-URL van codeload.github.com; KIT_URL is er om lokaal te
  # kunnen proefdraaien (bijvoorbeeld met een file://-pad).
  local url="${KIT_URL:-https://codeload.github.com/$REPO/tar.gz/refs/heads/$TAK}"
  local auth=()
  TARBALL="$(mktemp -t sjpeelavond.XXXXXXXX.tar.gz)"
  trap 'rm -f "${TARBALL:-}"' EXIT
  [ -n "$TOKEN" ] && auth=(-H "Authorization: Bearer $TOKEN")
  if ! curl -fsSL --retry 3 "${auth[@]}" "$url" -o "$TARBALL"; then
    warn "Kon de kit niet ophalen van $url"
    [ -z "$TOKEN" ] && warn "Is de repo privé? Zet dan een token: GH_TOKEN=... bash -c \"\$(curl ...)\""
    exit 1
  fi
  if [ -e "$KIT" ]; then
    [ -f "$KIT/deploy/proxmox/create-sjpeelavond-lxc.sh" ] \
      || die "$KIT bestaat al en is niet de kit van deze app. Verplaats die map of kies een andere plek: KIT_DIR=/pad/naar/kit"
    log "Oude kit in $KIT opruimen"
    rm -rf "$KIT"
  fi
  mkdir -p "$KIT"
  tar xzf "$TARBALL" -C "$KIT" --strip-components=1
}

log "Kit ophalen ($REPO/$TAK)"
haal_kit

# De kit moet compleet zijn vóór we iets aanraken of aanmaken.
for f in server.js public/index.html public/js/app.js \
         data/nummers-hits.json data/nummers-limburg.json data/index.json \
         deploy/proxmox/create-sjpeelavond-lxc.sh \
         deploy/proxmox/provision-sjpeelavond.sh
do
  [ -f "$KIT/$f" ] || die "De kit is onvolledig: $f ontbreekt."
done
log "Kit staat in $KIT en is compleet."

# Proefmodus, vóór de root- en pct-controles: zo kun je op elke machine testen of
# de kit te vinden en compleet is zonder Proxmox.
if [ "$FETCH_ONLY" = "1" ]; then
  log "FETCH_ONLY=1: kit opgehaald en gecontroleerd; ik maak niets aan en stop hier."
  exit 0
fi

[ "$(id -u)" -eq 0 ] || die "Draai dit als root op de Proxmox-host."
command -v pct   >/dev/null || die "pct niet gevonden: dit is geen Proxmox VE-host."
command -v pveam >/dev/null || die "pveam niet gevonden: dit is geen Proxmox VE-host."
command -v curl  >/dev/null || die "curl ontbreekt; installeer het met: apt-get install -y curl"
command -v tar   >/dev/null || die "tar ontbreekt."

log "LXC aanmaken en inrichten"
exec bash "$KIT/deploy/proxmox/create-sjpeelavond-lxc.sh"
