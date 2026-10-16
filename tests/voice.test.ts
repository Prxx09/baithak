import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { VoiceSession } from '../src/lib/voice';

class Stream { tracks: unknown[] = []; getTracks() { return this.tracks; } addTrack(track: unknown) { this.tracks.push(track); } }
class PeerConnection {
  static all: PeerConnection[] = [];
  connectionState = 'new'; signalingState = 'stable'; remoteDescription = null;
  sender = { replaceTrack: vi.fn().mockResolvedValue(undefined) };
  addTransceiver = vi.fn(() => ({ sender: this.sender }));
  close = vi.fn(); getSenders() { return [this.sender]; }
  constructor() { PeerConnection.all.push(this); }
}
const member = (id: string) => ({ user_id: id, display_name: id, requested: false, last_seen: new Date().toISOString() });
describe('voice signaling and lifecycle', () => {
  let receive: (event: { new: unknown }) => void;
  let writes: { receiver_id: string; payload: Record<string, unknown> }[];
  let removed: ReturnType<typeof vi.fn>;
  let session: VoiceSession;
  let changed: ReturnType<typeof vi.fn>;
  function signal(id: number, payload: Record<string, unknown>, sender = 'friend') {
    receive({ new: { id, room_id: 'room', sender_id: sender, payload: { scope: 'voice', session: 'remote-session', started: 100, ...payload }, created_at: new Date().toISOString() } });
  }
  async function flush() { for (let i = 0; i < 8; i++) await Promise.resolve(); }
  beforeEach(async () => {
    writes = []; removed = vi.fn(); changed = vi.fn(); PeerConnection.all = [];
    vi.stubGlobal('MediaStream', Stream); vi.stubGlobal('RTCPeerConnection', PeerConnection);
    const channel = { on: vi.fn((_event, _filter, callback) => { receive = callback; return channel; }), subscribe: vi.fn(() => channel) };
    const query = { eq: () => query, gt: () => query, order: () => query, limit: async () => ({ data: [], error: null }) };
    const db = { channel: () => channel, removeChannel: removed, from: () => ({ select: () => query, insert: async (row: typeof writes[number]) => { writes.push(row); return { error: null }; } }) } as unknown as SupabaseClient;
    session = new VoiceSession(db, 'room', 'you', changed, vi.fn());
    await session.start([member('you'), member('friend')]);
  });
  afterEach(() => { session.close(); vi.unstubAllGlobals(); });
  it('uses one audio transceiver and accepts only known, correctly addressed participants', async () => {
    signal(1, { hello: true }, 'outsider'); signal(2, { hello: true, target: 'another-session' }); await flush();
    expect(PeerConnection.all).toHaveLength(0);
    signal(3, { hello: true, mic: true }); await flush();
    expect(PeerConnection.all).toHaveLength(1);
    expect(PeerConnection.all[0].addTransceiver).toHaveBeenCalledExactlyOnceWith('audio', { direction: 'sendrecv' });
    expect(changed).toHaveBeenCalledWith('friend', expect.objectContaining({ mic: true }));
    expect(writes.some(row => row.payload.ack && row.payload.target === 'remote-session')).toBe(true);
  });
  it('removes outgoing audio when muted and closes connections on leave', async () => {
    signal(1, { hello: true }); await flush();
    const track = { id: 'microphone' } as MediaStreamTrack;
    await session.setMicrophone(track); expect(PeerConnection.all[0].sender.replaceTrack).toHaveBeenLastCalledWith(track);
    await session.setMicrophone(null); expect(PeerConnection.all[0].sender.replaceTrack).toHaveBeenLastCalledWith(null);
    expect(writes.at(-1)?.payload.mic).toBe(false);
    session.close(); expect(PeerConnection.all[0].close).toHaveBeenCalled(); expect(removed).toHaveBeenCalled();
  });
  it('rebuilds after a participant reconnects and ignores older session signals', async () => {
    signal(1, { hello: true }); await flush();
    signal(2, { hello: true, session: 'new-session', started: 200 }); await flush();
    expect(PeerConnection.all).toHaveLength(2); expect(PeerConnection.all[0].close).toHaveBeenCalled();
    signal(3, { hello: true, started: 100 }); await flush(); expect(PeerConnection.all).toHaveLength(2);
    signal(4, { bye: true, session: 'new-session', started: 200 }); await flush();
    expect(changed).toHaveBeenLastCalledWith('friend', null);
  });
});
