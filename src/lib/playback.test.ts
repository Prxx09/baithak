import { describe,it,expect,vi } from 'vitest';
import { expectedPosition,newerPlayback,ServerClock,timeLabel,videoId,type Playback } from './playback';
const base:Playback={room_id:'r',host_id:'host',host_epoch:1,video_epoch:1,revision:4,video_id:'M7lc1UVf-VE',video_title:'Video',playback_state:'playing',position_seconds:60,playback_rate:1,updated_at:'2026-10-16T10:00:00.000Z'};
describe('YouTube input',()=>{
  it('accepts watch, short, music, shorts, live, and embed URLs',()=>{for(const link of ['https://youtube.com/watch?v=M7lc1UVf-VE&t=20s','https://youtu.be/M7lc1UVf-VE','https://music.youtube.com/watch?v=M7lc1UVf-VE','https://www.youtube.com/shorts/M7lc1UVf-VE','https://youtube.com/live/M7lc1UVf-VE','https://www.youtube-nocookie.com/embed/M7lc1UVf-VE','M7lc1UVf-VE'])expect(videoId(link)).toBe('M7lc1UVf-VE');});
  it('rejects lookalike hosts and malformed video identifiers',()=>{for(const link of ['https://youtube.com.evil.test/watch?v=M7lc1UVf-VE','https://evil.test/M7lc1UVf-VE','https://youtube.com/watch?v=bad','<script>'])expect(videoId(link)).toBeNull();});
});
describe('server-authoritative playback timeline',()=>{
  it('compensates for elapsed delivery time',()=>expect(expectedPosition(base,Date.parse(base.updated_at)+300)).toBeCloseTo(60.3));
  it('honours paused state and playback rate',()=>{expect(expectedPosition({...base,playback_state:'paused'},Date.parse(base.updated_at)+10000)).toBe(60);expect(expectedPosition({...base,playback_rate:2},Date.parse(base.updated_at)+10000)).toBe(80);});
  it('clamps to video duration and ignores negative elapsed time',()=>{expect(expectedPosition(base,Date.parse(base.updated_at)+1000000,90)).toBe(90);expect(expectedPosition(base,Date.parse(base.updated_at)-1000)).toBe(60);});
  it('ignores old revisions, duplicate events, and other rooms',()=>{expect(newerPlayback(base,{...base,revision:3})).toBe(false);expect(newerPlayback(base,{...base})).toBe(false);expect(newerPlayback(base,{...base,revision:5,room_id:'other'})).toBe(false);expect(newerPlayback(base,{...base,revision:5})).toBe(true);});
  it('estimates clock offset from the request midpoint and prefers lower RTT',()=>{const clock=new ServerClock();vi.spyOn(Date,'now').mockReturnValue(1200);clock.observe(5200,1000,1400);expect(clock.now()).toBe(5200);clock.observe(9999,1000,2000);expect(clock.now()).toBe(5200);clock.observe(5300,1200,1300);expect(clock.now()).toBe(5250);vi.restoreAllMocks();});
  it('formats long videos without wrapping hours',()=>{expect(timeLabel(3671)).toBe('1:01:11');expect(timeLabel(9)).toBe('0:09');});
});
