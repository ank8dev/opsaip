// One WebGL2 context for the whole app, shared by every Opsy.
//
// Browsers allow only a few WebGL contexts per page (about 16) and each one
// costs memory, so the GL canvas here is never put on the page. Every frame,
// for each Opsy that is on screen, it draws that Opsy at its real pixel size
// into the corner of the shared canvas and copies the result into the Opsy's
// own 2D canvas. The copy has to happen in the same task as the draw: the
// drawing buffer is not preserved after that.
//
// Work is done only when it shows:
// - nothing runs while the tab is hidden or no Opsy is on screen;
// - reduced motion (OS or Settings): each Opsy is drawn once, as a still
//   frame, and again only when its state, size or the theme changes;
// - pixels = CSS size × device pixel ratio, with the ratio capped at 2.

import type { OpsyState } from '../../data/opsyFocus';
import { readMotionTokens } from '../../styles/motion';
import { OpsyMotion, rotation, type Timing } from './model';
import { FRAG, VERT } from './shader';

const MAX_DPR = 2;
const MAX_PX = 512; // per side, per Opsy
/** World units from the centre to the canvas edge; the ball's radius is 1, the rest is room to hop and squash. */
const VIEW = 1.3;

interface Instance {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  motion: OpsyMotion;
  size: number;    // CSS px
  onScreen: boolean;
  dirty: boolean;  // needs a draw even when nothing moves (reduced motion)
}

export interface OpsyHandle {
  setState(state: OpsyState): void;
  setSize(size: number): void;
  detach(): void;
}

const UNIFORMS = ['uRes', 'uTime', 'uPhase', 'uView', 'uPx', 'uTheme', 'uDim', 'uTint', 'uPos', 'uScale', 'uRot',
  'uEye0', 'uEye1', 'uKindL', 'uKindR'] as const;
type Uniforms = Record<(typeof UNIFORMS)[number], WebGLUniformLocation | null>;

interface Gpu {
  gl: WebGL2RenderingContext;
  u: Uniforms;
}

interface Shared {
  canvas: HTMLCanvasElement;
  gpu: Gpu | null; // null while the context is lost
  instances: Set<Instance>;
  byCanvas: Map<Element, Instance>;
  io: IntersectionObserver | null;
  raf: number;
  last: number;
  clock: number;
  reduced: boolean;
  timing: Timing;
}

let shared: Shared | null | undefined; // undefined: not tried yet; null: no WebGL2 here

function compile(gl: WebGL2RenderingContext): Gpu | null {
  const shader = (type: number, src: string) => {
    const s = gl.createShader(type);
    if (!s) return null;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return s;
  };
  const vs = shader(gl.VERTEX_SHADER, VERT);
  const fs = shader(gl.FRAGMENT_SHADER, FRAG);
  const prog = gl.createProgram();
  if (!vs || !fs || !prog) return null;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  // Check only after linking: compile errors also fail the link, and asking
  // earlier would block on drivers that compile in parallel.
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    if (import.meta.env.DEV) console.error('Opsy shader:', gl.getShaderInfoLog(fs) || gl.getProgramInfoLog(prog));
    return null;
  }
  gl.useProgram(prog);
  // one triangle that covers the whole viewport
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'a');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const u = {} as Uniforms;
  for (const name of UNIFORMS) u[name] = gl.getUniformLocation(prog, name);
  return { gl, u };
}

function init(): Shared | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const gl = canvas.getContext('webgl2', {
    alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false,
    preserveDrawingBuffer: false, powerPreference: 'low-power',
  });
  if (!gl) return null;
  const gpu = compile(gl);
  if (!gpu) return null;

  const tokens = readMotionTokens();
  const s: Shared = {
    canvas, gpu, instances: new Set(), byCanvas: new Map(), io: null,
    raf: 0, last: 0, clock: 0, reduced: tokens.reduced, timing: tokens,
  };

  // The GPU can drop the context (driver reset, too many tabs). The Opsy
  // canvases keep their last picture; drawing resumes once it is back.
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    s.gpu = null;
    stop(s);
  });
  canvas.addEventListener('webglcontextrestored', () => {
    s.gpu = compile(gl);
    redrawAll(s);
  });

  if (typeof IntersectionObserver !== 'undefined') {
    s.io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const inst = s.byCanvas.get(e.target);
        if (inst) inst.onScreen = e.isIntersecting;
      }
      redrawAll(s);
    });
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop(s);
    else wake(s);
  });
  // Theme and motion live on <html> (see state/ui.tsx); the OS setting can change too.
  const retune = () => {
    const t = readMotionTokens();
    s.reduced = t.reduced;
    s.timing = t;
    for (const inst of s.instances) inst.motion.setTiming(t);
    redrawAll(s);
  };
  new MutationObserver(retune).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-motion'] });
  matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', retune);
  return s;
}

function getShared(): Shared | null {
  if (shared === undefined) shared = init();
  return shared;
}

/** False when this browser has no WebGL2 (or the shader does not build): show the still image instead. */
export function canRenderOpsy(): boolean {
  return getShared() !== null;
}

function stop(s: Shared) {
  if (s.raf) cancelAnimationFrame(s.raf);
  s.raf = 0;
}

function wake(s: Shared) {
  if (s.raf || document.hidden || !s.gpu) return;
  s.last = performance.now();
  s.raf = requestAnimationFrame((now) => frame(s, now));
}

function redrawAll(s: Shared) {
  for (const inst of s.instances) inst.dirty = true;
  wake(s);
}

function pixels(size: number): number {
  const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
  return Math.max(1, Math.min(MAX_PX, Math.round(size * dpr)));
}

function frame(s: Shared, now: number) {
  s.raf = 0;
  const gpu = s.gpu;
  if (!gpu || document.hidden) return;
  const dt = Math.min(0.05, Math.max(0, (now - s.last) / 1000));
  s.last = now;
  s.clock += dt;

  let animating = false;
  for (const inst of s.instances) {
    if (!inst.onScreen || inst.size <= 0) continue;
    if (s.reduced) {
      if (!inst.dirty) continue;
      inst.motion.settle();
    } else {
      inst.motion.step(dt);
      animating = true;
    }
    draw(s, gpu, inst);
    inst.dirty = false;
  }
  if (animating) s.raf = requestAnimationFrame((t) => frame(s, t));
}

function draw(s: Shared, { gl, u }: Gpu, inst: Instance) {
  const px = pixels(inst.size);
  if (inst.canvas.width !== px || inst.canvas.height !== px) {
    inst.canvas.width = px;
    inst.canvas.height = px;
  }
  // The shared canvas only grows: resizing it reallocates its buffer.
  if (s.canvas.width < px || s.canvas.height < px) {
    s.canvas.width = Math.max(s.canvas.width, px);
    s.canvas.height = Math.max(s.canvas.height, px);
  }

  const f = inst.motion.frame();
  const light = document.documentElement.dataset.theme === 'light';
  gl.viewport(0, 0, px, px);
  gl.uniform2f(u.uRes, px, px);
  gl.uniform1f(u.uTime, s.clock);
  gl.uniform1f(u.uPhase, f.phase);
  gl.uniform1f(u.uView, VIEW);
  gl.uniform1f(u.uPx, (2 * VIEW) / px);
  gl.uniform1f(u.uTheme, light ? 0 : 1);
  gl.uniform1f(u.uDim, f.dim);
  gl.uniform1f(u.uTint, f.tint);
  gl.uniform3f(u.uPos, f.pos[0], f.pos[1], 0);
  gl.uniform3f(u.uScale, f.scale[0], f.scale[1], f.scale[2]);
  gl.uniformMatrix3fv(u.uRot, false, rotation(f.yaw, f.pitch, f.roll));
  gl.uniform4f(u.uEye0, ...f.eyeL);
  gl.uniform4f(u.uEye1, ...f.eyeR);
  gl.uniform1i(u.uKindL, f.kind[0]);
  gl.uniform1i(u.uKindR, f.kind[1]);
  gl.drawArrays(gl.TRIANGLES, 0, 3);

  // The viewport is the bottom-left corner in GL, which is the bottom rows of the canvas image.
  inst.ctx.clearRect(0, 0, px, px);
  inst.ctx.drawImage(s.canvas, 0, s.canvas.height - px, px, px, 0, 0, px, px);
}

/** Start drawing Opsy into `canvas`. Returns null when WebGL2 is not available. */
export function attachOpsy(canvas: HTMLCanvasElement, state: OpsyState, size: number): OpsyHandle | null {
  const s = getShared();
  const ctx = canvas.getContext('2d');
  if (!s || !ctx) return null;
  const inst: Instance = {
    canvas, ctx, motion: new OpsyMotion(state, s.timing), size,
    // Without IntersectionObserver, assume it shows.
    onScreen: s.io === null, dirty: true,
  };
  s.instances.add(inst);
  s.byCanvas.set(canvas, inst);
  s.io?.observe(canvas);
  wake(s);
  return {
    setState(next) {
      if (next === inst.motion.state) return;
      inst.motion.setState(next);
      inst.dirty = true;
      wake(s);
    },
    setSize(next) {
      if (next === inst.size) return;
      inst.size = next;
      inst.dirty = true;
      wake(s);
    },
    detach() {
      s.instances.delete(inst);
      s.byCanvas.delete(canvas);
      s.io?.unobserve(canvas);
      if (s.instances.size === 0) stop(s);
    },
  };
}
