import { useRef, useState, type KeyboardEvent } from 'react';

export interface Choice {
  value: string;
  title: string;
  description: string;
  badge?: string;
}

/** A vertical radio group of cards: one choice with a title and an explanation. */
export function Choices({ label, choices, defaultValue }: { label: string; choices: Choice[]; defaultValue: string }) {
  const [value, setValue] = useState(defaultValue);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function onKey(e: KeyboardEvent, i: number) {
    const d = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const n = (i + d + choices.length) % choices.length;
    setValue(choices[n].value);
    refs.current[n]?.focus();
  }

  return (
    <div className="op-choices" role="radiogroup" aria-label={label}>
      {choices.map((c, i) => (
        <button
          key={c.value}
          ref={(el) => { refs.current[i] = el; }}
          type="button"
          className="op-choice"
          role="radio"
          aria-checked={c.value === value}
          tabIndex={c.value === value ? 0 : -1}
          onClick={() => setValue(c.value)}
          onKeyDown={(e) => onKey(e, i)}
        >
          <span className="op-radio" aria-hidden="true" />
          <span className="op-choice-t">
            {c.title}
            {c.badge && <span className="op-choice-b">{c.badge}</span>}
          </span>
          <span className="op-choice-d">{c.description}</span>
        </button>
      ))}
    </div>
  );
}
