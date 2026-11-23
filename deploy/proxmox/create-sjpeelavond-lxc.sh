#!/usr/bin/env bash
# Maakt de Sjpeelavond-LXC aan en richt hem in. Draait op de Proxmox-host, als root,
# meestal aangeroepen door install.sh (dat de kit al naar /opt/sjpeelavond-kit haalde).
# Los te draaien vanuit de kit:  bash create-sjpeelavond-lxc.sh
#
# Bij te sturen met env-variabelen:
#   CTID=225 CORES=2 MEM=1024 SCHIJF_GB=8 BRIDGE=vmbr0 POORT=80 bash create-sjpeelavond-lxc.sh
set -euo pipefail

KIT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HOSTNAME_APP="${HOSTNAME_APP:-sjpeelavond}"
CTID="${CTID:-}"
CTID_VANAF="${CTID_VANAF:-100}"
BRIDGE="${BRIDGE:-vmbr0}"
DEBIAN_MAJOR="${DEBIAN_MAJOR:-13}"
MEM="${MEM:-1024}"
CORES="${CORES:-2}"
SWAP="${SWAP:-512}"
SCHIJF_GB="${SCHIJF_GB:-8}"
OPSLAG="${OPSLAG:-}"
SJABLOON_OPSLAG="${SJABLOON_OPSLAG:-}"
POORT="${POORT:-80}"
ARCH="${ARCH:-$(dpkg --print-architecture 2>/dev/null || echo amd64)}"

log()  { printf '\033[1;36m==>\033[0m %s\n' "$*" >&2; }
warn() { printf '\033[1;33m[!]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[fout]\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Draai dit als root op de Proxmox-host."
command -v pct   >/dev/null || die "pct niet gevonden: dit is geen Proxmox VE-host."
command -v pveam >/dev/null || die "pveam niet gevonden."
[ -f "$KIT/deploy/proxmox/provision-sjpeelavond.sh" ] || die "$KIT/deploy/proxmox/provision-sjpeelavond.sh ontbreekt — draai dit vanuit de kit."
[ -f "$KIT/server.js" ] || die "$KIT/server.js ontbreekt — draai dit vanuit de kit."

# Templatekeuze per architectuur: de pveam-lijst bevat templates voor meerdere
# architecturen en zonder filter pakt 'sort -V | tail -1' de verkeerde.
case "$ARCH" in
  amd64) TEMPLATE_ARCH="amd64" ;;
  arm64) TEMPLATE_ARCH="arm64" ;;
  *) die "Onbekende architectuur '$ARCH'. Deze kit is er voor amd64 (Intel/AMD) en arm64." ;;
esac
log "Host: $ARCH"

# --- Opslag kiezen: lokaal eerst, en proeven of root er mag schrijven -----------
# Een NAS als opslag geeft 'Permission denied' (root_squash); dan mislukken het
# downloaden van de template en het maken van de schijf.
opslag_kandidaten() {
  pvesm status --content "$1" 2>/dev/null | awk 'NR>1 && $3=="active"{
      t=$2
      p = (t=="lvmthin" || t=="zfspool" || t=="btrfs") ? 1 : (t=="lvm" || t=="dir") ? 2 : 3
      printf "%d %019d %s\n", p, 999999999999999999-$6, $1
    }' | sort | awk '{print $3}'
}
opslag_pad() {
  local s="$1" t pad
  t="$(pvesm status 2>/dev/null | awk -v s="$s" 'NR>1 && $1==s{print $2}')"
  pad="$(awk -v s="$s" '$1 ~ /:$/ {naam=$2} naam==s && $1=="path" {print $2; exit}' \
    /etc/pve/storage.cfg 2>/dev/null)"
  if [ -z "$pad" ]; then
    case "$t" in nfs|cifs|glusterfs) pad="/mnt/pve/$s" ;; esac
  fi
  printf '%s' "$pad"
}
opslag_schrijfbaar() {
  local pad; pad="$(opslag_pad "$1")"
  [ -n "$pad" ] || return 0
  [ -d "$pad" ] || return 1
  local proef="$pad/.sjpeelavond-schrijfproef.$$"
  touch "$proef" 2>/dev/null || return 1
  rm -f "$proef"; return 0
}
kies_opslag() {
  local k
  for k in $(opslag_kandidaten "$1"); do
    if opslag_schrijfbaar "$k"; then printf '%s' "$k"; return 0; fi
    warn "Opslag '$k' is niet beschrijfbaar door root (bijvoorbeeld een NAS met root_squash); ik sla die over."
  done
  return 1
}

if [ -z "$OPSLAG" ]; then
  OPSLAG="$(kies_opslag rootdir)" || die "Geen beschrijfbare opslag gevonden voor de schijf.
Kijk zelf met: pvesm status --content rootdir
Wijs er een aan met: OPSLAG=<naam> ..."
fi
if [ -z "$SJABLOON_OPSLAG" ]; then
  SJABLOON_OPSLAG="$(kies_opslag vztmpl)" || SJABLOON_OPSLAG="local"
fi
log "Schijf op '$OPSLAG', template op '$SJABLOON_OPSLAG'"

# --- Bridge ---------------------------------------------------------------------
if ! ip link show "$BRIDGE" >/dev/null 2>&1; then
  warn "Bridge '$BRIDGE' bestaat niet op deze host. Beschikbaar:"
  ip -o link show | awk -F': ' '{print "    " $2}' | grep -E '^    vmbr' >&2 || true
  die "Kies een bestaande bridge met BRIDGE=vmbrX ..."
fi

# --- Vrije container-id zoeken --------------------------------------------------
if [ -z "$CTID" ]; then
  for i in $(seq "$CTID_VANAF" 999); do
    if ! pct status "$i" >/dev/null 2>&1; then CTID="$i"; break; fi
  done
fi
[ -n "$CTID" ] || die "Geen vrij container-id gevonden vanaf $CTID_VANAF."
pct status "$CTID" >/dev/null 2>&1 && die "Container $CTID bestaat al. Kies een andere CTID of verwijder hem eerst."

# --- Template -------------------------------------------------------------------
log "Debian $DEBIAN_MAJOR-template zoeken voor $TEMPLATE_ARCH"
TEMPLATE=""
for opslag in $(opslag_kandidaten vztmpl); do
  BESTAAND="$(pveam list "$opslag" 2>/dev/null | awk 'NR>1{print $1}' \
    | grep -E "debian-${DEBIAN_MAJOR}-standard_.*_${TEMPLATE_ARCH}\.tar" | sort -V | tail -1 || true)"
  if [ -n "$BESTAAND" ]; then
    TEMPLATE="$(basename "$BESTAAND")"
    SJABLOON_OPSLAG="$opslag"
    break
  fi
done
if [ -z "$TEMPLATE" ]; then
  log "Debian $DEBIAN_MAJOR voor $TEMPLATE_ARCH downloaden naar '$SJABLOON_OPSLAG'"
  pveam update >/dev/null 2>&1 || warn "pveam update mislukte; de lokale lijst wordt gebruikt."
  KEUZE="$(pveam available --section system 2>/dev/null | awk '{print $NF}' \
    | grep -E "^debian-${DEBIAN_MAJOR}-standard_.*_${TEMPLATE_ARCH}\.tar" | sort -V | tail -1 || true)"
  [ -n "$KEUZE" ] || die "Geen Debian-$DEBIAN_MAJOR-template gevonden voor $TEMPLATE_ARCH. Draai 'pveam update' en probeer opnieuw."
  pveam download "$SJABLOON_OPSLAG" "$KEUZE" >/dev/null || die "Template downloaden mislukte."
  TEMPLATE="$KEUZE"
fi
log "Template: $TEMPLATE"

# --- Container maken ------------------------------------------------------------
log "Container $CTID aanmaken ($CORES cores, ${MEM} MB, ${SCHIJF_GB} GB, bridge $BRIDGE)"
pct create "$CTID" "$SJABLOON_OPSLAG:vztmpl/$TEMPLATE" \
  --hostname "$HOSTNAME_APP" \
  --cores "$CORES" --memory "$MEM" --swap "$SWAP" \
  --rootfs "$OPSLAG:$SCHIJF_GB" \
  --net0 "name=eth0,bridge=$BRIDGE,ip=dhcp,type=veth" \
  --unprivileged 1 \
  --features nesting=1 \
  --onboot 1 >&2

# pct start met --debug als het misgaat: dan staat de echte oorzaak erbij in plaats
# van alleen 'start mislukt'.
if ! pct start "$CTID" >&2; then
  warn "Container $CTID startte niet. Dit is de volledige uitleg van de laatste poging:"
  pct start "$CTID" --debug 2>&1 | tail -25 | sed 's/^/    /' >&2 || true
  die "De container is aangemaakt maar draait niet. Weghalen kan met: pct destroy $CTID"
fi

log "Wachten tot de container netwerk heeft"
for i in $(seq 1 60); do
  if pct exec "$CTID" -- getent hosts deb.debian.org >/dev/null 2>&1; then break; fi
  [ "$i" -eq 60 ] && die "De container kreeg geen netwerk. Controleer bridge '$BRIDGE' en DNS."
  sleep 2
done

# --- Inrichten ------------------------------------------------------------------
log "Sjpeelavond inrichten in container $CTID"
SRC="$KIT" POORT="$POORT" bash "$KIT/deploy/proxmox/provision-sjpeelavond.sh" "$CTID"
