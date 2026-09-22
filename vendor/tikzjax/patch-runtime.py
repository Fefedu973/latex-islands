"""Apply the documented local changes to a pristine @rod2ik/tikzjax 1.6.0 worker.
Usage: python patch-runtime.py /path/to/pristine/dist/run-tex.js /path/to/output.js
"""
from pathlib import Path
import base64
import gzip
import hashlib
import json
import re
import sys
source = Path(sys.argv[1]).read_text(encoding='utf-8')
replacements = [
    ('catch{try{const t=await fetch(A);if(!t.ok)throw new Error(`Unable to load ${A}.`);{const e=await t.text();zr[A]=e}}catch{}}',
     'catch{/* Latex Islands: only packaged TeX files are permitted. */}'),
    ('return new URL(t,`${Pn}/`).href',
     'if(!/^(?:tex\\.wasm\\.gz|core\\.dump\\.gz|tex_files\\/[a-zA-Z0-9_.-]+\\.gz)$/.test(t)||t.includes(".."))throw new Error("Asset path rejected: "+t);return new URL(t,`${Pn}/`).href'),
    ('e.g=function(){if("object"==typeof globalThis)return globalThis;try{return this||new Function("return this")()}catch(A){if("object"==typeof window)return window}}()',
     'e.g=globalThis')
]
for old, new in replacements:
    if source.count(old) != 1:
        raise SystemExit('Expected exactly one upstream patch location: ' + old[:60])
    source = source.replace(old, new)

# The SVG converter embeds metrics and character encodings separately from the
# TeX filesystem. Add genuine, pinned Euler metrics and BaKoMa glyph mappings to
# those existing tables. No network or generic font-loading hook is introduced.
root = Path(__file__).resolve().parent
metadata = json.loads((root / 'source/euler-fonts.json').read_text(encoding='utf-8'))
expected = {family + str(size) for family in ('eufm', 'eufb') for size in (5, 7, 10)}
if metadata.get('format') != 1 or set(metadata['fonts']) != expected:
    raise SystemExit('Unexpected supplemental Euler font metadata')
metrics, encodings = {}, {}
for name, entry in metadata['fonts'].items():
    tfm = gzip.decompress((root / 'tex_files' / (name + '.tfm.gz')).read_bytes())
    woff = (root / 'fonts' / (name + '.woff2')).read_bytes()
    if hashlib.sha256(tfm).hexdigest() != entry['tfmSha256'] or hashlib.sha256(woff).hexdigest() != entry['woff2Sha256']:
        raise SystemExit('Supplemental font hash mismatch: ' + name)
    if not entry['encoding'] or any(not key.isdigit() or not 0 <= int(key) <= 255 or not isinstance(value, int) or not 0 <= value <= 0x10FFFF for key, value in entry['encoding'].items()):
        raise SystemExit('Invalid Euler glyph mapping: ' + name)
    metrics[name] = base64.b64encode(tfm).decode('ascii')
    encodings[name] = entry['encoding']

for variable, additions in [('aA', metrics), ('fA', encodings)]:
    pattern = re.compile(r"const " + variable + r"=JSON\.parse\('([^']*)'\);")
    matches = list(pattern.finditer(source))
    if len(matches) != 1:
        raise SystemExit('Expected one upstream font table: ' + variable)
    match = matches[0]
    table = json.loads(match.group(1))
    if any(name in table for name in additions):
        raise SystemExit('Supplemental font already exists upstream')
    table.update(additions)
    replacement = 'const ' + variable + "=JSON.parse('" + json.dumps(table, separators=(',', ':')) + "');"
    source = source[:match.start()] + replacement + source[match.end():]

# TeX's ec (largest character code) is inclusive. Upstream incorrectly omitted
# that last glyph; Euler's alternate digit one occupies this valid final slot.
old = 'A<this.largest_character_code;++A)this.process_char(A)'
new = 'A<=this.largest_character_code;++A)this.process_char(A)'
if source.count(old) != 1:
    raise SystemExit('Expected one upstream TFM character boundary')
source = source.replace(old, new)
Path(sys.argv[2]).write_text(source, encoding='utf-8', newline='\n')
