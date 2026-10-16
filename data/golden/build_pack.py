"""Zip the Japanese sample pack for the Bills page.

    agent/.venv/bin/python data/golden/render.py --only pack   # first, to draw the bills
    agent/.venv/bin/python data/golden/build_pack.py           # writes web/public/sample-bills-japan.zip

The zip holds one folder, `sample-bills-japan/`, with every bill in `labels_pack.json` (the PDF where the pack
means it to be a PDF, otherwise the image) plus a README.txt saying what each file is there to show. The Bills
page opens the zip in the browser and sends only the bills, so the README is never uploaded.
"""

from __future__ import annotations

import json
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE.parents[1] / "web" / "public" / "sample-bills-japan.zip"
FOLDER = "sample-bills-japan"


def main() -> int:
    labels = json.loads((HERE / "labels_pack.json").read_text(encoding="utf-8"))
    rows: list[tuple[str, str]] = []
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
        for l in labels:
            src = HERE / "rendered" / (l["files"]["pdf"] if l.get("ship") == "pdf" else l["files"]["png"])
            arc = src.name.removeprefix("jpx_")
            z.write(src, f"{FOLDER}/{arc}")
            rows.append((arc, l.get("note", "")))
        readme = [
            "Sample bills: Takahashi Seimitsu, Kariya, Aichi (Japan). Fiscal year April 2025 to March 2026.",
            "",
            f"{len(rows)} files. Drop this zip on the Bills page as it is, or unzip and choose the files.",
            "Each file is here to show something the reader has to cope with:",
            "",
            *[f"  {name:48s} {note}" for name, note in rows],
            "",
            "Left out on purpose: electricity for January 2026. The check after reading asks about the gap.",
        ]
        z.writestr(f"{FOLDER}/README.txt", "\n".join(readme) + "\n")
    print(f"{len(rows)} bills -> {OUT} ({OUT.stat().st_size / 1e6:.1f} MB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
