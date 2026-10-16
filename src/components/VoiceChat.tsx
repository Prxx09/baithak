import { useEffect, useRef, useState } from 'react';
import { Headphones, LoaderCircle, Mic, MicOff, PhoneOff, RefreshCw, Volume2, VolumeX, SlidersHorizontal } from 'lucide-react';
import { backend } from '../lib/backend';
import { VoiceSession, type VoicePeer } from '../lib/voice';
import type { Member } from '../lib/types';
import { RemoteAudio } from './Media';
import { AudioActivity } from '../lib/audio-activity';

export function VoiceChat({ roomId, userId, members, demo, prepare }: { roomId: string; userId: string; members: Member[]; demo: boolean; prepare?: () => Promise<Member[]> }) {
  const [joined, setJoined] = useState(false), [muted, setMuted] = useState(true), [busy, setBusy] = useState(false);
  const [peers, setPeers] = useState<Record<string, VoicePeer>>({}), [error, setError] = useState('');
  const [speaking, setSpeaking] = useState<Record<string, boolean>>({}), [sound, setSound] = useState(true), [audioSettings, setAudioSettings] = useState(false);
  const [volume, setVolume] = useState(1), [sinkId, setSinkId] = useState(''), [outputLabel, setOutputLabel] = useState('System speaker / headphones');
  const meter = useRef<AudioActivity | null>(null), metered = useRef(new Set<string>());
  const engine = useRef<VoiceSession | null>(null), stream = useRef<MediaStream | null>(null);
  const alive = useRef(true), joining = useRef(false), generation = useRef(0), currentMembers = useRef(members);
  const prepareRef = useRef(prepare); prepareRef.current = prepare;
  currentMembers.current = members;
  function disconnect() {
    meter.current?.close(); meter.current = null; metered.current.clear(); setSpeaking({});
    generation.current++; engine.current?.close(); engine.current = null;
    stream.current?.getTracks().forEach(track => track.stop()); stream.current = null;
    setJoined(false); setMuted(true); setPeers({});
  }
  useEffect(() => { alive.current = true; return () => {
    alive.current = false; generation.current++;
    meter.current?.close(); meter.current = null;
    engine.current?.close(); stream.current?.getTracks().forEach(track => track.stop());
  }; }, []);
  useEffect(() => { engine.current?.sync(members); }, [members]);
  useEffect(() => {
    if (!joined || !meter.current) return;
    const active = new Set<string>();
    if (!muted && stream.current) { meter.current.attach(userId, stream.current); active.add(userId); }
    for (const [id, peer] of Object.entries(peers)) if (peer.mic && peer.state === 'connected') { meter.current.attach(id, peer.stream); active.add(id); }
    for (const id of metered.current) if (!active.has(id)) meter.current.remove(id);
    metered.current = active;
  }, [joined, muted, peers, userId]);
  useEffect(() => {
    const resume = () => {
      if (document.visibilityState === 'hidden') return;
      meter.current?.resume();
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
      if (typeof AudioContext !== 'undefined') {
        try { meter.current = new AudioActivity((id, active) => { if (alive.current && generation.current === attempt) setSpeaking(previous => ({ ...previous, [id]: active })); }); } catch { /* Voice still works without visual metering. */ }
      }
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
  async function chooseOutput() {
    const devices = navigator.mediaDevices as MediaDevices & { selectAudioOutput?: () => Promise<MediaDeviceInfo> };
    if (!devices?.selectAudioOutput) { setOutputLabel('Use your phone’s audio controls for speaker, earpiece, or Bluetooth'); return; }
    try { const device = await devices.selectAudioOutput(); if (alive.current) { setSinkId(device.deviceId); setOutputLabel(device.label || 'Selected speaker'); setError(''); } }
    catch (e) { if ((e as Error).name !== 'NotAllowedError' && alive.current) setError('The audio output could not be selected. Use your device’s audio controls.'); }
  }
  return <section id="room-voice" className={`voice-chat ${joined ? 'in-call' : ''}`} aria-label="Live voice chat">
    <div className="voice-chat-copy"><span className={`voice-icon ${joined ? 'active' : ''}`}><Headphones size={21}/></span><div><h3>Talk while you watch.</h3><p role="status">{demo ? 'Voice connects in a real room.' : joined ? connected ? `${connected} voice connection${connected === 1 ? '' : 's'} · ${muted ? 'Your mic is muted' : 'Your mic is live'}` : `Voice joined · ${muted ? 'Mic muted' : 'Mic live'} · Waiting for others` : 'Live audio for everyone in the room. Join when you’re ready.'}</p></div></div>
    <div className="voice-actions">{joined ? <><button className={`button ${muted ? 'secondary' : 'primary'}`} aria-pressed={!muted} disabled={busy} onClick={() => void toggleMute()}>{muted ? <MicOff size={18}/> : <Mic size={18}/>} {muted ? 'Unmute mic' : 'Mute mic'}</button><button className="button secondary" aria-label={sound ? 'Mute incoming voice sound' : 'Enable incoming voice sound'} aria-pressed={sound} onClick={() => setSound(value => !value)}>{sound ? <Volume2 size={18}/> : <VolumeX size={18}/>} Sound {sound ? 'on' : 'off'}</button><button className="icon-button" aria-label="Audio settings" aria-expanded={audioSettings} onClick={() => setAudioSettings(value => !value)}><SlidersHorizontal size={18}/></button><button className="icon-button" aria-label="Reconnect voice" disabled={busy} onClick={() => { disconnect(); void join(); }}><RefreshCw size={17}/></button><button className="button secondary leave-voice" onClick={disconnect}><PhoneOff size={18}/> Leave voice</button></> : <button className="button secondary" disabled={demo || busy} onClick={() => void join()}>{busy ? <LoaderCircle className="spin" size={16}/> : <Mic size={16}/>} {busy ? 'Connecting…' : 'Join voice'}</button>}</div>
    {joined && <div className="voice-members"><SpeakingChip name="You" speaking={!muted && !!speaking[userId]} muted={muted}/>{Object.entries(peers).map(([id, peer]) => <SpeakingChip key={id} name={members.find(m => m.user_id === id)?.display_name || 'A friend'} speaking={peer.mic && peer.state === 'connected' && !!speaking[id]} muted={!peer.mic} connecting={peer.state !== 'connected'}/>)}</div>}
    {joined && audioSettings && <div className="voice-audio-settings"><label>Voice volume <span>{Math.round(volume * 100)}%</span><input aria-label="Voice volume" type="range" min="0" max="1" step="0.05" value={volume} onChange={event => setVolume(Number(event.target.value))}/></label><button className="button secondary" onClick={() => void chooseOutput()}><Volume2 size={16}/> Choose audio output</button><p>{outputLabel}. Speaker, earpiece and Bluetooth routing depend on your browser and phone. On iPhone, use the device volume buttons.</p></div>}
    {error && <p className="voice-error" role="alert">{error}</p>}
    {joined && <p className="voice-tip">Use headphones to keep the video out of your microphone. Audio isn’t recorded.</p>}
    {joined && Object.entries(peers).map(([id, peer]) => <RemoteAudio key={id} stream={peer.stream} muted={!sound} volume={volume} sinkId={sinkId} onOutputError={setError}/>)}
  </section>;
}

function SpeakingChip({ name, speaking, muted, connecting = false }: { name: string; speaking: boolean; muted: boolean; connecting?: boolean }) {
  return <span className={`voice-member ${speaking ? 'is-speaking' : ''}`}><span className="speaker-avatar">{name.trim()[0]?.toUpperCase() || '?'}{speaking && <span className="speaker-bars" aria-hidden="true"><i/><i/><i/></span>}</span><span className="speaker-copy"><strong>{name}</strong><small>{connecting ? 'Connecting' : muted ? 'Muted' : speaking ? 'Speaking' : 'Listening'}</small></span>{muted ? <MicOff size={14}/> : <Mic size={14}/>}</span>;
}
