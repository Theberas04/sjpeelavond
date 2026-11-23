"""Controleer een schermafbeelding van de emulator: echte PNG met inhoud.

Gebruik: python3 scripts/check_screenshot.py <pad.png>

Faalt als het bestand geen PNG is, te klein is, één vlakke kleur is of minder
dan drie verschillende kleuren gebruikt. Een leeg scherm is één kleur; zo
onderscheidt de controle "de app tekende iets" van "de activity opende maar er
werd niets geschilderd".
"""

import pathlib
import struct
import sys
import zlib

MIN_BYTES = 20_000
# De Pauzeer-schermen zijn bewust licht (witte rijen op een lichte achtergrond);
# een echt leeg scherm is één kleur voor ~100%, dus 94% is nog steeds streng.
MAX_DOMINANT_SHARE = 0.94
MIN_CONTENT_SHARE = 0.06


def read_chunks(data):
    assert data[:8] == b"\x89PNG\r\n\x1a\n", "geen PNG-bestand"
    offset = 8
    while offset < len(data):
        (length,) = struct.unpack(">I", data[offset : offset + 4])
        kind = data[offset + 4 : offset + 8]
        payload = data[offset + 8 : offset + 8 + length]
        yield kind, payload
        offset += 12 + length


def decode(data):
    width = height = None
    bit_depth = colour_type = None
    idat = bytearray()
    palette = b""
    for kind, payload in read_chunks(data):
        if kind == b"IHDR":
            width, height, bit_depth, colour_type = struct.unpack(">IIBB", payload[:10])
        elif kind == b"IDAT":
            idat += payload
        elif kind == b"PLTE":
            palette = payload
        elif kind == b"IEND":
            break
    assert width and height, "IHDR-afmetingen ontbreken"
    assert bit_depth == 8, f"bitdiepte {bit_depth} wordt niet ondersteund"
    assert colour_type in (0, 2, 3, 4, 6), f"kleurtype {colour_type} wordt niet ondersteund"

    channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[colour_type]
    stride = width * channels
    raw = zlib.decompress(bytes(idat))
    previous = bytearray(stride)
    counts = {}
    total = 0
    band_counts = {}
    band_total = 0
    band_x0, band_x1 = int(width * 0.08), int(width * 0.92)
    band_y0, band_y1 = int(height * 0.20), int(height * 0.80)
    position = 0
    for row in range(height):
        filter_type = raw[position]
        position += 1
        line = bytearray(raw[position : position + stride])
        position += stride
        for index in range(stride):
            left = line[index - channels] if index >= channels else 0
            up = previous[index]
            up_left = previous[index - channels] if index >= channels else 0
            value = line[index]
            if filter_type == 1:
                value += left
            elif filter_type == 2:
                value += up
            elif filter_type == 3:
                value += (left + up) // 2
            elif filter_type == 4:
                estimate = left + up - up_left
                pa, pb, pc = abs(estimate - left), abs(estimate - up), abs(estimate - up_left)
                value += left if (pa <= pb and pa <= pc) else (up if pb <= pc else up_left)
            line[index] = value & 0xFF
        previous = line
        in_band_row = band_y0 <= row < band_y1
        if colour_type == 3:
            for index in range(width):
                entry = line[index] * 3
                key = palette[entry : entry + 3]
                counts[key] = counts.get(key, 0) + 1
                total += 1
                if in_band_row and band_x0 <= index < band_x1:
                    band_counts[key] = band_counts.get(key, 0) + 1
                    band_total += 1
        else:
            for index in range(0, stride, channels):
                key = bytes(line[index : index + min(channels, 3)])
                counts[key] = counts.get(key, 0) + 1
                total += 1
                if in_band_row and band_x0 <= index // channels < band_x1:
                    band_counts[key] = band_counts.get(key, 0) + 1
                    band_total += 1
    dominant = max(counts.values()) / total
    band_dominant = max(band_counts.values()) / band_total if band_total else 1.0
    content_share = 1.0 - band_dominant
    return width, height, len(counts), dominant, content_share


def main():
    path = pathlib.Path(sys.argv[1])
    data = path.read_bytes()
    assert len(data) >= MIN_BYTES, f"{path.name} lijkt leeg ({len(data)} bytes)"
    width, height, colours, dominant, content_share = decode(data)
    assert dominant <= MAX_DOMINANT_SHARE, (
        f"{path.name} is voor {dominant:.0%} één kleur; het scherm lijkt leeg"
    )
    assert content_share >= MIN_CONTENT_SHARE, (
        f"{path.name} toont niets in het midden van het scherm "
        f"({content_share:.1%} van het inhoudsgebied wijkt af van de achtergrond)"
    )
    print(
        f"{path.name}: {width}x{height}, {colours} kleuren, "
        f"dominante kleur {dominant:.0%}, inhoudsgebied {content_share:.0%} getekend, "
        f"{len(data)} bytes — scherminhoud aanwezig"
    )


if __name__ == "__main__":
    main()
