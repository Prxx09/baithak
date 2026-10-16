// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RoomLifetime } from '../src/components/RoomLifetime';
let mount: HTMLDivElement, root: ReturnType<typeof createRoot>;
beforeEach(() => { vi.useFakeTimers(); Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); mount = document.createElement('div'); document.body.appendChild(mount); root = createRoot(mount); });
afterEach(async () => { await act(async () => root.unmount()); mount.remove(); vi.useRealTimers(); });
it('expires at the server-adjusted deadline without extending on a rerender', async () => {
  let serverTime = Date.now(); const expiresAt = new Date(serverTime + 2000).toISOString(), onExpire = vi.fn();
  await act(async () => root.render(<RoomLifetime expiresAt={expiresAt} now={() => serverTime} onExpire={onExpire}/>));
  expect(mount.textContent).toContain('0:02');
  serverTime += 2001; await act(async () => { vi.advanceTimersByTime(1000); });
  expect(onExpire).toHaveBeenCalledTimes(1); expect(mount.textContent).toContain('0:00');
  await act(async () => { vi.advanceTimersByTime(3000); }); expect(onExpire).toHaveBeenCalledTimes(1);
});
it('checks expiry immediately when a suspended tab becomes visible', async () => {
  let serverTime = Date.now(); const onExpire = vi.fn();
  await act(async () => root.render(<RoomLifetime expiresAt={new Date(serverTime + 10000).toISOString()} now={() => serverTime} onExpire={onExpire}/>));
  serverTime += 20000; await act(async () => document.dispatchEvent(new Event('visibilitychange')));
  expect(onExpire).toHaveBeenCalledOnce();
});
