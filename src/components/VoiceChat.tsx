import { useEffect, useRef, useState } from 'react';
import { Headphones, LoaderCircle, Mic, MicOff, PhoneOff, RefreshCw } from 'lucide-react';
import { backend } from '../lib/backend';
import { VoiceSession, type VoicePeer } from '../lib/voice';
import type { Member } from '../lib/types';
import { RemoteAudio } from './Media';

export function VoiceChat({ roomId, userId, members, demo, prepare }: { roomId: string; userId: string; members: Member[]; demo: boolean; prepare?: () => Promise<Member[]> }) {
  const [joined, setJoined] = useState(false), [muted, setMuted] = useState(true), [busy, setBusy] = useState(false);
  const [peers, setPeers] = useState<Record<string, VoicePeer>>({}), [error, setError] = useState('');
  const engine = useRef<VoiceSession | null>(null), stream = useRef<MediaStream | null>(null);
  const alive = useRef(true), joining = useRef(false), generation = useRef(0), currentMembers = useRef(members);
  const prepareRef = useRef(prepare); prepareRef.current = prepare;
  currentMembers.current = members;
  function disconnect() {
    generation.current++; engine.current?.close(); engine.current = null;
    stream.current?.getTracks().forEach(track => track.stop()); stream.current = null;
    setJoined(false); setMuted(true); setPeers({});
  }
  useEffect(() => { alive.current = true; return () => {
    alive.current = false; generation.current++;
    engine.current?.close(); stream.current?.getTracks().forEach(track => track.stop());
  }; }, []);
  useEffect(() => { engine.current?.sync(members); }, [members]);
  useEffect(() => {
    const resume = () => {
      if (document.visibilityState === 'hidden') return;
      void engine.current?.resume().then(() => { if (alive.current) setError(''); }).catch(e => { if (alive.current) setError(e.message); });
    };
    document.addEventListener('visibilitychange', resume); window.addEventListener('online', resume);
    return () => { document.removeEventListener('visibilitychange', resume); window.removeEventListener('online', resume); };
  }, []);
  async function join() {
    if (joining.current) return;
    if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) {
      setError('Voice needs microphone access in a supported browser over HTTPS.'); return;
    }
    joining.current = true; setBusy(true); setError('');
    const attempt = ++generation.current;
    let captured: MediaStream | null = null;
    try {
      captured = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      if (!alive.current || generation.current !== attempt) { captured.getTracks().forEach(track => track.stop()); return; }
      stream.current = captured;
      const confirmedMembers = prepareRef.current ? await prepareRef.current() : currentMembers.current;
      if (!alive.current || generation.current !== attempt) { captured.getTracks().forEach(track => track.stop()); return; }
      const media = new VoiceSession(backend(), roomId, userId, (id, value) => {
        if (!alive.current || generation.current !== attempt) return;
        if (value?.state === 'connected') setError('');
        setPeers(previous => { const next = { ...previous }; if (value) next[id] = value; else delete next[id]; return next; });
      }, message => { if (alive.current && generation.current === attempt) setError(message); }, () => prepareRef.current ? prepareRef.current() : Promise.resolve(currentMembers.current));
      engine.current = media;
      await media.setMicrophone(captured.getAudioTracks()[0]);
      await media.start(confirmedMembers);
      if (!alive.current || generation.current !== attempt) { media.close(); captured.getTracks().forEach(track => track.stop()); return; }
      captured.getAudioTracks()[0].addEventListener('ended', () => {
        if (alive.current && generation.current === attempt) { disconnect(); setError('Microphone access ended. Join voice to reconnect.'); }
      }, { once: true });
      setJoined(true); setMuted(false);
    } catch (e) {
      captured?.getTracks().forEach(track => track.stop());
      if (alive.current && generation.current === attempt) {
        disconnect();
        setError((e as Error).name === 'NotAllowedError' ? 'Microphone permission was declined. Allow it in your browser, then join voice again.' : (e as Error).name === 'NotFoundError' ? 'No microphone found. Connect one and try again.' : (e as Error).message || 'Voice could not start. Please try again.');
      }
    } finally { joining.current = false; if (alive.current) setBusy(false); }
  }
  async function toggleMute() {
    const track = stream.current?.getAudioTracks()[0];
    if (!track || busy) return;
    setBusy(true); setError('');
    const next = !muted;
    track.enabled = !next; setMuted(next);
    try { await engine.current?.setMicrophone(next ? null : track); }
    catch { track.enabled = false; setMuted(true); setError('Your mic is muted. Reconnect voice to restore the connection.'); }
    finally { if (alive.current) setBusy(false); }
  }
  const connected = Object.values(peers).filter(peer => peer.state === 'connected').length;
  return <section className="voice-chat" aria-label="Live voice chat">
    <div className="voice-chat-copy"><span className={`voice-icon ${joined ? 'active' : ''}`}><Headphones size={21}/></span><div><h3>Talk while you watch.</h3><p role="status">{demo ? 'Voice connects in a real room.' : joined ? connected ? `${connected} voice connection${connected === 1 ? '' : 's'} · ${muted ? 'Your mic is muted' : 'Your mic is live'}` : `Voice joined · ${muted ? 'Mic muted' : 'Mic live'} · Waiting for others` : 'Live audio for everyone in the room. Join when you’re ready.'}</p></div></div>
    <div className="voice-actions">{joined ? <><button className={`button ${muted ? 'secondary' : 'primary'}`} aria-pressed={!muted} disabled={busy} onClick={() => void toggleMute()}>{muted ? <MicOff size={16}/> : <Mic size={16}/>} {muted ? 'Unmute mic' : 'Mute mic'}</button><button className="icon-button" aria-label="Reconnect voice" disabled={busy} onClick={() => { disconnect(); void join(); }}><RefreshCw size={17}/></button><button className="button secondary" onClick={disconnect}><PhoneOff size={16}/> Leave voice</button></> : <button className="button secondary" disabled={demo || busy} onClick={() => void join()}>{busy ? <LoaderCircle className="spin" size={16}/> : <Mic size={16}/>} {busy ? 'Connecting…' : 'Join voice'}</button>}</div>
    {joined && <div className="voice-members"><span className="voice-member">{muted ? <MicOff size={13}/> : <Mic size={13}/>} You</span>{Object.entries(peers).map(([id, peer]) => <span key={id} className="voice-member">{peer.mic ? <Mic size={13}/> : <MicOff size={13}/>} {members.find(m => m.user_id === id)?.display_name || 'A friend'} <small>{peer.state === 'connected' ? peer.mic ? 'Mic live' : 'Muted' : 'Connecting'}</small></span>)}</div>}
    {error && <p className="voice-error" role="alert">{error}</p>}
    {joined && <p className="voice-tip">Use headphones to keep the video out of your microphone. Audio isn’t recorded.</p>}
    {joined && Object.entries(peers).map(([id, peer]) => <RemoteAudio key={id} stream={peer.stream}/>)}
  </section>;
}
