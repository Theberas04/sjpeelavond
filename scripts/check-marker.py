"""Controleer dat een marker in de opgevangen logcat staat.

Gebruik: python3 scripts/check_marker.py <logcat.txt> <marker>

De emulatorrooktest wacht op een regel die de app zelf logt voordat er een
schermafbeelding wordt gemaakt. Dit script maakt van dat wachten een echte
controle: ontbreekt de marker, dan faalt de bouw en staat de logcat al als
artefact klaar, zodat de oorzaak zichtbaar is in plaats van een kale timeout.
"""

import pathlib
import sys

path = pathlib.Path(sys.argv[1])
marker = sys.argv[2]
text = path.read_text(errors="replace")
if marker in text:
    print(f"{path.name}: marker {marker!r} gevonden")
    raise SystemExit(0)
tail = "\n".join(text.splitlines()[-15:])
raise SystemExit(f"{path.name}: marker {marker!r} ontbreekt; laatste logcat-regels:\n{tail}")
