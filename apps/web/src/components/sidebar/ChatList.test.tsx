import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChatList } from './ChatList';

const tokens = {
  fast: 0, base: 0, slow: 0, stagger: 0, enterStep: 0, dist: 0, blur: 0, scaleFrom: 1,
  easeOut: [0, 0, 1, 1], easeExit: [0, 0, 1, 1], easeSpring: [0, 0, 1, 1], reduced: true,
};
const state = vi.hoisted(() => ({ enabled: true, chats: [] as { id: string; title: string }[], chatId: null as string | null, error: '' }));
vi.mock('../../state/ui', () => ({ useUi: () => ({ motion: tokens, setSettingsOpen: () => {}, closeTask: () => {} }) }));
vi.mock('../../state/chats', () => ({
  useChats: () => ({ enabled: state.enabled, chats: state.chats, session: { key: 0, chatId: state.chatId }, error: state.error, newChat: () => {}, openChat: () => {}, rename: async () => undefined, remove: async () => {} }),
}));

describe('ChatList', () => {
  it('has a New chat button and a row per chat with rename and delete', () => {
    state.enabled = true; state.chats = [{ id: 'a', title: 'First' }, { id: 'b', title: '<b>Second</b>' }]; state.chatId = 'a';
    const out = renderToStaticMarkup(<ChatList />);
    expect(out).toContain('New chat');
    expect(out).toContain('aria-label="Rename First"');
    expect(out).toContain('aria-label="Delete First"');
    expect(out).toMatch(/aria-current="true"[^>]*title="First"/);
  });

  it('draws a chat name as text, never as HTML', () => {
    state.chats = [{ id: 'b', title: '<img src=x onerror=1>' }];
    const out = renderToStaticMarkup(<ChatList />);
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;img');
  });

  it('shows an error as an alert', () => {
    state.error = 'I could not load your chats.';
    expect(renderToStaticMarkup(<ChatList />)).toContain('role="alert"');
    state.error = '';
  });

  it('is not shown in Demo', () => {
    state.enabled = false;
    expect(renderToStaticMarkup(<ChatList />)).toBe('');
  });
});
