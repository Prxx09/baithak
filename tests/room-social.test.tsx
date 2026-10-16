// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RoomChat } from '../src/components/RoomSocial';
let mount: HTMLDivElement, root: ReturnType<typeof createRoot>;
const members = [{ user_id: 'you', display_name: 'You', requested: false, last_seen: '' }, { user_id: 'friend', display_name: 'Friend', requested: false, last_seen: '' }];
const message = (id: number) => ({ id, sender_id: 'friend', body: `Message ${id}`, created_at: new Date().toISOString() });
const base = { members, user: 'you', draft: '', sending: false, onDraft: vi.fn(), onSend: vi.fn(), onTyping: vi.fn() };
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); mount = document.createElement('div'); document.body.appendChild(mount); root = createRoot(mount); });
afterEach(async () => { await act(async () => root.unmount()); mount.remove(); });
it('shows names for typing participants and uses a separate send button loading state', async () => {
  await act(async () => root.render(<RoomChat {...base} messages={[]} typingNames={['Friend']} sending={true} draft="hello"/>));
  expect(mount.querySelector('[role="status"]')?.textContent).toContain('Friend is typing');
  expect(mount.querySelector<HTMLButtonElement>('button[aria-label="Send message"]')?.disabled).toBe(true);
});
it('does not pull readers down and counts unread messages when the 100-message window rolls', async () => {
  const messages = Array.from({ length: 100 }, (_, i) => message(i + 1));
  await act(async () => root.render(<RoomChat {...base} messages={messages} typingNames={[]}/>));
  const scroll = mount.querySelector<HTMLDivElement>('.chat-messages')!;
  Object.defineProperties(scroll, { scrollHeight: { configurable: true, value: 2000 }, clientHeight: { configurable: true, value: 300 } });
  scroll.scrollTop = 200; await act(async () => scroll.dispatchEvent(new Event('scroll', { bubbles: true })));
  await act(async () => root.render(<RoomChat {...base} messages={[...messages.slice(1), message(101)]} typingNames={[]}/>));
  expect(scroll.scrollTop).toBe(200); expect(mount.querySelector('.chat-unread')?.textContent).toContain('1 new message');
  await act(async () => mount.querySelector<HTMLButtonElement>('.chat-unread')!.click()); expect(scroll.scrollTop).toBe(2000);
});
