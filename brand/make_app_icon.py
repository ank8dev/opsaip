"""Build the macOS app icon from brand/opsaip-logo-source.png.

    pip install pillow numpy
    python3 make_app_icon.py

Steps (each one is a plain function below):
  1. Fit a circle to the ball and cut the black background (alpha = disc).
  2. Clean the colored fringes around the dark "i" (chromatic aberration in
     the render): rebuild the edge as a mix of local lime and the glyph color.
  3. Put the ball on a graphite squircle tile, 824x824 on a 1024x1024
     transparent canvas (macOS icon grid), with a soft shadow below.
Output: png/app-icon/app-icon-1024.png
"""
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).parent
SRC = ROOT / "opsaip-logo-source.png"
OUT = ROOT / "png" / "app-icon" / "app-icon-1024.png"

CANVAS = 1024
TILE = 824                 # macOS icon grid: artwork 824 in a 1024 canvas
BALL = 640                 # ball diameter inside the tile
SQUIRCLE_N = 5.0           # superellipse exponent, close to the macOS shape
SS = 4                     # supersampling for smooth edges
GRAPHITE = json.loads((ROOT / "tokens.json").read_text())["colors"]["dark"]["surface"]


def hex_rgb(h):
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], dtype=np.float32)


def fit_circle(rgb):
    """Least-squares circle through the outer boundary of the lit pixels."""
    lit = rgb.max(axis=2) > 90
    ys, xs = np.nonzero(lit)
    cx0, cy0 = xs.mean(), ys.mean()
    ang = np.arctan2(ys - cy0, xs - cx0)
    dist = np.hypot(xs - cx0, ys - cy0)
    bins = np.linspace(-np.pi, np.pi, 361)
    idx = np.digitize(ang, bins)
    pts = []
    for b in range(1, len(bins)):
        sel = idx == b
        if sel.any():
            k = np.argmax(np.where(sel, dist, -1))
            pts.append((xs[k], ys[k]))
    p = np.array(pts, dtype=np.float64)
    A = np.c_[2 * p[:, 0], 2 * p[:, 1], np.ones(len(p))]
    b = (p ** 2).sum(axis=1)
    cx, cy, c = np.linalg.lstsq(A, b, rcond=None)[0]
    return cx, cy, float(np.sqrt(c + cx ** 2 + cy ** 2))


def disc_alpha(h, w, cx, cy, r):
    """Anti-aliased disc, 1 inside, 0 outside, 1px soft edge."""
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    d = np.hypot(xx + 0.5 - cx, yy + 0.5 - cy)
    return np.clip(r - d + 0.5, 0, 1)


def blur(a, sigma):
    """Gaussian blur of a float 2D array (separable convolution, edge-padded)."""
    k = int(np.ceil(sigma * 3))
    x = np.arange(-k, k + 1, dtype=np.float32)
    g = np.exp(-x ** 2 / (2 * sigma ** 2))
    g /= g.sum()
    p = np.pad(a, k, mode="edge")
    p = np.apply_along_axis(lambda r: np.convolve(r, g, mode="valid"), 1, p)
    return np.apply_along_axis(lambda c: np.convolve(c, g, mode="valid"), 0, p)


def nconv(img, weight, radius):
    """Normalized convolution: blur only where weight > 0, then fill."""
    num = np.stack([blur(img[..., c] * weight, radius) for c in range(3)], axis=2)
    den = blur(weight, radius)[..., None]
    return num / np.maximum(den, 1e-4), den[..., 0]


def clean_fringes(rgb, inside, safe):
    """Rebuild the edge of the dark glyph without the colored fringes."""
    G = rgb[..., 1]
    dark = (G < 70) & (inside > 0.99)
    dark_img = Image.fromarray((dark * 255).astype(np.uint8))
    core = np.asarray(dark_img.filter(ImageFilter.MinFilter(5))) > 0      # sure glyph
    grow = np.asarray(dark_img.filter(ImageFilter.MaxFilter(11))) > 0     # glyph + edge band
    far = ~grow & (inside > 0.99)                                         # sure lime
    lime, _ = nconv(rgb, far.astype(np.float32), 6)
    ink, _ = nconv(rgb, core.astype(np.float32), 6)
    # Matte from the green channel: it carries the cleanest dark/lime transition.
    g_lime = lime[..., 1]
    g_ink = ink[..., 1]
    m = np.clip((g_lime - G) / np.maximum(g_lime - g_ink, 1.0), 0, 1)
    rebuilt = lime * (1 - m[..., None]) + ink * m[..., None]
    # Only well inside the disc (`safe`): near the rim the stem foot has a bluish
    # glass glow that is neither lime nor ink, so the matte would be wrong there.
    band = (grow & ~core & (safe > 0.99)).astype(np.float32)
    band = blur(band, 1.0)[..., None]
    out = rgb * (1 - band) + rebuilt * band
    return out


def clean_rim_foot(rgb, cx, cy, r):
    """Pull the orange/purple rim line under the stem foot back to lime.

    Only the region where the stem meets the rim (lower left); the pale rim
    highlight elsewhere is part of the glass look and stays as it is.
    """
    h, w, _ = rgb.shape
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    d = np.hypot(xx + 0.5 - cx, yy + 0.5 - cy) - r
    zone = ((d > -10) & (yy > 820) & (xx < 430) & (rgb[..., 1] > 100)).astype(np.float32)
    zone = blur(zone, 1.0)[..., None]
    fixed = rgb.copy()
    fixed[..., 0] = np.minimum(rgb[..., 0], rgb[..., 1])        # no red above green
    fixed[..., 2] = np.minimum(rgb[..., 2], rgb[..., 1] * 0.4)  # no blue/purple cast
    return rgb * (1 - zone) + fixed * zone


def squircle_mask(size, n):
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
    c = (size - 1) / 2
    u = np.abs(xx - c) / (size / 2)
    v = np.abs(yy - c) / (size / 2)
    inside = u ** n + v ** n
    # distance-ish soft edge: 1 inside, falls to 0 over ~1.5 px at final scale
    edge = (1 - inside ** (1 / n)) * (size / 2)
    return np.clip(edge + 0.5, 0, 1)


def main():
    src = Image.open(SRC).convert("RGB")
    rgb = np.asarray(src, dtype=np.float32)
    h, w, _ = rgb.shape
    cx, cy, r = fit_circle(rgb)
    print(f"ball circle: center ({cx:.1f}, {cy:.1f}) radius {r:.1f}")

    # Step 1: remove the black background. Shrink 1 px so no black rim stays.
    a = disc_alpha(h, w, cx, cy, r - 1.0)
    # Step 2: clean the fringes around the glyph.
    rgb = clean_fringes(rgb, disc_alpha(h, w, cx, cy, r - 6), disc_alpha(h, w, cx, cy, r - 60))
    rgb = clean_rim_foot(rgb, cx, cy, r)
    ball = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8)).convert("RGBA")
    ball.putalpha(Image.fromarray((a * 255).astype(np.uint8)))
    # crop the square around the disc, resize to BALL (supersampled)
    r_eff = r - 1.0
    box = (cx - r_eff, cy - r_eff, cx + r_eff, cy + r_eff)
    ball = ball.crop(tuple(int(round(v)) for v in box)).resize(
        (BALL * SS, BALL * SS), Image.LANCZOS)

    # Step 3: tile, ball, shadow on the 1024 canvas (supersampled, then reduced).
    S = CANVAS * SS
    canvas = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    tile_px = TILE * SS
    m = squircle_mask(tile_px, SQUIRCLE_N)
    t = Image.new("RGBA", (tile_px, tile_px), tuple(int(v) for v in hex_rgb(GRAPHITE)) + (255,))
    t.putalpha(Image.fromarray((m * 255).astype(np.uint8)))
    off = (S - tile_px) // 2

    # soft shadow: tile shape, blurred, shifted down
    sh = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    sh_a = Image.new("L", (S, S), 0)
    sh_a.paste(Image.fromarray((m * 255).astype(np.uint8)), (off, off + 10 * SS))
    sh_a = sh_a.filter(ImageFilter.GaussianBlur(14 * SS)).point(lambda v: int(v * 0.5))
    sh.putalpha(sh_a)
    canvas = Image.alpha_composite(canvas, sh)
    canvas.alpha_composite(t, (off, off))
    canvas.alpha_composite(ball, ((S - BALL * SS) // 2, (S - BALL * SS) // 2))

    OUT.parent.mkdir(parents=True, exist_ok=True)
    canvas.resize((CANVAS, CANVAS), Image.LANCZOS).save(OUT, optimize=True)
    print("wrote", OUT)


if __name__ == "__main__":
    main()
