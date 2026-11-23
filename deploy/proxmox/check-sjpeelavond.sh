#!/usr/bin/env bash
# Alleen-lezen diagnose van een Sjpeelavond-container. Verandert niets.
# Draai op de Proxmox-host als root:
#
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/Theberas04/sjpeelavond/main/deploy/proxmox/check-sjpeelavond.sh)" <CTID>
#
# Het container-id mag ook via de omgeving (CTID=106 ...) of als $0 mee.
set -uo pipefail

case "${0:-}" in
  *[!0-9]*|"") KANDIDAAT0="" ;;
  *) KANDIDAAT0="$0" ;;
esac
CTID="${1:-${CTID:-$KANDIDAAT0}}"
APP_DIR="${APP_DIR:-/opt/sjpeelavond}"
DATA_DIR="${DATA_DIR:-/var/lib/sjpeelavond/data}"
MEDIA_DIR="${MEDIA_DIR:-/var/lib/sjpeelavond/media}"
POORT="${POORT:-80}"

if [ -z "$CTID" ]; then
  echo "Gebruik: bash check-sjpeelavond.sh <CTID>" >&2
  exit 2
fi

kop() { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }
binnen() { pct exec "$CTID" -- "$@" 2>&1; }
binnen_bash() { pct exec "$CTID" -- bash -c "$1" 2>&1; }

kop "Container $CTID op de host"
pct status "$CTID" 2>&1
pct config "$CTID" 2>&1 | grep -E '^(memory|cores|swap|rootfs|net0|onboot)' || true
if [ "$(pct status "$CTID" 2>/dev/null)" != "status: running" ]; then
  echo
  echo "De container draait niet. Start hem met: pct start $CTID"
  exit 0
fi

kop "Netwerk in de container"
binnen ip -4 -o addr show | sed 's/^/  /'
binnen ip route | sed 's/^/  /'
binnen_bash 'cat /etc/resolv.conf 2>/dev/null | grep -v "^#" | sed "s/^/  /"'

kop "Dienst"
binnen systemctl is-enabled sjpeelavond 2>&1
binnen systemctl is-active sjpeelavond 2>&1
binnen_bash 'systemctl status sjpeelavond --no-pager -l 2>&1 | tail -15'

kop "Node en de module node:sqlite"
binnen_bash 'command -v node; node --version 2>&1'
binnen_bash 'node -e "require(\"node:sqlite\"); console.log(\"node:sqlite werkt\")" 2>&1 | tail -3'

kop "Wat luistert er op poort $POORT"
binnen_bash "ss -ltnpH 'sport = :$POORT' 2>&1 || echo '  niets'"

kop "Geheugen en schijf"
binnen_bash 'free -m | sed "s/^/  /"'
binnen_bash 'df -h / | sed "s/^/  /"'

kop "Is de app te bereiken?"
binnen_bash "curl -sS --max-time 6 -o /dev/null -w '  in de container: HTTP %{http_code}\n' http://127.0.0.1:$POORT/healthz 2>&1 || echo '  in de container: mislukt'"
binnen_bash "curl -sS --max-time 6 -D - http://127.0.0.1:$POORT/healthz -o /dev/null 2>&1 | grep -i 'x-sjpeelavond' | sed 's/^/  /' || echo '  geen x-sjpeelavond-kop'"
binnen_bash "curl -sS --max-time 6 http://127.0.0.1:$POORT/api/versie 2>/dev/null | head -c 300 | sed 's/^/  /'"
IP="$(pct exec "$CTID" -- hostname -I 2>/dev/null | awk '{print $1}')"
if [ -n "$IP" ]; then
  printf '  adres: http://%s/\n' "$IP"
fi

kop "Bestanden en gegevens"
binnen_bash "ls -la $APP_DIR 2>&1 | head -15"
binnen_bash "ls -la $APP_DIR/public 2>&1 | head -15"
binnen_bash "ls -la $DATA_DIR 2>&1 | head -15"
binnen_bash 'ls -la /var/lib/sjpeelavond/ 2>&1 | head -15'

kop "Laatste regels uit het journaal"
binnen_bash 'journalctl -u sjpeelavond -n 25 --no-pager 2>&1'

kop "Wat nu?"
cat <<'HULP'
  - Draait de dienst niet?        pct exec <CTID> -- systemctl restart sjpeelavond
  - node:sqlite ontbreekt?        Zet Node 22 er weer op:
      pct exec <CTID> -- bash -c 'curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs'
  - Niets luistert op poort 80?   pct exec <CTID> -- systemctl status sjpeelavond
      let op de rechten: de dienst hoort AmbientCapabilities=CAP_NET_BIND_SERVICE te hebben.
  - Wachtwoord vergeten?          cat /etc/sjpeelavond.env in de container (alleen root leesbaar).
  - Bijwerken naar de nieuwste versie:
      bash -c "$(curl -fsSL https://raw.githubusercontent.com/Theberas04/sjpeelavond/main/deploy/proxmox/update-from-github.sh)" <CTID>
HULP
