// Opsy, the glass ball: <Opsy state="question" size={40} />
//
// `state` comes from opsyFocus() (data/opsyFocus.ts); `size` is the width and
// height in CSS px. Every Opsy on the page shares one WebGL2 context (see
// renderer.ts). Without WebGL2 it is a still SVG image.
//
// Decorative: it is hidden from screen readers. Whatever puts Opsy on the page
// says in text what the state means.

import { useEffect, useRef, useState } from 'react';
import type { OpsyState } from '../../data/opsyFocus';
import { attachOpsy, canRenderOpsy, type OpsyHandle } from './renderer';
import { OpsyStill } from './OpsyStill';
import './Opsy.css';

export interface OpsyProps {
  state: OpsyState;
  /** Width and height, CSS px. */
  size: number;
}

export function Opsy({ state, size }: OpsyProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const handle = useRef<OpsyHandle | null>(null);
  const [live, setLive] = useState(() => canRenderOpsy());

  // Attach once; later state and size changes go through the handle, so the
  // springs carry on from wherever they are.
  const first = useRef({ state, size });
  useEffect(() => {
    if (!live || !ref.current) return;
    const h = attachOpsy(ref.current, first.current.state, first.current.size);
    if (!h) { setLive(false); return; }
    handle.current = h;
    return () => { h.detach(); handle.current = null; };
  }, [live]);

  useEffect(() => { first.current.state = state; handle.current?.setState(state); }, [state]);
  useEffect(() => { first.current.size = size; handle.current?.setSize(size); }, [size]);

  if (!live) return <OpsyStill state={state} size={size} />;
  return <canvas ref={ref} className="op-opsy" style={{ width: size, height: size }} aria-hidden="true" data-state={state} />;
}
