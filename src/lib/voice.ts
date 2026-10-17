import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { iceServers } from './config';
import type { Member } from './types';

interface VoiceSignal {
  scope: 'voice'; session: string; started: number; target?: string;
  hello?: boolean; ack?: boolean; bye?: boolean; mic?: boolean;
  description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit;
}
interface Row { id: number; room_id: string; sender_id: string; payload: VoiceSignal; created_at: string; }
export interface VoicePeer { stream: MediaStream; mic: boolean; state: RTCPeerConnectionState; }
interface Peer {
  session: string; started: number; pc: RTCPeerConnection | null; stream: MediaStream;
  mic: boolean; departed: boolean; makingOffer: boolean; ignoreOffer: boolean; candidates: RTCIceCandidateInit[]; queue: Promise<void>;
}

/** Audio travels directly between browsers. Supabase carries membership-checked signaling only. */
export class VoiceSession {
  private peers = new Map<string, Peer>();
  private channel: RealtimeChannel | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private processed = new Set<number>();
  private session = crypto.randomUUID();
  private started = Date.now();
  private cursor = 0;
  private closed = false;
  private pulling = false;
  private track: MediaStreamTrack | null = null;
  private recovery: Promise<Member[]> | null = null;
  private recoveryAt = 0;
  constructor(private db: SupabaseClient, private roomId: string, private userId: string,
    private changed: (id: string, peer: VoicePeer | null) => void, private failed: (message: string) => void,
    private refreshMembers?: () => Promise<Member[]>) {}

  async start(members: Member[]) {
    this.channel = this.db.channel(`voice:${this.roomId}:${this.userId}:${this.session}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'baithak_signals', filter: `receiver_id=eq.${this.userId}` }, event => this.receive(event.new as Row))
      .subscribe();
    this.sync(members);
    await this.pull();
    if (!this.closed) this.timer = setInterval(() => { void this.pull(); }, 2500);
  }
  sync(members: Member[]) {
    if (this.closed) return;
    const ids = new Set(members.map(m => m.user_id));
    for (const [id, peer] of this.peers) if (!ids.has(id)) {
      peer.pc?.close(); this.peers.delete(id); this.changed(id, null);
    }
    for (const id of ids) if (id !== this.userId && !this.peers.has(id)) {
      this.peers.set(id, { session: '', started: 0, pc: null, stream: new MediaStream(), mic: false, departed: false, makingOffer: false, ignoreOffer: false, candidates: [], queue: Promise.resolve() });
      void this.send(id, { hello: true }).catch(e => this.failed(e.message));
    }
  }
  private async send(id: string, payload: Partial<VoiceSignal>) {
    if (this.closed) return;
    const insert = () => this.db.from('baithak_signals').insert({ room_id: this.roomId, sender_id: this.userId, receiver_id: id,
      payload: { ...payload, scope: 'voice', session: this.session, started: this.started, mic: !!this.track } });
    let { error } = await insert();
    if (error?.code === '42501' && this.refreshMembers && !this.closed) {
      // Re-check both participants instead of relaxing RLS or retrying a stale
      // recipient indefinitely. Share one recovery across an ICE candidate burst.
      if (!this.recovery || Date.now() - this.recoveryAt > 1000) {
        this.recoveryAt = Date.now();
        this.recovery = this.refreshMembers();
      }
      const members = await this.recovery;
      if (this.closed) return;
      this.sync(members);
      if (!members.some(member => member.user_id === id)) return;
      ({ error } = await insert());
    }
    if (error) throw new Error(error.code === '42501'
      ? 'Voice access could not be renewed. Leave voice and rejoin the room using its invitation.' : error.message);
  }
  async resume() {
    if (this.closed || !this.refreshMembers) return;
    this.sync(await this.refreshMembers());
    if (this.closed) return;
    for (const [id, peer] of this.peers) {
      if (peer.pc?.connectionState === 'failed' || peer.pc?.connectionState === 'disconnected') peer.pc.restartIce();
      await this.send(id, { hello: true });
    }
  }
  private async pull() {
    if (this.closed || this.pulling) return;
    this.pulling = true;
    try {
      const { data, error } = await this.db.from('baithak_signals').select('*').eq('room_id', this.roomId).eq('receiver_id', this.userId).gt('id', this.cursor).order('id').limit(1000);
      if (error) throw error;
      for (const row of data || []) this.receive(row as Row);
      if (data?.length) this.cursor = data[data.length - 1].id;
    } catch { /* Realtime is the fast path; polling retries after transient connection loss. */ }
    finally { this.pulling = false; }
  }
  private connect(id: string, peer: Peer) {
    peer.pc?.close(); peer.stream = new MediaStream(); peer.candidates = []; peer.ignoreOffer = false;
    const pc = new RTCPeerConnection({ iceServers: iceServers(), bundlePolicy: 'max-bundle' });
    peer.pc = pc;
    const sender = pc.addTransceiver('audio', { direction: 'sendrecv' }).sender;
    if (this.track) void sender.replaceTrack(this.track).catch(e => this.failed(e.message));
    pc.onicecandidate = event => { if (!this.closed && peer.pc === pc && this.peers.get(id) === peer && event.candidate) void this.send(id, { target: peer.session, candidate: event.candidate.toJSON() }).catch(e => this.failed(e.message)); };
    pc.ontrack = event => {
      if (this.closed || peer.pc !== pc || this.peers.get(id) !== peer) return;
      if (!peer.stream.getTracks().some(t => t.id === event.track.id)) peer.stream.addTrack(event.track);
      this.publish(id, peer);
    };
    pc.onconnectionstatechange = () => {
      if (this.closed || peer.pc !== pc || this.peers.get(id) !== peer) return;
      this.publish(id, peer);
      if (pc.connectionState === 'failed') {
        this.failed('Voice could not connect to a participant. Try reconnecting voice; some networks need a TURN relay.');
        pc.restartIce();
      }
    };
    pc.onnegotiationneeded = async () => {
      if (this.closed || peer.pc !== pc || this.peers.get(id) !== peer) return;
      try {
        peer.makingOffer = true;
        await pc.setLocalDescription();
        if (peer.pc === pc) await this.send(id, { target: peer.session, description: pc.localDescription!.toJSON() });
      } catch (e) { if (!this.closed && peer.pc === pc) this.failed((e as Error).message); }
      finally { peer.makingOffer = false; }
    };
    this.publish(id, peer);
  }
  private publish(id: string, peer: Peer) {
    if (!this.closed) this.changed(id, { stream: peer.stream, mic: peer.mic, state: peer.pc?.connectionState || 'new' });
  }
  private receive(row: Row) {
    const signal = row.payload;
    if (this.closed || row.room_id !== this.roomId || signal?.scope !== 'voice' || this.processed.has(row.id)) return;
    const peer = this.peers.get(row.sender_id);
    if (!peer || !signal.session || !Number.isFinite(signal.started) || (signal.target && signal.target !== this.session)) return;
    this.processed.add(row.id);
    if (this.processed.size > 5000) this.processed.delete(this.processed.values().next().value!);
    peer.queue = peer.queue.then(async () => {
      if (this.closed || this.peers.get(row.sender_id) !== peer) return;
      if (signal.session !== peer.session) {
        if (signal.started < peer.started) return;
        peer.session = signal.session; peer.started = signal.started; peer.departed = false;
        this.connect(row.sender_id, peer);
      }
      if (signal.bye) { peer.departed = true; peer.pc?.close(); peer.pc = null; this.changed(row.sender_id, null); return; }
      if (peer.departed) return;
      peer.mic = !!signal.mic; this.publish(row.sender_id, peer);
      if (signal.hello) {
        if (!signal.ack) await this.send(row.sender_id, { hello: true, ack: true, target: peer.session });
        return;
      }
      const pc = peer.pc!;
      if (signal.description) {
        const collision = signal.description.type === 'offer' && (peer.makingOffer || pc.signalingState !== 'stable');
        peer.ignoreOffer = this.userId.localeCompare(row.sender_id) < 0 && collision;
        if (peer.ignoreOffer) return;
        await pc.setRemoteDescription(signal.description);
        for (const candidate of peer.candidates.splice(0)) await pc.addIceCandidate(candidate);
        if (signal.description.type === 'offer') {
          await pc.setLocalDescription();
          await this.send(row.sender_id, { target: peer.session, description: pc.localDescription!.toJSON() });
        }
      } else if (signal.candidate && !peer.ignoreOffer) {
        if (pc.remoteDescription) await pc.addIceCandidate(signal.candidate);
        else peer.candidates.push(signal.candidate);
      }
    }).catch(e => { if (!this.closed) this.failed(e.message); });
  }
  async setMicrophone(track: MediaStreamTrack | null) {
    if (this.closed) return;
    this.track = track;
    await Promise.all([...this.peers.values()].map(peer => peer.pc?.getSenders()[0]?.replaceTrack(track)));
    await Promise.all([...this.peers.entries()].filter(([, peer]) => peer.session).map(([id, peer]) => this.send(id, { target: peer.session })));
  }
  close() {
    if (this.closed) return;
    for (const [id, peer] of this.peers) if (peer.session) void this.send(id, { target: peer.session, bye: true }).catch(() => {});
    this.closed = true; this.track = null;
    if (this.timer) clearInterval(this.timer);
    for (const peer of this.peers.values()) peer.pc?.close();
    this.peers.clear();
    if (this.channel) void this.db.removeChannel(this.channel);
  }
}
