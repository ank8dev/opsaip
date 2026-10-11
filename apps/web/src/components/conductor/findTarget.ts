// Finding where on screen the baton should point.
// Anything that can be conducted marks its status dot with data-baton="<task id>"
// (the tray bar uses data-baton="tray"). The same task can show up in several
// places at once; the baton picks the one you are most likely looking at.

export interface Point { x: number; y: number }

/** Where a place is shown, most important first. */
const PREFERENCE = ['.op-card', '.op-tray-body', '.op-side', '.op-main'];

/** The part of `el` that is actually visible: not hidden, not scrolled or clipped away. */
function visibleRect(el: Element, root: Element): DOMRect | null {
  if (el.closest('[hidden]')) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return null;
  let top = r.top, bottom = r.bottom, left = r.left, right = r.right;
  for (let p = el.parentElement; p && p !== root; p = p.parentElement) {
    const s = getComputedStyle(p);
    if (s.overflowX === 'visible' && s.overflowY === 'visible') continue;
    const c = p.getBoundingClientRect();
    top = Math.max(top, c.top); bottom = Math.min(bottom, c.bottom);
    left = Math.max(left, c.left); right = Math.min(right, c.right);
    if (bottom - top < r.height * 0.5 || right - left < r.width * 0.5) return null;
  }
  return r;
}

/** The centre of the best visible element for `key`, relative to `root`. */
export function locate(root: HTMLElement, key: string): Point | null {
  const nodes = Array.from(root.querySelectorAll(`[data-baton="${CSS.escape(key)}"]`));
  const R = root.getBoundingClientRect();
  let best: { rank: number; rect: DOMRect } | null = null;
  for (const n of nodes) {
    const rect = visibleRect(n, root);
    if (!rect) continue;
    const rank = PREFERENCE.findIndex((sel) => n.closest(sel));
    const score = rank < 0 ? PREFERENCE.length : rank;
    if (!best || score < best.rank) best = { rank: score, rect };
  }
  if (!best) return null;
  return { x: best.rect.left + best.rect.width / 2 - R.left, y: best.rect.top + best.rect.height / 2 - R.top };
}

/** Home when nothing is being conducted: standing just right of the sidebar, at the top. */
export function restPoint(root: HTMLElement): Point {
  const R = root.getBoundingClientRect();
  const main = root.querySelector('.op-main')?.getBoundingClientRect();
  return main ? { x: main.left - R.left + 28, y: main.top - R.top + 60 } : { x: 28, y: 60 };
}
