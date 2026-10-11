// The Conductor: the one baton in Opsaip.
//
// It lives just right of the sidebar and travels the whole dashboard to whatever
// it is conducting — the open task, else the most important one waiting for you,
// else an agent that is working. Its tip always points at that task's status dot.
//
//   light   muted = nothing running · lime = agents playing · red = a task failed
//   beat    a downbeat while the agent it points at is working
//   cue     a task starts: it flies there, an upbeat, the light flashes
//   hold    a task needs you: raised and still (a fermata) until you answer
//   fail    a dip; release: a small flick; the last one ends with a cut-off
//
// Travel follows Fluid (settles, never overshoots). Reduced motion: it jumps and
// does not beat.

import { useEffect, useRef, type RefObject } from 'react';
import { animate, motion, useMotionValue } from 'motion/react';
import type { AnyTask, TaskStatus } from '../../types';
import { useWorkspace } from '../../state/workspace';
import { useUi } from '../../state/ui';
import { locate, restPoint, type Point } from './findTarget';
import './Baton.css';

const LEAN = 33;     // the baton is drawn leaning 33°, the logo pose
const LENGTH = 31.7; // grip to the centre of the tip, in px
const GAP = 12;      // how far the tip stops short of the target
const HOLD = -15;    // raised while a task needs you

type EventType = 'cue' | 'beat' | 'hold' | 'fail' | 'release';
interface ConductEvent { type: EventType; id: string }

/** Grip position and angle so the tip points at `p` from below-left (or below-right near the left edge). */
function aim(p: Point): { x: number; y: number; angle: number } {
  const d = LENGTH + GAP;
  for (const angle of [LEAN, -LEAN]) {
    const rad = (angle * Math.PI) / 180;
    const x = p.x - d * Math.sin(rad);
    const y = p.y + d * Math.cos(rad);
    if (x >= 6 || angle === -LEAN) return { x, y, angle };
  }
  return { x: p.x, y: p.y, angle: LEAN };
}

function lightState(tasks: AnyTask[]): 'idle' | 'live' | 'error' {
  if (tasks.some((t) => t.status === 'Failed')) return 'error';
  if (tasks.some((t) => t.status === 'Working' || t.status === 'Needs you')) return 'live';
  return 'idle';
}

export function Baton({ rootRef }: { rootRef: RefObject<HTMLElement | null> }) {
  const { allTasks, attentionTasks } = useWorkspace();
  const ui = useUi();
  const t = ui.motion;

  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const pose = useMotionValue(0);     // aim, relative to the drawn lean
  const gesture = useMotionValue(0);  // beats on top of the aim
  const flash = useMotionValue(1);    // the tip's light, scaled on a cue

  // ---- what to conduct ----
  // A gesture can briefly take the baton to a task (`focus`); otherwise it goes to
  // the open task, else the most important one waiting for you, else a working agent.
  const focus = useRef<{ id: string; until: number } | null>(null);
  const attention = attentionTasks(ui.trayLevel);
  const working = allTasks.find((task) => task.status === 'Working');
  const defaultId = ui.openTaskId ?? attention[0]?.id ?? working?.id ?? null;

  const latest = useRef({ defaultId, statusOf: new Map<string, TaskStatus>(), t });
  latest.current = { defaultId, statusOf: new Map(allTasks.map((task) => [task.id, task.status])), t };
  const busy = useRef(0);

  const currentTarget = () =>
    focus.current && focus.current.until > Date.now() ? focus.current.id : latest.current.defaultId;
  const currentStatus = () => {
    const id = currentTarget();
    return id ? latest.current.statusOf.get(id) ?? null : null;
  };
  const restAngle = () => (currentStatus() === 'Needs you' ? HOLD : 0);

  // ---- travel: follow the target every frame, wherever it moves on screen ----
  const placed = useRef<{ x: number; y: number; angle: number } | null>(null);
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const root = rootRef.current;
      if (root) {
        const id = currentTarget();
        const tok = latest.current.t;
        const p = (id && (locate(root, id) ?? locate(root, 'tray'))) || null;
        const next = p ? aim(p) : { ...restPoint(root), angle: LEAN };
        const last = placed.current;
        const moved = !last || Math.hypot(next.x - last.x, next.y - last.y) > 1 || next.angle !== last.angle;
        if (moved) {
          const first = !last;
          placed.current = next;
          const opts = { duration: first ? 0 : tok.baton, ease: tok.easeBaton };
          animate(x, next.x, opts);
          animate(y, next.y, opts);
          animate(pose, next.angle - LEAN, opts);
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [rootRef, x, y, pose]); // currentTarget() reads the latest values through refs

  // ---- gestures ----
  async function play(frames: number[], duration: number, times?: number[]) {
    if (latest.current.t.reduced) return;
    await animate(gesture, frames, { duration, times, ease: 'easeInOut' });
  }

  async function perform(ev: ConductEvent, finale: boolean) {
    const tok = latest.current.t;
    // fly to the task first, then gesture there
    focus.current = { id: ev.id, until: Date.now() + tok.baton * 1000 + 900 };
    await new Promise((r) => setTimeout(r, tok.baton * 1000 * 0.8));
    const b = gesture.get();
    if (ev.type === 'cue') {
      await play([b, b - 10, b + 4, 0], 0.48, [0, 0.3, 0.7, 1]);
      if (!tok.reduced) await animate(flash, [1, 1.7, 1], { duration: 0.38, ease: tok.easeOut });
    } else if (ev.type === 'beat') {
      await play([b, b - 7, b + 13, b + 7, b], 0.46, [0, 0.28, 0.55, 0.78, 1]);
    } else if (ev.type === 'hold') {
      await play([b, HOLD], 0.48);
    } else if (ev.type === 'fail') {
      await play([b, b + 18, b], 0.52, [0, 0.5, 1]);
    } else if (ev.type === 'release') {
      if (finale) await play([b, b - 14, b + 6, b + 24, 0], 0.76, [0, 0.25, 0.5, 0.72, 1]); // cut-off
      else await play([b, b - 6, b + 20, b], 0.48, [0, 0.35, 0.65, 1]);
    }
  }

  // Watch task statuses: every change becomes a gesture, played one after another.
  const prev = useRef<Map<string, { status: TaskStatus; detail: string }> | null>(null);
  const chain = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    const nowMap = new Map(allTasks.map((task) => [task.id, { status: task.status, detail: task.detail }]));
    const before = prev.current;
    prev.current = nowMap;
    if (!before) return; // first data: nothing happened yet

    const events: ConductEvent[] = [];
    for (const task of allTasks) {
      const p = before.get(task.id);
      if (!p || p.status !== task.status) {
        if (task.status === 'Working') events.push({ type: p?.status === 'Needs you' ? 'beat' : 'cue', id: task.id });
        else if (task.status === 'Needs you') events.push({ type: 'hold', id: task.id });
        else if (task.status === 'Failed') events.push({ type: 'fail', id: task.id });
        else if (task.status === 'Done') events.push({ type: 'release', id: task.id });
      } else if (task.status === 'Working' && p.detail !== task.detail) {
        events.push({ type: 'beat', id: task.id });
      }
    }
    const finale = !allTasks.some((task) => task.status === 'Working' || task.status === 'Needs you');
    for (const ev of events) {
      if (ev.type === 'beat' && busy.current > 3) continue; // a burst of steps plays as a few beats
      busy.current++;
      chain.current = chain.current
        .then(() => perform(ev, finale && ev.type === 'release'))
        .finally(() => {
          busy.current--;
          if (!busy.current) animate(gesture, restAngle(), { duration: latest.current.t.base, ease: latest.current.t.easeSpring });
        });
    }
  }, [allTasks]); // perform() reads the latest values through refs

  // At rest between events: held up for "Needs you", level otherwise,
  // and a steady beat while the agent it points at is working.
  const defaultStatus = defaultId ? latest.current.statusOf.get(defaultId) : null;
  useEffect(() => {
    if (!busy.current) animate(gesture, restAngle(), { duration: t.base, ease: t.easeSpring });
  }, [defaultId, defaultStatus, t]); // restAngle() reads the latest status through refs
  useEffect(() => {
    if (t.reduced) return;
    const id = window.setInterval(() => {
      if (busy.current || currentStatus() !== 'Working') return;
      animate(gesture, [0, -7, 13, 7, 0], { duration: 0.46, times: [0, 0.28, 0.55, 0.78, 1], ease: 'easeInOut' });
    }, 2400);
    return () => window.clearInterval(id);
  }, [t.reduced]);

  const state = lightState(allTasks);
  const needs = attention.length;
  const label = needs ? `${needs} ${needs === 1 ? 'needs' : 'need'} you` : state === 'live' ? 'agents running' : state === 'error' ? 'a task failed' : 'resting';

  return (
    <>
      <motion.div className="op-baton" data-state={state} style={{ x, y }} aria-hidden="true">
        <motion.div className="op-baton-layer" style={{ rotate: pose }}>
          <motion.div className="op-baton-layer" style={{ rotate: gesture }}>
            <svg className="op-baton-svg" viewBox="0 0 28 32" width="28" height="32">
              <g transform="translate(4,31) scale(0.56)">
                <path className="op-baton-stick" d="M-4.61 -2.09 Q-5.98 0 -3.48 0 L3.47 0 Q5.97 0 7.34 -2.09 L26.88 -31.91 Q28.25 -34 25.75 -34 L18.79 -34 Q16.29 -34 14.92 -31.91 Z" />
              </g>
            </svg>
            <motion.span className="op-baton-light" style={{ scale: flash }} />
          </motion.div>
        </motion.div>
      </motion.div>
      <span className="op-sr-only" role="status">Conductor: {label}</span>
    </>
  );
}
