// Opsaip brand builder.
// One source of truth: tokens + glyph components -> every logo file.
// Run: node build.mjs   (from inside the brand/ folder)

import { writeFileSync, mkdirSync, readFileSync } from "node:fs";

const tokens = JSON.parse(readFileSync(new URL("./tokens.json", import.meta.url)));
const { stroke, dotRadius, tracking, metrics, baton: B, colors } = tokens;
const h = stroke / 2;
const { xTop, baseline, descender } = metrics;
const midY = (xTop + baseline) / 2;
const ry = (baseline - xTop) / 2;
const rx = tokens.bowlWidth / 2;

// "flat" = straight cut stroke ends (strict, ChatGPT-like). "round" = soft round ends.
const flat = tokens.terminals === "flat";
const cap = flat ? "butt" : "round";
// With flat ends a line stops exactly at its end point, so stems are
// extended by half a stroke to stay flush with the outer edge of the bowls.
const top = flat ? xTop - h : xTop;          // stem top (x-height line)
const bottom = flat ? baseline + h : baseline; // stem bottom (baseline)
const desc = flat ? descender + h : descender; // p descender
// Small softening of the corners on flat ends (0 = sharp corners).
const cr = flat ? (tokens.cornerRadius || 0) : 0;

// ---------- Shape helpers ----------
// Closed filled shape; each corner gets its own small rounding radius.
// Rounding = cut the corner at distance r on both edges, join with a smooth curve.
function rounded(pts, radii, c) {
  const n = pts.length;
  let d = "";
  pts.forEach((V, i) => {
    const P = pts[(i + n - 1) % n], N = pts[(i + 1) % n], r = radii[i];
    const cmd = i ? "L" : "M";
    if (!r) { d += `${cmd}${f(V[0])} ${f(V[1])} `; return; }
    const toward = (T) => { const l = Math.hypot(T[0] - V[0], T[1] - V[1]);
      return [V[0] + (T[0] - V[0]) / l * r, V[1] + (T[1] - V[1]) / l * r]; };
    const A = toward(P), Bq = toward(N);
    d += `${cmd}${f(A[0])} ${f(A[1])} Q${f(V[0])} ${f(V[1])} ${f(Bq[0])} ${f(Bq[1])} `;
  });
  return `<path d="${d}Z" fill="${c}" stroke="none"/>`;
}

// A vertical stem: a line with round ends, or a flat bar with softened corners.
function stem(x, y0, y1, c) {
  if (!flat) return `<line x1="${x}" y1="${y0}" x2="${x}" y2="${y1}" stroke="${c}"/>`;
  return rounded([[x - h, y0], [x + h, y0], [x + h, y1], [x - h, y1]], [cr, cr, cr, cr], c);
}

// ---------- The s ----------
// Six cubic curves (drawn at x 223..266). With flat ends, the stroke is
// shortened by the corner radius at both ends and finished with a small
// end piece whose two outer corners are softened.
const S = [
  [[266, 87], [260, 81], [252, 80], [245, 80]],
  [[245, 80], [233, 80], [225, 85], [225, 91]],
  [[225, 91], [225, 98], [233, 100], [245, 100]],
  [[245, 100], [257, 100], [266, 103], [266, 110]],
  [[266, 110], [266, 116], [258, 120], [245, 120]],
  [[245, 120], [236, 120], [228, 118], [223, 113]],
];
const bez = (s, t) => [0, 1].map(k => (1 - t) ** 3 * s[0][k] + 3 * (1 - t) ** 2 * t * s[1][k] + 3 * (1 - t) * t * t * s[2][k] + t ** 3 * s[3][k]);
function split(s, t) { // de Casteljau: cut one curve into two at t
  const L = (a, b) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const a = L(s[0], s[1]), b = L(s[1], s[2]), cc = L(s[2], s[3]);
  const d = L(a, b), e = L(b, cc), m = L(d, e);
  return [[s[0], a, d, m], [m, e, cc, s[3]]];
}
function tAtLength(s, r, fromEnd) { // walk along the curve until distance r is covered
  let prev = bez(s, fromEnd ? 1 : 0), acc = 0;
  for (let i = 1; i <= 400; i++) {
    const t = fromEnd ? 1 - i / 400 : i / 400, p = bez(s, t);
    acc += Math.hypot(p[0] - prev[0], p[1] - prev[1]); prev = p;
    if (acc >= r) return t;
  }
  return fromEnd ? 0 : 1;
}
function endPiece(near, far, c) { // short bar near -> far, outer corners softened
  const l = Math.hypot(far[0] - near[0], far[1] - near[1]);
  const d = [(far[0] - near[0]) / l, (far[1] - near[1]) / l], nx = -d[1] * h, ny = d[0] * h;
  const n0 = [near[0] - d[0] * 0.4, near[1] - d[1] * 0.4]; // tiny overlap, no seam
  return rounded([[n0[0] + nx, n0[1] + ny], [far[0] + nx, far[1] + ny],
                  [far[0] - nx, far[1] - ny], [n0[0] - nx, n0[1] - ny]], [0, cr, cr, 0], c);
}
function drawS(x, c) {
  const segs = S.map(s => s.map(p => [p[0] - 223 + x, p[1]]));
  let caps = "";
  if (cr) {
    const first = split(segs[0], tAtLength(segs[0], cr, false))[1];
    const last = split(segs[5], tAtLength(segs[5], cr, true))[0];
    caps = endPiece(first[0], segs[0][0], c) + endPiece(last[3], segs[5][3], c);
    segs[0] = first; segs[5] = last;
  }
  const d = `M${segs[0][0].map(f).join(" ")} ` + segs.map(s => `C${s.slice(1).map(p => p.map(f).join(" ")).join(" ")}`).join(" ");
  return `<path d="${d}" stroke="${c}"/>` + caps;
}

// ---------- Baton component ----------
// One bar + one dot. Same angle everywhere; only the length changes.
const len = Math.hypot(B.dx, B.dy);
const ux = B.dx / len, uy = B.dy / len;
function baton(x0, y0, L, c) {
  const x1 = x0 + ux * L, y1 = y0 + uy * L;
  const dx = x0 + ux * (L + B.dotGap), dy = y0 + uy * (L + B.dotGap);
  const dot = `<circle cx="${f(dx)}" cy="${f(dy)}" r="${dotRadius}" fill="${dotColor || c}" stroke="none"/>`;
  if (!flat) {
    return {
      svg: `<line x1="${f(x0)}" y1="${f(y0)}" x2="${f(x1)}" y2="${f(y1)}" stroke="${c}"/>` + dot,
      bounds: { x0: x0 - h, x1: dx + dotRadius, y0: dy - dotRadius, y1: y0 + h },
    };
  }
  // Flat version: a slanted bar cut horizontally at both ends,
  // like "/" in a grotesk font. The bottom sits flush with the letters' baseline.
  const k = B.dx / -B.dy;          // horizontal shift per 1 unit of height
  const hw = h * len / -B.dy;      // half width of a horizontal cut
  const yb = y0 + h, xb = x0 - h * k; // bottom cut center
  const pts = [[xb - hw, yb], [xb + hw, yb], [x1 + hw, y1], [x1 - hw, y1]];
  return {
    svg: rounded(pts, [cr, cr, cr, cr], c) + dot,
    bounds: { x0: xb - hw, x1: Math.max(x1 + hw, dx + dotRadius), y0: dy - dotRadius, y1: yb },
  };
}

// ---------- Glyph components ----------
// Each glyph is drawn from its own origin (x = 0 = left stroke center).
// width = advance to the next glyph (before tracking).
const W = tokens.bowlWidth;
const glyphs = {
  o: { width: W, draw: (x, c) => `<ellipse cx="${x + rx}" cy="${midY}" rx="${rx}" ry="${ry}" stroke="${c}"/>`,
       y: [xTop - h, baseline + h] },
  p: { width: W, draw: (x, c) =>
         stem(x, top, desc, c) +
         `<ellipse cx="${x + rx}" cy="${midY}" rx="${rx}" ry="${ry}" stroke="${c}"/>`,
       y: [xTop - h, descender + h] },
  a: { width: W, draw: (x, c) =>
         `<ellipse cx="${x + rx}" cy="${midY}" rx="${rx}" ry="${ry}" stroke="${c}"/>` +
         stem(x + W, top, bottom, c),
       y: [xTop - h, baseline + h] },
  s: { width: 43, draw: (x, c) => drawS(x, c),
       y: [xTop - h, baseline + h] },
  // classic i: stem + the same dot as the baton
  i: { width: 0, draw: (x, c) =>
         stem(x, top, bottom, c) +
         `<circle cx="${x}" cy="${xTop - tokens.iDotGap}" r="${dotRadius}" fill="${dotColor || c}" stroke="none"/>`,
       extra: [-dotRadius + h, dotRadius - h], y: [xTop - tokens.iDotGap - dotRadius, baseline + h] },
  // the baton used as the letter i (gets extra air on both sides)
  baton: { width: B.letterWidth, before: B.spaceBefore, after: B.spaceAfter,
           draw: (x, c) => baton(x, baseline, B.letterLength, c).svg,
           y: null },
};

function setWord(word, c) {
  let x = 0, out = "", minY = Infinity, maxY = -Infinity, maxX = -Infinity;
  word.forEach((g, n) => {
    const G = glyphs[g];
    x += G.before || 0;
    out += G.draw(x, c);
    if (g === "baton") {
      const b = baton(x, baseline, B.letterLength, c).bounds;
      minY = Math.min(minY, b.y0); maxY = Math.max(maxY, b.y1); maxX = Math.max(maxX, b.x1);
    } else {
      minY = Math.min(minY, G.y[0]); maxY = Math.max(maxY, G.y[1]);
      maxX = Math.max(maxX, x + G.width + h + (G.extra ? G.extra[1] : 0));
    }
    x += G.width + (G.after || 0) + (n < word.length - 1 ? tracking : 0);
  });
  return { svg: out, x0: -h, x1: maxX, y0: minY, y1: maxY };
}

// ---------- Output helpers ----------
const f = (n) => Math.round(n * 100) / 100;
function file(name, inner, box, pad = 0) {
  const x = f(box.x0 - pad), y = f(box.y0 - pad);
  const w = f(box.x1 - box.x0 + pad * 2), hh = f(box.y1 - box.y0 + pad * 2);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${hh}" width="${w * 2}" height="${hh * 2}">` +
    `<g fill="none" stroke-width="${stroke}" stroke-linecap="${cap}" stroke-linejoin="round">${inner}</g></svg>\n`;
  writeFileSync(new URL(name, import.meta.url), svg);
}
function square(box) {
  const s = Math.max(box.x1 - box.x0, box.y1 - box.y0);
  const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
  return { x0: cx - s / 2, x1: cx + s / 2, y0: cy - s / 2, y1: cy + s / 2 };
}

mkdirSync(new URL("./components/", import.meta.url), { recursive: true });
mkdirSync(new URL("./logo/", import.meta.url), { recursive: true });

// The dot is the only accent. Lime on dark backgrounds; on light backgrounds
// lime is nearly invisible (contrast 1.2:1), so there the dot uses the ink color.
let dotColor = null;
const themes = { "on-light": colors.ink, "on-dark": colors.paper };
const themeDot = { "on-light": null, "on-dark": colors.lime };

// components (ink color, for reference and Figma import)
for (const g of ["o", "p", "s", "a", "i"]) {
  const w = setWord([g], colors.ink);
  file(`./components/glyph-${g}.svg`, w.svg, w, 4);
}
{
  const s = baton(0, baseline, B.letterLength, colors.ink);
  file("./components/baton-letter.svg", s.svg, s.bounds, 4);
  const l = baton(0, baseline, B.symbolLength, colors.ink);
  file("./components/baton-symbol.svg", l.svg, l.bounds, 4);
}

// logos
for (const [t, c] of Object.entries(themes)) {
  dotColor = themeDot[t];
  const wb = setWord(["o", "p", "s", "a", "baton", "p"], c);
  file(`./logo/wordmark-baton-${t}.svg`, wb.svg, wb);

  const wi = setWord(["o", "p", "s", "a", "i", "p"], c);
  file(`./logo/wordmark-${t}.svg`, wi.svg, wi);

  const sym = baton(0, baseline, B.symbolLength, c);
  file(`./logo/symbol-${t}.svg`, sym.svg, square(sym.bounds), 10);

  // lockup: long baton + classic wordmark
  const sb = baton(0, baseline, B.symbolLength, c);
  const shift = sb.bounds.x1 + tokens.lockupGap + h;
  const word = setWord(["o", "p", "s", "a", "i", "p"], c);
  file(`./logo/lockup-${t}.svg`,
    sb.svg + `<g transform="translate(${f(shift)} 0)">${word.svg}</g>`,
    { x0: sb.bounds.x0, x1: shift + word.x1,
      y0: Math.min(sb.bounds.y0, word.y0), y1: Math.max(sb.bounds.y1, word.y1) });
}
console.log("brand built");
