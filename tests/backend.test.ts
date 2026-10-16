import { beforeAll,afterAll,describe,it,expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
const db=new PGlite();
const ids=Array.from({length:8},(_,i)=>`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`);
let code='';let room='';
async function asUser(index:number){await db.exec(`reset role; set "request.jwt.claim.sub" = '${ids[index]}'; set role authenticated;`);}
async function call(action:string,invite=code,name='Guest',title='Test room'){
  const r=await db.query<{snapshot:{room:{id:string;invite_code:string;active_sharer:string|null};members:unknown[]}}>('select public.baithak_command($1,$2,$3,$4) as snapshot',[action,invite,name,title]);
  return r.rows[0].snapshot;
}
beforeAll(async()=>{
  await db.exec(`create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid; $$; grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated; create publication supabase_realtime;`);
  for(const id of ids)await db.query('insert into auth.users values($1)',[id]);
  await db.exec(readFileSync('supabase/schema.sql','utf8'));
},30000);
afterAll(async()=>await db.close());
describe('room authorization and broadcaster ownership',()=>{
  it('creates an authenticated room and admits its owner',async()=>{await asUser(0);const s=await call('create','', 'Owner');code=s.room.invite_code;room=s.room.id;expect(code).toHaveLength(32);expect(s.members).toHaveLength(1);});
  it('does not expose rooms to nonmembers',async()=>{await asUser(1);const r=await db.query('select * from public.baithak_rooms');expect(r.rows).toHaveLength(0);await expect(call('heartbeat')).rejects.toThrow('expired');});
  it('requires the correct invitation and admits a guest',async()=>{await expect(call('join','wrong')).rejects.toThrow('invalid');const s=await call('join');expect(s.members).toHaveLength(2);});
  it('allows one claim and rejects a second broadcaster',async()=>{await asUser(0);expect((await call('claim')).room.active_sharer).toBe(ids[0]);await asUser(1);await expect(call('claim')).rejects.toThrow('already sharing');});
  it('prevents a guest from releasing another person’s slot',async()=>{expect((await call('release')).room.active_sharer).toBe(ids[0]);});
  it('hands the slot over after the broadcaster releases it',async()=>{await asUser(0);await call('release');await asUser(1);expect((await call('claim')).room.active_sharer).toBe(ids[1]);});
  it('rejects spoofed sender identity and outsider messages',async()=>{
    await expect(db.query('insert into public.baithak_chat(room_id,sender_id,body) values($1,$2,$3)',[room,ids[0],'spoof'])).rejects.toThrow('row-level security');
    await asUser(2);await expect(db.query('insert into public.baithak_chat(room_id,sender_id,body) values($1,$2,$3)',[room,ids[2],'outsider'])).rejects.toThrow('row-level security');
  });
  it('routes signaling only to its authenticated recipient',async()=>{
    await asUser(0);await db.query('insert into public.baithak_signals(room_id,sender_id,receiver_id,payload) values($1,$2,$3,$4)',[room,ids[0],ids[1],{hello:true}]);
    expect((await db.query('select * from public.baithak_signals')).rows).toHaveLength(0);
    await asUser(1);expect((await db.query('select * from public.baithak_signals')).rows).toHaveLength(1);
    await asUser(2);expect((await db.query('select * from public.baithak_signals')).rows).toHaveLength(0);
  });
  it('enforces the six-person admission cap',async()=>{for(let i=2;i<6;i++){await asUser(i);await call('join');}await asUser(6);await expect(call('join')).rejects.toThrow('full');});
  it('reclaims an expired broadcast lease',async()=>{
    await db.exec('reset role');await db.query("update public.baithak_rooms set lease_until=now()-interval '1 second' where id=$1",[room]);await asUser(0);expect((await call('claim')).room.active_sharer).toBe(ids[0]);
  });
  it('only lets the creator end a room',async()=>{await asUser(1);await expect(call('end')).rejects.toThrow('Only the room creator');await asUser(0);await call('end');await asUser(1);await expect(call('heartbeat')).rejects.toThrow('ended');});
  it('creates a fixed four-hour deadline and rejects joins, heartbeats, chat, and voice after expiry',async()=>{
    await asUser(0);const s=await call('create','');room=s.room.id;code=s.room.invite_code;
    const before=await db.query<{hours:number}>("select extract(epoch from(expires_at-created_at))/3600 as hours from public.baithak_rooms where id=$1",[room]);
    expect(Number(before.rows[0].hours)).toBe(4);
    await asUser(1);await call('join');
    await db.exec('reset role');await db.query("update public.baithak_rooms set expires_at=now()-interval '1 second' where id=$1",[room]);await asUser(1);
    await expect(call('join')).rejects.toThrow('ended');await expect(call('heartbeat')).rejects.toThrow('ended');
    await expect(db.query('insert into public.baithak_chat(room_id,sender_id,body) values($1,$2,$3)',[room,ids[1],'expired'])).rejects.toThrow('row-level security');
    await expect(db.query('insert into public.baithak_signals(room_id,sender_id,receiver_id,payload) values($1,$2,$3,$4)',[room,ids[1],ids[0],{scope:'voice',hello:true}])).rejects.toThrow('row-level security');
    expect((await db.query('select * from public.baithak_rooms')).rows).toHaveLength(0);
  });
});
