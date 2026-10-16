import { useEffect, useState } from 'react';
import { ArrowUpRight, ArrowRight, Play, MonitorUp, Headphones, Link2, Radio, ShieldCheck, Users, Check, LoaderCircle, Sparkles } from 'lucide-react';
import type { Snapshot } from '../lib/types';
import { guest,command } from '../lib/backend';
import { parseRoomCode,friendlyError,getConfig } from '../lib/config';

export function Landing({onEnter,onPreview,onSetup}:{onEnter:(snapshot:Snapshot,id:string)=>void;onPreview:()=>void;onSetup:()=>void}) {
  const invitation=new URLSearchParams(location.search).get('room')||'';
  const [mode,setMode]=useState<'create'|'join'>(invitation?'join':'create');
  const [name,setName]=useState('');
  const [title,setTitle]=useState('The evening baithak');
  const [code,setCode]=useState(invitation);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const connected=!!getConfig().key;
  async function enterRoom(action:'create'|'join', invitationCode=code) {
    setError('');
    const displayName=name.trim();
    if(!displayName){setError('Add your name so your people know it’s you.');return;}
    if(action==='create'&&!title.trim()){setError('Give your room a name first.');return;}
    if(!connected){onSetup();return;}
    setBusy(true);
    try{
      const id=await guest();const snapshot=await command(action,action==='join'?parseRoomCode(invitationCode):'',displayName,title.trim());
      onEnter(snapshot,id);
    }
    catch(err){setError(friendlyError(err));}finally{setBusy(false);}
  }
  function enter(e:React.FormEvent){e.preventDefault();void enterRoom(mode);}
  useEffect(()=>{if(invitation)document.getElementById('start')?.scrollIntoView({block:'start'});},[invitation]);
  return <main>
    <section className="hero wrap">
      <div className="hero-copy"><div className="launch-pill"><span className="green-dot"/> GOOD COMPANY. ANY DISTANCE.</div><h1>Your songs.<br/>Your people.<br/><span>One baithak.</span></h1><p className="hero-description">The movie nights. The music rabbit holes.<br className="desktop"/> The “you have to see this” moments. All together.</p><div className="hero-links"><a className="button primary" href="#start">{invitation?'Join your baithak':'Start a baithak'} <ArrowUpRight size={19}/></a><button className="text-button" onClick={onPreview}><span className="play-round"><Play size={12} fill="currentColor"/></span> Take a look around</button></div><div className="hero-proof"><span><Check size={14}/> Free to get together</span><span><Check size={14}/> No downloads</span></div></div>
      <div className="hero-art"><div className="orbit-label"><span/> LESS SCROLLING. MORE SHARING.</div><div className="preview-window"><div className="preview-top"><div className="window-dots"><i/><i/><i/></div><span>the living room</span><span className="tiny-live"><Radio size={12}/> ROOM PREVIEW</span></div><div className="landscape"><div className="sun"/><div className="hill back"/><div className="hill front"/><div className="landscape-grain"/><div className="art-caption"><span>Some things are better</span><strong>with your people.</strong></div><div className="film-marker">BAITHAK ORIGINAL MOMENTS <span>01:24</span></div></div><div className="preview-controls"><span className="fake-play"><Play size={12} fill="currentColor"/></span><div className="fake-timeline"><i/></div><span>LIVE TOGETHER</span><Headphones size={16}/></div><div className="preview-bottom"><span className="preview-avatar purple">B</span><div><strong>Your next favourite hangout</strong><span>One host. Everyone in sync.</span></div><span className="preview-label">बैठक</span></div></div><div className="floating-card"><div className="float-icon"><Headphones size={23}/></div><div><strong>Same song. Same moment.</strong><span>YouTube, played in sync.</span></div><span className="wave-bars"><i/><i/><i/><i/><i/></span></div><div className="art-footer"><span>DIFFERENT PLACES.</span><svg width="72" height="16" viewBox="0 0 72 16" aria-hidden="true"><path d="M1 8h67m-7-6 7 6-7 6" stroke="currentColor" fill="none"/></svg><span>SAME VIBE.</span></div></div>
    </section>
    <div className="marquee"><div className="wrap marquee-inner"><span><MonitorUp size={16}/> ONE SHARED ROOM</span><i>✳</i><span><Headphones size={16}/> PLAYBACK IN SYNC</span><i>✳</i><span><Users size={16}/> A SHARED QUEUE</span><i>✳</i><span><Link2 size={16}/> JUST SEND A LINK</span></div></div>
    <section id="start" className="start-section wrap"><div className="start-copy"><span className="eyebrow">MAKE ROOM FOR YOUR PEOPLE</span><h2>Plans optional.<br/>Good company, essential.</h2><p>Open a room. Drop the link in your group.<br/>Let the evening figure itself out.</p><div className="feature-line"><span>01</span><div><strong>One room, one host.</strong><p>The host presses play. Everyone follows.</p></div></div><div className="feature-line"><span>02</span><div><strong>Skip together. Switch together.</strong><p>Play, pause, seek, and change songs together.</p></div></div><div className="feature-line"><span>03</span><div><strong>A little room, just for you.</strong><p>Invite up to five friends with an invite link.</p></div></div></div>
    <div className="start-card"><div className="card-heading"><span className="card-icon"><Users size={21}/></span><span className="small muted">YOUR SPACE, YOUR VIBE <Sparkles size={13}/></span></div><h3 className="start-card-title">{mode==='join'?'The group is waiting.':'Let’s get this together.'}</h3><p className="start-card-subtitle">{mode==='join'?'One name and you’re in. No account needed.':'Name the room, tell us who you are, then send the link.'}</p>{invitation&&mode==='join'&&<div className="invite-banner"><span className="green-dot"/> Invite link ready <span className="invite-banner-icon">✳</span></div>}<div className="mode-tabs"><button type="button" aria-pressed={mode==='create'} className={mode==='create'?'active':''} onClick={()=>{setMode('create');setError('');}}>Create a room</button><button type="button" aria-pressed={mode==='join'} className={mode==='join'?'active':''} onClick={()=>{setMode('join');setError('');}}>Join a room</button></div><form onSubmit={enter}>{mode==='create'?<label>Room name<input maxLength={80} required placeholder="The Friday night hangout" value={title} onChange={e=>setTitle(e.target.value)}/></label>:<label>Invitation link or room code<input required placeholder="Paste your invitation here" value={code} onChange={e=>setCode(e.target.value)}/></label>}<label className="required-name">Your name <span>REQUIRED</span><input maxLength={32} required autoComplete="nickname" placeholder="What should everyone call you?" value={name} onChange={e=>setName(e.target.value)}/></label><div className="name-preview"><span className="preview-initial">{name.trim().charAt(0).toUpperCase()||'?'}</span><span>{name.trim()?<>Joining as <strong>{name.trim()}</strong></>:'Your name shows up in the room'}</span><span className="preview-spark">✳</span></div>{error&&<div className="notice error" role="alert">{error}</div>}<button disabled={busy} className="button primary full" type="submit">{busy?<LoaderCircle className="spin" size={18}/>:null}{busy?'Getting your room ready…':mode==='create'?'Create my baithak':'Join the room'}<ArrowRight size={18}/></button></form><p className="card-note"><ShieldCheck size={14}/> No sign-in · Six people · Just share the link</p>{!connected&&<button className="connection-note" onClick={onSetup}>Backend connection needed <ArrowUpRight size={13}/></button>}</div></section>
    <section className="closing wrap"><span className="little-star">✳</span><p>Far apart.<br/><span>Still hanging out.</span></p><button className="text-button" onClick={onPreview}>Explore the room <ArrowUpRight size={18}/></button></section>
  </main>;
}
