# Sjpeelavond op Proxmox

Alles wat je nodig hebt om de app in een LXC-container op je Proxmox-host te zetten,
bij te werken en te controleren. Eén opdracht op de host, geen nginx ertussen.

## Installeren

Op de Proxmox-host zelf, als root:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/Theberas04/sjpeelavond/main/deploy/proxmox/install.sh)"
```

De installer doet drie dingen:

1. **`install.sh`** haalt de kit als tarball op via `codeload.github.com` naar de vaste
   map `/opt/sjpeelavond-kit`, controleert dat de app, de pagina en de dataset er zijn en
   draait daarna `create-sjpeelavond-lxc.sh`. De kit blijft staan, zodat de controle- en
   bijwerkscripts daarna bij de hand zijn. Zet `KIT_DIR` voor een andere map, of `TAK`
   voor een andere branch.
2. **`create-sjpeelavond-lxc.sh`** maakt een unprivileged Debian-container (standaard
   2 cores, 1 GB, 8 GB schijf, DHCP op `vmbr0`) en print het adres. Hij zoekt zelf een
   vrije container-id (vanaf `CTID_VANAF`, standaard 100), een opslag die een
   containerschijf aankan (`OPSLAG`, en anders de eerste beschrijfbare opslag met
   `rootdir`) en een opslag die sjablonen aankan (`SJABLOON_OPSLAG`) — dat zijn vaak twee
   verschillende opslagen. De sjabloonkeuze let op de architectuur van de host
   (amd64/arm64), anders pakt `sort -V` de verkeerde. Bestaat de bridge niet, dan noemt
   hij de bridges die er wel zijn. Start de container niet, dan volgt `pct start --debug`
   met de volledige oorzaak.
3. **`provision-sjpeelavond.sh`** installeert Node 22, stuurt de app, de pagina en de
   dataset mee naar de container, zet de gegevens in `/var/lib/sjpeelavond`, genereert een
   beheerderswachtwoord en zet de systemd-dienst `sjpeelavond` op. Node komt eerst uit de
   NodeSource-repo en anders uit de officiële `nodejs.org`-tarball.

Aan het eind print het script het adres (`http://<ip>/`) en het beheerderswachtwoord.

Instellingen die je kunt meegeven: `CTID`, `CTID_VANAF`, `HOSTNAME_APP`, `CORES`, `MEM`,
`SWAP`, `SCHIJF_GB`, `BRIDGE`, `OPSLAG`, `SJABLOON_OPSLAG`, `DEBIAN_MAJOR`, `ARCH`,
`GEBRUIKER`, `POORT`, `SJPEELAVOND_WACHTWOORD`. Voorbeeld:

```bash
CTID=225 MEM=2048 SJPEELAVOND_WACHTWOORD=mijnwachtwoord \
  bash -c "$(curl -fsSL https://raw.githubusercontent.com/Theberas04/sjpeelavond/main/deploy/proxmox/install.sh)"
```

### Proefdraaien zonder Proxmox

`install.sh` haalt de kit ook op zonder Proxmox-gereedschap (handig om de bestandslijst en
de compleetheid te testen):

```bash
FETCH_ONLY=1 bash -c "$(curl -fsSL https://raw.githubusercontent.com/Theberas04/sjpeelavond/main/deploy/proxmox/install.sh)"
```

Met een lokale checkout, zonder GitHub:

```bash
cd /tmp && git clone https://github.com/Theberas04/sjpeelavond
FETCH_ONLY=1 KIT_DIR=/tmp/sjpeelavond-kit bash /tmp/sjpeelavond/deploy/proxmox/install.sh
SRC=/tmp/sjpeelavond bash /tmp/sjpeelavond/deploy/proxmox/create-sjpeelavond-lxc.sh
```

## Bijwerken

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/Theberas04/sjpeelavond/main/deploy/proxmox/update-from-github.sh)" <CTID>
```

Het container-id mag op drie manieren mee: als eerste argument (`bash script.sh 106`), via
de omgeving (`CTID=106 …`) en als `bash -c "$(curl …)" 106` — die laatste zet het nummer in
`$0`, niet in `$1`, en dat vangen de scripts af.

De updater haalt de tarball van `codeload.github.com`, pakt hem uit op de host, maakt in de
container een reservekopie (`/opt/sjpeelavond.bak`), schuift de nieuwe bestanden erin en
herstart de dienst. Daarna controleert hij de `/healthz`-marker, of de geserveerde pagina
byte voor byte gelijk is aan het bestand in de container en of `/api/versie` de app naam
noemt. Mislukt de controle, dan gaat de reservekopie terug en draait de oude versie weer; de
niet-werkende bestanden blijven staan in `/opt/sjpeelavond.stuk`.

De database (`SJPEELAVOND_DB`) en je eigen uploads (`SJPEELAVOND_MEDIA`) worden nooit
aangeraakt; de dataset wordt wel verversd.

## Controleren

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/Theberas04/sjpeelavond/main/deploy/proxmox/check-sjpeelavond.sh)" <CTID>
```

Alleen-lezen: containerstatus, netwerk, dienst, Node plus een `node:sqlite`-probe, wat er op
de poort luistert, geheugen, schijf, de bestanden, de dataset en de laatste journaalregels,
met onderaan per bevinding de letterlijke opdracht die het oplost.

## Wat de scripts bewust niet doen

- **Geen nginx.** De Node-dienst serveert zijn eigen pagina en bestanden en krijgt poort 80
  via `AmbientCapabilities=CAP_NET_BIND_SERVICE`, terwijl hij als gewone gebruiker
  (`sjpeelavond`) draait en niet als root. Een proxy die zelf `/healthz` antwoordt, verbergt
  een verkeerd webroot-pad: de controle slaagt terwijl de app onzichtbaar is.
- **Geen Docker.** Eén proces, één systemd-unit, één databasemap.
- **Geen afhankelijkheden in de app.** Alleen Node 22 (voor `node:sqlite`); de server leest
  de dataset uit platte JSON.

## Portaal van de bestanden

De scripts moeten het over dezelfde bestandslijsten eens zijn: een bestand dat de installer
wel ophaalt maar de updater niet naar de container stuurt, laat de dienst crashen met
`Cannot find module`. Daarom controleert de kit dit:

```bash
python3 scripts/check-deploy-file-lists.py            # elk pad in elke lijst bestaat in de repo
python3 scripts/check-deploy-file-lists.py --remote   # en geeft HTTP 200 op de ruwe URL
```

De kit-map is vast (`/opt/sjpeelavond-kit`), zodat de scripts na de installatie blijven
liggen en de update- en controlecommando's altijd dezelfde bestanden gebruiken.
