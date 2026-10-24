// The web's motion engine, used only by motion.web.tsx.
//
// Reanimated's web build runs only its predefined layout animations: custom
// entering / exiting worklets never run, layout transitions animate size with
// `transform: scale` (squashing text) and unknown easings fall back to linear.
// So on the web the helpers in motion.web.tsx return a plain description of the
// motion (a `WebMotion`), and this file plays it with the Web Animations API on
// the view's DOM node:
//
//   springs   Reanimated's own duration-based spring (critically damped, the same
//             stiffness for the same duration), sampled into keyframes, so the web
//             and the phone move on the same curve frame for frame
//   fades     the token's cubic-bezier, which the browser runs natively
//   exit      a copy of the view stays where it was and fades out after React
//             removes the original
//   layout    FLIP that animates translate only; a view that grew is revealed by
//             clipping, never scaled, so text keeps its shape
//
// It reaches the DOM node through Reanimated's own animated component: the
// lifecycle of its base class is wrapped once (see `install`), and each
// description carries `reduceMotionV: 'always'` so Reanimated's own web layout
// animation code steps aside for it.

import Animated from 'react-native-reanimated';

type Curve = 'spring' | readonly number[];

/** One property animating from p = 0 to p = 1. `frame` turns progress into CSS. */
export interface Track {
  ms: number;
  delay: number;
  curve: Curve;
  frame: (p: number) => Keyframe;
  /** Transforms add onto whatever else moves the view (its own style, a layout move). */
  add?: boolean;
}

export const WEB = Symbol('opsaip.webMotion');

export type WebMotion =
  | { [WEB]: 'enter' | 'exit'; tracks: Track[]; reduceMotionV: 'always' }
  | { [WEB]: 'layout'; ms: number; reduced: boolean; reduceMotionV: 'always' };

export const tracks = (kind: 'enter' | 'exit', list: Track[]): WebMotion => ({ [WEB]: kind, tracks: list, reduceMotionV: 'always' });
export const layoutMotion = (ms: number, reduced: boolean): WebMotion => ({ [WEB]: 'layout', ms, reduced, reduceMotionV: 'always' });

// ---- The spring ----
//
// A port of Reanimated's `withSpring({ duration, dampingRatio: 1 })` (mass 4,
// energy threshold 6e-9; react-native-reanimated/src/animation/spring): the
// stiffness is solved so the spring's energy falls to the threshold after
// 1.5 × duration, and then it snaps to rest. Position from rest, starting still:
//   x(t) = x0 · (1 + ω t) · e^(−ω t),  ω = √(k / m)

const MASS = 4;
const THRESHOLD = 6e-9;
const PERCEPTUAL = 1.5;

function bisect(min: number, max: number, f: (x: number) => number, precision: number, iterations: number) {
  const direction = f(max) >= f(min) ? 1 : -1;
  let current = (max + min) / 2;
  while (Math.abs(f(current)) > precision && iterations > 0) {
    iterations -= 1;
    if (f(current) * direction < 0) min = current;
    else max = current;
    current = (min + max) / 2;
  }
  return current;
}

const omegas = new Map<number, number>();

/** ω (rad/s) of the spring Reanimated builds for `ms`. */
function omegaFor(ms: number) {
  const known = omegas.get(ms);
  if (known !== undefined) return known;
  const settle = (ms * PERCEPTUAL) / 1000;
  const energy = (x: number, v: number, k: number) => 0.5 * k * x * x + 0.5 * MASS * v * v;
  const fraction = (k: number) => {
    const w = Math.sqrt(k / MASS);
    const e = Math.exp(-w * settle);
    const a = 1 + w * settle; // x0 = 1, v0 = 0
    return energy(a * e, a * e * -w + w * e, k) / energy(1, 0, k) - THRESHOLD;
  };
  const w = Math.sqrt(bisect(Number.EPSILON, 8e3, fraction, THRESHOLD * 1e-3, 100) / MASS);
  omegas.set(ms, w);
  return w;
}

/** How long the spring actually runs before it snaps to rest. */
export const settleMs = (ms: number) => ms * PERCEPTUAL;

/** Progress 0 → 1 of the spring `ms`, `t` ms after it started. */
export function springAt(ms: number, t: number) {
  if (t >= settleMs(ms)) return 1;
  const w = omegaFor(ms);
  const s = Math.max(0, t) / 1000;
  return 1 - (1 + w * s) * Math.exp(-w * s);
}

/** Keyframe offsets every ~4ms (a 240Hz grid), so straight lines between them stay on the curve. */
function springFrames(ms: number, frame: (p: number) => Keyframe): Keyframe[] {
  const total = settleMs(ms);
  const steps = Math.max(8, Math.ceil(total / 4));
  const out: Keyframe[] = [];
  for (let i = 0; i <= steps; i++) out.push({ ...frame(i === steps ? 1 : springAt(ms, (i / steps) * total)), offset: i / steps });
  return out;
}

const bezier = (c: readonly number[]) => `cubic-bezier(${c.join(', ')})`;

// ---- Playing ----

/** Play tracks on an element. `hold` keeps the last frame (an exit, before the copy goes). */
export function play(el: HTMLElement, list: Track[], hold = false): Animation[] {
  return list.map((t) => {
    const fill: FillMode = hold ? 'both' : 'backwards';
    const composite: CompositeOperation = t.add ? 'add' : 'replace';
    if (t.curve === 'spring') {
      return el.animate(springFrames(t.ms, t.frame), { duration: settleMs(t.ms), delay: t.delay, fill, composite, easing: 'linear' });
    }
    return el.animate([t.frame(0), t.frame(1)], { duration: t.ms, delay: t.delay, fill, composite, easing: bezier(t.curve) });
  });
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where layout put the view inside its parent, ignoring transforms and scrolling. Null when hidden. */
function measure(el: HTMLElement): Box | null {
  if (!el.isConnected || !el.offsetParent) return null;
  return { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
}

/** Leave: a copy of the view stays in its place and plays the exit, then goes. */
export function exitFrom(el: HTMLElement, list: Track[]) {
  const parent = el.offsetParent;
  const box = measure(el);
  if (!(parent instanceof HTMLElement) || !box) return;
  const ghost = el.cloneNode(true) as HTMLElement;
  Object.assign(ghost.style, {
    position: 'absolute',
    left: `${box.x}px`,
    top: `${box.y}px`,
    width: `${box.w}px`,
    height: `${box.h}px`,
    margin: '0',
    pointerEvents: 'none',
  });
  ghost.setAttribute('aria-hidden', 'true');
  ghost.dataset.exiting = '';
  parent.appendChild(ghost);
  const anims = play(ghost, list, true);
  const total = Math.max(...list.map((t) => t.delay + (t.curve === 'spring' ? settleMs(t.ms) : t.ms)));
  let gone = false;
  const remove = () => {
    if (gone) return;
    gone = true;
    ghost.remove();
  };
  Promise.all(anims.map((a) => a.finished)).then(remove, remove);
  setTimeout(remove, total + 250); // a hidden tab never finishes animations
}

// ---- Layout: FLIP, translate only ----

interface Flight {
  start: number;
  ms: number;
  dx: number;
  dy: number;
  dw: number; // drawn width minus the new width (negative: it grew)
  dh: number;
  anims: Animation[];
}

interface Tracked {
  ms: number;
  reduced: boolean;
  box: Box | null;
  flight?: Flight;
}

const tracked = new Map<HTMLElement, Tracked>();
let observer: MutationObserver | undefined;
let resizer: ResizeObserver | undefined;
let quiet = false; // the window is resizing: follow it, don't animate

function track(el: HTMLElement, ms: number, reduced: boolean) {
  const t = tracked.get(el);
  if (t) {
    t.ms = ms;
    t.reduced = reduced;
    return;
  }
  tracked.set(el, { ms, reduced, box: measure(el) });
  resizer?.observe(el);
}

function untrack(el: HTMLElement) {
  tracked.delete(el);
  resizer?.unobserve(el);
}

function measureAll() {
  for (const [el, t] of tracked) {
    if (!el.isConnected) {
      untrack(el);
      continue;
    }
    const box = measure(el);
    if (t.box && box && !quiet && !t.reduced) move(el, t, t.box, box);
    else if (t.flight && (!box || t.reduced)) settle(t);
    t.box = box;
  }
}

function settle(t: Tracked) {
  t.flight?.anims.forEach((a) => a.cancel());
  t.flight = undefined;
}

const same = (a: number, b: number) => Math.abs(a - b) < 0.5;

function move(el: HTMLElement, t: Tracked, from: Box, to: Box) {
  if (same(from.x, to.x) && same(from.y, to.y) && same(from.w, to.w) && same(from.h, to.h)) return;

  // Start from where it is drawn now: an interrupted move carries on from mid-flight.
  let dx = from.x - to.x;
  let dy = from.y - to.y;
  let dw = from.w - to.w;
  let dh = from.h - to.h;
  const f = t.flight;
  if (f) {
    const left = 1 - springAt(f.ms, performance.now() - f.start);
    dx += f.dx * left;
    dy += f.dy * left;
    dw += f.dw * left;
    dh += f.dh * left;
    settle(t);
  }
  const clipW = dw < -0.5;
  const clipH = dh < -0.5;
  if (same(dx, 0) && same(dy, 0) && !clipW && !clipH) return;

  const list: Track[] = [];
  if (!same(dx, 0) || !same(dy, 0)) {
    list.push({ ms: t.ms, delay: 0, curve: 'spring', add: true, frame: (p) => ({ transform: `translate(${dx * (1 - p)}px, ${dy * (1 - p)}px)` }) });
  }
  if (clipW || clipH) {
    // It grew: show it at its old size and uncover the rest on the same spring.
    list.push({
      ms: t.ms,
      delay: 0,
      curve: 'spring',
      frame: (p) => ({ clipPath: `inset(0px ${clipW ? -dw * (1 - p) : 0}px ${clipH ? -dh * (1 - p) : 0}px 0px)` }),
    });
  }
  const anims = play(el, list);
  const flight: Flight = { start: performance.now(), ms: t.ms, dx, dy, dw: clipW ? dw : 0, dh: clipH ? dh : 0, anims };
  t.flight = flight;
  Promise.all(anims.map((a) => a.finished)).then(
    () => {
      if (t.flight === flight) t.flight = undefined;
    },
    () => {},
  );
}

// ---- Hooking into Reanimated's animated component ----

interface Host {
  props: { entering?: unknown; exiting?: unknown; layout?: unknown };
  context?: { current?: boolean } | null;
  _componentDOMRef?: HTMLElement | null;
}

type Lifecycle = (this: Host, ...args: unknown[]) => unknown;

const motionOf = (v: unknown): WebMotion | undefined => (v && typeof v === 'object' && WEB in v ? (v as WebMotion) : undefined);

function syncLayout(host: Host) {
  const el = host._componentDOMRef;
  if (!(el instanceof HTMLElement)) return;
  const l = motionOf(host.props.layout);
  if (l && l[WEB] === 'layout') track(el, l.ms, l.reduced);
  else if (tracked.has(el)) untrack(el);
}

let installed = false;

/** Wrap the lifecycle of Reanimated's animated component (web build) once. */
export function install() {
  if (installed || typeof document === 'undefined') return;
  installed = true;

  // Animated.View renders a subclass of Reanimated's AnimatedComponent; the
  // lifecycle we need lives on that base class.
  const probe = (Animated.View as unknown as (props: object) => { type: { prototype: object } })({});
  const base = Object.getPrototypeOf(probe.type.prototype) as Record<string, Lifecycle>;
  const wrap = (name: string, after: (host: Host) => void, first = false) => {
    const original = base[name];
    base[name] = function (this: Host, ...args: unknown[]) {
      if (first) after(this);
      const out = original?.apply(this, args);
      if (!first) after(this);
      return out;
    };
  };

  wrap('componentDidMount', (host) => {
    const el = host._componentDOMRef;
    const e = motionOf(host.props.entering);
    if (el instanceof HTMLElement && e && e[WEB] === 'enter' && !host.context?.current) play(el, e.tracks);
    syncLayout(host);
  });
  wrap('componentDidUpdate', syncLayout);
  wrap(
    'componentWillUnmount',
    (host) => {
      const el = host._componentDOMRef;
      if (!(el instanceof HTMLElement)) return;
      untrack(el);
      const x = motionOf(host.props.exiting);
      if (x && x[WEB] === 'exit') exitFrom(el, x.tracks);
    },
    true,
  );

  // Any change to the page may move a tracked view: measure before the next paint.
  observer = new MutationObserver(measureAll);
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
  resizer = new ResizeObserver(measureAll);
  window.addEventListener('resize', () => {
    quiet = true;
    requestAnimationFrame(() => requestAnimationFrame(() => (quiet = false)));
  });
}
