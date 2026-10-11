"""Opsaip Display — builds the font from the same rules as the logo (../tokens.json).

Every letter is made of the logo's parts: horizontal ovals, straight stems,
the slanted baton and the round dot. Strokes are turned into filled outlines,
outer corners are softened by `cornerRadius`, then the font is written as
OTF (CFF), TTF and WOFF2.

Run:  pip install fonttools skia-pathops brotli pillow
      python3 build_font.py
"""
import json
import math
from pathlib import Path

import pathops
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.t2CharStringPen import T2CharStringPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.pens.cu2quPen import Cu2QuPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.reverseContourPen import ReverseContourPen
from fontTools.feaLib.builder import addOpenTypeFeaturesFromString
from fontTools.ttLib import TTFont

HERE = Path(__file__).parent
T = json.loads((HERE.parent / "tokens.json").read_text())

# ---------- design units (same as the logo) ----------
STROKE = T["stroke"]                 # 10
H = STROKE / 2                       # 5
CR = T["cornerRadius"]               # 2.5  softened corners
DOT = T["dotRadius"]                 # 7
RX = T["bowlWidth"] / 2              # 26   horizontal oval
XT, BL = T["metrics"]["xTop"], T["metrics"]["baseline"]   # 80, 120 (stroke centers)
MID = (XT + BL) / 2                  # 100
RY = (BL - XT) / 2                   # 20
XT_O, BL_O = XT - H, BL + H          # 75, 125 outer x-height / baseline
ASC_O = 49                           # outer top of b d h k l
DESC_O = T["metrics"]["descender"] + H  # 153 outer bottom of p q g j y
I_DOT_Y = XT - T["iDotGap"]          # 62
BK = T["baton"]["dx"] / -T["baton"]["dy"]  # 0.655: the baton slant (x per 1 of height)
SB = (T["tracking"] - STROKE) / 2    # 2.5: half the visible gap between letters

# ---------- font units ----------
UPM = 1000
S = 10.4                             # 1 design unit = 10.4 font units (x-height 520)
def fx(x): return x * S
def fy(y): return (BL_O - y) * S     # baseline outer edge = 0


# ---------- geometry helpers (design units, y down) ----------
def new():
    return pathops.Path()


def ept(cx, cy, rx, ry, t):
    a = math.radians(t)
    return cx + rx * math.cos(a), cy - ry * math.sin(a)


def arc(p, cx, cy, rx, ry, t0, t1, move=True):
    """Elliptical arc from angle t0 to t1 (degrees, counter-clockwise on screen when t grows)."""
    n = max(1, math.ceil(abs(t1 - t0) / 90))
    d = (t1 - t0) / n
    x, y = ept(cx, cy, rx, ry, t0)
    if move:
        p.moveTo(x, y)
    for i in range(n):
        a0, a1 = math.radians(t0 + i * d), math.radians(t0 + (i + 1) * d)
        k = 4 / 3 * math.tan((a1 - a0) / 4)
        x0, y0 = ept(cx, cy, rx, ry, math.degrees(a0))
        x3, y3 = ept(cx, cy, rx, ry, math.degrees(a1))
        d0 = (-rx * math.sin(a0), -ry * math.cos(a0))
        d1 = (-rx * math.sin(a1), -ry * math.cos(a1))
        p.cubicTo(x0 + k * d0[0], y0 + k * d0[1], x3 - k * d1[0], y3 - k * d1[1], x3, y3)
    return p


def stroked(p):
    """Turn a centre-line path into a filled band, flat (butt) ends."""
    p.stroke(STROKE, pathops.LineCap.BUTT_CAP, pathops.LineJoin.MITER_JOIN, 4)
    p.convertConicsToQuads()
    return p


def oval(cx=RX, cy=MID, rx=RX, ry=RY):
    p = new()
    arc(p, cx, cy, rx, ry, 0, 360)
    p.close()
    return stroked(p)


def oval_arc(t0, t1, cx=RX, cy=MID, rx=RX, ry=RY):
    return stroked(arc(new(), cx, cy, rx, ry, t0, t1))


def rect(x0, y0, x1, y1):
    p = new()
    p.moveTo(x0, y0); p.lineTo(x1, y0); p.lineTo(x1, y1); p.lineTo(x0, y1); p.close()
    return p


def stem(x, y0, y1):
    return rect(x - H, y0, x + H, y1)


def hbar(x0, x1, y):
    return rect(x0, y - H, x1, y + H)


def poly(pts):
    p = new()
    p.moveTo(*pts[0])
    for q in pts[1:]:
        p.lineTo(*q)
    p.close()
    return p


def slant(xb, yb, xt, yt):
    """A bar cut horizontally at both ends (like the baton) from bottom (xb,yb) to top (xt,yt), centre line."""
    hw = H * math.hypot(xt - xb, yt - yb) / abs(yb - yt)
    return poly([(xb - hw, yb), (xb + hw, yb), (xt + hw, yt), (xt - hw, yt)])


def dot(cx, cy, r=DOT):
    p = new()
    arc(p, cx, cy, r, r, 0, 360)
    p.close()
    return p


def union(parts):
    out = new()
    for q in parts:
        out = pathops.op(out, q, pathops.PathOp.UNION, fix_winding=True)
    return out


def soften(shape, r=CR):
    """Round every convex corner by r (morphological opening); curves stay as they are."""
    if r <= 0:
        return shape
    band = new(); band.addPath(shape)
    band.stroke(2 * r, pathops.LineCap.ROUND_CAP, pathops.LineJoin.ROUND_JOIN, 4)
    band.convertConicsToQuads()
    eroded = pathops.op(shape, band, pathops.PathOp.DIFFERENCE, fix_winding=True)
    grow = new(); grow.addPath(eroded)
    grow.stroke(2 * r, pathops.LineCap.ROUND_CAP, pathops.LineJoin.ROUND_JOIN, 4)
    grow.convertConicsToQuads()
    return pathops.op(eroded, grow, pathops.PathOp.UNION, fix_winding=True)


# ---------- the s from the logo (six cubic curves, x 223..266) ----------
S_CURVES = [
    [(266, 87), (260, 81), (252, 80), (245, 80)],
    [(245, 80), (233, 80), (225, 85), (225, 91)],
    [(225, 91), (225, 98), (233, 100), (245, 100)],
    [(245, 100), (257, 100), (266, 103), (266, 110)],
    [(266, 110), (266, 116), (258, 120), (245, 120)],
    [(245, 120), (236, 120), (228, 118), (223, 113)],
]


def s_shape():
    p = new()
    p.moveTo(S_CURVES[0][0][0] - 223, S_CURVES[0][0][1])
    for c in S_CURVES:
        (x1, y1), (x2, y2), (x3, y3) = c[1:]
        p.cubicTo(x1 - 223, y1, x2 - 223, y2, x3 - 223, y3)
    return stroked(p)


# ---------- glyphs: (strokes, dots) — dots are not used for spacing ----------
W = RX * 2   # 52
G = {}

G["o"] = ([oval()], [])
G["a"] = ([oval(), stem(W, XT_O, BL_O)], [])
G["b"] = ([stem(0, ASC_O, BL_O), oval()], [])
G["d"] = ([oval(), stem(W, ASC_O, BL_O)], [])
G["p"] = ([stem(0, XT_O, DESC_O), oval()], [])
G["q"] = ([oval(), stem(W, XT_O, DESC_O)], [])
G["c"] = ([oval_arc(42, 318)], [])
G["e"] = ([hbar(0, W + H, MID), oval_arc(0, 318)], [])
# g: bowl + right stem that hooks back to the left under the baseline
_g = new(); _g.moveTo(W, XT_O); _g.lineTo(W, 136); arc(_g, RX, 136, RX, 12, 0, -158, move=False)
G["g"] = ([oval(), stroked(_g)], [])
# arches: the top half of the same oval, springing from the stems
G["n"] = ([stem(0, XT_O, BL_O), oval_arc(180, 0), stem(W, MID, BL_O)], [])
G["h"] = ([stem(0, ASC_O, BL_O), oval_arc(180, 0), stem(W, MID, BL_O)], [])
G["u"] = ([stem(0, XT_O, MID), oval_arc(180, 360), stem(W, XT_O, BL_O)], [])
_m = 19  # m uses two narrower arches
G["m"] = ([stem(0, XT_O, BL_O), oval_arc(180, 0, cx=_m, rx=_m), stem(2 * _m, MID, BL_O),
           oval_arc(180, 0, cx=3 * _m, rx=_m), stem(4 * _m, MID, BL_O)], [])
G["r"] = ([stem(0, XT_O, BL_O), oval_arc(180, 62, cx=22, rx=22)], [])
G["i"] = ([stem(0, XT_O, BL_O)], [dot(0, I_DOT_Y)])
_j = new(); _j.moveTo(0, XT_O); _j.lineTo(0, 136); arc(_j, -12, 136, 12, 12, 0, -150, move=False)
G["j"] = ([stroked(_j)], [dot(0, I_DOT_Y)])
G["l"] = ([stem(0, ASC_O, BL_O)], [])
# f and t: a stem with a crossbar on the x-height line
_f = new(); _f.moveTo(12, BL_O); _f.lineTo(12, 68); arc(_f, 30, 68, 18, 14, 180, 72, move=False)
G["f"] = ([stroked(_f), hbar(-1, 30, XT)], [])
G["t"] = ([stem(12, 58, BL_O), hbar(-1, 30, XT)], [])
# diagonals all lean like the baton
_vh = BL_O - XT_O          # 50
_vr = _vh * BK             # 32.75 horizontal run
G["v"] = ([slant(_vr, BL_O, 0, XT_O), slant(_vr, BL_O, 2 * _vr, XT_O)], [])
_wk = 0.46; _wr = _vh * _wk
G["w"] = ([slant(_wr, BL_O, 0, XT_O), slant(_wr, BL_O, 2 * _wr, XT_O),
           slant(3 * _wr, BL_O, 2 * _wr, XT_O), slant(3 * _wr, BL_O, 4 * _wr, XT_O)], [])
G["x"] = ([slant(_vr, BL_O, 0, XT_O), slant(0, BL_O, _vr, XT_O)], [])
_yr = (DESC_O - XT_O) * BK
G["y"] = ([slant(_vr, BL_O, 0, XT_O), slant(2 * _vr - _yr, DESC_O, 2 * _vr, XT_O)], [])
G["k"] = ([stem(0, ASC_O, BL_O), slant(4, 110, 4 + 35 * BK, XT_O), slant(12 + 25 * BK, BL_O, 12, 100)], [])
G["z"] = ([hbar(-2, 40, XT), hbar(-2, 40, BL), slant(2, BL - H, 36, XT + H)], [])
G["s"] = ([s_shape()], [])

# punctuation
G["period"] = ([], [dot(0, BL_O - DOT)])
G["comma"] = ([slant(-6, 138, 2, 118)], [dot(2, BL_O - DOT)])
G["colon"] = ([], [dot(0, BL_O - DOT), dot(0, XT_O + DOT)])
G["semicolon"] = ([slant(-6, 138, 2, 118)], [dot(2, BL_O - DOT), dot(2, XT_O + DOT)])
G["exclam"] = ([stem(0, ASC_O, 100)], [dot(0, BL_O - DOT)])
_q = new(); arc(_q, 18, 66, 18, 15, 160, -90); _q.lineTo(18, 100)
G["question"] = ([stroked(_q)], [dot(18, BL_O - DOT)])
G["periodcentered"] = ([], [dot(0, MID)])
G["hyphen"] = ([hbar(0, 30, MID)], [])
G["underscore"] = ([hbar(0, 52, DESC_O - H)], [])
G["quotesingle"] = ([stem(0, ASC_O, 68)], [])
G["quotedbl"] = ([stem(0, ASC_O, 68), stem(14, ASC_O, 68)], [])
G["slash"] = ([slant(0, BL_O, (BL_O - ASC_O) * BK, ASC_O)], [])
G["parenleft"] = ([oval_arc(110, 250, cx=40, cy=101, rx=40, ry=50)], [])
G["parenright"] = ([oval_arc(70, -70, cx=-14, cy=101, rx=40, ry=50)], [])

# figures: same parts, taller (outer top at 52, just under the ascenders)
FT = 52 + H            # 57: top stroke centre of figures


def line(*pts):
    p = new(); p.moveTo(*pts[0])
    for q in pts[1:]:
        p.lineTo(*q)
    return stroked(p)


_two = new(); arc(_two, 22, 74.5, 22, 17.5, 160, -22); _two.lineTo(4, BL)
_three = new(); arc(_three, 22, 73, 21, 16, 150, -90); arc(_three, 22, 104.5, 23, 15.5, 90, -150, move=False)
_five = new(); arc(_five, 22, 104, 23, 16, 140, -150)
_six = new(); arc(_six, 34, 100, 34, 43, 180, 104)
_nine = new(); arc(_nine, 14, 77, 34, 43, 0, -76)
G["zero"] = ([oval(cx=24, cy=88.5, rx=24, ry=31.5)], [])
G["one"] = ([stem(14, 52, BL_O), slant(-1, 74, 9, FT)], [])
G["two"] = ([stroked(_two), hbar(1, 46, BL)], [])
G["three"] = ([stroked(_three)], [])
G["four"] = ([stem(34, 52, BL_O), hbar(-3, 47, 104), line((1, 104), (34, FT))], [])
G["five"] = ([hbar(3, 44, FT), stem(7, 52, 92), stroked(_five)], [])
G["six"] = ([oval(cx=24, cy=100.5, rx=24, ry=19.5), stroked(_six)], [])
G["seven"] = ([hbar(-3, 46, FT), slant(12, BL_O, 42, FT + H)], [])
G["eight"] = ([oval(cx=24, cy=73.5, rx=20, ry=16.5), oval(cx=24, cy=104, rx=24, ry=16)], [])
G["nine"] = ([oval(cx=24, cy=76.5, rx=24, ry=19.5), stroked(_nine)], [])

# the baton as an i (stylistic set 1): same numbers as the logo
_L, _dg = T["baton"]["letterLength"], T["baton"]["dotGap"]
_len = math.hypot(T["baton"]["dx"], T["baton"]["dy"])
_ux, _uy = T["baton"]["dx"] / _len, T["baton"]["dy"] / _len
G["i.baton"] = ([slant(-H * BK, BL_O, _ux * _L, BL + _uy * _L)],
                [dot(_ux * (_L + _dg), BL + _uy * (_L + _dg))])

CMAP = {c: c for c in "abcdefghijklmnopqrstuvwxyz"}
CMAP.update({".": "period", ",": "comma", ":": "colon", ";": "semicolon", "!": "exclam",
             "?": "question", "-": "hyphen", "·": "periodcentered", "_": "underscore", "'": "quotesingle",
             '"': "quotedbl", "/": "slash", "(": "parenleft", ")": "parenright"})
CMAP.update({str(n): w for n, w in enumerate(
    ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"])})
EXTRA_SB = {"i.baton": (8.25 - SB, 6.73 - SB)}   # the baton gets extra air, as in the logo
SPACE = 24


def build():
    order = [".notdef", "space"] + list(G)
    shapes, metrics = {}, {}
    for name, (strokes, dots) in G.items():
        body = union(strokes) if strokes else None
        full = union(([body] if body else []) + dots)
        full = soften(full)
        bx = (body or full).bounds        # spacing from strokes only (a dot may hang over)
        x0, x1 = bx[0], bx[2]
        lsb, rsb = SB, SB
        if name in EXTRA_SB:
            lsb += EXTRA_SB[name][0]; rsb += EXTRA_SB[name][1]
            x1 = max(x1, full.bounds[2])
        dx = lsb - x0
        shapes[name] = (full, dx)
        metrics[name] = (round(fx(x1 - x0 + lsb + rsb)), round(fx(full.bounds[0] + dx)))
    metrics["space"] = (round(fx(SPACE)), 0)
    metrics[".notdef"] = (round(fx(40)), 0)

    def draw(pen, name):
        if name in shapes:
            shape, dx = shapes[name]
            tp = TransformPen(ReverseContourPen(pen), (S, 0, 0, -S, dx * S, BL_O * S))
            shape.draw(tp)

    # --- OTF (CFF) ---
    fb = FontBuilder(UPM, isTTF=False)
    fb.setupGlyphOrder(order)
    cmap = {ord(" "): "space"}
    cmap.update({ord(k): v for k, v in CMAP.items()})
    fb.setupCharacterMap(cmap)
    charstrings = {}
    for name in order:
        pen = T2CharStringPen(metrics[name][0], None)
        draw(pen, name)
        charstrings[name] = pen.getCharString()
    fb.setupCFF("OpsaipDisplay-Regular", {"FullName": "Opsaip Display Regular"}, charstrings, {})
    common(fb, metrics, order)
    otf = HERE / "OpsaipDisplay-Regular.otf"
    fb.save(otf)
    add_features(otf)

    # --- TTF ---
    fb = FontBuilder(UPM, isTTF=True)
    fb.setupGlyphOrder(order)
    fb.setupCharacterMap(cmap)
    glyphs = {}
    for name in order:
        pen = TTGlyphPen(None)
        draw(Cu2QuPen(pen, 1.0, reverse_direction=False), name)
        glyphs[name] = pen.glyph()
    fb.setupGlyf(glyphs)
    common(fb, metrics, order)
    ttf = HERE / "OpsaipDisplay-Regular.ttf"
    fb.save(ttf)
    add_features(ttf)

    f = TTFont(otf); f.flavor = "woff2"; f.save(HERE / "OpsaipDisplay-Regular.woff2")
    print(f"built {len(order)} glyphs → otf, ttf, woff2")


def common(fb, metrics, order):
    fb.setupHorizontalMetrics({n: metrics[n] for n in order})
    fb.setupHorizontalHeader(ascent=860, descent=-320)
    fb.setupNameTable({"familyName": "Opsaip Display", "styleName": "Regular",
                       "uniqueFontIdentifier": "Opsaip Display Regular 0.1",
                       "fullName": "Opsaip Display Regular", "psName": "OpsaipDisplay-Regular",
                       "version": "Version 0.100", "licenseDescription": "Opsaip brand font. All rights reserved."})
    fb.setupOS2(sTypoAscender=800, sTypoDescender=-300, sTypoLineGap=100, usWinAscent=860, usWinDescent=320,
                sxHeight=round(fx(BL_O - XT_O)), sCapHeight=754, achVendID="OPSP", fsType=0)
    fb.setupPost()


def add_features(path):
    f = TTFont(path)
    addOpenTypeFeaturesFromString(f, "languagesystem DFLT dflt;\nlanguagesystem latn dflt;\n"
                                     "feature ss01 { sub i by i.baton; } ss01;\n")
    f.save(path)


if __name__ == "__main__":
    build()
