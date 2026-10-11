# Opsaip Display (v0.1)

The brand display font, drawn from the logo letters. Every glyph is built from the
logo's parts — horizontal ovals, straight stems, the slanted baton and the round dot —
with flat ends and corners softened by ¼ of the stroke. Typing `opsaip` gives the logo.

**Use it for:** brand headlines, the landing page, social images — set in lowercase, 32px and up.
**Not for:** UI text, paragraphs or small sizes. The interface uses Instrument Sans and DM Mono.

## What is inside

- lowercase a–z
- figures 0–9
- `. , : ; ! ? - _ ' " / ( ) ·` and space
- **ss01**: `i` → the baton i from the logo (`font-feature-settings: "ss01"`)
- no uppercase yet

## Files

| file | use |
|---|---|
| `OpsaipDisplay-Regular.otf` | install on macOS (double-click → Install), Figma, design apps |
| `OpsaipDisplay-Regular.ttf` | same, for apps that prefer TrueType |
| `OpsaipDisplay-Regular.woff2` | websites |
| `specimen.png`, `compare.png` | the alphabet, and the font next to the logo |
| `build_font.py`, `specimen.py` | the source |

## Use on the web

```css
@font-face {
  font-family: "Opsaip Display";
  src: url("/fonts/OpsaipDisplay-Regular.woff2") format("woff2");
  font-weight: 500;
  font-display: swap;
}
.brand-heading { font-family: "Opsaip Display", "Instrument Sans", sans-serif; text-transform: lowercase; }
.brand-heading.baton { font-feature-settings: "ss01"; }  /* opsa/p */
```

## Rebuild

The font is generated from `../tokens.json` (stroke, dot, oval size, corner radius, tracking).
Change a token, then:

```
pip install fonttools skia-pathops brotli pillow cairosvg
python3 build_font.py     # -> .otf .ttf .woff2
python3 specimen.py       # -> specimen.png, compare.png
```

## Known weak spots / next steps

- No uppercase, no accented letters, no `@ # & %`.
- No kerning table yet; spacing is even (a gap of half a stroke between every pair), which is tight for pairs like `ll` and loose for `rv`.
- `k`, `w` and `2` are the least refined shapes.
