#!/usr/bin/env python3
"""Controleer of de APK echt bevat wat de app nodig heeft.

Gebruik: python3 scripts/check-apk.py <apk>

Kijkt in de pakketinhoud zelf, niet in de werkmap: de webapp-bundel (pagina, scripts,
muziekdatabase) en de klassen van de schil moeten er allemaal in zitten, en de
database moet gevuld zijn. Een bundel die niet is meegekomen valt hier om, en niet
pas op het toestel.
"""

import json
import pathlib
import sys
import zipfile

VERPLICHT = [
    "assets/index.html",
    "assets/js/app.js",
    "assets/js/spel.js",
    "assets/js/lokaal.js",
    "assets/data/index.json",
    "assets/data/nummers-hits.json",
    "assets/data/nummers-limburg.json",
    "classes.dex",
    "AndroidManifest.xml",
    "resources.arsc",
]

KLASSEN = [
    b"Lnl/werdens/sjpeelavond/MainActivity;",
    b"Lnl/werdens/sjpeelavond/Buiten;",
    b"Lnl/werdens/sjpeelavond/Schermen;",
]

MIN_NUMMERS = 100


def main() -> int:
    if len(sys.argv) < 2:
        print("gebruik: check-apk.py <apk>", file=sys.stderr)
        return 2
    apk = pathlib.Path(sys.argv[1])
    if not apk.exists():
        print(f"{apk} bestaat niet", file=sys.stderr)
        return 2

    fouten = []
    with zipfile.ZipFile(apk) as pakket:
        namen = set(pakket.namelist())
        print(f"--- {apk.name} ({apk.stat().st_size} bytes, {len(namen)} onderdelen) ---")

        for naam in VERPLICHT:
            if naam not in namen:
                fouten.append(f"{naam} ontbreekt in de APK")
                continue
            grootte = pakket.getinfo(naam).file_size
            if grootte == 0:
                fouten.append(f"{naam} is leeg")
            print(f"  {naam:34s} {grootte:>9d} bytes")

        for bestand in ("assets/data/nummers-hits.json", "assets/data/nummers-limburg.json"):
            if bestand not in namen:
                continue
            inhoud = json.loads(pakket.read(bestand).decode("utf-8"))
            aantal = len(inhoud.get("nummers") or [])
            if aantal < MIN_NUMMERS:
                fouten.append(f"{bestand} heeft maar {aantal} nummers")
            else:
                print(f"  {bestand}: {aantal} nummers")

        dex = b""
        for naam in sorted(n for n in namen if n.startswith("classes") and n.endswith(".dex")):
            dex += pakket.read(naam)
            print(f"  {naam}: {pakket.getinfo(naam).file_size} bytes")
        for klasse in KLASSEN:
            if klasse not in dex:
                fouten.append(f"klasse {klasse.decode()} zit niet in de dex")

    for fout in fouten:
        print(f"  ! {fout}", file=sys.stderr)
    if fouten:
        print(f"APK onvolledig: {len(fouten)} fout(en).", file=sys.stderr)
        return 1
    print("APK compleet: bundel, database en klassen allemaal aanwezig.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
