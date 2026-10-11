"""Export every logo SVG to PNG in several sizes (transparent background).

Run after `node build.mjs`:
    pip install cairosvg
    python3 export_png.py
"""
from pathlib import Path
import cairosvg

ROOT = Path(__file__).parent
SVG = ROOT / "logo"
PNG = ROOT / "png"

# Wide logos: width in px. Symbol: square sizes (favicon, avatars, app icons).
WIDE = [256, 512, 1024, 2048]
SQUARE = [16, 32, 48, 64, 128, 180, 256, 512, 1024]

for svg in sorted(SVG.glob("*.svg")):
    name = svg.stem
    sizes = SQUARE if name.startswith("symbol") else WIDE
    out = PNG / name
    out.mkdir(parents=True, exist_ok=True)
    for w in sizes:
        cairosvg.svg2png(url=str(svg), write_to=str(out / f"{name}-{w}.png"), output_width=w)
    print(f"{name}: {len(sizes)} sizes")
