#!/usr/bin/env bash
# Werkt een bestaande Sjpeelavond-container bij naar de laatste versie op main.
# Draai op de Proxmox-host als root:
#
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/Theberas04/sjpeelavond/main/deploy/proxmox/update-from-github.sh)" <CTID>
#
# Het container-id mag ook via de omgeving (CTID=106 ...) of als $0 mee.
#
# Wat het doet: haalt de kit als tarball van codeload.github.com, pakt hem uit op de
# host, maakt in de container een reservekopie, schuift de nieuwe bestanden erin,
# herstart de dienst en controleert of de nieuwe versie echt draait. Mislukt de
# controle, dan gaat de reservekopie terug en draait de oude versie weer. De
# database en de eigen uploads (SJPEELAVOND_DB en SJPEELAVOND_MEDIA) worden nooit
# overschreven; de dataset wordt wel verversd.
set -euo pipefail

case "${0:-}" in
  *[!0-9]*|"") KANDIDAAT0="" ;;
  *) KANDIDAAT0="$0" ;;
esac
CTID="${1:-${CTID:-$KANDIDAAT0}}"
REPO="${REPO:-Theberas04/sjpeelavond}"
TAK="${TAK:-main}"
APP_DIR="${APP_DIR:-/opt/sjpeelavond}"
DATA_DIR="${DATA_DIR:-/var/lib/sjpeelavond/data}"
MEDIA_DIR="${MEDIA_DIR:-/var/lib/sjpeelavond/media}"
DB_PAD="${DB_PAD:-/var/lib/sjpeelavond/sjpeelavond.db}"
POORT="${POORT:-80}"
KIT_IN_CONTAINER="${KIT_IN_CONTAINER:-/opt/sjpeelavond-kit}"

log()  { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[!]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[fout]\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Draai dit als root op de Proxmox-host."
[ -n "$CTID" ] || die "Gebruik: bash update-from-github.sh <CTID>"
command -v pct >/dev/null || die "pct niet gevonden: dit is geen Proxmox VE-host."
pct status "$CTID" >/dev/null 2>&1 || die "Container $CTID bestaat niet."
[ "$(pct status "$CTID")" = "status: running" ] || die "Container $CTID draait niet."

# Dit zijn de paden die deze updater uit de repo haalt en in de container zet.
# Zelfde lijst als provision-sjpeelavond.sh; check-deploy-file-lists.py bewaakt dat
# elke naam echt in de repo bestaat.
FILES=(
  "server.js"
  "public/index.html"
  "public/js/app.js"
  "public/js/spel.js"
  "public/favicon.svg"
  "public/manifest.webmanifest"
  "public/icon-192.png"
  "public/icon-512.png"
  "public/icon-512-maskable.png"
  "public/apple-touch-icon.png"
  "data/nummers-hits.json"
  "data/nummers-limburg.json"
  "data/index.json"
  "data/hitster.json"
)
RUNTIME=(
  "server.js"
)
PAGINA=(
  "public/index.html"
  "public/js/app.js"
  "public/js/spel.js"
  "public/favicon.svg"
  "public/manifest.webmanifest"
  "public/icon-192.png"
  "public/icon-512.png"
  "public/icon-512-maskable.png"
  "public/apple-touch-icon.png"
)
DATA=(
  "data/nummers-hits.json"
  "data/nummers-limburg.json"
  "data/index.json"
  "data/hitster.json"
)
KIT_SCRIPTS=(
  "deploy/proxmox/provision-sjpeelavond.sh"
  "deploy/proxmox/update-from-github.sh"
  "deploy/proxmox/check-sjpeelavond.sh"
)

STAGING="$(mktemp -d)"; trap 'rm -rf "$STAGING"' EXIT
log "Nieuwe versie ophalen van $REPO ($TAK)"
# De tarball-URL van codeload.github.com; nooit de api. Is de repo publiek, dan
# volstaat dit; is hij prive, dan faalt de download met een duidelijke melding.
curl -fsSL --retry 3 "https://codeload.github.com/$REPO/tar.gz/refs/heads/$TAK?cb=$(date +%s)" \
  -o "$STAGING/kit.tar.gz" || die "Kon de nieuwe versie niet ophalen. Is de repository openbaar en is er internet?"
mkdir -p "$STAGING/kit"
tar xzf "$STAGING/kit.tar.gz" -C "$STAGING/kit" --strip-components=1
for f in "${FILES[@]}"; do
  [ -f "$STAGING/kit/$f" ] || die "De nieuwe versie is incompleet: $f ontbreekt."
done
log "   $(echo "${#FILES[@]}") bestanden opgehaald"

binnen_bash() { pct exec "$CTID" -- bash -c "$1"; }

log "Reservekopie maken in de container"
if ! pct exec "$CTID" -- test -d "$APP_DIR"; then
  die "$APP_DIR bestaat niet in de container: is Sjpeelavond hier wel ingericht?"
fi
binnen_bash "rm -rf $APP_DIR.bak && cp -a $APP_DIR $APP_DIR.bak"
pct exec "$CTID" -- test -d "$APP_DIR.bak" || die "Kon geen reservekopie maken; ik stop voordat er iets verandert."

log "Nieuwe bestanden plaatsen"
binnen_bash "install -d -o $GEBRUIKER -g $GEBRUIKER $APP_DIR $APP_DIR/public $APP_DIR/public/js $DATA_DIR $MEDIA_DIR" 2>/dev/null \
  || binnen_bash "mkdir -p $APP_DIR/public/js $DATA_DIR $MEDIA_DIR"
for f in "${RUNTIME[@]}"; do pct push "$CTID" "$STAGING/kit/$f" "$APP_DIR/$f" --perms 644; done
for f in "${PAGINA[@]}"; do pct push "$CTID" "$STAGING/kit/$f" "$APP_DIR/$f" --perms 644; done
for f in "${DATA[@]}"; do pct push "$CTID" "$STAGING/kit/$f" "$DATA_DIR/$(basename "$f")" --perms 644; done

# De kit-scripts in de container verversen, zodat check- en updatecommando's die
# daar staan ook de nieuwste versie zijn.
binnen_bash "mkdir -p $KIT_IN_CONTAINER"
for f in "${KIT_SCRIPTS[@]}"; do
  if [ -f "$STAGING/kit/$f" ]; then
    pct push "$CTID" "$STAGING/kit/$f" "$KIT_IN_CONTAINER/$(basename "$f")" --perms 755
  fi
done

GEBRUIKER="$(pct exec "$CTID" -- stat -c %U "$APP_DIR" 2>/dev/null | tr -d '\r')"
GEBRUIKER="${GEBRUIKER:-sjpeelavond}"
binnen_bash "chown -R $GEBRUIKER:$GEBRUIKER $APP_DIR $DATA_DIR $MEDIA_DIR"

log "Dienst herstarten"
binnen_bash "systemctl restart sjpeelavond"

log "Controleren of de nieuwe versie echt draait"
OK=0
for poging in $(seq 1 30); do
  if binnen_bash "curl -fsS -D /tmp/sjpeelavond-kop.txt -o /tmp/sjpeelavond-healthz.txt http://127.0.0.1:$POORT/healthz" 2>/dev/null; then
    if binnen_bash "grep -qi 'x-sjpeelavond' /tmp/sjpeelavond-kop.txt" && binnen_bash "grep -q '^ok' /tmp/sjpeelavond-healthz.txt"; then
      OK=1; break
    fi
  fi
  sleep 2
done

if [ "$OK" = "1" ]; then
  # De pagina wordt per verzoek van schijf gelezen; vergelijk een bestand dat de
  # nieuwe versie schrijft, zodat een oud proces niet als 'bijgewerkt' geldt.
  if ! binnen_bash "curl -fsS http://127.0.0.1:$POORT/ -o /tmp/sjpeelavond-index.html && cmp -s /tmp/sjpeelavond-index.html $APP_DIR/public/index.html"; then
    warn "De bestanden staan in de container, maar de dienst serveert nog de oude pagina."
    binnen_bash "journalctl -u sjpeelavond -n 20 --no-pager" >&2 || true
    die "Probeer: pct exec $CTID -- systemctl restart sjpeelavond"
  fi
  if ! binnen_bash "curl -fsS http://127.0.0.1:$POORT/api/versie -o /tmp/sjpeelavond-versie.json && grep -q '\"naam\":\"Sjpeelavond\"' /tmp/sjpeelavond-versie.json"; then
    warn "De API antwoordt niet zoals verwacht."
    binnen_bash "cat /tmp/sjpeelavond-versie.json" >&2 || true
    die "De nieuwe versie draait niet goed."
  fi
  log "   de nieuwste bestanden worden ook echt geserveerd"
  binnen_bash "rm -rf $APP_DIR.bak"
  log "Sjpeelavond in container $CTID is bijgewerkt."
else
  warn "De nieuwe versie start niet; ik zet de reservekopie terug."
  binnen_bash "journalctl -u sjpeelavond -n 30 --no-pager" >&2 || true
  binnen_bash "systemctl stop sjpeelavond || true"
  binnen_bash "rm -rf $APP_DIR.stuk && mv $APP_DIR $APP_DIR.stuk && mv $APP_DIR.bak $APP_DIR"
  GEBRUIKER="$(pct exec "$CTID" -- stat -c %U "$APP_DIR" 2>/dev/null | tr -d '\r')"
  binnen_bash "chown -R ${GEBRUIKER:-sjpeelavond}:${GEBRUIKER:-sjpeelavond} $APP_DIR"
  binnen_bash "systemctl start sjpeelavond"
  die "De oude versie draait weer. Bestanden die niet werkten staan in $APP_DIR.stuk."
fi
