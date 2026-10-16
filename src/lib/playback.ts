export interface Playback {
  room_id:string; host_id:string; host_epoch:number; video_epoch:number; revision:number; video_id:string|null;
  video_title:string; playback_state:'playing'|'paused'; position_seconds:number;
  playback_rate:number; updated_at:string;
  autoplay_enabled?:boolean; autoplay_next?:{video_id:string;title:string}|null;
  recently_played?:string[]; playlist_id?:string|null; playlist_page_token?:string|null;
}
export interface QueueItem { id:number; video_id:string; title:string; added_by:string; }
export interface WatchState { playback:Playback; queue:QueueItem[]; server_now:string; }
export interface VideoChoice { id:string; title:string; channel?:string; }
const VIDEO_ID=/^[A-Za-z0-9_-]{11}$/;
export function playlistId(value:string):string|null {
  try{const url=new URL(value.trim());if(!['youtube.com','www.youtube.com','m.youtube.com','music.youtube.com','youtu.be'].includes(url.hostname))return null;const id=url.searchParams.get('list');return id&&/^[A-Za-z0-9_-]{10,120}$/.test(id)?id:null;}catch{return null;}
}
export function videoId(value:string):string|null {
  const text=value.trim(); if(VIDEO_ID.test(text))return text;
  try{
    const url=new URL(text); const host=url.hostname.toLowerCase().replace(/^www\./,'');
    if(!['youtube.com','m.youtube.com','music.youtube.com','youtu.be','youtube-nocookie.com'].includes(host))return null;
    const id=host==='youtu.be'?url.pathname.split('/')[1]:url.searchParams.get('v')||(/^\/(shorts|embed|live)\//.test(url.pathname)?url.pathname.split('/')[2]:'');
    return id&&VIDEO_ID.test(id)?id:null;
  }catch{return null;}
}
export function expectedPosition(p:Playback,serverNow:number,duration=Infinity):number {
  const elapsed=p.playback_state==='playing'?Math.max(0,(serverNow-Date.parse(p.updated_at))/1000)*p.playback_rate:0;
  return Math.min(duration,Math.max(0,p.position_seconds+elapsed));
}
export function newerPlayback(current:Playback|null,next:Playback):boolean {
  return !current || (next.room_id===current.room_id && next.revision>current.revision);
}
export function timeLabel(seconds:number):string {
  const value=Math.max(0,Math.floor(Number.isFinite(seconds)?seconds:0));
  const h=Math.floor(value/3600),m=Math.floor(value%3600/60),s=value%60;
  return h?`${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`:`${m}:${String(s).padStart(2,'0')}`;
}
export class ServerClock {
  private offset=0;private bestRtt=Infinity;private observed=0;
  observe(serverTime:number,sent:number,received:number){
    const rtt=received-sent;
    if(rtt<0||!Number.isFinite(serverTime))return;
    if(rtt<=this.bestRtt||received-this.observed>60_000){this.offset=serverTime-(sent+received)/2;this.bestRtt=rtt;this.observed=received;}
  }
  now(){return Date.now()+this.offset;}
}
