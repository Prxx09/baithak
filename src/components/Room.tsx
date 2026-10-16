import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Check, Copy, DoorOpen, Headphones, LoaderCircle, MessageCircle, Mic, MicOff, Monitor, MonitorUp, MoreHorizontal, Radio, RefreshCw, Search, Send, Settings2, Shield, Square, Users, Video, VideoOff, X, TvMinimalPlay } from 'lucide-react';
import { backend,command } from '../lib/backend';
import { friendlyError } from '../lib/config';
import { RoomMedia,type RemoteMedia } from '../lib/rtc';
import type { Snapshot } from '../lib/types';
import { RemoteAudio,StreamVideo } from './Media';

export function Room({initial,userId,demo,onLeave}:{initial:Snapshot;userId:string;demo:boolean;onLeave:()=>void}) {
  const [snapshot,setSnapshot]=useState(initial);
  const current=useRef(initial);
  const [remote,setRemote]=useState<Record<string,RemoteMedia>>({});
  const [screen,setScreen]=useState<MediaStream|null>(null);
  const [voice,setVoice]=useState<MediaStream|null>(null);
  const [camera,setCamera]=useState<MediaStream|null>(null);
  const screenRef=useRef<MediaStream|null>(null), voiceRef=useRef<MediaStream|null>(null), cameraRef=useRef<MediaStream|null>(null);
  const engine=useRef<RoomMedia|null>(null);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [busy,setBusy]=useState(false);
  const [panel,setPanel]=useState<'chat'|'people'>('chat');
  const [draft,setDraft]=useState('');
  const [sending,setSending]=useState(false);
  const [copied,setCopied]=useState(false);
  const [quality,setQuality]=useState('720');
  const [settings,setSettings]=useState(false);
  const [searchOpen,setSearchOpen]=useState(false);
  const [search,setSearch]=useState('');
  const [results,setResults]=useState<{id:string;title:string;channel:string;thumb:string}[]>([]);
  const [searching,setSearching]=useState(false);
  const [generation,setGeneration]=useState(0);
  const lastHeartbeat=useRef(Date.now());
  const alive=useRef(true);
  const chatEnd=useRef<HTMLDivElement>(null);
  const amSharing=snapshot.room.active_sharer===userId;
  const sharer=snapshot.members.find(m=>m.user_id===snapshot.room.active_sharer);
  const activeStream=amSharing?screen:snapshot.room.active_sharer?remote[snapshot.room.active_sharer]?.screen||null:null;
  const online=Object.values(remote).filter(p=>p.state==='connected').length;
  const setState=useCallback((next:Snapshot)=>{current.current=next;setSnapshot(next);},[]);

  async function release() {
    const stream=screenRef.current;screenRef.current=null;setScreen(null);
    stream?.getTracks().forEach(t=>t.stop());
    await engine.current?.setScreen(null);
    if(demo){setState({...current.current,room:{...current.current.room,active_sharer:null}});return;}
    try{setState(await command('release',initial.room.invite_code));}catch(err){setError(friendlyError(err));}
  }
  const releaseRef=useRef(release); releaseRef.current=release;

  useEffect(()=>{
    alive.current=true;
    if(demo)return ()=>{alive.current=false;[screenRef.current,voiceRef.current,cameraRef.current].forEach(s=>s?.getTracks().forEach(t=>t.stop()));};
    const media=new RoomMedia(backend(),initial.room.id,userId,(id,value)=>{
      if(!alive.current)return;
      setRemote(prev=>{const next={...prev};if(value)next[id]=value;else delete next[id];return next;});
    },message=>{if(alive.current)setError(message);});
    engine.current=media;
    media.sync(current.current.members);
    void media.start().catch(err=>setError(friendlyError(err)));
    let refreshing=false;
    async function refresh() {
      if(refreshing)return;refreshing=true;
      try{
        const next=await command('heartbeat',initial.room.invite_code);
        if(!alive.current)return;
        lastHeartbeat.current=Date.now();setState(next);media.sync(next.members);
        if(screenRef.current&&next.room.active_sharer!==userId){await media.setScreen(null);screenRef.current.getTracks().forEach(t=>t.stop());screenRef.current=null;setScreen(null);setNotice('The sharing slot was released. You can start again.');}
      }catch(err){
        if(!alive.current)return;
        setError(friendlyError(err));
        if(/ended|invalid|expired/i.test(friendlyError(err))){media.close();[screenRef.current,voiceRef.current,cameraRef.current].forEach(s=>s?.getTracks().forEach(t=>t.stop()));screenRef.current=null;setScreen(null);setVoice(null);setCamera(null);}
      }finally{refreshing=false;}
    }
    void refresh();
    const heartbeat=setInterval(()=>void refresh(),7000);
    const watchdog=setInterval(()=>{if(screenRef.current&&Date.now()-lastHeartbeat.current>30_000){void releaseRef.current();setError('Sharing stopped because the room connection was lost. Reconnect before sharing again.');}},3000);
    const chat=backend().channel(`chat:${initial.room.id}:${userId}`).on('postgres_changes',{event:'INSERT',schema:'public',table:'baithak_chat',filter:`room_id=eq.${initial.room.id}`},()=>void refresh()).subscribe();
    const onVisible=()=>{if(document.visibilityState==='visible')void refresh();};
    document.addEventListener('visibilitychange',onVisible);
    return ()=>{
      alive.current=false;clearInterval(heartbeat);clearInterval(watchdog);media.close();engine.current=null;void backend().removeChannel(chat);document.removeEventListener('visibilitychange',onVisible);
      // Reconnect closes peer sessions but keeps local capture available for reattachment.
    };
  },[demo,initial.room.id,initial.room.invite_code,userId,generation,setState]);
  useEffect(()=>{const media=engine.current;if(media){void media.setScreen(screenRef.current);void media.setVoice(voiceRef.current);void media.setCamera(cameraRef.current);}},[generation]);
  useEffect(()=>{chatEnd.current?.scrollIntoView({behavior:'smooth',block:'nearest'});},[snapshot.messages.length]);
  useEffect(()=>()=>{[screenRef.current,voiceRef.current,cameraRef.current].forEach(s=>s?.getTracks().forEach(t=>t.stop()));},[]);

  async function startShare() {
    setError('');
    if(!navigator.mediaDevices?.getDisplayMedia){setError('Screen sharing needs a supported desktop browser over HTTPS. Try desktop Chrome or Edge.');return;}
    setBusy(true);let captured:MediaStream|null=null;
    try{
      // Capture is initiated immediately in the click handler to retain browser user activation.
      captured=await navigator.mediaDevices.getDisplayMedia({video:{height:{ideal:Number(quality)},frameRate:{ideal:30,max:30}},audio:true});
      if(!alive.current){captured.getTracks().forEach(t=>t.stop());return;}
      const next=demo?{...current.current,room:{...current.current.room,active_sharer:userId}}:await command('claim',initial.room.invite_code);
      screenRef.current=captured;setScreen(captured);setState(next);
      captured.getVideoTracks()[0].addEventListener('ended',()=>void releaseRef.current(),{once:true});
      await engine.current?.setScreen(captured);
      if(!captured.getAudioTracks().length)setNotice('Picture is sharing, but no content audio was captured. Share a browser tab and enable “Share tab audio” to include sound.');
      else setNotice('Your screen and content audio are sharing.');
    }catch(err){captured?.getTracks().forEach(t=>t.stop());if(screenRef.current===captured)await releaseRef.current();if((err as Error).name!=='NotAllowedError')setError(friendlyError(err));}
    finally{setBusy(false);}
  }
  async function toggleMedia(kind:'voice'|'camera') {
    setError('');
    const ref=kind==='voice'?voiceRef:cameraRef;
    const setter=kind==='voice'?setVoice:setCamera;
    if(ref.current){const previous=ref.current;ref.current=null;setter(null);previous.getTracks().forEach(t=>t.stop());try{if(kind==='voice')await engine.current?.setVoice(null);else await engine.current?.setCamera(null);}catch(err){setError(friendlyError(err));}return;}
    try{
      const stream=await navigator.mediaDevices.getUserMedia(kind==='voice'?{audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}}:{video:{width:{ideal:320},height:{ideal:180},frameRate:{ideal:15,max:24}}});
      if(!alive.current){stream.getTracks().forEach(t=>t.stop());return;}
      ref.current=stream;setter(stream);
      if(kind==='voice')await engine.current?.setVoice(stream);else await engine.current?.setCamera(stream);
    }catch(err){ref.current?.getTracks().forEach(t=>t.stop());ref.current=null;setter(null);setError(friendlyError(err));}
  }
  async function leave(end=false) {
    if(end&&!confirm('End this room for everyone?'))return;
    try{if(!demo)await command(end?'end':'leave',initial.room.invite_code);}catch(err){setError(friendlyError(err));if(end)return;}
    [screenRef.current,voiceRef.current,cameraRef.current].forEach(s=>s?.getTracks().forEach(t=>t.stop()));engine.current?.close();onLeave();
  }
  async function sendMessage(e:React.FormEvent) {
    e.preventDefault();if(!draft.trim()||sending)return;
    const text=draft.trim();setSending(true);
    try{
      if(demo)setState({...current.current,messages:[...current.current.messages,{id:Date.now(),sender_id:userId,body:text,created_at:new Date().toISOString()}]});
      else {const {error}=await backend().from('baithak_chat').insert({room_id:initial.room.id,sender_id:userId,body:text});if(error)throw error;setState(await command('heartbeat',initial.room.invite_code));}
      setDraft('');
    }catch(err){setError(friendlyError(err));}finally{setSending(false);}
  }
  async function copyInvite() {try{const url=new URL(location.origin);url.searchParams.set('room',snapshot.room.invite_code);await navigator.clipboard.writeText(url.toString());setCopied(true);setTimeout(()=>setCopied(false),2000);}catch{setNotice(`Copy this invitation: ${location.origin}/?room=${snapshot.room.invite_code}`);}}
  async function findVideos(e:React.FormEvent) {
    e.preventDefault();if(!search.trim())return;
    const key=import.meta.env.VITE_YOUTUBE_API_KEY;
    if(!key){window.open(`https://www.youtube.com/results?search_query=${encodeURIComponent(search)}`,'_blank','noopener,noreferrer');setNotice('Play your chosen video in YouTube, then share that browser tab with audio.');return;}
    setSearching(true);
    try{const response=await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=6&q=${encodeURIComponent(search)}&key=${encodeURIComponent(key)}`);const data=await response.json();if(!response.ok)throw new Error(data.error?.message||'Video search failed.');setResults(data.items.map((item:{id:{videoId:string};snippet:{title:string;channelTitle:string;thumbnails:{medium:{url:string}}}})=>({id:item.id.videoId,title:item.snippet.title,channel:item.snippet.channelTitle,thumb:item.snippet.thumbnails.medium.url})));}catch(err){setError(friendlyError(err));}finally{setSearching(false);}
  }

  return <main className="room-page wrap">
    {demo&&<div className="preview-banner"><span><Monitor size={14}/> Local room preview · Only you are here. Sharing stays on this device.</span><button onClick={onLeave}>Back to create a room <ArrowUpRight size={14}/></button></div>}
    <div className="room-heading"><div><div className="room-eyebrow"><span className="green-dot"/>{demo?'LOCAL PREVIEW':'YOUR PRIVATE CORNER OF THE INTERNET'}</div><h1>{snapshot.room.title}<span className="room-hindi">बैठक</span></h1><p><Users size={13}/>{snapshot.members.length}/6 here <span>·</span><Shield size={13}/> Invite only <span>·</span>{demo?'Try the controls':online?`${online} peer${online>1?'s':''} connected`:'Waiting for your people'}</p></div><div className="room-header-actions"><button disabled={demo} className="button secondary" onClick={copyInvite}>{copied?<Check size={16}/>:<Copy size={16}/>} {copied?'Link copied':'Invite your people'}</button><button className="icon-button" aria-label="Room options" onClick={()=>setSettings(!settings)}><MoreHorizontal/></button></div></div>
    {error&&<div className="notice error" role="alert">{error}<button aria-label="Dismiss error" onClick={()=>setError('')}><X size={16}/></button></div>}
    {notice&&<div className="notice" role="status">{notice}<button aria-label="Dismiss message" onClick={()=>setNotice('')}><X size={16}/></button></div>}
    {settings&&<div className="room-settings"><label>Screen quality<select value={quality} onChange={e=>setQuality(e.target.value)} disabled={amSharing}><option value="480">480p · Less bandwidth</option><option value="720">720p · Balanced</option><option value="1080">1080p · More detail</option></select></label><button className="button secondary" onClick={()=>{setError('');setRemote({});setGeneration(n=>n+1);}}><RefreshCw size={16}/> Reconnect media</button>{snapshot.room.owner_id===userId&&!demo&&<button className="button danger" onClick={()=>void leave(true)}>End room for everyone</button>}<p>Use headphones to avoid echo. Content sharing is limited to one person; microphones and cameras are optional for everyone.</p></div>}
    <div className="room-grid"><section className="stage-column"><div className="stage"><div className="stage-top"><span><span className={`status-dot ${snapshot.room.active_sharer?'live':''}`}/>{snapshot.room.active_sharer?(amSharing?'YOU ARE SHARING':`${sharer?.display_name||'A friend'} IS SHARING`):'THE STAGE IS YOURS'}</span><span><Shield size={12}/> {demo?'LOCAL':'WEBRTC'}</span></div>
      {snapshot.room.active_sharer&&activeStream?<StreamVideo stream={activeStream} muted={amSharing} controls={!amSharing} className="main-stream"/>:<div className="stage-empty"><div className="screen-illustration"><MonitorUp size={44} strokeWidth={1.2}/><span className="star one">✳</span><span className="star two">✧</span></div><span className="eyebrow">A GOOD EVENING STARTS HERE</span><h2>{snapshot.room.active_sharer?'Connecting to the shared screen…':'What are we watching?'}</h2><p>{snapshot.room.active_sharer?'The broadcaster’s stream will appear here.':'A music video. A movie night. That one funny thing.\nShare a tab and bring everyone along.'}</p>{!snapshot.room.active_sharer&&<button className="button primary" disabled={busy} onClick={()=>void startShare()}>{busy?<LoaderCircle className="spin" size={18}/>:<MonitorUp size={18}/>} Share your screen <ArrowUpRight size={17}/></button>}<span className="stage-tip">For sound, choose a browser tab and enable “Share tab audio”.</span></div>}
      <div className="stage-bottom"><span><Headphones size={14}/>{amSharing?'Your preview is muted to prevent echo.':'Same screen. Shared moments.'}</span><button className="text-button" onClick={()=>setSearchOpen(!searchOpen)}><TvMinimalPlay size={17}/> Find something to watch <ArrowUpRight size={13}/></button></div></div>
      {searchOpen&&<section className="youtube-panel"><div><strong>Find your next rabbit hole.</strong><button className="icon-button" aria-label="Close video search" onClick={()=>setSearchOpen(false)}><X size={17}/></button></div><form onSubmit={findVideos}><Search size={17}/><input aria-label="Search YouTube" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search YouTube…" required/><button className="button primary" disabled={searching}>{searching?'Searching…':'Search'}</button></form><p className="small muted">Videos open on the broadcaster’s device. Share that tab to watch together.</p><div className="search-results">{results.map(r=><a key={r.id} href={`https://www.youtube.com/watch?v=${r.id}`} target="_blank" rel="noreferrer"><img src={r.thumb} alt=""/><div><strong>{r.title}</strong><span>{r.channel}</span></div><ArrowUpRight size={16}/></a>)}</div></section>}
      <div className="participant-strip">{snapshot.members.map((member,index)=>{
        const mine=member.user_id===userId;const media=remote[member.user_id];const cam=mine?camera:media?.cameraOn?media.camera:null;const mic=mine?!!voice:!!media?.micOn;
        return <div className={`participant-tile color-${index%4}`} key={member.user_id}>{cam?<StreamVideo stream={cam} muted className="camera-stream"/>:<span className="participant-initial">{member.display_name.charAt(0).toUpperCase()}</span>}<div className="participant-label"><span>{member.display_name}{mine?' (you)':''}</span>{mic?<Mic size={12}/>:<MicOff size={12}/>}</div>{snapshot.room.active_sharer===member.user_id&&<span className="sharing-badge"><Monitor size={11}/> Sharing</span>}</div>;
      })}{snapshot.members.length<6&&<button className="invite-tile" disabled={demo} onClick={copyInvite}><span>+</span><strong>Save them a seat</strong></button>}</div>
      <div className="control-bar"><div className="device-controls"><button className={`control ${voice?'enabled':''}`} onClick={()=>void toggleMedia('voice')} aria-label={voice?'Mute microphone':'Enable microphone'}>{voice?<Mic size={21}/>:<MicOff size={21}/>}<span>{voice?'Mic on':'Mic off'}</span></button><button className={`control ${camera?'enabled':''}`} onClick={()=>void toggleMedia('camera')} aria-label={camera?'Turn camera off':'Turn camera on'}>{camera?<Video size={21}/>:<VideoOff size={21}/>}<span>{camera?'Camera on':'Camera off'}</span></button><button className="control" onClick={()=>setSettings(!settings)} aria-label="Media settings"><Settings2 size={21}/><span>Settings</span></button></div><div className="share-control">{amSharing?<button className="button stop" onClick={()=>void release()}><Square size={14} fill="currentColor"/> Stop sharing</button>:snapshot.room.active_sharer?<button className="button secondary" onClick={()=>{if(demo)return;void command('request',initial.room.invite_code).then(setState).then(()=>setNotice('Your request is visible in the People panel. The broadcaster can stop sharing to pass the screen.')).catch(e=>setError(friendlyError(e)));}}>Ask for a turn</button>:<button disabled={busy} className="button primary" onClick={()=>void startShare()}><MonitorUp size={17}/>{busy?'Starting…':'Share screen'}</button>}</div><button className="control leave-control" onClick={()=>void leave()}><DoorOpen size={20}/><span>Leave</span></button></div><p className="room-footnote"><Shield size={12}/> No recording. No independent players. Just one shared stream.</p></section>
      <aside className="room-sidebar"><div className="sidebar-tabs"><button className={panel==='chat'?'active':''} onClick={()=>setPanel('chat')}><MessageCircle size={16}/> The conversation</button><button className={panel==='people'?'active':''} onClick={()=>setPanel('people')}><Users size={16}/><span>{snapshot.members.length}</span></button></div>{panel==='chat'?<><div className="chat-messages"><div className="chat-welcome"><span>✳</span><strong>Make yourself at home.</strong><p>This is your little corner.<br/>Say something. Send a laugh.</p></div>{snapshot.messages.map(message=><div className={`chat-message ${message.sender_id===userId?'mine':''}`} key={message.id}><div><strong>{snapshot.members.find(m=>m.user_id===message.sender_id)?.display_name||'A friend'}</strong><time>{new Date(message.created_at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</time></div><p>{message.body}</p></div>)}<div ref={chatEnd}/></div><form className="chat-composer" onSubmit={sendMessage}><input aria-label="Message the room" maxLength={1000} placeholder="Say something nice…" value={draft} onChange={e=>setDraft(e.target.value)}/><button aria-label="Send message" disabled={sending||!draft.trim()}>{sending?<LoaderCircle size={17}/>:<Send size={17}/>}</button></form></>:<div className="people-panel">{snapshot.members.map((m,i)=><div className="person-row" key={m.user_id}><span className={`person-avatar color-${i%4}`}>{m.display_name[0].toUpperCase()}</span><div><strong>{m.display_name}{m.user_id===userId?' (you)':''}</strong><span>{m.user_id===snapshot.room.owner_id?'Room creator':'Here for the good company'}</span>{m.requested&&<small>✋ Wants to share next</small>}</div>{m.user_id===snapshot.room.active_sharer?<MonitorUp size={15}/>:null}</div>)}<div className="people-note"><Radio size={18}/><p>One person shares at a time. Stop sharing when you’re ready to pass the screen.</p></div></div>}<div className="sidebar-footer"><span className="green-dot"/>{demo?'LOCAL PREVIEW':'A LITTLE CLOSER, TOGETHER'}</div></aside></div>
    {Object.entries(remote).map(([id,media])=><RemoteAudio key={id} stream={media.voice}/>)}
  </main>;
}
