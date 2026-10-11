"""Render specimen.png and compare.png with the compiled font."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import cairosvg, io

HERE = Path(__file__).parent
FONT = str(HERE / "OpsaipDisplay-Regular.otf")
BG, FG, MUTED, LIME = "#0B0B0B", "#EDEDED", "#8A8A8A", "#C8F03C"

def text(d, xy, s, size, fill=FG):
    d.text(xy, s, font=ImageFont.truetype(FONT, size), fill=fill)

W, H = 1600, 980
im = Image.new("RGB", (W, H), BG); d = ImageDraw.Draw(im)
y = 50
text(d, (60, y), "abcdefghijklm", 120); y += 170
text(d, (60, y), "nopqrstuvwxyz", 120); y += 190
text(d, (60, y), "0123456789  .,:;!?-_'\"/()·", 96); y += 160
text(d, (60, y), "opsaip", 96); y += 130
text(d, (60, y), "orchestrate your agents", 64); y += 95
text(d, (60, y), "fix login bug · 2 agents running", 48, MUTED)
im.save(HERE / "specimen.png")

# compare: the logo wordmark vs the word typed in the font
png = cairosvg.svg2png(url=str(HERE.parent / "logo" / "wordmark-on-dark.svg"), output_width=760)
logo = Image.open(io.BytesIO(png)).convert("RGBA")
c = Image.new("RGB", (900, 420), BG); dc = ImageDraw.Draw(c)
c.paste(logo, (60, 40), logo)
text(dc, (60, 230), "opsaip", 152)
c.save(HERE / "compare.png")
