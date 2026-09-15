"""Apply the documented local changes to a pristine @rod2ik/tikzjax 1.6.0 worker.
Usage: python patch-runtime.py /path/to/pristine/dist/run-tex.js /path/to/output.js
"""
from pathlib import Path
import sys
source = Path(sys.argv[1]).read_text()
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
Path(sys.argv[2]).write_text(source)
