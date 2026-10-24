// Checks that the web build moves like the phone app (src/theme/motion.web.tsx).
//
//   npx expo export -p web     # → dist/
//   node scripts/check-web-motion.mjs [dist]
//
// 1. curves    the web's enter animation, seeked frame by frame, against Reanimated's own
//              spring and bezier code (the code that runs on the phone's UI thread)
// 2. enter     enter animations run on load: fade, scale and rise, the brief out of a blur
// 3. layout    "Show the list" moves the rows on a translate-only spring; no text that was
//              on screen is ever scaled, in any frame
// 4. exit      leaving views fade out from where they were, then go
// 5. reduced   with reduced motion: opacity only, no movement, scale or blur

import { readFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = fileURLToPath(new URL('..', import.meta.url));
const dist = resolve(here, process.argv[2] ?? 'dist');
if (!existsSync(join(dist, 'index.html'))) {
  console.error(`No web build in ${dist}. Run: npx expo export -p web`);
  process.exit(1);
}

let failed = 0;
const check = (ok, what, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? ` (${detail})` : ''}`);
  if (!ok) failed++;
};

// ---- The phone's curves, from Reanimated's own source ----

const rea = join(here, 'node_modules/react-native-reanimated/lib/module');
const asModule = (src) => import(`data:text/javascript,${encodeURIComponent(src)}`);
const springUtils = await asModule(readFileSync(join(rea, 'animation/spring/springUtils.js'), 'utf8').replace(/^import \{ logger \}.*$/m, 'const logger = console;'));
const { Bezier } = await asModule(readFileSync(join(rea, 'Bezier.js'), 'utf8'));

/** withSpring(to, { duration, dampingRatio: 1 }) from `from`, stepped like the UI thread at `hz`. */
function nativeSpring(from, to, duration, hz = 120) {
  const config = { mass: 4, dampingRatio: 1, duration, energyThreshold: 6e-9, velocity: 0, useDuration: true, skipAnimation: false, overshootClamping: false };
  const x0 = from - to;
  config.stiffness = springUtils.calculateNewStiffnessToMatchDuration(x0, config, 0);
  const { omega0 } = springUtils.initialCalculations(config.stiffness, config);
  const a = { toValue: to, current: from, velocity: 0, startValue: x0, initialEnergy: springUtils.getEnergy(x0, 0, config.stiffness, config.mass) };
  const frames = [[0, from]];
  for (let t = 1000 / hz, last = 0; ; last = t, t += 1000 / hz) {
    const r = springUtils.criticallyDampedSpringCalculations(a, { v0: a.velocity, x0: a.current - to, omega0, t: Math.min(t - last, 64) / 1000 });
    a.current = r.position;
    a.velocity = r.velocity;
    if (springUtils.isAnimationTerminatingCalculation(a, config)) {
      frames.push([t, to]);
      return frames;
    }
    frames.push([t, a.current]);
  }
}

// ---- Serve the build ----

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.ttf': 'font/ttf', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = join(dist, path);
  if (!file.startsWith(dist) || !existsSync(file) || path.endsWith('/')) file = join(dist, 'index.html');
  res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
}).listen(0);
const url = `http://localhost:${server.address().port}/`;

// Every Web Animation the page starts, kept so it can be seeked later.
const RECORD = () => {
  window.__anims = [];
  const animate = Element.prototype.animate;
  Element.prototype.animate = function (frames, timing) {
    const a = animate.call(this, frames, timing);
    window.__anims.push(a);
    return a;
  };
};

const browser = await chromium.launch();
const open = async (reducedMotion = 'no-preference') => {
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, colorScheme: 'dark', hasTouch: true, isMobile: true, reducedMotion });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => check(false, 'no page errors', e.message));
  await page.clock.setFixedTime(new Date('2026-10-26T08:30:00'));
  await page.addInitScript(RECORD);
  await page.goto(url);
  await page.getByText('Show the list', { exact: true }).first().waitFor();
  await page.waitForTimeout(1500);
  return page;
};

// What each recorded animation moves.
const SUMMARY = () =>
  window.__anims.map((a, i) => {
    const kf = a.effect.getKeyframes();
    const props = Object.keys(kf[0]).filter((k) => !['offset', 'computedOffset', 'easing', 'composite'].includes(k));
    // enter and exit fade the same view they scale; a layout move never fades
    const fades = window.__anims.some((b) => b.effect.target === a.effect.target && 'opacity' in b.effect.getKeyframes()[0]);
    return { i, props, fades, duration: a.effect.getTiming().duration, frames: kf.length, first: kf[0], ghost: !!a.effect.target.closest('[data-exiting]') };
  });

try {
  // ---- 1 + 2: enter, and its curves against the phone's ----
  const page = await open();
  const entered = await page.evaluate(SUMMARY);
  check(entered.some((a) => a.props.includes('opacity')), 'enter fades run on load', `${entered.filter((a) => a.props.includes('opacity')).length} fades`);
  const rise = entered.find((a) => a.props.includes('transform') && a.duration === 720 && String(a.first.transform).includes('translateY(12px)'));
  check(!!rise, 'a medium enter scales 0.96 → 1 and rises 12px on the spring', rise ? `${rise.frames} keyframes over ${rise.duration}ms` : 'none found');
  check(entered.some((a) => a.props.includes('filter') && String(a.first.filter).includes('blur(8px)')), 'the brief comes out of an 8px blur');

  if (rise) {
    // Seek the web animation to each phone frame and read what the browser draws.
    const native = { y: nativeSpring(12, 0, 480), s: nativeSpring(0.96, 1, 480) };
    const times = native.s.map(([t]) => t);
    const drawn = await page.evaluate(
      ({ i, times }) => {
        const a = window.__anims[i];
        a.pause();
        const out = times.map((t) => {
          a.currentTime = t;
          const m = new DOMMatrix(getComputedStyle(a.effect.target).transform);
          return [m.a, m.f];
        });
        a.finish();
        return out;
      },
      { i: rise.i, times },
    );
    const ds = Math.max(...drawn.map(([s], k) => Math.abs(s - native.s[k][1])));
    const dy = Math.max(...drawn.map(([, y], k) => Math.abs(y - native.y[k][1])));
    check(ds < 1e-4 && dy < 0.01, 'web spring = Reanimated withSpring at every 120Hz frame', `max scale error ${ds.toExponential(1)}, max rise error ${dy.toFixed(4)}px, ${times.length} frames, settles at ${times.at(-1).toFixed(0)}ms`);

    const fade = entered.find((a) => a.props.includes('opacity') && a.duration === 480);
    const ease = Bezier(0.32, 0.72, 0, 1);
    const opacity = await page.evaluate((i) => {
      const a = window.__anims[i];
      a.pause();
      const out = [];
      for (let t = 0; t <= 480; t += 1000 / 120) {
        a.currentTime = t;
        out.push([t, Number(getComputedStyle(a.effect.target).opacity)]);
      }
      a.finish();
      return out;
    }, fade.i);
    const dop = Math.max(...opacity.map(([t, o]) => Math.abs(o - ease(t / 480))));
    check(dop < 0.002, 'web fade = Reanimated Easing.bezier(0.32, 0.72, 0, 1)', `max opacity error ${dop.toFixed(4)}`);
  }

  // ---- 3 + 4: layout and exit, on "Show the list" ----
  await page.evaluate(() => (window.__anims = []));
  const scale = await page.evaluate(async () => {
    // Text on screen before the change; the rows that arrive with it may grow in, these may not.
    const texts = [...document.querySelectorAll('#root *')].filter((el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()));
    const button = [...document.querySelectorAll('#root *')].find((el) => el.textContent === 'Show the list' && el.children.length === 0);
    const fading = (el) => el.getAnimations({ subtree: false }).some((a) => 'opacity' in a.effect.getKeyframes()[0]);
    const worst = { value: 0, text: '' };
    const sample = () => {
      for (const el of texts) {
        if (!el.isConnected) continue;
        let m = new DOMMatrix();
        let skip = false;
        for (let a = el; a && a !== document.documentElement; a = a.parentElement) {
          if (fading(a)) skip = true; // entering or leaving: that motion scales on purpose
          m = new DOMMatrix(getComputedStyle(a).transform === 'none' ? undefined : getComputedStyle(a).transform).multiply(m);
        }
        if (skip) continue;
        const off = Math.max(Math.abs(Math.hypot(m.a, m.b) - 1), Math.abs(Math.hypot(m.c, m.d) - 1));
        if (off > worst.value) Object.assign(worst, { value: off, text: el.textContent.slice(0, 40) });
      }
    };
    button.click();
    const frames = [];
    await new Promise((done) => {
      const t0 = performance.now();
      const tick = () => {
        sample();
        frames.push(performance.now() - t0);
        if (performance.now() - t0 < 900) requestAnimationFrame(tick);
        else done();
      };
      requestAnimationFrame(tick);
    });
    return { ...worst, frames: frames.length, checked: texts.length };
  });
  const changed = await page.evaluate(SUMMARY);
  const moves = changed.filter((a) => !a.fades);
  check(moves.length > 0 && moves.every((a) => !String(a.first.transform ?? '').includes('scale')), 'layout changes move and clip, never scale', `${moves.length} moves: ${[...new Set(moves.map((a) => a.props.join('+')))].join(', ')}`);
  check(scale.value < 1e-6, 'no text on screen is scaled in any frame of the layout change', `${scale.checked} text nodes × ${scale.frames} frames, worst ${scale.value.toExponential(1)}${scale.text ? ` on "${scale.text}"` : ''}`);
  const exits = changed.filter((a) => a.ghost);
  check(exits.some((a) => a.props.includes('opacity')), 'leaving views fade out in place', `${exits.length / 2} exits, ${exits[0]?.duration}ms`);
  await page.waitForTimeout(600);
  check((await page.locator('[data-exiting]').count()) === 0, 'and are gone afterwards');

  // ---- 5: reduced motion ----
  const quiet = await open('reduce');
  await quiet.getByText('Show the list', { exact: true }).first().click();
  await quiet.waitForTimeout(800);
  const reduced = await quiet.evaluate(SUMMARY);
  const moving = reduced.filter((a) => !(a.props.length === 1 && a.props[0] === 'opacity'));
  check(reduced.length > 0 && moving.length === 0, 'reduced motion: opacity only', `${reduced.length} fades, ${moving.length} other`);
} finally {
  await browser.close();
  server.close();
}

console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
