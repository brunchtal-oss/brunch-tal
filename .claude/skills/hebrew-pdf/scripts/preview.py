"""Render PDF pages to PNG so they can be looked at with the Read tool.

Usage: python preview.py <file.pdf> <out_dir> [--scale 1.4]
Needs pypdfium2. Install it into a throwaway folder and point PYTHONPATH at it:
  python -m pip install --target <scratchpad>/pylib pypdfium2
  PYTHONPATH=<scratchpad>/pylib python preview.py ...
"""

import os
import sys

import pypdfium2 as pdfium


def main() -> None:
    args = sys.argv[1:]
    scale = 1.4
    if "--scale" in args:
        i = args.index("--scale")
        scale = float(args[i + 1])
        del args[i : i + 2]
    if len(args) != 2:
        print(__doc__)
        sys.exit(2)
    pdf_path, out_dir = args
    os.makedirs(out_dir, exist_ok=True)
    pdf = pdfium.PdfDocument(pdf_path)
    for n in range(len(pdf)):
        image = pdf[n].render(scale=scale).to_pil()
        path = os.path.join(out_dir, f"page-{n + 1:02d}.png")
        image.save(path)
        print(path)


if __name__ == "__main__":
    main()
