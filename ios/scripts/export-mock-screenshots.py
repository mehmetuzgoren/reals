#!/usr/bin/env python3
import base64
import hashlib
import json
import pathlib
import re
import sys

directory = pathlib.Path(sys.argv[1]).resolve()
screens = {}


def collect(value):
    if isinstance(value, list):
        for item in value:
            collect(item)
    elif isinstance(value, dict):
        strings = [item for item in value.values() if isinstance(item, str)]
        labels = [re.search(r"mocks-v2-screen-(0[1-8])(?:\b|_)", item) for item in strings]
        labels = [match.group(1) for match in labels if match]
        if labels:
            for item in strings:
                candidate = directory / pathlib.Path(item).name
                if candidate.suffix.lower() in (".png", ".jpg", ".jpeg") and candidate.is_file():
                    screens[labels[0]] = candidate
        for item in value.values():
            if isinstance(item, (list, dict)):
                collect(item)


for manifest in directory.glob("*.json"):
    collect(json.loads(manifest.read_text()))

if sorted(screens) != [f"{index:02}" for index in range(1, 9)]:
    raise SystemExit(f"Expected eight named demo screenshots; exported {sorted(screens)}")

for name, path in sorted(screens.items()):
    data = path.read_bytes()
    encoded = base64.b64encode(data).decode("ascii")
    print(f"REALS_MOCK_IMAGE {name} {path.suffix.lower()} {len(data)} {hashlib.sha256(data).hexdigest()}")
    for index, start in enumerate(range(0, len(encoded), 2000)):
        print(f"REALS_MOCK_DATA {name} {index:04} {encoded[start:start + 2000]}")
    print(f"REALS_MOCK_END {name}")
