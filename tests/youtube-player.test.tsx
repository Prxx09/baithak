// @vitest-environment jsdom
import { act,createRef } from 'react';
import { createRoot,type Root } from 'react-dom/client';
import { beforeEach,afterEach,describe,it,expect,vi } from 'vitest';
import { YouTubePlayer,type PlayerHandle } from '../src/components/YouTubePlayer';
import type { Playback } from '../src/lib/playback';
const playback:Playback={room_id:'room',host_id:'host',host_epoch:1,video_epoch:1,revision:1,video_id:'M7lc1UVf-VE',video_title:'Video',playback_state:'playing',position_seconds:60,playback_rate:1,updated_at:new Date().toISOString()};
let root:Root,container:HTMLDivElement,instance:FakePlayer;
class FakePlayer{
  position=0;duration=200;state=-1;speed=1;id='';title='Video';
  events:Record<string,(event:{data:number})=>void>;
  seeks:number[]=[];loads:string[]=[];
  constructor(_element:HTMLElement,options:Record<string,unknown>){instance=this;this.events=options.events as FakePlayer['events'];queueMicrotask(()=>this.events.onReady({data:0}));}
  playVideo(){this.state=1;this.events.onStateChange({data:1});}
  pauseVideo(){this.state=2;this.events.onStateChange({data:2});}
  seekTo(position:number){this.position=position;this.seeks.push(position);}
  loadVideoById(options:{videoId:string;startSeconds:number}){this.id=options.videoId;this.position=options.startSeconds;this.loads.push(this.id);this.playVideo();}
  cueVideoById(options:{videoId:string;startSeconds:number}){this.id=options.videoId;this.position=options.startSeconds;this.state=5;this.loads.push(this.id);}
  getCurrentTime(){return this.position;}getDuration(){return this.duration;}getPlayerState(){return this.state;}getPlaybackRate(){return this.speed;}
  setPlaybackRate(rate:number){this.speed=rate;this.events.onPlaybackRateChange({data:rate});}
  getVideoData(){return {video_id:this.id,title:this.title};}destroy(){}
}
beforeEach(()=>{vi.useFakeTimers();container=document.createElement('div');document.body.appendChild(container);root=createRoot(container);window.YT={Player:FakePlayer} as unknown as typeof window.YT;Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.useRealTimers();});
async function render(isHost:boolean,p:Playback=playback){const ref=createRef<PlayerHandle>();const command=vi.fn();await act(async()=>root.render(<YouTubePlayer ref={ref} playback={p} isHost={isHost} serverNow={()=>Date.parse(p.updated_at)+300} onCommand={command} onProgress={()=>{}} onStatus={()=>{}} onError={()=>{}}/>));return {ref,command};}
describe('YouTube player synchronization adapter',()=>{
  it('restores a late joiner at the latency-compensated timestamp',async()=>{await render(false);expect(instance.position).toBeCloseTo(60.3);expect(instance.id).toBe(playback.video_id);});
  it('never turns guest player events into host commands',async()=>{const {command}=await render(false);await act(async()=>{await vi.advanceTimersByTimeAsync(2500);instance.pauseVideo();instance.setPlaybackRate(1.5);});expect(command).not.toHaveBeenCalled();});
  it('publishes host play/pause through the native controls',async()=>{const {command}=await render(true);await act(async()=>{await vi.advanceTimersByTimeAsync(2500);instance.pauseVideo();});expect(command).toHaveBeenCalledWith('pause',expect.objectContaining({state:'paused'}));});
  it('publishes an exact host skip without a feedback loop',async()=>{const {ref,command}=await render(true);await act(async()=>ref.current!.seek(70));expect(instance.position).toBe(70);expect(command).toHaveBeenCalledTimes(1);expect(command).toHaveBeenCalledWith('seek',expect.objectContaining({position:70}));});
  it('follows a changed video and paused state from the room',async()=>{const {command}=await render(false);const next={...playback,video_id:'aqz-KE-bpKQ',video_epoch:2,revision:2,playback_state:'paused' as const,position_seconds:12};await act(async()=>root.render(<YouTubePlayer playback={next} isHost={false} serverNow={()=>Date.parse(next.updated_at)} onCommand={command} onProgress={()=>{}} onStatus={()=>{}} onError={()=>{}}/>));expect(instance.id).toBe('aqz-KE-bpKQ');expect(instance.position).toBe(12);expect(instance.state).toBe(5);expect(command).not.toHaveBeenCalled();});
  it('reloads the same song when its video epoch changes',async()=>{const {command}=await render(true);const next={...playback,video_epoch:2,revision:2,position_seconds:0};await act(async()=>root.render(<YouTubePlayer playback={next} isHost serverNow={()=>Date.parse(next.updated_at)} onCommand={command} onProgress={()=>{}} onStatus={()=>{}} onError={()=>{}}/>));expect(instance.loads).toHaveLength(2);expect(instance.position).toBe(0);});
});
