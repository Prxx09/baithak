import { lazy, Suspense, useState } from 'react';
import { ArrowUpRight, Code2, Settings2 } from 'lucide-react';
import { Landing } from './components/Landing';
import { Connection } from './components/Connection';
import type { Snapshot } from './lib/types';
import { getConfig } from './lib/config';
const Room=lazy(()=>import('./components/WatchRoom').then(module=>({default:module.WatchRoom})));

export function App() {
  const [session,setSession]=useState<{snapshot:Snapshot;id:string;demo:boolean}|null>(null);
  const [connection,setConnection]=useState(false);
  const showSetup=!getConfig().key||new URLSearchParams(location.search).has('setup');
  function preview(){setSession({id:'preview-you',demo:true,snapshot:{room:{id:'local-preview',invite_code:'',title:'Your little living room',owner_id:'preview-you',active_sharer:null,lease_until:null,closed:false,expires_at:new Date(Date.now()+14400000).toISOString()},members:[{user_id:'preview-you',display_name:'You',requested:false,last_seen:new Date().toISOString()}],messages:[]}});window.scrollTo(0,0);}
  function leave(){setSession(null);history.replaceState({},'','/');window.scrollTo(0,0);}
  return <><header className="site-header wrap"><a className="brand" href="/" onClick={e=>{if(!session){e.preventDefault();window.scrollTo({top:0,behavior:'smooth'});}}}><span className="brand-symbol"><svg width="25" height="25" viewBox="0 0 32 32" aria-hidden="true"><path d="M6 7h10a9 9 0 0 1 0 18H6V7Zm8 5v8l7-4-7-4Z" fill="currentColor"/><circle cx="25" cy="26" r="4" fill="currentColor"/></svg></span><span>baithak<span className="brand-period">.</span></span></a><nav aria-label="Main navigation">{!session&&<><a href="#start">The plan</a><button onClick={preview}>The room <ArrowUpRight size={13}/></button></>}<a href="https://github.com/Prxx09/baithak" target="_blank" rel="noreferrer" className="github-link" aria-label="Baithak on GitHub"><Code2 size={18}/><span>Open source</span></a>{showSetup&&<button className="icon-button connection-button" aria-label="Connection settings" onClick={()=>setConnection(true)}><Settings2 size={17}/></button>}</nav></header>{session?<Suspense fallback={<main className="wrap room-loading" role="status"><span className="green-dot"/> Getting your room ready…</main>}><Room initial={session.snapshot} userId={session.id} demo={session.demo} onLeave={leave}/></Suspense>:<Landing onSetup={()=>setConnection(true)} onPreview={preview} onEnter={(snapshot,id)=>{history.replaceState({},'',`/?room=${snapshot.room.invite_code}`);setSession({snapshot,id,demo:false});window.scrollTo(0,0);}}/>}{!session&&<footer className="site-footer wrap"><span>बैठक <i>—</i> A place to just be.</span><span>Built for company. Open to everyone.</span><a href="https://github.com/Prxx09/baithak" target="_blank" rel="noreferrer">Made to be shared <ArrowUpRight size={13}/></a></footer>}{connection&&<Connection onClose={()=>setConnection(false)}/>}</>;
}
