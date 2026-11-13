// Opsy's body and face as springs. Pure: no DOM, no WebGL, no clock of its own.
// The renderer calls step(dt) once per frame and reads frame() for the shader.
//
// Ported from the mascot lab (opsy-lab.html), cut down to the six states that
// opsyFocus() can produce. Nothing here invents content: the eyes only change
// shape, and the body only moves.
//
// Timing follows the brand's "Fluid" motion: every spring is tuned to settle in
// one of the three token durations (fast / base / slow = 260 / 480 / 720 ms).

import type { OpsyState } from '../../data/opsyFocus';

/** What each eye draws. Numbers match the `kind` switch in shader.ts. */
export const EYE = { dot: 0, question: 1, arc: 2, cross: 3 } as const;
export type EyeKind = (typeof EYE)[keyof typeof EYE];

/** Durations in seconds, from tokens.css (see styles/motion.ts). */
export interface Timing {
  fast: number;
  base: number;
  slow: number;
}

export const FLUID: Timing = { fast: 0.26, base: 0.48, slow: 0.72 };

// ---------- springs ----------

export interface Spring {
  v: number;
  vel: number;
  to: number;
  k: number; // stiffness
  z: number; // damping ratio: 1 = no overshoot, < 1 = a little wobble
}

/**
 * Stiffness for a spring with damping ratio `z` that settles (stays within 2%
 * of the target) in about `seconds`. For z < 1 the envelope e^(-z·w·t) reaches
 * 2% at t = 4 / (z·w); a critically damped spring (z = 1) needs about 5.8 / w.
 */
export function stiffness(seconds: number, z: number): number {
  const t = Math.max(seconds, 0.05); // reduced motion sets 1ms; never build a spring that stiff
  const w = z >= 1 ? 5.8 / t : 4 / (z * t);
  return w * w;
}

/** Semi-implicit Euler: stable for w·dt < 2; the caller keeps dt small. */
export function stepSpring(s: Spring, dt: number): void {
  const c = 2 * Math.sqrt(s.k) * s.z;
  s.vel += (-s.k * (s.v - s.to) - c * s.vel) * dt;
  s.v += s.vel * dt;
}

type Tier = keyof Timing;
interface SpringDef { v: number; tier: Tier; z: number }

// Which Fluid tier each part uses. Lids are quick, the face follows at base,
// the body moves slow. The body keeps a little of the lab's jelly (z < 1);
// everything that changes place or size without a kick settles without overshoot.
const DEFS = {
  lidL: { v: 1, tier: 'fast', z: 1 },
  lidR: { v: 1, tier: 'fast', z: 1 },
  eyeS: { v: 1, tier: 'base', z: 0.8 },
  sep: { v: 0.27, tier: 'base', z: 1 },
  gx: { v: 0, tier: 'base', z: 1 },
  gy: { v: 0, tier: 'base', z: 1 },
  tint: { v: 0, tier: 'base', z: 1 },
  px: { v: 0, tier: 'base', z: 0.35 }, // the error shake
  sx: { v: 1, tier: 'slow', z: 0.5 },
  sy: { v: 1, tier: 'slow', z: 0.5 },
  py: { v: 0, tier: 'slow', z: 0.7 },
  yaw: { v: 0, tier: 'slow', z: 0.85 },
  pitch: { v: 0, tier: 'slow', z: 0.85 },
  roll: { v: 0, tier: 'slow', z: 0.8 },
  dim: { v: 0, tier: 'slow', z: 1 },
  flow: { v: 1, tier: 'slow', z: 1 },
} satisfies Record<string, SpringDef>;

type Part = keyof typeof DEFS;

// ---------- what each state looks like ----------

interface Pose {
  kind: [EyeKind, EyeKind];
  lid: number;          // 1 open, 0 closed
  eyeS: number;         // eye size
  sep: number;          // half the distance between the eyes
  gaze: [number, number] | null; // null = little random glances
  roll: number;         // head tilt
  pitch: number;
  dim: number;          // the glass and liquid go darker
  tint: number;         // red rim
  flow: number;         // liquid speed
  bob: number;          // float amplitude
  sink: number;
  blinks: boolean;
}

const BASE: Pose = {
  kind: [EYE.dot, EYE.dot], lid: 1, eyeS: 1, sep: 0.27, gaze: null, roll: 0, pitch: 0,
  dim: 0, tint: 0, flow: 1, bob: 0.05, sink: 0, blinks: true,
};

export const POSES: Record<OpsyState, Pose> = {
  idle: BASE,
  // A slow turn, eyes down to the work; they fade as they go round the back.
  working: { ...BASE, eyeS: 0.82, flow: 1.3, gaze: [0.12, -0.3] },
  // ? ?, the head tilts: a person is needed.
  question: { ...BASE, kind: [EYE.question, EYE.question], sep: 0.31, roll: 0.16 },
  // Eyes shut tight, the rim glows red.
  error: { ...BASE, lid: 0, tint: 1, flow: 0.6, blinks: false },
  // Arcs: closed, smiling eyes.
  done: { ...BASE, kind: [EYE.arc, EYE.arc], sep: 0.29, eyeS: 1.05, blinks: false },
  // Crosses, the glass dims, it barely floats.
  offline: { ...BASE, kind: [EYE.cross, EYE.cross], sep: 0.3, dim: 0.45, flow: 0.2, bob: 0.015, sink: -0.03, gaze: [0, 0], blinks: false },
};

/** Working: how fast the ball turns, rad/s. */
export const TURN_SPEED = 0.62;

// ---------- the model ----------

/** Everything the shader needs for one frame, in world units (ball radius 1). */
export interface OpsyFrame {
  pos: [number, number];
  yaw: number;
  pitch: number;
  roll: number;
  scale: [number, number, number];
  eyeL: [number, number, number, number]; // x, y, size, open (0..1)
  eyeR: [number, number, number, number];
  kind: [EyeKind, EyeKind];
  phase: number; // liquid time, accumulated so speed changes never jump the waves
  dim: number;
  tint: number;
}

const TAU = Math.PI * 2;
/** An angle moved into (-π, π], so a turn back takes the short way. */
export const wrapAngle = (a: number) => a - TAU * Math.floor((a + Math.PI) / TAU);

export class OpsyMotion {
  state: OpsyState;
  private readonly p: Record<Part, Spring>;
  private kindNow: [EyeKind, EyeKind];
  private clock = 0;
  private phase = 0;
  private turn = 0;          // working: where the turn has got to
  private blinkUntil = 0;
  private nextBlink = 1.5;
  private secondBlinkAt = -1;
  private glance: [number, number] = [0, 0];
  private nextGlance = 1;
  private readonly rng: () => number;

  constructor(state: OpsyState, timing: Timing = FLUID, rng: () => number = Math.random) {
    this.state = state;
    this.rng = rng;
    this.kindNow = [...POSES[state].kind];
    this.p = {} as Record<Part, Spring>;
    for (const part of Object.keys(DEFS) as Part[]) {
      const d: SpringDef = DEFS[part];
      this.p[part] = { v: d.v, vel: 0, to: d.v, k: 0, z: d.z };
    }
    this.setTiming(timing);
    this.settle(); // a new Opsy appears already in its state, with no entrance
  }

  setTiming(t: Timing): void {
    for (const part of Object.keys(DEFS) as Part[]) {
      const d: SpringDef = DEFS[part];
      this.p[part].k = stiffness(t[d.tier], d.z);
    }
  }

  /** Change state. Each entrance is a small physical gesture: a kick to a spring. */
  setState(next: OpsyState): void {
    const prev = this.state;
    if (next === prev) return;
    this.state = next;
    const p = this.p;
    if (prev === 'working') {
      // turn back to the front the short way
      p.yaw.v = wrapAngle(p.yaw.v);
      this.turn = 0;
    }
    if (next === 'working') this.turn = p.yaw.v;
    if (next === 'question') { p.sy.vel += 1.6; p.sx.vel -= 1.0; p.py.vel += 1.4; }
    if (next === 'done') { p.py.vel += 3.2; p.sy.vel -= 1.8; p.sx.vel += 1.5; }
    if (next === 'error') p.px.vel += 4.5;
    if (prev === 'error') p.sy.vel += 1.2;
  }

  /** The eyes that are showing right now (they swap behind a blink). */
  get eyes(): [EyeKind, EyeKind] {
    return [this.kindNow[0], this.kindNow[1]];
  }

  /** Advance by `dt` seconds. */
  step(dt: number): void {
    dt = Math.min(Math.max(dt, 0), 0.05); // a long pause (hidden tab) never becomes a jump
    this.clock += dt;
    this.phase += dt * this.p.flow.v;
    if (this.state === 'working') this.turn -= TURN_SPEED * dt;
    // keep the turn small; move the spring with it so nothing jumps
    if (Math.abs(this.turn) > TAU) {
      const shift = TAU * Math.trunc(this.turn / TAU);
      this.turn -= shift;
      this.p.yaw.v -= shift;
    }
    this.aim(this.clock, false);
    const n = Math.max(1, Math.ceil(dt * 240)); // substeps keep the stiff springs stable
    for (let i = 0; i < n; i++) for (const s of Object.values(this.p)) stepSpring(s, dt / n);
  }

  /**
   * Jump straight to the resting pose of the current state: the still frame for
   * reduced motion. Working faces the front instead of turning.
   */
  settle(): void {
    this.kindNow = [...POSES[this.state].kind];
    this.blinkUntil = 0;
    this.secondBlinkAt = -1;
    this.turn = 0;
    // Twice: the body's lean is aimed from where the eyes look, which the first pass snaps.
    for (let pass = 0; pass < 2; pass++) {
      this.aim(this.clock, true);
      for (const s of Object.values(this.p)) { s.v = s.to; s.vel = 0; }
    }
  }

  /** Set every spring's target for time `t`. */
  private aim(t: number, still: boolean): void {
    const p = this.p;
    const pose = POSES[this.state];
    const motion = still ? 0 : 1;

    // glyph swaps happen behind a blink: close, swap, open
    const swapping = this.kindNow[0] !== pose.kind[0] || this.kindNow[1] !== pose.kind[1];
    if (swapping && Math.max(p.lidL.v, p.lidR.v) < 0.12) this.kindNow = [...pose.kind];

    if (!still) {
      if (this.secondBlinkAt > 0 && t >= this.secondBlinkAt) { this.blinkUntil = t + 0.1; this.secondBlinkAt = -1; }
      if (pose.blinks && !swapping && t > this.nextBlink) {
        this.blinkUntil = t + 0.14;
        this.nextBlink = t + 1.8 + this.rng() * 3.8;
        if (this.rng() < 0.18) this.secondBlinkAt = t + 0.3; // now and then, a double blink
      }
    }
    const closed = swapping || t < this.blinkUntil;
    p.lidL.to = closed ? 0 : pose.lid;
    p.lidR.to = closed ? 0 : pose.lid;
    p.eyeS.to = pose.eyeS;
    p.sep.to = pose.sep;

    let gaze = pose.gaze;
    if (!gaze) {
      if (!still && t > this.nextGlance) {
        this.glance = [(this.rng() - 0.5) * 0.7, (this.rng() - 0.5) * 0.4];
        this.nextGlance = t + 0.8 + this.rng() * 2.2;
      }
      gaze = still ? [0, 0] : this.glance;
    }
    p.gx.to = gaze[0];
    p.gy.to = gaze[1];

    // the body leans toward where it looks, tilts with a question, floats and breathes
    p.roll.to = pose.roll;
    p.pitch.to = pose.pitch - p.gy.v * 0.22;
    p.yaw.to = (still ? 0 : this.turn) + p.gx.v * 0.3;
    p.py.to = pose.sink + motion * pose.bob * Math.sin(t * 1.1);
    const breath = 1 + motion * 0.012 * Math.sin(t * 1.6);
    p.sx.to = breath;
    p.sy.to = breath;
    p.px.to = 0;
    p.dim.to = pose.dim;
    p.tint.to = pose.tint;
    p.flow.to = pose.flow;
  }

  frame(): OpsyFrame {
    const p = this.p;
    const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
    const es = 0.115 * p.eyeS.v;
    const sep = p.sep.v * Math.max(p.eyeS.v, 0) ** 0.3;
    const ex = p.gx.v * 0.2 - p.gx.v * 0.03;
    const ey = 0.1 + p.gy.v * 0.17;
    return {
      pos: [p.px.v * 0.06, p.py.v * 0.6],
      yaw: p.yaw.v,
      pitch: p.pitch.v,
      roll: p.roll.v,
      scale: [p.sx.v, p.sy.v, (p.sx.v + p.sy.v) / 2],
      eyeL: [-sep + ex, ey, es, clamp01(p.lidL.v)],
      eyeR: [sep + ex, ey, es, clamp01(p.lidR.v)],
      kind: this.eyes,
      phase: this.phase,
      dim: p.dim.v,
      tint: clamp01(p.tint.v),
    };
  }
}

/**
 * Object-to-world rotation R = Rz(roll) · Ry(yaw) · Rx(pitch), as the 9 numbers
 * of a GLSL mat3 (column-major).
 */
export function rotation(yaw: number, pitch: number, roll: number): Float32Array {
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const cr = Math.cos(roll), sr = Math.sin(roll);
  // rows of Ry·Rx
  const a = [[cy, sy * sp, sy * cp], [0, cp, -sp], [-sy, cy * sp, cy * cp]];
  // rows of Rz·(Ry·Rx)
  const r = [
    [cr * a[0][0] - sr * a[1][0], cr * a[0][1] - sr * a[1][1], cr * a[0][2] - sr * a[1][2]],
    [sr * a[0][0] + cr * a[1][0], sr * a[0][1] + cr * a[1][1], sr * a[0][2] + cr * a[1][2]],
    a[2],
  ];
  return new Float32Array([r[0][0], r[1][0], r[2][0], r[0][1], r[1][1], r[2][1], r[0][2], r[1][2], r[2][2]]);
}
