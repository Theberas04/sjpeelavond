#!/usr/bin/env python3
"""Zelfcontrole van de hulpmiddelen van dit project.

De controles hieronder horen te kunnen falen; anders bewijzen ze niets. Dit script
laat elke controle met opzet op iets slechts los en eist dat hij dan omvalt — en
controleert daarnaast dat de schermnamen van de schil en van de pagina gelijk lopen,
want dat zijn twee lijsten die uit elkaar kunnen groeien.

    python3 scripts/zelfcontrole.py
"""

import ast
import pathlib
import re
import struct
import subprocess
import sys
import tempfile
import zlib

HIER = pathlib.Path(__file__).resolve().parent
ROOT = HIER.parent
fouten = []


def meld(goed: bool, uitleg: str) -> None:
    print(f"  {'ok ' if goed else 'FOUT'} {uitleg}")
    if not goed:
        fouten.append(uitleg)


def draai(*commando) -> int:
    return subprocess.run(commando, cwd=ROOT, capture_output=True, text=True).returncode


def vlak_png(pad: pathlib.Path, maat: int = 200) -> None:
    """Een PNG met één kleur: precies waar check-screenshot.py op hoort te zakken."""

    def blok(soort: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + soort + data + struct.pack(">I", zlib.crc32(soort + data) & 0xFFFFFFFF)

    rij = b"\x00" + b"\xff" * (maat * 3)
    png = (
        b"\x89PNG\r\n\x1a\n"
        + blok(b"IHDR", struct.pack(">IIBBBBB", maat, maat, 8, 2, 0, 0, 0))
        + blok(b"IDAT", zlib.compress(rij * maat))
        + blok(b"IEND", b"")
    )
    pad.write_bytes(png)


def schermnamen() -> None:
    """De lijst in Schermen.java en de namen in startVanAdres moeten gelijk zijn."""
    java = (ROOT / "android/app/src/main/java/nl/werdens/sjpeelavond/Schermen.java").read_text()
    js = (ROOT / "public/js/app.js").read_text()

    blok = java[java.index("TOEGESTAAN"):]
    van_schil = set(re.findall(r'"([a-z0-9-]+)"', blok))

    begin = js.index("async function startVanAdres")
    eind = js.index("async function opstarten")
    deel = js[begin:eind]
    # De namen die de pagina als diepe link kent: de vergelijkingen met `naam` én de
    # sleutels van de tabel met spellensoorten (de waarden daarvan zijn geen links).
    van_pagina = set(re.findall(r"naam === '([a-z0-9-]+)'", deel))
    tabel = re.search(r"const soorten = \{([^}]*)\}", deel)
    if tabel:
        van_pagina |= set(re.findall(r"([a-z0-9-]+)\s*:", tabel.group(1)))
    van_pagina |= set(re.findall(r"'([a-z0-9-]+)'\s*:", tabel.group(1) if tabel else ""))

    meld(van_schil == van_pagina, f"schermnamen gelijk: schil {sorted(van_schil)} tegenover pagina {sorted(van_pagina)}")
    if van_schil != van_pagina:
        meld(False, f"alleen in de schil: {sorted(van_schil - van_pagina)}; alleen in de pagina: {sorted(van_pagina - van_schil)}")


def main() -> int:
    print("--- scripts parsen ---")
    onparseerbaar = []
    for bestand in list((ROOT / "scripts").glob("*.py")) + list((ROOT / "tools").glob("*.py")):
        try:
            ast.parse(bestand.read_text(), filename=str(bestand))
        except SyntaxError as fout:
            onparseerbaar.append(f"{bestand.name}: {fout}")
    meld(not onparseerbaar, f"{len(list((ROOT / 'scripts').glob('*.py')))} hulpscripts parsen" + (f" ({onparseerbaar})" if onparseerbaar else ""))

    print("--- check-apk.py keurt iets dat geen APK is af ---")
    meld(draai(sys.executable, "scripts/check-apk.py", "README.md") != 0, "check-apk.py zakt op README.md")

    print("--- check-screenshot.py keurt een leeg vlak af ---")
    with tempfile.TemporaryDirectory() as map_:
        leeg = pathlib.Path(map_) / "vlak.png"
        vlak_png(leeg)
        meld(draai(sys.executable, "scripts/check-screenshot.py", str(leeg)) != 0, "check-screenshot.py zakt op een vlak beeld")

    print("--- de schermnamen van de schil en van de pagina ---")
    schermnamen()

    print("--- de bundel is compleet (--check) ---")
    meld(draai("node", "scripts/sync-assets.mjs", "--check") == 0, "sync-assets.mjs --check is groen")

    if fouten:
        print(f"\nZelfcontrole gezakt: {len(fouten)} punt(en).", file=sys.stderr)
        return 1
    print("\nZelfcontrole groen.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
