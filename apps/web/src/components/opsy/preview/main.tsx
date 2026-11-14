// Dev-only preview of Opsy: every state at the sizes the app is likely to use,
// one big Opsy to watch transitions, and the still image used without WebGL2.
// Loaded only by dev/opsy.html, which is not a build input.

import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/instrument-sans/400.css';
import '@fontsource/instrument-sans/500.css';
import '@fontsource/dm-mono/400.css';
import '../../../styles/tokens.css';
import '../../../styles/base.css';
import './preview.css';
import type { OpsyState } from '../../../data/opsyFocus';
import { Opsy } from '../Opsy';
import { OpsyStill } from '../OpsyStill';

const STATES: OpsyState[] = ['idle', 'working', 'question', 'done', 'error', 'offline', 'hello'];
const SIZES = [24, 40, 96];

function Preview() {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [reduce, setReduce] = useState(false);
  const [big, setBig] = useState<OpsyState>('idle');

  const applyTheme = (t: 'dark' | 'light') => {
    setTheme(t);
    if (t === 'light') document.documentElement.dataset.theme = 'light';
    else delete document.documentElement.dataset.theme;
  };
  const applyReduce = (on: boolean) => {
    setReduce(on);
    if (on) document.documentElement.dataset.motion = 'reduce';
    else delete document.documentElement.dataset.motion;
  };

  return (
    <main className="opv">
      <header className="opv-bar">
        <h1>Opsy preview <span className="op-mono">dev only</span></h1>
        <button type="button" onClick={() => applyTheme(theme === 'dark' ? 'light' : 'dark')}>Theme: {theme}</button>
        <button type="button" aria-pressed={reduce} onClick={() => applyReduce(!reduce)}>Reduced motion: {reduce ? 'on' : 'off'}</button>
      </header>

      <section className="opv-stage">
        <Opsy state={big} size={220} />
        <div className="opv-chips">
          {STATES.map((s) => (
            <button key={s} type="button" aria-pressed={big === s} onClick={() => setBig(s)}>{s}</button>
          ))}
        </div>
      </section>

      <section>
        <h2>Every state, live</h2>
        <div className="opv-grid">
          {STATES.map((s) => (
            <figure key={s}>
              <div className="opv-sizes">{SIZES.map((z) => <Opsy key={z} state={s} size={z} />)}</div>
              <figcaption className="op-mono">{s}</figcaption>
            </figure>
          ))}
        </div>
      </section>

      <section>
        <h2>Still image (no WebGL2)</h2>
        <div className="opv-grid">
          {STATES.map((s) => (
            <figure key={s}>
              <div className="opv-sizes">{SIZES.map((z) => <OpsyStill key={z} state={s} size={z} />)}</div>
              <figcaption className="op-mono">{s}</figcaption>
            </figure>
          ))}
        </div>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Preview />
  </StrictMode>,
);
