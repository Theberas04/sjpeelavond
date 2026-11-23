#!/usr/bin/env bash
# Richt een bestaande Debian-container in als Sjpeelavond-server.
#
#   bash deploy/proxmox/provision-sjpeelavond.sh <CTID>
#
# Draait op de Proxmox-host als root, meestal aangeroepen door
# create-sjpeelavond-lxc.sh. De app-bestanden komen uit $SRC
# (standaard /opt/sjpeelavond-kit); met SRC=/pad/naar/checkout kun je ook een
# lokale werkboom naar de container sturen zonder GitHub.
#
# De app luistert op poort 80 zonder nginx ervoor: de systemd-dienst draait als
# gewone gebruiker met AmbientCapabilities=CAP_NET_BIND_SERVICE.
set -euo pipefail

# Het container-id kan op drie manieren komen: als eerste argument
# ('bash script.sh 106'), via de omgeving (CTID=106 ...) en via
# 'bash -c "$(curl ...)" 106' — dat laatste zet het nummer in $0, niet in $1.
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
GEBRUIKER="${GEBRUIKER:-sjpeelavond}"
POORT="${POORT:-80}"
SRC="${SRC:-/opt/sjpeelavond-kit}"
ENV_BESTAND="${ENV_BESTAND:-/etc/sjpeelavond.env}"

log()  { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[!]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[fout]\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Draai dit als root op de Proxmox-host."
[ -n "$CTID" ] || die "Gebruik: bash provision-sjpeelavond.sh <CTID>"
pct status "$CTID" >/dev/null 2>&1 || die "Container $CTID bestaat niet."

# De bestandslijsten: elk pad is repo-relatief en wordt uit $SRC naar de container
# gepusht. Deze lijsten moeten gelijk blijven lopen met update-from-github.sh;
# scripts/check-deploy-file-lists.py bewaakt dat elk pad in de repo bestaat.
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

for f in "${RUNTIME[@]}" "${PAGINA[@]}" "${DATA[@]}"; do
  [ -f "$SRC/$f" ] || die "Bestand ontbreekt op de host: $SRC/$f
Draai eerst deploy/proxmox/install.sh (of zet SRC naar je checkout)."
done

binnen_bash() { pct exec "$CTID" -- bash -c "$1"; }

log "Basispakketten installeren in container $CTID"
# 'apt-get update' mag mislukken zonder de installatie te stoppen (pipefail-valkuil):
# de image kan al een gevulde index hebben.
binnen_bash "export DEBIAN_FRONTEND=noninteractive; apt-get update -qq 2>/dev/null || true; apt-get install -y -qq ca-certificates curl xz-utils tar procps >/dev/null"

log "Node 22 installeren (node:sqlite vraagt 22.5 of nieuwer)"
NODE_HUIDIG="$(pct exec "$CTID" -- node --version 2>/dev/null || true)"
NODE_HUIDIG="${NODE_HUIDIG#v}"
NODE_MAJOR="${NODE_HUIDIG%%.*}"
case "${NODE_MAJOR:-}" in ''|*[!0-9]*) NODE_MAJOR=0 ;; esac
if [ "$NODE_MAJOR" -lt 22 ]; then
  # Eerst de NodeSource-repo; de gewone Debian-/Proxmox-repo heeft vaak nog een
  # te oude Node. Faalt die route, dan pakken we de officiële nodejs.org-tarball.
  if pct exec "$CTID" -- bash -c 'set -e
      export DEBIAN_FRONTEND=noninteractive
      curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/nodesource.sh
      bash /tmp/nodesource.sh >/dev/null 2>&1
      apt-get install -y -qq nodejs >/dev/null' 2>/dev/null; then
    log "Node geinstalleerd via de NodeSource-repo"
  else
    warn "De NodeSource-route mislukte; ik pak de officiele nodejs.org-tarball."
    case "$(pct exec "$CTID" -- dpkg --print-architecture)" in
      amd64) NODE_ARCH=x64 ;;
      arm64) NODE_ARCH=arm64 ;;
      *) die "Onbekende architectuur in de container." ;;
    esac
    # De versie uit de officiele index halen; eerst naar een bestand schrijven en
    # daarna zoeken (geen 'curl | grep').
    pct exec "$CTID" -- bash -c 'curl -fsSL https://nodejs.org/dist/index.json -o /tmp/node-index.json' \
      || die "Kon de Node-index niet ophalen van nodejs.org."
    VERSIE="$(pct exec "$CTID" -- bash -c "sed -n 's/.*\"version\":\"\\(v22[^\"]*\\)\".*/\\1/p' /tmp/node-index.json | head -1" 2>/dev/null || true)"
    [ -n "$VERSIE" ] || die "Kon geen Node-22-versie bepalen uit de index."
    pct exec "$CTID" -- bash -c "set -e
        mkdir -p /opt/node22
        curl -fsSL https://nodejs.org/dist/$VERSIE/node-$VERSIE-linux-$NODE_ARCH.tar.xz -o /tmp/node.tar.xz
        tar -xJf /tmp/node.tar.xz -C /opt/node22 --strip-components=1
        for b in node npm npx; do ln -sf /opt/node22/bin/\$b /usr/local/bin/\$b; done
        rm -f /tmp/node.tar.xz" || die "Node-tarball installeren mislukte."
    log "Node $VERSIE uit de nodejs.org-tarball geinstalleerd"
  fi
fi
if ! pct exec "$CTID" -- bash -c 'node -e "require(\"node:sqlite\")"' >/dev/null 2>&1; then
  die "Node in de container kan node:sqlite niet laden. Installeer Node 22 of nieuwer:
  pct exec $CTID -- bash -c 'curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs'"
fi
NODE_BIN="$(pct exec "$CTID" -- command -v node)"
log "   $(pct exec "$CTID" -- node --version) op $NODE_BIN"

log "Gebruiker en mappen"
binnen_bash "id -u $GEBRUIKER >/dev/null 2>&1 || useradd --system --create-home --home /var/lib/sjpeelavond --shell /usr/sbin/nologin $GEBRUIKER"
binnen_bash "install -d -o $GEBRUIKER -g $GEBRUIKER $APP_DIR $APP_DIR/public $APP_DIR/public/js $DATA_DIR $MEDIA_DIR"

log "Bestanden naar de container sturen"
for f in "${RUNTIME[@]}"; do pct push "$CTID" "$SRC/$f" "$APP_DIR/$f" --perms 644; done
for f in "${PAGINA[@]}"; do pct push "$CTID" "$SRC/$f" "$APP_DIR/$f" --perms 644; done
for f in "${DATA[@]}"; do pct push "$CTID" "$SRC/$f" "$DATA_DIR/$(basename "$f")" --perms 644; done
binnen_bash "chown -R $GEBRUIKER:$GEBRUIKER $APP_DIR $DATA_DIR $MEDIA_DIR"

# --- Beheerderswachtwoord ------------------------------------------------------
# Het wachtwoord wordt gegeven of eenmalig gegenereerd en daarna bewaard. De app
# zet het bij de eerste start als scrypt-hash in de database; daarna is het platte
# wachtwoord alleen nog nodig om het te kunnen tonen.
BESTAAND_WW="$(pct exec "$CTID" -- sed -n 's/^SJPEELAVOND_WACHTWOORD=//p' "$ENV_BESTAND" 2>/dev/null | head -1 || true)"
WACHTWOORD="${SJPEELAVOND_WACHTWOORD:-$BESTAAND_WW}"
if [ -z "$WACHTWOORD" ]; then
  WACHTWOORD="$(head -c 18 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9' | head -c 20)"
  [ -n "$WACHTWOORD" ] || WACHTWOORD="sjpeelavond$(date +%s | tail -c 7)"
fi
ENVTMP="$(mktemp)"
( umask 077; printf 'SJPEELAVOND_WACHTWOORD=%s\n' "$WACHTWOORD" > "$ENVTMP" )
pct push "$CTID" "$ENVTMP" "$ENV_BESTAND" --perms 600
rm -f "$ENVTMP"

log "Systemd-dienst installeren (poort $POORT, gebruiker $GEBRUIKER)"
UNIT="$(mktemp)"
cat > "$UNIT" <<UNITEOF
[Unit]
Description=Sjpeelavond — hits en Limburgs repertoire als gezelschapsspel
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$GEBRUIKER
Group=$GEBRUIKER
WorkingDirectory=$APP_DIR
Environment=POORT=$POORT
Environment=SJPEELAVOND_DATA=$DATA_DIR
Environment=SJPEELAVOND_MEDIA=$MEDIA_DIR
Environment=SJPEELAVOND_DB=$DB_PAD
EnvironmentFile=$ENV_BESTAND
ExecStart=$NODE_BIN $APP_DIR/server.js
# Poort 80 is geprivilegieerd: alleen deze ene capability. De dienst blijft de
# onbevoorrechte gebruiker $GEBRUIKER en draait dus niet als root.
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNITEOF
pct push "$CTID" "$UNIT" /etc/systemd/system/sjpeelavond.service --perms 644
rm -f "$UNIT"

binnen_bash "systemctl daemon-reload && systemctl enable sjpeelavond >/dev/null 2>&1 && systemctl restart sjpeelavond"

log "Controleren of de app antwoordt"
OK=0
for poging in $(seq 1 30); do
  if binnen_bash "curl -fsS -D /tmp/sjpeelavond-kop.txt -o /tmp/sjpeelavond-healthz.txt http://127.0.0.1:$POORT/healthz" 2>/dev/null; then
    if binnen_bash "grep -qi 'x-sjpeelavond' /tmp/sjpeelavond-kop.txt" && binnen_bash "grep -q '^ok' /tmp/sjpeelavond-healthz.txt"; then
      OK=1; break
    fi
  fi
  sleep 2
done

if [ "$OK" != "1" ]; then
  warn "De app antwoordt niet op poort $POORT. Bewijs:"
  binnen_bash "systemctl is-active sjpeelavond; systemctl status sjpeelavond --no-pager -l | tail -20" >&2 || true
  binnen_bash "ss -ltnpH 'sport = :$POORT' || echo 'niets luistert op $POORT'" >&2 || true
  binnen_bash "journalctl -u sjpeelavond -n 25 --no-pager" >&2 || true
  die "Inrichten afgebroken: de dienst start niet."
fi

if ! binnen_bash "ss -ltnpH 'sport = :$POORT' | grep -q node"; then
  warn "Poort $POORT antwoordt wel, maar niet door node. Wat luistert er:"
  binnen_bash "ss -ltnpH 'sport = :$POORT'" >&2 || true
  die "Een andere dienst bezet poort $POORT."
fi

TOTALEN="$(binnen_bash "curl -fsS http://127.0.0.1:$POORT/api/versie" 2>/dev/null | tr ',' '\n' | grep -m1 'samen' || true)"
log "   app antwoordt${TOTALEN:+ (nummers samen:$TOTALEN)}"

IP="$(pct exec "$CTID" -- hostname -I 2>/dev/null | awk '{print $1}')"
IP="${IP:-<ip-van-de-container>}"
printf '\n\033[1;32mSjpeelavond draait.\033[0m\n'
printf '  Open op je telefoon of laptop:  http://%s/\n' "$IP"
printf '  Beheerderswachtwoord:           %s\n' "$WACHTWOORD"
printf '  (wachtwoord staat ook in de container in %s)\n' "$ENV_BESTAND"
printf '  Gegevens:                       %s (database: %s)\n' "$DATA_DIR" "$DB_PAD"
printf '  Dienst:                         systemctl status sjpeelavond\n'
printf '  Log:                            journalctl -u sjpeelavond -f\n'
printf '\n  Bijwerken naar de nieuwste versie:\n'
printf '    bash -c "$(curl -fsSL https://raw.githubusercontent.com/%s/%s/deploy/proxmox/update-from-github.sh)" %s\n' "$REPO" "$TAK" "$CTID"
printf '  Controleren:\n'
printf '    bash -c "$(curl -fsSL https://raw.githubusercontent.com/%s/%s/deploy/proxmox/check-sjpeelavond.sh)" %s\n' "$REPO" "$TAK" "$CTID"
