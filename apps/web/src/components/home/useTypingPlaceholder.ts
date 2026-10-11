import { useEffect, useRef, useState } from 'react';

const PHRASES = [
  'What should the agent do?',
  'Fix the barge-in bug and open a PR',
  'Summarize Fjord Bank feedback from Linear',
  'Review open pull requests on GitHub',
  'Deploy the console preview to Vercel',
  'Draft release notes 3.3 in Notion',
];

/**
 * A placeholder that erases itself letter by letter and types the next example.
 * Pauses while the user is typing; with reduced motion it just swaps phrases.
 */
export function useTypingPlaceholder(active: boolean, paused: boolean, reduced: boolean): string {
  const [text, setText] = useState(PHRASES[0]);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useEffect(() => {
    if (!active) return;
    let phrase = 0;
    let shown = PHRASES[0];
    let phase: 'hold' | 'erase' | 'type' = 'hold';
    let timer = 0;
    setText(shown);

    const step = () => {
      let delay: number;
      if (pausedRef.current) {
        delay = 800;
      } else if (reduced) {
        phrase = (phrase + 1) % PHRASES.length;
        shown = PHRASES[phrase];
        delay = 4000;
      } else if (phase === 'hold') {
        phase = 'erase';
        delay = 0;
      } else if (phase === 'erase') {
        if (shown.length) { shown = shown.slice(0, -1); delay = 28; }
        else { phrase = (phrase + 1) % PHRASES.length; phase = 'type'; delay = 300; }
      } else {
        const target = PHRASES[phrase];
        if (shown.length < target.length) { shown = target.slice(0, shown.length + 1); delay = 55; }
        else { phase = 'hold'; delay = 2600; }
      }
      setText(shown);
      timer = window.setTimeout(step, delay);
    };
    timer = window.setTimeout(step, 2600);
    return () => window.clearTimeout(timer);
  }, [active, reduced]);

  return text;
}
