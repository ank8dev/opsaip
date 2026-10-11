# Opsaip brand

Everything here is built from two components: **the letters** and **the baton**.
Never draw a logo by hand from scratch — change the components or tokens, then rebuild.

```
node build.mjs          # 1. components + tokens -> logo/*.svg
python3 export_png.py   # 2. logo/*.svg -> png/ in many sizes (needs: pip install cairosvg)
```

## Structure

```
brand/
  tokens.json        ← all numbers live here (stroke, dot, spacing, colors)
  build.mjs          ← turns components into logo files
  components/        ← single parts, for reference and Figma
    glyph-o/p/s/a/i.svg
    baton-letter.svg   short baton, used as the letter i
    baton-symbol.svg   long baton, used as the standalone symbol
  logo/              ← finished files (generated — do not edit by hand)
    wordmark-baton-*   opsa/p — baton replaces the i (signature version)
    wordmark-*         opsaip — classic i
    lockup-*           long baton + opsaip
    symbol-*           baton alone, square (avatar, favicon, app icon)
  font/              ← Opsaip Display font (otf, ttf, woff2) + its generator
  png/               ← PNG exports, transparent background (generated)
    <logo-name>/<logo-name>-<width>.png
    wide logos: 256, 512, 1024, 2048 px wide
    symbol:     16, 32, 48, 64, 128, 180, 256, 512, 1024 px square
  export_png.py      ← makes png/ from logo/
  preview.png
```

`-on-light` = dark ink, for light backgrounds. `-on-dark` = light ink, for dark backgrounds.

## The rules

- **One stroke for everything:** 10 units. Letters and baton always share it.
- **Flat ends** (`"terminals": "flat"`): stroke ends are cut straight, like ChatGPT's wordmark.
  Set `"round"` in tokens.json to get the earlier soft version back.
- **Softened corners:** `cornerRadius` 2.5 = ¼ of the stroke. Corners are slightly rounded,
  not sharp and not a half-circle. Applies to stems, the baton and the ends of the s.
- **One dot:** radius 7. It is the only round "accent" — the baton dot and the dot of the classic i are the same dot.
- **One angle:** the baton always leans the same way (dx 19, dy −29). Only its length changes.
  With flat ends it is cut horizontally, flush with the letters' baseline.
- **Letters are horizontal ovals:** bowl 52 × 40 (rx 26, ry 20). The `a` is single-storey.
- **Tracking 15** → visible gap between letters = half a stroke (ChatGPT ≈ 0.6 stroke).
  The baton letter gets extra air: +10 before, +8 after.
- **Restraint:** the baton is the only playful element. Do not add other tricks to the letters.
- **Colors — Neutral graphite + lime** (full palette in `tokens.json` → `colors`):
  - dark theme: bg `#0B0B0B` · surface `#141414` · raised `#1C1C1C` · border `#2A2A2A` · muted `#8A8A8A` · secondary `#A3A3A3` · text `#EDEDED`
  - light theme: bg `#FAFAFA` · surface `#FFFFFF` · raised `#F2F2F2` · border `#E3E3E3` · muted `#6B6B6B` · secondary `#525252` · text `#111111`
  - accent: lime `#C8F03C` (hover `#D4F55A`, pressed `#B5E01F`, text on lime `#0B0B0B`); error `#FF5A4E` dark / `#C4302A` light; control outlines `#6B6B6B` dark / `#8A8A8A` light
  - **Lime rule:** on dark — the dot, main button, "live" status. On light — only as a fill with dark text
    (lime on light bg is 1.2:1 contrast, invisible). So on light logos the dot is ink.
  - Status = shape and motion of the dot (pulsing = working, solid = done, hollow = waiting), not extra colors. Only errors get a color.

## Design system

The full system (tokens, components, brand book) lives in the Opsaip Design System artifact. This folder is the source for the logo; keep colors in sync with it.

## Typography

- **UI:** Instrument Sans (400 / 500). Headings slightly tight: letter-spacing −0.01em.
- **Mono:** DM Mono — agent logs, code, IDs, timestamps.
- **Display:** Opsaip Display v0.1 — our own font for brand headlines, built from the logo letters (`font/`).
- Both UI fonts are free on Google Fonts (OFL license).

## Notes

- Files use strokes. In Figma, use *Outline stroke* before final export if a tool needs filled shapes.
- The `s` is the weakest glyph — refine it by hand first, then copy the new path into `build.mjs`.
- These are logo letters (a wordmark). The full Opsaip Display font is built separately in `font/`.
