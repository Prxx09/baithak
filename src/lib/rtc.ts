import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { iceServers } from './config';
import type { Member, Signal } from './types';

export interface RemoteMedia { screen: MediaStream; voice: MediaStream; camera: MediaStream; micOn: boolean; cameraOn: boolean; state: RTCPeerConnectionState; }
type Peer = { pc: RTCPeerConnection; media: RemoteMedia; makingOffer: boolean; ignoreOffer: boolean; candidates: RTCIceCandidateInit[]; queue: Promise<void>; };
export class RoomMedia {
  private peers = new Map<string, Peer>();
  private channel: RealtimeChannel | null = null;
  private poll: ReturnType<typeof setInterval> | null = null;
  private processed = new Set<number>();
  private started = new Date(Date.now() - 3000).toISOString();
  private closed = false;
  private screen: MediaStream | null = null;
  private voice: MediaStream | null = null;
  private camera: MediaStream | null = null;
  private polling = false;
  constructor(private db: SupabaseClient, private roomId: string, private userId: string,
    private onMedia: (id: string, media: RemoteMedia | null) => void, private onError: (message: string) => void) {}

  async start() {
    this.channel = this.db.channel(`signals:${this.roomId}:${this.userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'baithak_signals', filter: `receiver_id=eq.${this.userId}` }, event => this.receive(event.new as Signal))
      .subscribe();
    this.poll = setInterval(() => { void this.pull(); }, 2500);
    await this.pull();
  }
  private async pull() {
    if (this.closed || this.polling) return;
    this.polling = true;
    try {
      const { data, error } = await this.db.from('baithak_signals').select('*').eq('room_id',this.roomId).eq('receiver_id',this.userId).gt('created_at',this.started).order('id').limit(1000);
      if (error) throw error;
      for (const row of data || []) this.receive(row as Signal);
      // A small overlap plus ID deduplication avoids losing equal-timestamp rows.
      if (data?.length) this.started = new Date(new Date(data[data.length-1].created_at).getTime()-1000).toISOString();
    } catch { /* The room heartbeat reports backend loss; realtime remains the fast path. */ }
    finally { this.polling = false; }
  }
  private async send(receiver: string, payload: Signal['payload']) {
    if (this.closed) return;
    const { error } = await this.db.from('baithak_signals').insert({ room_id:this.roomId, sender_id:this.userId, receiver_id:receiver, payload });
    if (error) throw error;
  }
  sync(members: Member[]) {
    if (this.closed) return;
    const ids = new Set(members.map(m => m.user_id));
    for (const [id, peer] of this.peers) if (!ids.has(id)) { peer.pc.close(); this.peers.delete(id); this.onMedia(id,null); }
    for (const id of ids) if (id!==this.userId && !this.peers.has(id)) { this.createPeer(id); void this.send(id,{hello:true}).catch(e=>this.onError(String(e.message))); }
  }
  private createPeer(id: string): Peer {
    const pc = new RTCPeerConnection({ iceServers: iceServers(), bundlePolicy: 'max-bundle' });
    const peer: Peer = { pc, media: { screen:new MediaStream(), voice:new MediaStream(), camera:new MediaStream(), micOn:false, cameraOn:false, state:'new' }, makingOffer:false, ignoreOffer:false, candidates:[], queue:Promise.resolve() };
    this.peers.set(id,peer);
    const tracks = [this.screen?.getVideoTracks()[0],this.screen?.getAudioTracks()[0],this.voice?.getAudioTracks()[0],this.camera?.getVideoTracks()[0]];
    for (let i=0;i<4;i++) {
      const transceiver = pc.addTransceiver(i===0 || i===3 ? 'video':'audio', {direction:'sendrecv'});
      if (tracks[i]) void transceiver.sender.replaceTrack(tracks[i]!);
    }
    pc.onicecandidate = event => { if(event.candidate) void this.send(id,{candidate:event.candidate.toJSON()}).catch(()=>{}); };
    pc.ontrack = event => {
      const index = pc.getTransceivers().indexOf(event.transceiver);
      const stream = index<2 ? peer.media.screen : index===2 ? peer.media.voice : peer.media.camera;
      if (!stream.getTracks().some(t=>t.id===event.track.id)) stream.addTrack(event.track);
      this.onMedia(id,{...peer.media});
    };
    pc.onconnectionstatechange = () => {
      peer.media.state = pc.connectionState;
      this.onMedia(id,{...peer.media});
      if (pc.connectionState==='failed') this.onError('A peer connection failed. A TURN relay may be needed on this network. Use Reconnect to try again.');
    };
    pc.onnegotiationneeded = async () => {
      try {
        peer.makingOffer = true;
        await pc.setLocalDescription();
        await this.send(id,{description:pc.localDescription!.toJSON(),media:{mic:!!this.voice,camera:!!this.camera}});
      } catch(e) { if(!this.closed) this.onError((e as Error).message); }
      finally { peer.makingOffer=false; }
    };
    return peer;
  }
  private receive(row: Signal) {
    if(this.closed || row.room_id!==this.roomId || this.processed.has(row.id)) return;
    this.processed.add(row.id);
    if(this.processed.size>5000) this.processed.delete(this.processed.values().next().value!);
    const peer = this.peers.get(row.sender_id);
    // Only peers from a server-confirmed membership snapshot are accepted.
    if(!peer) { this.processed.delete(row.id); return; }
    peer.queue = peer.queue.then(async()=>{
      const {description,candidate,media,hello} = row.payload;
      if(media) { peer.media.micOn=media.mic; peer.media.cameraOn=media.camera; this.onMedia(row.sender_id,{...peer.media}); }
      if(hello) { await this.send(row.sender_id,{media:{mic:!!this.voice,camera:!!this.camera}}); return; }
      if(description) {
        const collision = description.type==='offer' && (peer.makingOffer || peer.pc.signalingState!=='stable');
        const polite = this.userId.localeCompare(row.sender_id)>0;
        peer.ignoreOffer = !polite && collision;
        if(peer.ignoreOffer) return;
        await peer.pc.setRemoteDescription(description);
        for(const queued of peer.candidates.splice(0)) await peer.pc.addIceCandidate(queued);
        if(description.type==='offer') { await peer.pc.setLocalDescription(); await this.send(row.sender_id,{description:peer.pc.localDescription!.toJSON(),media:{mic:!!this.voice,camera:!!this.camera}}); }
      } else if(candidate && !peer.ignoreOffer) {
        if(peer.pc.remoteDescription) await peer.pc.addIceCandidate(candidate);
        else peer.candidates.push(candidate);
      }
    }).catch(e=>{ if(!this.closed && peer.pc.signalingState!=='closed') this.onError(e.message); });
  }
  async setScreen(stream: MediaStream | null) { this.screen=stream; await this.replace(0,stream?.getVideoTracks()[0]||null); await this.replace(1,stream?.getAudioTracks()[0]||null); }
  async setVoice(stream: MediaStream | null) { this.voice=stream; await this.replace(2,stream?.getAudioTracks()[0]||null); await this.announce(); }
  async setCamera(stream: MediaStream | null) { this.camera=stream; await this.replace(3,stream?.getVideoTracks()[0]||null); await this.announce(); }
  private async replace(index:number,track:MediaStreamTrack|null) {
    await Promise.all([...this.peers.values()].map(async peer=>{
      const sender=peer.pc.getTransceivers()[index]?.sender;
      if(sender) { await sender.replaceTrack(track); if(index===0 && track) { const p=sender.getParameters(); if(p.encodings?.length) { p.encodings[0].maxBitrate=2_000_000; await sender.setParameters(p).catch(()=>{}); } } }
    }));
  }
  private async announce() { await Promise.all([...this.peers.keys()].map(id=>this.send(id,{media:{mic:!!this.voice,camera:!!this.camera}}))); }
  close() {
    this.closed=true;
    if(this.poll) clearInterval(this.poll);
    for(const [id,p] of this.peers) { p.pc.close(); this.onMedia(id,null); }
    this.peers.clear();
    if(this.channel) void this.db.removeChannel(this.channel);
  }
}
