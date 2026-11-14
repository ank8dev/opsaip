import { describe, expect, it } from 'vitest';
import { createOverlayHistory } from './overlayHistory';

function fake() {
  const calls: string[] = [];
  return { calls, pushState: () => { calls.push('push'); }, back: () => { calls.push('back'); } };
}

describe('overlay history', () => {
  it('adds one entry when it opens, however often opened() is called', () => {
    const h = fake();
    const o = createOverlayHistory(h);
    o.opened(); o.opened();
    expect(h.calls).toEqual(['push']);
  });

  it('the back button closes the overlay, once', () => {
    const o = createOverlayHistory(fake());
    o.opened();
    expect(o.popped()).toBe(true);
    expect(o.popped()).toBe(false);
  });

  it('closing from the app removes the entry, and the resulting popstate closes nothing', () => {
    const h = fake();
    const o = createOverlayHistory(h);
    o.opened();
    o.closed();
    expect(h.calls).toEqual(['push', 'back']);
    expect(o.popped()).toBe(false);
  });

  it('does not touch history when it was never opened', () => {
    const h = fake();
    const o = createOverlayHistory(h);
    o.closed();
    expect(h.calls).toEqual([]);
    expect(o.popped()).toBe(false);
  });

  it('can open again after closing', () => {
    const h = fake();
    const o = createOverlayHistory(h);
    o.opened(); o.closed(); o.popped(); o.opened();
    expect(h.calls).toEqual(['push', 'back', 'push']);
    expect(o.popped()).toBe(true);
  });

  it('works without a back button when pushState throws', () => {
    const o = createOverlayHistory({ pushState: () => { throw new Error('blocked'); }, back: () => {} });
    o.opened();
    expect(o.popped()).toBe(false);
  });
});
