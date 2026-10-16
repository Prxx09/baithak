import { afterEach, expect, it, vi } from 'vitest';
import { AudioActivity } from '../src/lib/audio-activity';
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it('highlights real audio with a hold period, never plays the local mic, and cleans up', () => {
  vi.useFakeTimers(); let amplitude = 128;
  const source = { connect: vi.fn(), disconnect: vi.fn() }, analyser = { fftSize: 512, getByteTimeDomainData: (data: Uint8Array) => data.fill(amplitude), disconnect: vi.fn() };
  const close = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('AudioContext', class { state = 'running'; createMediaStreamSource() { return source; } createAnalyser() { return analyser; } resume = vi.fn().mockResolvedValue(undefined); close = close; });
  const changed = vi.fn(), meter = new AudioActivity(changed), stream = { getAudioTracks: () => [{}] } as MediaStream;
  meter.attach('you', stream); meter.attach('you', stream);
  expect(source.connect).toHaveBeenCalledExactlyOnceWith(analyser);
  vi.advanceTimersByTime(100); expect(changed).not.toHaveBeenCalled();
  amplitude = 160; vi.advanceTimersByTime(100); expect(changed).toHaveBeenLastCalledWith('you', true);
  amplitude = 128; vi.advanceTimersByTime(300); expect(changed).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(200); expect(changed).toHaveBeenLastCalledWith('you', false);
  meter.close(); expect(source.disconnect).toHaveBeenCalled(); expect(close).toHaveBeenCalledOnce();
});
