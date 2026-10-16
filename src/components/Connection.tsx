import { useState } from 'react';
import { X, Check, ExternalLink, Plug } from 'lucide-react';
import { getConfig,saveConfig,friendlyError } from '../lib/config';
export function Connection({onClose}:{onClose:()=>void}) {
  const config=getConfig();
  const [url,setUrl]=useState(config.url);
  const [key,setKey]=useState(config.key);
  const [error,setError]=useState('');
  return <div className="modal-backdrop" onClick={onClose}><section role="dialog" aria-modal="true" aria-labelledby="connect-title" className="modal" onClick={e=>e.stopPropagation()}><button className="modal-x icon-button" aria-label="Close settings" onClick={onClose}><X/></button><span className="eyebrow"><Plug size={14}/> CONNECTION SETTINGS</span><h2 id="connect-title">Bring your room online.</h2><p>Connect the dedicated Baithak backend. These public connection settings are saved only in this browser.</p><form onSubmit={e=>{e.preventDefault();try{saveConfig(url.trim(),key.trim());location.reload();}catch(err){setError(friendlyError(err));}}}>
    <label>Supabase project URL<input type="url" required value={url} onChange={e=>setUrl(e.target.value)}/></label><label>Publishable key<input required autoComplete="off" placeholder="sb_publishable_…" value={key} onChange={e=>setKey(e.target.value)}/></label>
    <p className="small">Use a publishable key only. Never paste a service role key, database password, or secret key.</p>
    {error && <div className="notice error" role="alert">{error}</div>}
    <button className="button primary full" type="submit"><Check size={17}/> Save connection</button></form>
    <div className="setup-steps"><strong>Project owner setup</strong><ol><li>Run <a href="https://github.com/Prxx09/baithak/blob/main/supabase/setup.sql" target="_blank" rel="noreferrer">supabase/setup.sql <ExternalLink size={11}/></a> in the SQL Editor.</li><li>Enable Anonymous Sign-Ins in Authentication.</li><li>Set the public URL and key in Vercel for all guests to use the same backend.</li></ol></div></section></div>;
}
