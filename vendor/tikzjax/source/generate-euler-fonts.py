"""Generate deterministic Euler encoding metadata from pinned AFM and WOFF2.

Requires fonttools with Brotli support only when regenerating this file.
Usage: python generate-euler-fonts.py
The normal runtime patch/build uses the checked-in JSON and Python stdlib only.
"""
# SPDX-License-Identifier: GPL-3.0-or-later
from pathlib import Path
from hashlib import sha256
import gzip
import json
import re
import struct
import zipfile
from fontTools.ttLib import TTFont

root = Path(__file__).resolve().parents[1]
result = {
    "format": 1,
    "source": "AMSFonts 3.04 AFM encoding and bundled BaKoMa WOFF2 cmap",
    "archiveSha256": "dd763ca89b712d096e952ca43c3b60409bfca174f04c5743da68468d063fe7b6",
    "fonts": {},
}
archive = root / "extra-tex-source/amsfonts-3.04.tds.zip"
if sha256(archive.read_bytes()).hexdigest() != result["archiveSha256"]:
    raise ValueError("AMSFonts source archive hash mismatch")
ams = zipfile.ZipFile(archive)
for family in ("eufm", "eufb"):
    for size in (5, 7, 10):
        name = family + str(size)
        afm = ams.read("fonts/afm/public/amsfonts/euler/" + name + ".afm")
        slots = {int(code): glyph for code, glyph in re.findall(r"^C (-?\d+) ; .*? N (\S+) ;", afm.decode("ascii"), re.M) if int(code) >= 0}
        tfm = gzip.decompress((root / "tex_files" / (name + ".tfm.gz")).read_bytes())
        if tfm != ams.read("fonts/tfm/public/amsfonts/euler/" + name + ".tfm"):
            raise ValueError("Packaged TFM differs from pinned source: " + name)
        fontfile = root / "fonts" / (name + ".woff2")
        font = TTFont(fontfile)
        cmap = font.getBestCmap()
        lengths = struct.unpack(">12H", tfm[:24])
        header, first, last = lengths[1:4]
        encoding = {}
        for code in range(first, last + 1):
            # A zero width index means this TeX character slot is unassigned.
            if not tfm[24 + 4 * header + 4 * (code - first)]:
                continue
            glyph = slots[code]
            candidates = [unicode for unicode, actual in cmap.items() if actual == glyph]
            # WOFF2 post table version 3 discards custom glyph names. AFM records
            # their duplicate legacy BaKoMa slots, which survive in the PUA cmap.
            if not candidates:
                candidates = [0xF000 + alias for alias, actual in slots.items()
                              if actual == glyph and 0xF000 + alias in cmap]
            if not candidates:
                raise ValueError(f"No verified WOFF2 glyph for {name} slot {code} ({glyph})")
            encoding[str(code)] = max(candidates)
        result["fonts"][name] = {
            "tfmSha256": sha256(tfm).hexdigest(),
            "woff2Sha256": sha256(fontfile.read_bytes()).hexdigest(),
            "afmSha256": sha256(afm).hexdigest(),
            "encoding": encoding,
        }
        font.close()
ams.close()
target = root / "source/euler-fonts.json"
target.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8", newline="\n")
print("Wrote", target)
