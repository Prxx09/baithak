import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { newerPlayback,ServerClock,type Playback,type WatchState } from './playback';
export class WatchSession {
  clock=new ServerClock();
  state:WatchState|null=null;
  private channel:RealtimeChannel|null=null;
  private timer:ReturnType<typeof setInterval>|null=null;
  private stopped=false;
  private pending:Promise<unknown>=Promise.resolve();
  constructor(private db:SupabaseClient,private code:string,private roomId:string,private changed:(state:WatchState)=>void,private failed:(message:string)=>void){}
  private accept(next:WatchState){
    if(this.stopped)return;
    if(this.state&&next.playback.revision<this.state.playback.revision)return;
    this.state=next;this.changed(next);
  }
  async read(){
    const sent=Date.now();
    const {data,error}=await this.db.rpc('baithak_watch',{p_code:this.code,p_action:'read'});
    if(error)throw error;
    this.clock.observe(Date.parse(data.server_now),sent,Date.now());this.accept(data as WatchState);
    return data as WatchState;
  }
  async start(){
    // State-row updates are server-authorized events; clients cannot spoof a host broadcast.
    this.channel=this.db.channel(`watch:${this.roomId}`).on('postgres_changes',{event:'UPDATE',schema:'public',table:'baithak_playback',filter:`room_id=eq.${this.roomId}`},event=>{
      const playback=event.new as Playback;
      if(newerPlayback(this.state?.playback||null,playback)){
        this.accept({playback,queue:this.state?.queue||[],server_now:new Date(this.clock.now()).toISOString()});
        void this.read().catch(e=>this.failed(e.message));
      }
    }).subscribe(status=>{if(status==='SUBSCRIBED')void this.read().catch(e=>this.failed(e.message));});
    await this.read();
    this.timer=setInterval(()=>void this.read().catch(e=>this.failed(e.message)),5000);
  }
  action(action:string,payload:Record<string,unknown>={}){
    const request=this.pending.catch(()=>{}).then(async()=>{
      if(this.stopped)throw new Error('The room connection is closed.');
      if(!this.state)await this.read();
      const epoch=this.state!.playback.host_epoch;
      for(let attempt=0;attempt<2;attempt++){
        const sent=Date.now();const state=this.state!.playback;
        const {data,error}=await this.db.rpc('baithak_watch',{p_code:this.code,p_action:action,p_payload:payload,p_revision:state.revision,p_epoch:epoch});
        if(error){
          if(error.message.includes('STALE_REVISION')&&attempt===0){await this.read();if(this.state!.playback.host_epoch!==epoch)throw new Error('The host changed. Follow the new host.');continue;}
          throw error;
        }
        this.clock.observe(Date.parse(data.server_now),sent,Date.now());this.accept(data as WatchState);return data as WatchState;
      }
      throw new Error('Playback changed. Please try again.');
    });
    this.pending=request;return request;
  }
  close(){this.stopped=true;if(this.timer)clearInterval(this.timer);if(this.channel)void this.db.removeChannel(this.channel);}
}
