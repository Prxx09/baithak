import { useEffect,useRef,useState } from 'react';
import { ArrowUpRight,Check,ChevronDown,Copy,Crown,DoorOpen,ExternalLink,ListMusic,LoaderCircle,MessageCircle,MoreHorizontal,Music2,Pause,Play,Plus,RefreshCw,Search,Send,Shield,SkipForward,SkipBack,Trash2,Users,X } from 'lucide-react';
import { backend,command,refreshMembership } from '../lib/backend';
import { friendlyError } from '../lib/config';
import { expectedPosition,timeLabel,videoId,playlistId,type Playback,type QueueItem,type VideoChoice,type WatchState } from '../lib/playback';
import { WatchSession } from '../lib/watch';
import { playlistPage } from '../lib/discovery';
import type { Snapshot } from '../lib/types';
import { YouTubePlayer,type PlayerHandle } from './YouTubePlayer';
import { VoiceChat } from './VoiceChat';
import { RoomLifetime } from './RoomLifetime';
import { RoomChat, RoomReactions, useRoomSocial } from './RoomSocial';

function emptyWatch(roomId:string,host:string):WatchState{return {playback:{room_id:roomId,host_id:host,host_epoch:1,video_epoch:0,revision:0,video_id:null,video_title:'',playback_state:'paused',position_seconds:0,playback_rate:1,autoplay_enabled:true,autoplay_next:null,recently_played:[],playlist_id:null,playlist_page_token:null,updated_at:new Date().toISOString()},queue:[],server_now:new Date().toISOString()};}
export function WatchRoom({initial,userId,demo,onLeave}:{initial:Snapshot;userId:string;demo:boolean;onLeave:()=>void}){
  const [snapshot,setSnapshot]=useState(initial);
  const [watch,setWatch]=useState<WatchState|null>(demo?emptyWatch(initial.room.id,userId):null);
  const watchRef=useRef(watch);watchRef.current=watch;
  const session=useRef<WatchSession|null>(null),player=useRef<PlayerHandle|null>(null);
  const [error,setError]=useState(''),[notice,setNotice]=useState('');
  const [query,setQuery]=useState(''),[results,setResults]=useState<VideoChoice[]>([]);
  const [searching,setSearching]=useState(false),[pending,setPending]=useState(0);
  const [panel,setPanel]=useState<'queue'|'chat'>('queue');
  const [draft,setDraft]=useState(''),[sending,setSending]=useState(false);
  const [copied,setCopied]=useState(false),[people,setPeople]=useState(false),[options,setOptions]=useState(false);
  const [position,setPosition]=useState(0),[duration,setDuration]=useState(0),[seek,setSeek]=useState<number|null>(null);
  const seekValue=useRef<number|null>(null);
  const [playerPlaying,setPlayerPlaying]=useState(false);
  const [playerGeneration,setPlayerGeneration]=useState(0);
  const [status,setStatus]=useState('Ready'),[transport,setTransport]=useState(demo?'Local preview':'Connecting');
  const [ended,setEnded]=useState<'expired'|'session'|'closed'|null>(null);
  const [leaving,setLeaving]=useState(false);
  const [autoBusy,setAutoBusy]=useState(false),[discoveryError,setDiscoveryError]=useState('');
  const playlistRequest=useRef<{key:string;promise:Promise<WatchState|null>}|null>(null);
  const advancing=useRef<Promise<void>|null>(null);
  const skipFailures=useRef(0);
  const p=watch?.playback||null;
  const isHost=p?.host_id===userId;
  const host=snapshot.members.find(m=>m.user_id===p?.host_id);
  const canSearch=!!import.meta.env.VITE_YOUTUBE_API_KEY;
  const roomCode=initial.room.invite_code;
  const invite=`${location.origin}/?room=${roomCode}`;
  const displayName=initial.members.find(member=>member.user_id===userId)?.display_name||'';
  function now(){return session.current?.clock.now()||Date.now();}
  const social=useRoomSocial(initial.room.id,userId,snapshot.members,demo,!ended&&!leaving,now);
  async function prepareVoice(){const next=await refreshMembership(roomCode,displayName);setSnapshot(next);return next.members;}
  function endLocally(){session.current?.close();player.current?.pause();setEnded('expired');}
  function accept(next:WatchState){watchRef.current=next;setWatch(next);}
  useEffect(()=>{
    if(demo||ended)return;
    let alive=true,refreshing=false;
    const connected=new WatchSession(backend(),roomCode,initial.room.id,state=>{if(alive){accept(state);setTransport('Following the room');}},message=>{if(alive){setError(friendlyError(new Error(message)));setTransport('Reconnecting');}});
    session.current=connected;
    void connected.start().catch(e=>{if(alive){setError(friendlyError(e));setTransport('Setup needed');}});
    async function refresh(){
      if(refreshing)return;refreshing=true;
      try{const next=await refreshMembership(roomCode,displayName);if(alive)setSnapshot(next);}
      catch(e){if(alive){setError(friendlyError(e));if(/ended|expired|invalid/i.test(friendlyError(e))){connected.close();player.current?.pause();setEnded(/session expired/i.test(friendlyError(e))?'session':'closed');}}}
      finally{refreshing=false;}
    }
    void refresh();const timer=setInterval(()=>void refresh(),5000);
    const chat=backend().channel(`watch-chat:${initial.room.id}`).on('postgres_changes',{event:'INSERT',schema:'public',table:'baithak_chat',filter:`room_id=eq.${initial.room.id}`},()=>void refresh()).subscribe();
    const restore=()=>{if(document.visibilityState==='visible'){void refresh();void connected.read().then(()=>player.current?.resync()).catch(e=>{if(alive)setError(friendlyError(e));});}};
    const networkRestore=()=>{void connected.read().then(()=>player.current?.resync()).catch(e=>{if(alive)setError(friendlyError(e));});};
    document.addEventListener('visibilitychange',restore);window.addEventListener('online',networkRestore);
    return ()=>{alive=false;clearInterval(timer);connected.close();session.current=null;void backend().removeChannel(chat);document.removeEventListener('visibilitychange',restore);window.removeEventListener('online',networkRestore);};
  },[demo,ended,initial.room.id,roomCode]);

  async function action(name:string,payload:Record<string,unknown>={}){
    if(!demo){if(!session.current)throw new Error('The room is still connecting.');return await session.current.action(name,payload);}
    const before=watchRef.current!;let playback={...before.playback};let queue=[...before.queue];
    if(name==='enqueue')queue.push({id:Date.now(),video_id:String(payload.video_id),title:String(payload.title),added_by:userId});
    else if(name==='remove')queue=queue.filter(q=>q.id!==payload.id);
    else if(name==='set_playlist'){playback.playlist_id=String(payload.playlist_id);playback.playlist_page_token='';playback.autoplay_next=null;}
    else if(name==='playlist_page'&&payload.expected_token===playback.playlist_page_token){queue.push(...(payload.items as VideoChoice[]).map((v,i)=>({id:Date.now()+i,video_id:v.id,title:v.title,added_by:userId})));playback.playlist_page_token=payload.next_token?String(payload.next_token):null;}
    else if(name==='transfer'){playback.host_id=String(payload.host_id);playback.host_epoch++;}
    else if(name==='load'){playback.video_id=String(payload.video_id);playback.video_title=String(payload.title);playback.video_epoch++;playback.position_seconds=0;playback.playback_state='playing';playback.updated_at=new Date().toISOString();}
    else if(name==='next'||name==='play_item'){
      const next=name==='play_item'?queue.find(item=>item.id===payload.id):queue[0];
      if(next)queue=queue.filter(item=>item.id!==next.id);playback.position_seconds=next?0:Number(payload.position)||expectedPosition(playback,now());playback.playback_state=next?'playing':'paused';playback.updated_at=new Date().toISOString();
      if(next){playback.video_id=next.video_id;playback.video_title=next.title;playback.video_epoch++;}
    }else if(['play','pause','seek','rate','tick'].includes(name)){
      playback={...playback,position_seconds:Number(payload.position??expectedPosition(playback,now())),playback_rate:Number(payload.rate??playback.playback_rate),playback_state:(payload.state as Playback['playback_state'])||playback.playback_state,updated_at:new Date().toISOString()};
      if(payload.title)playback.video_title=String(payload.title);
      if(name==='play')playback.playback_state='playing';if(name==='pause')playback.playback_state='paused';
    }
    if(playback.video_epoch!==before.playback.video_epoch){playback.recently_played=[...(before.playback.recently_played||[]),...(before.playback.video_id?[before.playback.video_id]:[])].slice(-100);playback.autoplay_next=null;}
    playback.revision++;const next={playback,queue,server_now:new Date().toISOString()};accept(next);return next;
  }
  function fire(name:string,payload:Record<string,unknown>={}){
    if(!isHost)return;
    if(name==='next'){void advance(payload).catch(e=>setError(friendlyError(e)));return;}
    void action(name,payload).catch(e=>{setError(friendlyError(e));if(!demo)void session.current?.read().then(()=>player.current?.resync()).catch(()=>{});});
  }
  async function fillPlaylist():Promise<WatchState|null>{
    const start=watchRef.current,p=start?.playback;
    if(!start||!p?.playlist_id||p.playlist_page_token==null||p.host_id!==userId||start.queue.length>5)return start;
    const key=`${p.host_epoch}:${p.playlist_id}:${p.playlist_page_token}`;
    if(playlistRequest.current?.key===key)return playlistRequest.current.promise;
    const promise=(async()=>{
      try{
        const page=await playlistPage(p.playlist_id!,p.playlist_page_token!,import.meta.env.VITE_YOUTUBE_API_KEY);
        const current=watchRef.current;
        if(!current||current.playback.host_id!==userId||current.playback.host_epoch!==p.host_epoch||current.playback.playlist_id!==p.playlist_id||current.playback.playlist_page_token!==p.playlist_page_token)return current;
        return await action('playlist_page',{playlist_id:p.playlist_id,expected_token:p.playlist_page_token,next_token:page.nextToken,items:page.items});
      }catch(e){setDiscoveryError(friendlyError(e));return watchRef.current;}
    })();playlistRequest.current={key,promise};return promise;
  }
  async function advance(payload:Record<string,unknown>):Promise<void>{
    if(advancing.current)return advancing.current;
    const start=watchRef.current;if(!start||start.playback.host_id!==userId)return;
    const epoch=Number(payload.from_video_epoch??start.playback.video_epoch);
    const promise=(async()=>{
      setAutoBusy(true);
      try{
        if(!watchRef.current?.queue.length)await fillPlaylist();
        const current=watchRef.current;
        if(!current||current.playback.host_id!==userId||current.playback.host_epoch!==start.playback.host_epoch||current.playback.video_epoch!==epoch)return;
        await action('next',{...payload,from_video_epoch:epoch});
      }finally{setAutoBusy(false);}
    })();advancing.current=promise;try{await promise;}finally{advancing.current=null;}
  }
  useEffect(()=>{
    if(isHost&&p?.playlist_id&&p.playlist_page_token!=null&&watch!.queue.length<=5)void fillPlaylist();
  },[isHost,p?.video_epoch,p?.playlist_id,p?.playlist_page_token,watch?.queue.length]);
  async function pick(choice:VideoChoice,playNow:boolean){
    setPending(n=>n+1);setError('');
    try{
      if(playNow&&isHost){await action('load',{video_id:choice.id,title:choice.title});}
      else{const next=await action('enqueue',{video_id:choice.id,title:choice.title});if(isHost&&!next.playback.video_id)await action('next');else setNotice('Added to the shared queue.');}
      setQuery('');setResults([]);setPanel('queue');
    }catch(e){setError(friendlyError(e));}finally{setPending(n=>n-1);}
  }
  async function search(e:React.FormEvent){
    e.preventDefault();if(!query.trim())return;
    const id=videoId(query),list=playlistId(query);setError('');setSearching(true);
    try{
      if(list){
        if(!isHost)throw new Error('Ask the host to load this playlist. You can add individual videos to the queue.');
        if(!canSearch)throw new Error('Playlist discovery is not configured yet. You can still add individual video links.');
        await action('set_playlist',{playlist_id:list});
        await fillPlaylist();
        if(!watchRef.current?.playback.video_id)await advance({});
        setNotice('Playlist added. More videos will load automatically as the queue plays.');setQuery('');
      }else if(id){
        let title=`YouTube video · ${id}`;
        try{const response=await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}&format=json`,{signal:AbortSignal.timeout(5000)});if(response.ok)title=(await response.json()).title||title;}catch{/* Metadata is optional; playback does not depend on it. */}
        setResults([{id,title}]);
      }else if(canSearch){
        const url=new URL('https://www.googleapis.com/youtube/v3/search');url.search=new URLSearchParams({part:'snippet',type:'video',videoEmbeddable:'true',maxResults:'8',q:query,key:import.meta.env.VITE_YOUTUBE_API_KEY}).toString();
        const response=await fetch(url,{signal:AbortSignal.timeout(10000)});const data=await response.json();if(!response.ok)throw new Error(data.error?.message||'YouTube search could not be reached.');
        setResults(data.items.map((v:{id:{videoId:string};snippet:{title:string;channelTitle:string}})=>({id:v.id.videoId,title:v.snippet.title,channel:v.snippet.channelTitle})));
        if(!data.items.length)setNotice('No videos found. Try another search.');
      }else throw new Error('Paste a YouTube link or video ID. You can also find a video with “Search on YouTube”.');
    }catch(e){setError(friendlyError(e));}finally{setSearching(false);}
  }
  async function copy(){try{await navigator.clipboard.writeText(invite);setCopied(true);setTimeout(()=>setCopied(false),2000);}catch{setNotice(`Share this invitation: ${invite}`);}}
  async function leave(end=false){
    if(end&&!confirm('End this baithak for everyone?'))return;
    setLeaving(true);
    try{if(!demo)await command(end?'end':'leave',roomCode);}catch(e){setError(friendlyError(e));if(end){setLeaving(false);return;}}
    session.current?.close();onLeave();
  }
  async function send(e:React.FormEvent){
    e.preventDefault();if(!draft.trim()||sending)return;setSending(true);
    const text=draft.trim();
    try{
      if(demo)setSnapshot(previous=>({...previous,messages:[...previous.messages,{id:Date.now(),sender_id:userId,body:text,created_at:new Date().toISOString()}]}));
      else{
        await prepareVoice();
        const {error}=await backend().from('baithak_chat').insert({room_id:initial.room.id,sender_id:userId,body:text});if(error)throw error;
        // Sending succeeded even if a subsequent refresh fails. Keep the local
        // message until heartbeat replaces it, rather than inviting a resend.
        setSnapshot(previous=>({...previous,messages:[...previous.messages,{id:-Date.now(),sender_id:userId,body:text,created_at:new Date().toISOString()}]}));
        void refreshMembership(roomCode,displayName).then(setSnapshot).catch(()=>{});
      }
      setDraft(current=>current.trim()===text?'':current);
    }catch(e){setError(friendlyError(e));}finally{setSending(false);}
  }
  function takeNext(){fire('next',player.current?.sample() as unknown as Record<string,unknown>||{});}
  function commitSeek(){if(seekValue.current!==null){player.current?.seek(seekValue.current);seekValue.current=null;setSeek(null);}}
  if(ended)return <main className="wrap room-ended"><span className="eyebrow">{ended==='session'?'YOUR SESSION HAS ENDED':'THIS BAITHAK HAS ENDED'}</span><h1>Good company. Until next time.</h1><p>{ended==='expired'?'This temporary room reached its four-hour limit. Playback and voice have stopped, and the invitation has expired.':ended==='session'?'Your connection was inactive for too long. Playback and voice have stopped. You can rejoin with the invitation if the room is still open.':'This room is no longer available. Playback and voice have stopped. Create a fresh room to keep hanging out.'}</p><button className="button primary" onClick={onLeave}>Back to rooms <ArrowUpRight size={17}/></button></main>;
  return <main className="watch-page wrap">
    {demo?<div className="preview-banner"><span><Music2 size={14}/> Local player preview · Try a YouTube link. No remote guests are connected.</span><button onClick={onLeave}>Create a real room <ArrowUpRight size={14}/></button></div>:null}
    {!demo&&<RoomLifetime expiresAt={snapshot.room.expires_at} now={now} onExpire={endLocally}/>}
    <div className="room-heading"><div><div className="room-eyebrow"><span className="green-dot"/> A LITTLE CLOSER, ONE SONG AT A TIME</div><h1>{snapshot.room.title}<span className="room-hindi">बैठक</span></h1><p><Shield size={12}/> Invite-only room <span>·</span> No sign-in <span>·</span> {transport}</p></div><div className="room-header-actions"><button className="button secondary" aria-expanded={people} onClick={()=>setPeople(!people)}><Users size={15}/>{snapshot.members.length} here <ChevronDown size={12}/></button><button disabled={demo} className="button primary" onClick={()=>void copy()}>{copied?<Check size={15}/>:<Copy size={15}/>} {copied?'Link copied':'Invite your people'}</button><button className="icon-button" aria-label="Room options" aria-expanded={options} onClick={()=>setOptions(!options)}><MoreHorizontal size={20}/></button></div></div>
    {error?<div className="notice error" role="alert">{error}<button aria-label="Dismiss error" onClick={()=>setError('')}><X size={16}/></button></div>:null}
    {notice?<div className="notice" role="status">{notice}<button aria-label="Dismiss notice" onClick={()=>setNotice('')}><X size={16}/></button></div>:null}
    {people?<section className="watch-people"><div><strong>Your people</strong><span>One host keeps everyone in sync.</span></div>{snapshot.members.map((m,index)=><div className="watch-person" key={m.user_id}><span className={`person-avatar color-${index%4}`}>{m.display_name[0].toUpperCase()}</span><div><strong>{m.display_name}{m.user_id===userId?' (you)':''}</strong><small>{m.user_id===p?.host_id?'Host':m.requested?'Wants to host next':'Following the host'}</small></div>{isHost&&m.user_id!==userId?<button className="button secondary" onClick={()=>fire('transfer',{host_id:m.user_id})}>Make host</button>:m.user_id===p?.host_id?<Crown size={15}/>:null}</div>)}</section>:null}
    {options?<div className="room-settings"><button className="button secondary" onClick={()=>{void session.current?.read().then(()=>player.current?.resync()).catch(e=>setError(friendlyError(e)));player.current?.resync();}}>Resync player</button><button className="button secondary" onClick={()=>setPlayerGeneration(n=>n+1)}>Reload player</button>{snapshot.room.owner_id===userId&&!demo?<button className="button danger" onClick={()=>void leave(true)}>End room for everyone</button>:null}<p>Only the host changes the room’s playback. Your volume and fullscreen controls are personal.</p></div>:null}
    {!leaving&&<VoiceChat roomId={initial.room.id} userId={userId} members={snapshot.members} demo={demo} prepare={prepareVoice}/>}
    <RoomReactions reactions={social.reactions} members={snapshot.members} user={userId} onReact={social.react}/>
    <nav className="room-mobile-nav" aria-label="Room shortcuts"><a href="#room-player">Watch</a><a href="#room-voice">Voice</a><button onClick={()=>{setPanel('chat');document.getElementById('room-sidebar')?.scrollIntoView({block:'start',behavior:'smooth'});}}>Chat {social.typingNames.length>0&&<span className="tab-typing-dot" aria-label="Someone is typing"/>}</button><button onClick={()=>{setPanel('queue');document.getElementById('room-sidebar')?.scrollIntoView({block:'start',behavior:'smooth'});}}>Queue</button></nav>
    <div className="watch-layout"><section className="watch-main"><div id="room-player" className="watch-stage"><div className="stage-top"><span><span className="status-dot live"/>{isHost?'YOU’RE THE HOST':`${host?.display_name||'The host'} CONTROLS PLAYBACK`}</span><span>{status}</span></div><YouTubePlayer key={playerGeneration} ref={player} playback={p} isHost={isHost} hasQueuedNext={!!watch?.queue.length||!!(p?.playlist_id&&p.playlist_page_token!=null)} serverNow={now} onCommand={fire} onProgress={(position,duration)=>{setPosition(position);setDuration(duration);if(position>5)skipFailures.current=0;}} onPlayingChange={setPlayerPlaying} onStatus={setStatus} onError={setError} onUnavailable={id=>{if(isHost&&id===watchRef.current?.playback.video_id&&skipFailures.current<3&&(watchRef.current.queue.length||!!(p?.playlist_id&&p?.playlist_page_token!=null))){skipFailures.current++;setNotice('This video is unavailable. Trying the next one…');fire('next',{from_video_epoch:p?.video_epoch});}}}/>
      <div className="watch-now"><div><span className="eyebrow">{p?.video_id?'NOW PLAYING':'YOUR NEXT SHARED MOMENT'}</span><h2>{p?.video_title||'Good company. Great videos.'}</h2></div>{p?.video_id?<a className="icon-button" href={`https://www.youtube.com/watch?v=${p.video_id}`} target="_blank" rel="noreferrer" aria-label="Open current video on YouTube"><ExternalLink size={16}/></a>:<span className="watch-note">बैठक</span>}</div>
      <div className="watch-transport"><div className="watch-scrubber"><span>{timeLabel(seek??position)}</span><input aria-label="Video position" type="range" min="0" max={duration||1} step="0.1" value={Math.min(seek??position,duration||1)} disabled={!isHost||!p?.video_id} onChange={e=>{seekValue.current=Number(e.target.value);setSeek(seekValue.current);}} onPointerUp={commitSeek} onPointerCancel={commitSeek} onKeyUp={commitSeek} onBlur={commitSeek}/><span>{timeLabel(duration)}</span></div><div className="watch-buttons"><div className="playback-buttons"><button className="icon-button" aria-label="Back 10 seconds" title="Back 10 seconds" disabled={!isHost||!p?.video_id} onClick={()=>player.current?.seek(Math.max(0,position-10))}><SkipBack size={18}/><span>10</span></button><button className="watch-play" aria-label={playerPlaying?'Pause for everyone':'Play for everyone'} disabled={!isHost||!p?.video_id} onClick={()=>playerPlaying?player.current?.pause():player.current?.play()}>{playerPlaying?<Pause size={21} fill="currentColor"/>:<Play size={21} fill="currentColor"/>}</button><button className="icon-button" aria-label="Forward 10 seconds" title="Forward 10 seconds" disabled={!isHost||!p?.video_id} onClick={()=>player.current?.seek(Math.min(duration||Infinity,position+10))}><SkipForward size={18}/><span>10</span></button><button className="icon-button next-video" aria-label="Play next video" title="Next video" disabled={!isHost||autoBusy||(!watch?.queue.length&&!(p?.playlist_id&&p.playlist_page_token!=null))} onClick={takeNext}>{autoBusy?<LoaderCircle className="spin" size={19}/>:<ListMusic size={19}/>}</button></div><div className="watch-sync-actions"><select aria-label="Playback speed" disabled={!isHost||!p?.video_id} value={p?.playback_rate||1} onChange={e=>player.current?.rate(Number(e.target.value))}>{[0.5,0.75,1,1.25,1.5,1.75,2].map(rate=><option value={rate} key={rate}>{rate}×</option>)}</select><button className="text-button" disabled={!p?.video_id} onClick={()=>player.current?.resync()}><RefreshCw size={13}/> Resync</button></div></div>{((!isHost||status==='Click Start watching')&&p?.video_id)?<div className="watch-guest"><span><Crown size={12}/> {isHost?'Your browser needs one tap to start audio.':`Following ${host?.display_name||'the host'}. Local changes resync automatically.`}</span><button className="button secondary" onClick={()=>player.current?.start()}><Play size={13}/> Start watching</button></div>:null}</div></div>
      <section className="watch-discover"><div className="watch-discover-heading"><span className="discover-icon"><Music2 size={19}/></span><div><h3>Find the next good thing.</h3><p>{canSearch?'Search YouTube, or paste a video or playlist link.':'Paste a YouTube link. Play it here, together.'}</p></div></div><form onSubmit={search} className="watch-search"><Search size={18}/><input required aria-label={canSearch?'Search YouTube or paste a link':'Paste a YouTube link'} value={query} onChange={e=>setQuery(e.target.value)} placeholder={canSearch?'Search YouTube or paste a video / playlist link…':'Paste a YouTube video link or video ID…'}/><button className="button primary" disabled={searching}>{searching?<LoaderCircle className="spin" size={16}/>:<ArrowUpRight size={17}/>} {searching?'Finding…':canSearch?'Find video':'Find video'}</button></form><div className="search-help"><span>Everyone can add to the queue. The host picks what plays.</span>{!canSearch?<a href={`https://www.youtube.com/results?search_query=${encodeURIComponent(query||'music')}`} target="_blank" rel="noreferrer">Search on YouTube <ArrowUpRight size={12}/></a>:null}</div>{results.length?<div className="watch-results">{results.map(choice=><article className="video-result" key={choice.id}><img src={`https://i.ytimg.com/vi/${choice.id}/mqdefault.jpg`} alt=""/><div><strong>{choice.title}</strong><span>{choice.channel||'YouTube'}</span></div>{isHost?<button className="button secondary" disabled={pending>0} onClick={()=>void pick(choice,true)}><Play size={13}/> Play now</button>:null}<button className="icon-button" aria-label={`Add ${choice.title} to queue`} disabled={pending>0||!watch} onClick={()=>void pick(choice,false)}><Plus size={17}/></button></article>)}</div>:null}{!p?.video_id&&!results.length?<button className="sample-video" disabled={!watch||pending>0} onClick={()=>void pick({id:'M7lc1UVf-VE',title:'YouTube Player Demo'},isHost)}><Play size={12}/> Try the YouTube sample video <ArrowUpRight size={12}/></button>:null}</section>
      <div className="watch-room-footer"><div className="room-member-chips">{snapshot.members.map((m,i)=><span key={m.user_id} className={`color-${i%4}`}>{m.user_id===p?.host_id?<Crown size={10}/>:<span className="green-dot"/>}{m.display_name}</span>)}</div><button className="text-button leave-watch" onClick={()=>void leave()}><DoorOpen size={14}/> Leave room</button></div>
    </section><aside id="room-sidebar" className="watch-sidebar room-sidebar"><div className="sidebar-tabs"><button aria-pressed={panel==='queue'} className={panel==='queue'?'active':''} onClick={()=>setPanel('queue')}><ListMusic size={16}/> Up next <span>{watch?.queue.length||0}</span></button><button aria-pressed={panel==='chat'} className={panel==='chat'?'active':''} onClick={()=>setPanel('chat')}><MessageCircle size={16}/> Chat {social.typingNames.length>0&&<span className="tab-typing-dot" aria-label="Someone is typing"/>}</button></div>{panel==='queue'?<><div className="autoplay-setting youtube-source"><div><strong>YouTube suggestions</strong><span>Available inside the host’s player</span></div><span className="source-badge">YT</span></div><div className="watch-queue">{watch?.queue.length?watch.queue.map((item,index)=><QueueCard key={item.id} item={item} index={index} isHost={isHost} mine={item.added_by===userId} pending={pending>0} onPlay={()=>fire('play_item',{id:item.id})} onRemove={()=>void action('remove',{id:item.id}).catch(e=>setError(friendlyError(e)))}/>):<div className="queue-empty"><span>✳</span><h3>The queue is open.</h3><p>Add a video, or let the host choose from YouTube’s suggestions in the player.</p><span className="queue-tip">The host’s choice syncs to everyone.</span></div>}<p className="autoplay-hint">{autoBusy?'Loading the next queued video…':p?.playlist_id&&p.playlist_page_token!=null?'Your YouTube playlist continues automatically.':p?.video_id?'At the end, the host can choose a related video in the YouTube player.':'Play a video to get started.'}</p>{discoveryError?<div className="discovery-note">{discoveryError}{isHost?<button className="text-button" onClick={()=>{playlistRequest.current=null;setDiscoveryError('');void fillPlaylist();}}>Try again</button>:null}</div>:null}</div><div className="queue-bottom"><span><ListMusic size={13}/> {watch?.queue.length||0}/30 videos</span>{!isHost&&!demo?<button className="text-button" onClick={()=>void action('request_host').then(()=>setNotice('The host can pass control to you from the people list.')).catch(e=>setError(friendlyError(e)))}>Ask to host <Crown size={12}/></button>:<span>Host picks next</span>}</div></>:<RoomChat messages={snapshot.messages} members={snapshot.members} user={userId} draft={draft} sending={sending} typingNames={social.typingNames} onDraft={setDraft} onSend={send} onTyping={social.announceTyping}/>}<div className="sidebar-footer"><span className="green-dot"/> SAME VIDEO. SAME MOMENT.</div></aside></div>
  </main>;
}
function QueueCard({item,index,isHost,mine,pending,onPlay,onRemove}:{item:QueueItem;index:number;isHost:boolean;mine:boolean;pending:boolean;onPlay:()=>void;onRemove:()=>void}){
  return <article className="queue-card"><div className="queue-thumb"><img src={`https://i.ytimg.com/vi/${item.video_id}/mqdefault.jpg`} alt=""/><span>{String(index+1).padStart(2,'0')}</span></div><div className="queue-card-copy"><strong>{item.title}</strong><span>{mine?'Added by you':'Added to the room'}</span></div><div className="queue-card-actions">{isHost?<button className="icon-button" aria-label={`Play ${item.title}`} disabled={pending} onClick={onPlay}><Play size={12}/></button>:null}{isHost||mine?<button className="icon-button" aria-label={`Remove ${item.title}`} onClick={onRemove}><Trash2 size={12}/></button>:null}</div></article>;
}
