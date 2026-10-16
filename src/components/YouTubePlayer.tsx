import { forwardRef,useEffect,useImperativeHandle,useRef,useState } from 'react';
import { LoaderCircle,MonitorPlay } from 'lucide-react';
import { expectedPosition,type Playback } from '../lib/playback';
export interface PlayerSample { position:number; rate:number; state:'playing'|'paused'; sampled_at_ms:number; title?:string; }
export interface PlayerHandle { play():void;pause():void;seek(position:number):void;rate(rate:number):void;resync():void;start():void;sample():PlayerSample; }
interface YTPlayer {
  playVideo():void;pauseVideo():void;seekTo(seconds:number,allowSeekAhead:boolean):void;
  cueVideoById(options:{videoId:string;startSeconds:number}):void;
  loadVideoById(options:{videoId:string;startSeconds:number}):void;
  getCurrentTime():number;getDuration():number;getPlayerState():number;getPlaybackRate():number;
  setPlaybackRate(rate:number):void;getVideoData():{video_id:string;title:string};destroy():void;
}
interface YouTubeAPI { Player:new (element:HTMLElement,options:Record<string,unknown>)=>YTPlayer; }
declare global {interface Window {YT?:YouTubeAPI;onYouTubeIframeAPIReady?:()=>void;}}
let apiPromise:Promise<YouTubeAPI>|null=null;
function loadAPI():Promise<YouTubeAPI>{
  if(window.YT?.Player)return Promise.resolve(window.YT);
  if(apiPromise)return apiPromise;
  apiPromise=new Promise((resolve,reject)=>{
    const previous=window.onYouTubeIframeAPIReady;
    const timeout=setTimeout(()=>{document.getElementById('youtube-iframe-api')?.remove();apiPromise=null;reject(new Error('YouTube did not load. Check your connection and reload the player.'));},20000);
    window.onYouTubeIframeAPIReady=()=>{previous?.();clearTimeout(timeout);if(window.YT)resolve(window.YT);};
    if(!document.getElementById('youtube-iframe-api')){const script=document.createElement('script');script.id='youtube-iframe-api';script.src='https://www.youtube.com/iframe_api';script.onerror=()=>{clearTimeout(timeout);apiPromise=null;script.remove();reject(new Error('YouTube could not be reached.'));};document.head.appendChild(script);}
  });return apiPromise;
}
interface Props {
  playback:Playback|null;isHost:boolean;serverNow:()=>number;
  hasQueuedNext?:boolean;
  onCommand:(action:string,payload:Record<string,unknown>)=>void;
  onProgress:(position:number,duration:number)=>void;
  onStatus:(status:string)=>void;onError:(message:string)=>void;onUnavailable?:(videoId:string)=>void;
}
export const YouTubePlayer=forwardRef<PlayerHandle,Props>(function YouTubePlayer(props,ref){
  const mount=useRef<HTMLDivElement>(null),player=useRef<YTPlayer|null>(null);
  const latest=useRef(props);latest.current=props;
  const loadedEpoch=useRef(-1);
  const loaded=useRef(''),suppressed=useRef(0),ended=useRef('');
  const ready=useRef(false),previous=useRef({position:0,wall:0,state:-1});
  const lastTick=useRef(0);
  const [loading,setLoading]=useState(false);
  function sample():PlayerSample{if(!ready.current){const p=latest.current.playback;return {position:p?expectedPosition(p,latest.current.serverNow()):0,rate:p?.playback_rate||1,state:p?.playback_state||'paused',sampled_at_ms:latest.current.serverNow()};}return {position:player.current?.getCurrentTime()||0,rate:player.current?.getPlaybackRate()||1,state:latest.current.playback?.playback_state||'paused',sampled_at_ms:latest.current.serverNow(),title:player.current?.getVideoData()?.title||undefined};}
  function emit(action:string,extra:Record<string,unknown>={}){latest.current.onCommand(action,{...sample(),...extra});}
  function apply(force=false){
    const p=latest.current.playback,yt=player.current;if(!ready.current||!yt||!p?.video_id)return;
    const target=expectedPosition(p,latest.current.serverNow(),yt.getDuration()||Infinity);
    if(loaded.current!==p.video_id||loadedEpoch.current!==p.video_epoch){
      loaded.current=p.video_id;loadedEpoch.current=p.video_epoch;ended.current='';suppressed.current=performance.now()+1800;
      const config={videoId:p.video_id,startSeconds:target};
      if(p.playback_state==='playing')yt.loadVideoById(config);else yt.cueVideoById(config);
      return;
    }
    if(latest.current.isHost&&!force)return;
    const playing=yt.getPlayerState()===1;
    const drifting=Math.abs(yt.getCurrentTime()-target)>1.2;
    // Buffering guests are corrected when playback resumes, rather than seek-looped.
    if(yt.getPlayerState()===3&&!force)return;
    if(force||drifting||playing!==(p.playback_state==='playing')||yt.getPlaybackRate()!==p.playback_rate){
      suppressed.current=performance.now()+1200;
      if(force||drifting)yt.seekTo(target,true);
      if(yt.getPlaybackRate()!==p.playback_rate)yt.setPlaybackRate(p.playback_rate);
      if(p.playback_state==='playing')yt.playVideo();else yt.pauseVideo();
    }
  }
  useImperativeHandle(ref,()=>({
    play(){if(!ready.current)return;suppressed.current=performance.now()+1200;player.current!.playVideo();emit('play',{state:'playing'});},
    pause(){if(!ready.current)return;suppressed.current=performance.now()+1200;player.current!.pauseVideo();emit('pause',{state:'paused'});},
    seek(position){if(!ready.current)return;suppressed.current=performance.now()+1200;player.current!.seekTo(position,true);emit('seek',{position});},
    rate(rate){if(!ready.current)return;suppressed.current=performance.now()+1200;player.current!.setPlaybackRate(rate);emit('rate',{rate});},
    resync(){apply(true);},
    start(){if(!ready.current)return;apply(true);if(latest.current.playback?.playback_state==='playing')player.current!.playVideo();},sample
  }));
  useEffect(()=>{
    if(!props.playback?.video_id)return;
    let disposed=false;setLoading(true);latest.current.onStatus('Loading player');
    const element=document.createElement('div');mount.current?.appendChild(element);
    void loadAPI().then(api=>{
      if(disposed)return;
      player.current=new api.Player(element,{width:'100%',height:'100%',playerVars:{autoplay:1,playsinline:1,controls:1,origin:location.origin,rel:1},events:{
        onReady:()=>{if(disposed)return;ready.current=true;setLoading(false);latest.current.onStatus('Ready');apply(true);},
        onStateChange:(event:{data:number})=>{
          if(disposed)return;
          const yt=player.current,p=latest.current.playback;
          latest.current.onStatus(event.data===3?'Buffering':event.data===1?'Playing':event.data===2?'Paused':'Ready');
          if(!yt||!p||yt.getVideoData()?.video_id!==p.video_id)return;
          if(event.data===1&&yt.getPlaybackRate()!==p.playback_rate){suppressed.current=performance.now()+1200;yt.setPlaybackRate(p.playback_rate);}
          if(event.data===0&&latest.current.isHost&&ended.current!==p.video_id){
            ended.current=p.video_id;
            if(latest.current.hasQueuedNext)emit('next',{from_video_epoch:p.video_epoch});
            else latest.current.onStatus('Choose a YouTube suggestion');
            return;
          }
          if(!latest.current.isHost){if(event.data===1&&performance.now()>suppressed.current)apply();return;}
          if(performance.now()<suppressed.current)return;
          if(event.data===1||event.data===2)emit(event.data===1?'play':'pause',{state:event.data===1?'playing':'paused'});
        },
        onPlaybackRateChange:(event:{data:number})=>{if(latest.current.isHost&&performance.now()>suppressed.current)emit('rate',{rate:event.data});},
        onAutoplayBlocked:()=>latest.current.onStatus('Click Start watching'),
        onError:(event:{data:number})=>{latest.current.onError([101,150].includes(event.data)?'This video does not allow embedded playback.':event.data===100?'This video is unavailable or private.':`YouTube could not play this video (${event.data}). Try another video or reload the player.`);if([100,101,150].includes(event.data)&&latest.current.playback?.video_id)latest.current.onUnavailable?.(latest.current.playback.video_id);}
      }});
    }).catch(error=>{if(!disposed){setLoading(false);latest.current.onError(error.message);}});
    const interval=setInterval(()=>{
      const yt=player.current,p=latest.current.playback;if(!ready.current||!yt||!p?.video_id)return;
      const position=yt.getCurrentTime(),duration=yt.getDuration(),state=yt.getPlayerState(),wall=performance.now();
      latest.current.onProgress(position,duration);
      const actual=yt.getVideoData();
      if(latest.current.isHost&&actual?.video_id&&actual.video_id!==p.video_id&&wall>suppressed.current&&(state===1||state===2)){
        emit('load',{video_id:actual.video_id,title:actual.title});suppressed.current=wall+1800;
      }else if(latest.current.isHost&&actual?.video_id===p.video_id&&wall>suppressed.current){
        const prev=previous.current;
        const expected=prev.position+(prev.state===1?(wall-prev.wall)/1000*yt.getPlaybackRate():0);
        if(prev.wall&&(state===1||state===2)&&(prev.state===1||prev.state===2)&&Math.abs(position-expected)>1.2){emit('seek',{position});suppressed.current=wall+700;}
        else if(wall-lastTick.current>5000&&(state===1||state===2)){lastTick.current=wall;emit('tick',{state:state===1?'playing':'paused'});}
      }else if(!latest.current.isHost&&wall>suppressed.current&&wall-lastTick.current>3000){lastTick.current=wall;apply();}
      previous.current={position,wall,state};
    },250);
    return ()=>{disposed=true;clearInterval(interval);ready.current=false;player.current?.destroy();player.current=null;loaded.current='';loadedEpoch.current=-1;element.remove();};
  },[!!props.playback?.video_id]);
  useEffect(()=>{apply();},[props.playback?.revision]);
  useEffect(()=>{if(ready.current)apply(true);},[props.playback?.host_epoch]);
  return <div className="yt-player-shell"><div ref={mount} className="yt-player-mount"/>{!props.playback?.video_id?<div className="yt-empty"><span className="yt-empty-icon"><MonitorPlay size={49} strokeWidth={1.2}/></span><span className="eyebrow">YOUR PEOPLE. SAME PLAYLIST.</span><h2>What’s the first song?</h2><p>Paste a YouTube link or pick a video.<br/>The host presses play. Everyone follows.</p></div>:null}{loading?<div className="yt-loading"><LoaderCircle className="spin" size={22}/> Connecting to YouTube…</div>:null}</div>;
});
