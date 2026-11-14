import { AnimatePresence, motion } from 'motion/react';
import { formatBytes, type AttachmentKind } from '../../data/attachments/capabilities';
import { useUi } from '../../state/ui';
import { popover } from '../../styles/motion';
import type { AttachmentItem } from './useAttachments';

const KIND_BADGE: Record<AttachmentKind | 'file', string> = { image: 'IMG', video: 'VID', pdf: 'PDF', text: 'TXT', file: 'FILE' };
const KIND_WORD: Record<AttachmentKind | 'file', string> = { image: 'image', video: 'video', pdf: 'PDF', text: 'text file', file: 'file' };

/** One attached file as it appears in a message already sent (display only). */
export function FileChip({ name, kind, size }: { name: string; kind: AttachmentKind; size: number }) {
  return (
    <span className="op-chip-file" title={name}>
      <span className="op-chip-badge" aria-hidden="true">{KIND_BADGE[kind]}</span>
      <span className="op-chip-name">{name}</span>
      <span className="op-chip-size">{formatBytes(size)}</span>
      <span className="op-sr-only"> ({KIND_WORD[kind]})</span>
    </span>
  );
}

/**
 * The files attached to the message being written: a chip each, with a preview for
 * images, its state in words, and a remove button.
 *
 * Motion: chips enter and leave with `popover` from styles/motion.ts, inside
 * AnimatePresence, like the app's menus; no new values; reduced motion comes
 * from the tokens.
 */
export function AttachmentChips({ items, onRemove }: { items: readonly AttachmentItem[]; onRemove: (key: string) => void }) {
  const t = useUi().motion;
  return (
    <ul className="op-attach-list" aria-label="Attached files">
      <AnimatePresence initial={false}>
        {items.map((i) => (
          <motion.li key={i.key} className="op-attach" data-status={i.status} {...popover(t, t.dist / 2)}>
            {i.preview
              ? <img className="op-attach-thumb" src={i.preview} alt="" />
              : <span className="op-attach-thumb op-attach-kind" aria-hidden="true">{KIND_BADGE[i.kind]}</span>}
            <span className="op-attach-text">
              <span className="op-attach-name" title={i.name}>{i.name}</span>
              <span className="op-attach-sub" role={i.status === 'error' ? 'alert' : undefined}>
                {i.status === 'uploading' ? 'Uploading…' : i.status === 'error' ? i.error : `${KIND_WORD[i.kind]} · ${formatBytes(i.size)}`}
              </span>
            </span>
            <button type="button" className="op-attach-x" aria-label={`Remove ${i.name}`} onClick={() => onRemove(i.key)}>×</button>
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  );
}
