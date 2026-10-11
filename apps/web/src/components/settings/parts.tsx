// Building blocks for the Settings page. Most settings are previews: they keep
// their own state and say so in the note under the title.

import { createContext, useContext, useState, type ReactNode } from 'react';
import { Picker, type PickerOption } from '../common/Picker';

/** Shows a short message in the note under the Settings title. */
export const PreviewContext = createContext<(msg: string) => void>(() => {});
export const usePreview = () => useContext(PreviewContext);

export function SettingsSection({ id, title, lead, children }: { id: string; title: string; lead: string; children: ReactNode }) {
  return (
    <section className="op-set-sec" id={id} aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`}>{title}</h2>
      <p className="op-set-lead">{lead}</p>
      {children}
    </section>
  );
}

export function Card({ children, label }: { children: ReactNode; label?: string }) {
  return <div className="op-set-card" aria-label={label}>{children}</div>;
}

interface RowProps {
  title: ReactNode;
  description?: ReactNode;
  /** The control takes the full width under the text. */
  block?: boolean;
  children: ReactNode;
}

/** A setting: name and explanation on the left, its control on the right. */
export function SettingRow({ title, description, block = false, children }: RowProps) {
  return (
    <div className={`op-set-row${block ? ' op-set-row-block' : ''}`}>
      <div className="op-set-txt">
        <span className="op-set-k">{title}</span>
        {description && <span className="op-set-d">{description}</span>}
      </div>
      <div className="op-set-ctl">{children}</div>
    </div>
  );
}

/** A button that only previews its action. */
export function PreviewButton({ label, preview, danger = false }: { label: string; preview: string; danger?: boolean }) {
  const show = usePreview();
  return (
    <button type="button" className={`op-sbtn${danger ? ' op-sbtn-danger' : ''}`} onClick={() => show(preview)}>
      {label}
    </button>
  );
}

/** A picker that keeps its own value (preview settings). */
export function LocalPicker({ ariaLabel, options, defaultValue }: { ariaLabel: string; options: PickerOption[]; defaultValue: string }) {
  const [value, setValue] = useState(defaultValue);
  return <Picker ariaLabel={ariaLabel} value={value} options={options} onChange={setValue} />;
}

/** A line of code with a Copy button. */
export function CopyCode({ code }: { code: string }) {
  const [label, setLabel] = useState('Copy');
  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setLabel('Copied');
    } catch {
      setLabel('Select and copy');
    }
    window.setTimeout(() => setLabel('Copy'), 1600);
  }
  return (
    <div className="op-code">
      <code>{code}</code>
      <button type="button" className="op-sbtn" onClick={copy}>{label}</button>
    </div>
  );
}

/** "00:00" … "23:00" */
export const HOURS: PickerOption[] = Array.from({ length: 24 }, (_, h) => ({
  value: String(h),
  label: `${String(h).padStart(2, '0')}:00`,
}));
