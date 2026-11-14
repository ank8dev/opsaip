import { useCallback, useEffect, useRef, useState } from 'react';
import { NO_CAPABILITIES, fileProblem, type AttachPurpose, type AttachmentKind, type Capabilities, typeOf, type PlaceCapabilities } from '../../data/attachments/capabilities';
import { uploadProblemText, type Upload } from '../../data/attachments/upload';
import type { ServerApi } from '../../data/chat/serverApi';

/** What can be attached here: asked once when the app is live. A server without the endpoint means no attachments. */
export function useCapabilities(api: ServerApi, live: boolean): Capabilities {
  const [caps, setCaps] = useState<Capabilities>(NO_CAPABILITIES);
  useEffect(() => {
    if (!live) { setCaps(NO_CAPABILITIES); return; }
    const c = new AbortController();
    void api.capabilities(c.signal).then((r) => { if (!c.signal.aborted) setCaps(r.ok ? r.value : NO_CAPABILITIES); });
    return () => c.abort();
  }, [api, live]);
  return caps;
}

export interface AttachmentItem {
  key: string;
  name: string;
  size: number;
  kind: AttachmentKind | 'file';
  /** An object URL of an image, for its thumbnail. Revoked when the chip goes. */
  preview?: string;
  status: 'uploading' | 'ready' | 'error';
  upload?: Upload;
  error?: string;
}

/**
 * The files attached to the message being written. Each file is uploaded as soon
 * as it is accepted (POST /v1/uploads); the message then sends only the ids.
 * Files the server would refuse are not added; `notice` says why. Everything is
 * in memory: nothing is stored on this page.
 */
export function useAttachments(api: ServerApi, purpose: AttachPurpose | null, place: PlaceCapabilities) {
  const [items, setItems] = useState<AttachmentItem[]>([]);
  const [notice, setNotice] = useState('');
  const seq = useRef(0);
  const aborts = useRef(new Map<string, AbortController>());
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const drop = useCallback((item: AttachmentItem, tellServer: boolean) => {
    aborts.current.get(item.key)?.abort();
    aborts.current.delete(item.key);
    if (item.preview) URL.revokeObjectURL(item.preview);
    if (tellServer && item.upload) void api.deleteUpload(item.upload.id);
  }, [api]);

  const add = useCallback(
    (files: readonly File[]) => {
      if (purpose === null || files.length === 0) return;
      const problems: string[] = [];
      const added: { item: AttachmentItem; file: File }[] = [];
      let count = itemsRef.current.filter((i) => i.status !== 'error').length;
      for (const file of files) {
        const why = fileProblem(file, place, purpose, count);
        if (why !== undefined) { problems.push(why); continue; }
        count += 1;
        const kind = typeOf(file, place.types)?.id ?? 'file';
        const item: AttachmentItem = {
          key: `a${++seq.current}`, name: file.name, size: file.size, kind, status: 'uploading',
          ...(kind === 'image' ? { preview: URL.createObjectURL(file) } : {}),
        };
        added.push({ item, file });
      }
      setNotice(problems.join(' '));
      if (added.length === 0) return;
      setItems((list) => [...list, ...added.map((a) => a.item)]);
      for (const { item, file } of added) {
        const c = new AbortController();
        aborts.current.set(item.key, c);
        void api.upload(purpose, file, c.signal).then((r) => {
          if (c.signal.aborted) return;
          aborts.current.delete(item.key);
          setItems((list) => list.map((i) => (i.key !== item.key ? i : r.ok
            ? { ...i, status: 'ready', upload: r.upload, name: r.upload.name, size: r.upload.size }
            : { ...i, status: 'error', error: uploadProblemText(r.problem, r.reason) })));
        });
      }
    },
    [api, purpose, place],
  );

  const remove = useCallback((key: string) => {
    const item = itemsRef.current.find((i) => i.key === key);
    if (!item) return;
    drop(item, true);
    setItems((list) => list.filter((i) => i.key !== key));
    setNotice('');
  }, [drop]);

  /** Forget everything. `tellServer` false after the message used the files: the server already consumed them. */
  const clear = useCallback((tellServer: boolean) => {
    for (const item of itemsRef.current) drop(item, tellServer);
    setItems([]);
    setNotice('');
  }, [drop]);

  // Files belong to one place (Ask or Agent): leaving it drops them.
  const was = useRef(purpose);
  useEffect(() => {
    if (was.current !== purpose) { clear(true); was.current = purpose; }
  }, [purpose, clear]);
  useEffect(() => () => { for (const item of itemsRef.current) drop(item, true); }, [drop]);

  return {
    items, notice, add, remove, clear,
    ids: items.filter((i) => i.status === 'ready' && i.upload).map((i) => i.upload!.id),
    uploading: items.some((i) => i.status === 'uploading'),
    hasError: items.some((i) => i.status === 'error'),
  };
}

export type Attachments = ReturnType<typeof useAttachments>;
