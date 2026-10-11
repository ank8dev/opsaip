import { useState } from 'react';

interface SwitchProps {
  label: string;
  defaultOn?: boolean;
  disabled?: boolean;
}

/** An on/off switch. Preview only: keeps its own state. */
export function Switch({ label, defaultOn = false, disabled = false }: SwitchProps) {
  const [on, setOn] = useState(defaultOn);
  return (
    <button
      type="button"
      className="op-switch"
      role="switch"
      aria-label={label}
      aria-checked={on}
      disabled={disabled}
      onClick={() => setOn(!on)}
    />
  );
}
