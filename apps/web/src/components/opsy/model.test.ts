import { describe, expect, it } from 'vitest';
import type { OpsyState } from '../../data/opsyFocus';
import { EYE, FLUID, OpsyMotion, POSES, rotation, stepSpring, stiffness, wrapAngle, type Spring } from './model';

const STATES: OpsyState[] = ['idle', 'working', 'question', 'done', 'error', 'offline'];

/** A fixed "random" source, so blinks and glances are the same on every run. */
const fixed = (x = 0.5) => () => x;

function run(m: OpsyMotion, seconds: number, dt = 1 / 60) {
  for (let t = 0; t < seconds; t += dt) m.step(dt);
}

/** Time for a spring from 1 to 0 to stay within 2% of 0. */
function settleTime(k: number, z: number): number {
  const s: Spring = { v: 1, vel: 0, to: 0, k, z };
  const dt = 1 / 2000;
  let lastOut = 0;
  for (let t = 0; t < 3; t += dt) {
    stepSpring(s, dt);
    if (Math.abs(s.v) > 0.02) lastOut = t;
  }
  return lastOut;
}

describe('springs follow Fluid (260 / 480 / 720 ms)', () => {
  for (const seconds of [FLUID.fast, FLUID.base, FLUID.slow]) {
    for (const z of [0.35, 0.5, 0.7, 0.85, 1]) {
      it(`${seconds * 1000} ms, damping ${z}: settles within 15% of the duration`, () => {
        const t = settleTime(stiffness(seconds, z), z);
        expect(Math.abs(t - seconds) / seconds).toBeLessThan(0.15);
      });
    }
  }

  it('a critically damped spring never overshoots', () => {
    const s: Spring = { v: 1, vel: 0, to: 0, k: stiffness(FLUID.base, 1), z: 1 };
    for (let i = 0; i < 2000; i++) { stepSpring(s, 1 / 2000); expect(s.v).toBeGreaterThanOrEqual(-1e-9); }
  });

  it('reduced motion (1 ms durations) still builds a stable spring', () => {
    const s: Spring = { v: 1, vel: 0, to: 0, k: stiffness(0.001, 1), z: 1 };
    for (let i = 0; i < 240; i++) stepSpring(s, 1 / 240);
    expect(Number.isFinite(s.v)).toBe(true);
    expect(Math.abs(s.v)).toBeLessThan(0.02);
  });
});

describe('OpsyMotion: the six states', () => {
  it.each(STATES)('%s: a new Opsy shows its own eyes at once', (state) => {
    const m = new OpsyMotion(state, FLUID, fixed());
    expect(m.eyes).toEqual(POSES[state].kind);
  });

  it('maps states to eyes: ? ?, arcs, crosses, dots', () => {
    expect(POSES.question.kind).toEqual([EYE.question, EYE.question]);
    expect(POSES.done.kind).toEqual([EYE.arc, EYE.arc]);
    expect(POSES.offline.kind).toEqual([EYE.cross, EYE.cross]);
    for (const s of ['idle', 'working', 'error'] as const) expect(POSES[s].kind).toEqual([EYE.dot, EYE.dot]);
  });

  it('eyes swap behind a blink: closed first, then the new shape opens', () => {
    const m = new OpsyMotion('idle', FLUID, fixed());
    m.setState('question');
    m.step(1 / 60);
    expect(m.eyes).toEqual([EYE.dot, EYE.dot]); // still closing
    let swappedOpen = -1;
    for (let i = 0; i < 120; i++) {
      m.step(1 / 60);
      if (m.eyes[0] === EYE.question) {
        swappedOpen = m.frame().eyeL[3];
        break;
      }
    }
    expect(swappedOpen).toBeGreaterThanOrEqual(0);
    expect(swappedOpen).toBeLessThan(0.12);
    run(m, 0.6); // a base-tier opening; the next planned blink is later
    expect(m.frame().eyeL[3]).toBeGreaterThan(0.95);
  });

  it('error: eyes shut and the rim turns red; leaving it clears both', () => {
    const m = new OpsyMotion('idle', FLUID, fixed());
    m.setState('error');
    run(m, 1.5);
    const f = m.frame();
    expect(f.eyeL[3]).toBeLessThan(0.02);
    expect(f.tint).toBeGreaterThan(0.98);
    m.setState('idle');
    run(m, 1.5);
    expect(m.frame().tint).toBeLessThan(0.02);
  });

  it('offline dims the glass', () => {
    const m = new OpsyMotion('offline', FLUID, fixed());
    expect(m.frame().dim).toBeCloseTo(POSES.offline.dim);
  });

  it('working turns slowly, and only working turns', () => {
    const idle = new OpsyMotion('idle', FLUID, fixed());
    run(idle, 3);
    expect(Math.abs(idle.frame().yaw)).toBeLessThan(0.3);

    const m = new OpsyMotion('idle', FLUID, fixed());
    m.setState('working');
    run(m, 1);
    const a = m.frame().yaw;
    run(m, 1);
    const b = m.frame().yaw;
    // about TURN_SPEED rad/s once the spring has caught up
    expect(a - b).toBeGreaterThan(0.4);
    expect(a - b).toBeLessThan(0.8);
  });

  it('after working, it turns back to the front the short way', () => {
    const m = new OpsyMotion('working', FLUID, fixed());
    run(m, 7); // more than a full turn
    m.setState('idle');
    expect(Math.abs(m.frame().yaw)).toBeLessThanOrEqual(Math.PI + 1e-9);
    run(m, 2);
    expect(Math.abs(m.frame().yaw)).toBeLessThan(0.3);
  });

  it('a long turn never grows without bound', () => {
    const m = new OpsyMotion('working', FLUID, fixed());
    run(m, 120, 0.05);
    expect(Math.abs(m.frame().yaw)).toBeLessThan(4 * Math.PI);
  });

  it('a huge dt (a tab hidden for minutes) is clamped, never a jump', () => {
    const m = new OpsyMotion('idle', FLUID, fixed());
    m.setState('done');
    m.step(300);
    const f = m.frame();
    for (const v of [...f.pos, f.yaw, f.pitch, f.roll, ...f.scale, ...f.eyeL]) expect(Number.isFinite(v)).toBe(true);
    expect(Math.abs(f.pos[1])).toBeLessThan(0.3);
  });

  it.each(STATES)('%s: settle() gives the still frame: front-facing, no motion left', (state) => {
    const m = new OpsyMotion('idle', FLUID, fixed());
    m.setState(state);
    run(m, 0.3);
    m.settle();
    const f = m.frame();
    expect(m.eyes).toEqual(POSES[state].kind);
    expect(Math.abs(f.yaw)).toBeLessThan(0.15); // working faces the front, not mid-turn
    expect(f.eyeL[3]).toBeCloseTo(POSES[state].lid);
    expect(f.scale[0]).toBeCloseTo(1);
    const before = JSON.stringify(f);
    m.settle();
    expect(JSON.stringify(m.frame())).toBe(before);
  });
});

describe('helpers', () => {
  it('wrapAngle keeps angles in (-π, π]', () => {
    expect(wrapAngle(0)).toBe(0);
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(-Math.PI);
    expect(wrapAngle(-7)).toBeCloseTo(-7 + 2 * Math.PI);
  });

  it('rotation is orthonormal and matches the identity at rest', () => {
    [1, 0, 0, 0, 1, 0, 0, 0, 1].forEach((v, i) => expect(rotation(0, 0, 0)[i]).toBeCloseTo(v));
    const r = rotation(0.7, -0.3, 0.2);
    const col = (i: number) => [r[i * 3], r[i * 3 + 1], r[i * 3 + 2]];
    const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) expect(dot(col(i), col(j))).toBeCloseTo(i === j ? 1 : 0, 5);
  });

  it('yaw turns the face (+z) toward +x', () => {
    const r = rotation(Math.PI / 2, 0, 0);
    // column 2 is where the object's +z ends up
    expect(r[6]).toBeCloseTo(1);
    expect(r[8]).toBeCloseTo(0);
  });
});
