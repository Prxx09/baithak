// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const media = vi.hoisted(() => ({ start: vi.fn().mockResolvedValue(undefined), setMicrophone: vi.fn().mockResolvedValue(undefined), close: vi.fn(), sync: vi.fn() }));
vi.mock('../src/lib/backend', () => ({ backend: () => ({}) }));
vi.mock('../src/lib/voice', () => ({ VoiceSession: class { start = media.start; setMicrophone = media.setMicrophone; close = media.close; sync = media.sync; } }));
import { VoiceChat } from '../src/components/VoiceChat';
let mount: HTMLDivElement, root: ReturnType<typeof createRoot>, stop: ReturnType<typeof vi.fn>, track: MediaStreamTrack, getUserMedia: ReturnType<typeof vi.fn>;
const members = [{ user_id: 'you', display_name: 'You', requested: false, last_seen: '' }];
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks(); stop = vi.fn(); track = { enabled: true, stop, addEventListener: vi.fn() } as unknown as MediaStreamTrack;
  getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [track], getAudioTracks: () => [track] });
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
  vi.stubGlobal('RTCPeerConnection', class {});
  mount = document.createElement('div'); document.body.appendChild(mount); root = createRoot(mount);
});
afterEach(async () => { await act(async () => root.unmount()); mount.remove(); vi.unstubAllGlobals(); });
function button(text: string) { return [...mount.querySelectorAll('button')].find(el => el.textContent?.includes(text))!; }
it('requests audio only on opt-in, mutes the track, and stops capture on leaving voice', async () => {
  await act(async () => root.render(<VoiceChat roomId="room" userId="you" members={members} demo={false}/>));
  expect(getUserMedia).not.toHaveBeenCalled();
  await act(async () => button('Join voice').click());
  expect(getUserMedia).toHaveBeenCalledWith(expect.objectContaining({ video: false }));
  expect(mount.textContent).toContain('Mic live');
  await act(async () => button('Mute mic').click()); expect(track.enabled).toBe(false); expect(media.setMicrophone).toHaveBeenLastCalledWith(null);
  await act(async () => button('Leave voice').click()); expect(stop).toHaveBeenCalled(); expect(media.close).toHaveBeenCalled();
});
it('stops a permission response that arrives after the room unmounts', async () => {
  let resolve!: (value: unknown) => void; getUserMedia.mockReturnValue(new Promise(r => { resolve = r; }));
  await act(async () => root.render(<VoiceChat roomId="room" userId="you" members={members} demo={false}/>));
  await act(async () => button('Join voice').click()); await act(async () => root.render(null));
  await act(async () => resolve({ getTracks: () => [track], getAudioTracks: () => [track] }));
  expect(stop).toHaveBeenCalled(); expect(media.start).not.toHaveBeenCalled();
});
it('stops capture immediately when leaving during membership renewal', async () => {
  let resolve!: (value: typeof members) => void;
  const prepare = vi.fn(() => new Promise<typeof members>(r => { resolve = r; }));
  await act(async () => root.render(<VoiceChat roomId="room" userId="you" members={members} demo={false} prepare={prepare}/>));
  await act(async () => button('Join voice').click()); expect(prepare).toHaveBeenCalled();
  await act(async () => root.render(null)); expect(stop).toHaveBeenCalled();
  await act(async () => resolve(members)); expect(media.start).not.toHaveBeenCalled();
});
it('controls incoming sound independently of the microphone and offers audio settings', async () => {
  await act(async () => root.render(<VoiceChat roomId="room" userId="you" members={members} demo={false}/>));
  await act(async () => button('Join voice').click());
  await act(async () => button('Sound on').click());
  expect(track.enabled).toBe(true); expect(button('Sound off').getAttribute('aria-pressed')).toBe('false');
  await act(async () => mount.querySelector<HTMLButtonElement>('[aria-label="Audio settings"]')!.click());
  expect(mount.querySelector('[aria-label="Voice volume"]')).toBeTruthy();
  expect(mount.textContent).toContain('Speaker, earpiece and Bluetooth');
});
it('joins listen-only without asking for a microphone, then enables it explicitly', async () => {
  await act(async () => root.render(<VoiceChat roomId="room" userId="you" members={members} demo={false}/>));
  await act(async () => button('Listen only').click());
  expect(getUserMedia).not.toHaveBeenCalled(); expect(media.setMicrophone).toHaveBeenCalledWith(null);
  expect(button('Unmute mic')).toBeTruthy();
  await act(async () => button('Unmute mic').click());
  expect(getUserMedia).toHaveBeenCalledOnce(); expect(media.setMicrophone).toHaveBeenLastCalledWith(track);
  await act(async () => button('Leave voice').click()); expect(stop).toHaveBeenCalled();
});
it('keeps quick call controls available after scrolling and hides them while typing', async () => {
  let observe!: (entries: { isIntersecting: boolean }[]) => void;
  const disconnect = vi.fn();
  vi.stubGlobal('IntersectionObserver', class { constructor(callback: typeof observe) { observe = callback; } observe = vi.fn(); disconnect = disconnect; });
  await act(async () => root.render(<VoiceChat roomId="room" userId="you" members={members} demo={false}/>));
  await act(async () => button('Listen only').click());
  await act(async () => observe([{ isIntersecting: false }]));
  expect(mount.querySelector('[aria-label="Quick call controls"]')).toBeTruthy();
  const input = document.createElement('input'); document.body.appendChild(input);
  await act(async () => input.focus()); expect(mount.querySelector('[aria-label="Quick call controls"]')).toBeNull();
  input.remove(); await act(async () => button('Leave voice').click()); expect(disconnect).toHaveBeenCalled();
});
