import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ThreadMessage } from '../../data/chat/types';
import { ChatThread } from './ChatThread';
import type { Chat } from './useChat';

const tokens = {
  fast: 0, base: 0, slow: 0, stagger: 0, enterStep: 0, dist: 0, blur: 0, scaleFrom: 1,
  easeOut: [0, 0, 1, 1], easeExit: [0, 0, 1, 1], easeSpring: [0, 0, 1, 1], reduced: true,
};
vi.mock('../../state/ui', () => ({ useUi: () => ({ motion: tokens, openTask: () => {} }) }));
vi.mock('../../state/workspace', () => ({ useWorkspace: () => ({ findTask: () => null }) }));
vi.mock('../../lib/useNow', () => ({ useNow: () => new Date(2026, 0, 1, 10) }));
// One marker per Opsy on the page, with the state it shows.
vi.mock('../opsy/Opsy', () => ({ Opsy: ({ state, size }: { state: string; size: number }) => <i data-opsy={state} data-size={size} /> }));

const text = (id: number, t: string): ThreadMessage => ({ id, from: 'opsy', widget: { kind: 'text', text: t } });
const chat = (messages: ThreadMessage[], serverOffline = false) =>
  ({ messages, live: true, serverOffline, decide: () => {}, answerPermission: async () => {}, stop: async () => {} }) as unknown as Chat;
const opsies = (html: string) => [...html.matchAll(/data-opsy="(\w+)" data-size="(\d+)"/g)].map((m) => ({ state: m[1], size: Number(m[2]) }));

describe('ChatThread: one Opsy', () => {
  it('shows only the latest Opsy message with the avatar', () => {
    const html = renderToStaticMarkup(
      <ChatThread chat={chat([
        { id: 1, from: 'you', text: 'a' }, text(2, 'first'),
        { id: 3, from: 'you', text: 'b' }, text(4, 'second'),
        { id: 5, from: 'you', text: 'c' }, text(6, 'third'),
      ])} />,
    );
    expect(opsies(html)).toHaveLength(1);
    // The avatar sits in the last message's row, and the older rows are empty columns.
    expect(html.indexOf('data-opsy')).toBeGreaterThan(html.indexOf('third') - 400);
    expect(html.indexOf('data-opsy')).toBeLessThan(html.indexOf('third'));
    expect(html.indexOf('data-opsy')).toBeGreaterThan(html.indexOf('second'));
  });

  it('draws the avatar larger than the old 32 px', () => {
    const html = renderToStaticMarkup(<ChatThread chat={chat([text(1, 'hi')])} />);
    expect(opsies(html)[0].size).toBeGreaterThanOrEqual(48);
  });

  it('its state follows the latest message: waiting for the server is working', () => {
    const pending: ThreadMessage = { id: 2, from: 'opsy', pending: true, widget: { kind: 'text', text: 'Asking…' } };
    expect(opsies(renderToStaticMarkup(<ChatThread chat={chat([text(1, 'ok'), pending])} />))[0].state).toBe('working');
    expect(opsies(renderToStaticMarkup(<ChatThread chat={chat([pending, text(3, 'ok')])} />))[0].state).toBe('idle');
  });

  it('is offline whatever the message, when the server is offline', () => {
    expect(opsies(renderToStaticMarkup(<ChatThread chat={chat([text(1, 'ok')], true)} />))[0].state).toBe('offline');
  });

  it('has the one intro Opsy before any message', () => {
    expect(opsies(renderToStaticMarkup(<ChatThread chat={chat([])} />))).toHaveLength(1);
  });
});
