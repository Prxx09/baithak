import { useEffect, useRef, useState } from 'react';
import { Volume2, VolumeX, Maximize2, Play } from 'lucide-react';
export function StreamVideo({stream,muted=false,className='',controls=false}:{stream:MediaStream|null;muted?:boolean;className?:string;controls?:boolean}) {
  const ref=useRef<HTMLVideoElement>(null);
  const [blocked,setBlocked]=useState(false);
  const [quiet,setQuiet]=useState(muted);
  useEffect(()=>{setQuiet(muted);},[muted]);
  useEffect(()=>{
    const video=ref.current;
    if(!video) return;
    video.srcObject=stream;
    if(stream) void video.play().then(()=>setBlocked(false)).catch(()=>setBlocked(true));
    return ()=>{video.srcObject=null;};
  },[stream]);
  return <div className={`stream-video ${className}`}>
    <video ref={ref} autoPlay playsInline muted={quiet}/>
    {blocked && <button className="enable-play" onClick={()=>{void ref.current?.play().then(()=>setBlocked(false));}}><Play size={20}/> Click to start watching</button>}
    {controls && <div className="video-actions"><button aria-label={quiet?'Unmute stream':'Mute stream'} onClick={()=>setQuiet(!quiet)}>{quiet?<VolumeX size={18}/>:<Volume2 size={18}/>}</button><input aria-label="Stream volume" type="range" min="0" max="1" step="0.05" defaultValue="1" onChange={e=>{if(ref.current) ref.current.volume=Number(e.target.value);}}/><button aria-label="Fullscreen" onClick={()=>void ref.current?.requestFullscreen()}><Maximize2 size={18}/></button></div>}
  </div>;
}
export function RemoteAudio({stream,muted=false,volume=1,sinkId='',onOutputError}:{stream:MediaStream;muted?:boolean;volume?:number;sinkId?:string;onOutputError?:(message:string)=>void}) {
  const ref=useRef<HTMLAudioElement>(null);
  const [blocked,setBlocked]=useState(false);
  useEffect(()=>{if(ref.current)ref.current.volume=Math.max(0,Math.min(1,volume));},[volume]);
  useEffect(()=>{const el=ref.current;if(el&&'setSinkId' in el)void el.setSinkId(sinkId).catch(()=>onOutputError?.('That audio output is unavailable. Choose another output or use your device’s audio controls.'));},[sinkId]);
  useEffect(()=>{const el=ref.current;if(!el)return;el.srcObject=stream;const play=()=>{void el.play().then(()=>setBlocked(false)).catch(()=>setBlocked(true));};if(stream.getAudioTracks().length)play();stream.addEventListener('addtrack',play);return()=>{stream.removeEventListener('addtrack',play);el.pause();el.srcObject=null;};},[stream]);
  return <><audio ref={ref} autoPlay muted={muted} onPlaying={()=>setBlocked(false)}/>{blocked && !muted && <button className="audio-unlock" onClick={()=>void ref.current?.play().then(()=>setBlocked(false)).catch(()=>setBlocked(true))}><Volume2 size={13}/> Enable voice audio</button>}</>;
}
