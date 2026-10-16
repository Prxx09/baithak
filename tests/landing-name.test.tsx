// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { guest, command } = vi.hoisted(() => ({ guest: vi.fn(), command: vi.fn() }));
vi.mock('../src/lib/backend', () => ({ guest, command }));
vi.mock('../src/lib/config', () => ({
  getConfig: () => ({ key: 'public-test-key' }),
  parseRoomCode: (value: string) => value,
  friendlyError: (error: Error) => error.message,
}));

import { Landing } from '../src/components/Landing';

describe('room name entry', () => {
  let mount: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    history.replaceState({}, '', '/?room=invited-room');
    HTMLElement.prototype.scrollIntoView = vi.fn();
    mount = document.createElement('div');
    document.body.appendChild(mount);
    root = createRoot(mount);
    guest.mockReset();
    command.mockReset();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    mount.remove();
    history.replaceState({}, '', '/');
  });

  it('prefills an invitation but waits for an explicitly entered name', async () => {
    await act(async () => root.render(<Landing onEnter={vi.fn()} onPreview={vi.fn()} onSetup={vi.fn()} />));
    const name = mount.querySelector<HTMLInputElement>('input[autocomplete="nickname"]')!;
    const invite = mount.querySelector<HTMLInputElement>('input[placeholder="Paste your invitation here"]')!;
    expect(name.required).toBe(true);
    expect(name.value).toBe('');
    expect(invite.value).toBe('invited-room');
    expect(guest).not.toHaveBeenCalled();
    await act(async () => mount.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(mount.querySelector('[role="alert"]')?.textContent).toContain('Add your name');
    expect(guest).not.toHaveBeenCalled();
    expect(command).not.toHaveBeenCalled();
  });
});
