// Opsy as a still SVG image: for browsers without WebGL2.
// Same geometry as the shader at rest (ball radius 1, view ±1.3, eyes from
// POSES), drawn flat: a lime gradient, a highlight, and the eyes.

import { useId } from 'react';
import type { OpsyState } from '../../data/opsyFocus';
import { EYE, POSES, type EyeKind } from './model';

const INK = '#090A09';
const S = 0.115; // eye size at rest, as in OpsyMotion.frame()
const EY = 0.1;  // eye height

function Eye({ kind, x, closed }: { kind: EyeKind; x: number; closed: boolean }) {
  const y = -EY; // SVG's y points down
  const line = { stroke: INK, strokeLinecap: 'round' as const, fill: 'none' };
  if (closed) return <path d={`M${x - 0.88 * S} ${y}H${x + 0.88 * S}`} strokeWidth={0.44 * S} {...line} />;
  if (kind === EYE.dot) return <circle cx={x} cy={y} r={S} fill={INK} />;
  if (kind === EYE.question) {
    // the same hook, stem and dot as sdQuestion() in shader.ts, in a box of half-size 2.3·S
    return (
      <g transform={`translate(${x} ${y}) scale(${2.3 * S})`}>
        <path d="M0 -0.02A0.36 0.36 0 1 0 -0.338 -0.503M0 -0.02V0.25" strokeWidth={0.24} {...line} />
        <circle cx={0} cy={0.62} r={0.14} fill={INK} />
      </g>
    );
  }
  if (kind === EYE.arc) {
    const ra = 1.55 * S, ha = 0.72;
    const cy = y + ra - 0.32 * S; // the arc's centre, below the eye
    const ex = ra * Math.sin(ha), ey = cy - ra * Math.cos(ha);
    return <path d={`M${x - ex} ${ey}A${ra} ${ra} 0 0 1 ${x + ex} ${ey}`} strokeWidth={0.44 * S} {...line} />;
  }
  const d = 0.95 * S * Math.SQRT1_2;
  return <path d={`M${x - d} ${y - d}L${x + d} ${y + d}M${x - d} ${y + d}L${x + d} ${y - d}`} strokeWidth={0.48 * S} {...line} />;
}

export function OpsyStill({ state, size }: { state: OpsyState; size: number }) {
  const pose = POSES[state];
  const closed = pose.lid < 0.5;
  const id = `opsy-still${useId().replace(/:/g, '')}`;
  return (
    <svg className="op-opsy" width={size} height={size} viewBox="-1.3 -1.3 2.6 2.6" aria-hidden="true" data-state={state}>
      <defs>
        <radialGradient id={id} cx="0.38" cy="0.32" r="0.75">
          <stop offset="0" stopColor="#F0FCBD" />
          <stop offset="0.45" stopColor="#C8F03C" />
          <stop offset="0.85" stopColor="#8CCC1A" />
          <stop offset="1" stopColor="#4F8A0F" />
        </radialGradient>
      </defs>
      <circle r={1} fill={`url(#${id})`} />
      {pose.dim > 0 && <circle r={1} fill="#000" opacity={pose.dim * 0.55} />}
      <ellipse cx={-0.42} cy={-0.5} rx={0.32} ry={0.2} fill="#fff" opacity={0.55} transform="rotate(-35 -0.42 -0.5)" />
      {pose.tint > 0 && <circle r={0.95} fill="none" stroke="#FF5A4E" strokeWidth={0.1} opacity={0.8} />}
      <Eye kind={pose.kind[0]} x={-pose.sep} closed={closed} />
      <Eye kind={pose.kind[1]} x={pose.sep} closed={closed} />
    </svg>
  );
}
