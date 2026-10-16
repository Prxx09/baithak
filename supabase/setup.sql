-- Fresh Baithak installation: rooms, YouTube synchronization, and YouTube-native suggestions.
-- Existing watch-room installations: run only autoplay.sql.

-- Baithak: run once in the dedicated project's Supabase SQL Editor.
-- No secret keys, public room enumeration, or direct room writes.
begin;
create schema if not exists baithak_private;
revoke all on schema baithak_private from public;
grant usage on schema baithak_private to authenticated;

create table public.baithak_rooms (
  id uuid primary key default gen_random_uuid(),
  invite_code text unique not null default replace(gen_random_uuid()::text, '-', ''),
  title text not null check (char_length(title) between 1 and 80),
  owner_id uuid not null references auth.users(id) on delete cascade,
  active_sharer uuid references auth.users(id) on delete set null,
  lease_until timestamptz,
  closed boolean not null default false,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '4 hours'
);
create table public.baithak_members (
  room_id uuid not null references public.baithak_rooms on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 32),
  requested boolean not null default false,
  last_seen timestamptz not null default now(),
  primary key (room_id, user_id)
);
create table public.baithak_signals (
  id bigint generated always as identity primary key,
  room_id uuid not null references public.baithak_rooms on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  receiver_id uuid not null references auth.users(id) on delete cascade,
  payload jsonb not null check (octet_length(payload::text) < 65536),
  created_at timestamptz not null default now()
);
create table public.baithak_chat (
  id bigint generated always as identity primary key,
  room_id uuid not null references public.baithak_rooms on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index baithak_members_user_idx on public.baithak_members(user_id);
create index baithak_rooms_owner_idx on public.baithak_rooms(owner_id);
create index baithak_rooms_sharer_idx on public.baithak_rooms(active_sharer);
create index baithak_signals_inbox_idx on public.baithak_signals(room_id,receiver_id,created_at);
create index baithak_signals_sender_idx on public.baithak_signals(sender_id);
create index baithak_signals_receiver_idx on public.baithak_signals(receiver_id);
create index baithak_chat_room_idx on public.baithak_chat(room_id,created_at);
create index baithak_chat_sender_idx on public.baithak_chat(sender_id);

alter table public.baithak_rooms enable row level security;
alter table public.baithak_members enable row level security;
alter table public.baithak_signals enable row level security;
alter table public.baithak_chat enable row level security;

-- Definer helper is deliberately private; it breaks the membership-policy recursion.
create function baithak_private.is_member(p_room uuid, p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.baithak_members m join public.baithak_rooms r on r.id=m.room_id
    where m.room_id=p_room and m.user_id=p_user and m.last_seen > now()-interval '75 seconds'
    and not r.closed and r.expires_at > now()
  );
$$;
revoke all on function baithak_private.is_member(uuid,uuid) from public,anon;
grant execute on function baithak_private.is_member(uuid,uuid) to authenticated;

create policy baithak_rooms_read on public.baithak_rooms for select to authenticated
using (baithak_private.is_member(id));
create policy baithak_members_read on public.baithak_members for select to authenticated
using (baithak_private.is_member(room_id));
create policy baithak_signals_read on public.baithak_signals for select to authenticated
using (receiver_id=(select auth.uid()) and baithak_private.is_member(room_id));
create policy baithak_signals_send on public.baithak_signals for insert to authenticated
with check (sender_id=(select auth.uid()) and sender_id<>receiver_id
  and baithak_private.is_member(room_id) and baithak_private.is_member(room_id,receiver_id));
create policy baithak_chat_read on public.baithak_chat for select to authenticated
using (baithak_private.is_member(room_id));
create policy baithak_chat_send on public.baithak_chat for insert to authenticated
with check (sender_id=(select auth.uid()) and baithak_private.is_member(room_id));

revoke all on public.baithak_rooms,public.baithak_members,public.baithak_signals,public.baithak_chat from anon,authenticated;
grant select on public.baithak_rooms,public.baithak_members to authenticated;
grant select,insert on public.baithak_signals,public.baithak_chat to authenticated;
grant usage,select on sequence public.baithak_signals_id_seq,public.baithak_chat_id_seq to authenticated;

-- The only privileged room mutations. A row lock serializes admission and share claims.
create function baithak_private.command(p_action text,p_code text,p_name text,p_title text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_room public.baithak_rooms;
begin
  if v_uid is null then raise exception 'Sign in as a guest first.'; end if;
  if p_action='create' then
    if length(trim(p_name)) not between 1 and 32 then raise exception 'Enter a name of 1–32 characters.'; end if;
    if length(trim(p_title)) not between 1 and 80 then raise exception 'Enter a room name of 1–80 characters.'; end if;
    perform pg_advisory_xact_lock(hashtextextended(v_uid::text,0));
    if (select count(*) from public.baithak_rooms where owner_id=v_uid and not closed and expires_at>now()) >= 3
      then raise exception 'You already have three open rooms. End one before creating another.'; end if;
    insert into public.baithak_rooms(title,owner_id) values(trim(p_title),v_uid) returning * into v_room;
    insert into public.baithak_members(room_id,user_id,display_name) values(v_room.id,v_uid,trim(p_name));
  else
    select * into v_room from public.baithak_rooms where invite_code=p_code for update;
    if not found or v_room.closed or v_room.expires_at<=now() then raise exception 'This room has ended or the invitation is invalid.'; end if;
    if p_action='join' then
      if length(trim(p_name)) not between 1 and 32 then raise exception 'Enter a name of 1–32 characters.'; end if;
      delete from public.baithak_members where room_id=v_room.id and last_seen<now()-interval '75 seconds';
      if not exists(select 1 from public.baithak_members where room_id=v_room.id and user_id=v_uid)
        and (select count(*) from public.baithak_members where room_id=v_room.id)>=6
        then raise exception 'This room is full (six people).'; end if;
      insert into public.baithak_members(room_id,user_id,display_name) values(v_room.id,v_uid,trim(p_name))
        on conflict(room_id,user_id) do update set last_seen=now(),display_name=excluded.display_name;
    else
      if not exists(select 1 from public.baithak_members where room_id=v_room.id and user_id=v_uid and last_seen>now()-interval '75 seconds')
        then raise exception 'Your room session expired. Rejoin using the invitation link.'; end if;
      if p_action='heartbeat' then
        update public.baithak_members set last_seen=now() where room_id=v_room.id and user_id=v_uid;
        if v_room.active_sharer=v_uid then
          update public.baithak_rooms set lease_until=now()+interval '45 seconds' where id=v_room.id;
        end if;
        delete from public.baithak_signals where room_id=v_room.id and created_at<now()-interval '90 seconds';
      elsif p_action='claim' then
        if v_room.active_sharer is not null and v_room.active_sharer<>v_uid and v_room.lease_until>now()
          then raise exception 'Someone is already sharing. Ask for a turn.'; end if;
        update public.baithak_rooms set active_sharer=v_uid,lease_until=now()+interval '45 seconds' where id=v_room.id;
        update public.baithak_members set requested=false where room_id=v_room.id and user_id=v_uid;
      elsif p_action='release' then
        update public.baithak_rooms set active_sharer=null,lease_until=null where id=v_room.id and active_sharer=v_uid;
      elsif p_action='request' then
        update public.baithak_members set requested=true where room_id=v_room.id and user_id=v_uid;
      elsif p_action='leave' then
        update public.baithak_rooms set active_sharer=null,lease_until=null where id=v_room.id and active_sharer=v_uid;
        delete from public.baithak_members where room_id=v_room.id and user_id=v_uid;
        return jsonb_build_object('left',true);
      elsif p_action='end' then
        if v_room.owner_id<>v_uid then raise exception 'Only the room creator can end the room.'; end if;
        update public.baithak_rooms set closed=true,active_sharer=null,lease_until=null where id=v_room.id;
        return jsonb_build_object('ended',true);
      else raise exception 'Unknown room action.';
      end if;
    end if;
    update public.baithak_rooms set active_sharer=null,lease_until=null
      where id=v_room.id and active_sharer is not null and (lease_until<now() or not exists(
        select 1 from public.baithak_members where room_id=v_room.id and user_id=active_sharer and last_seen>now()-interval '75 seconds'));
  end if;
  select * into v_room from public.baithak_rooms where id=v_room.id;
  return jsonb_build_object('room',to_jsonb(v_room),
    'members',coalesce((select jsonb_agg(to_jsonb(m) order by m.user_id) from public.baithak_members m where m.room_id=v_room.id and m.last_seen>now()-interval '75 seconds'),'[]'::jsonb),
    'messages',coalesce((select jsonb_agg(to_jsonb(c) order by c.id) from (select id,sender_id,body,created_at from public.baithak_chat where room_id=v_room.id order by id desc limit 100)c),'[]'::jsonb));
end;
$$;
revoke all on function baithak_private.command(text,text,text,text) from public,anon;
grant execute on function baithak_private.command(text,text,text,text) to authenticated;
create function public.baithak_command(p_action text,p_code text default '',p_name text default '',p_title text default '')
returns jsonb language sql security invoker set search_path = '' as $$
  select baithak_private.command(p_action,p_code,p_name,p_title);
$$;
revoke all on function public.baithak_command(text,text,text,text) from public,anon;
grant execute on function public.baithak_command(text,text,text,text) to authenticated;

alter publication supabase_realtime add table public.baithak_signals,public.baithak_chat;
commit;

-- Enable Anonymous Sign-Ins under Authentication → Sign In / Providers.
-- Keep baithak_private out of the Data API exposed schemas.

-- Upgrade existing Baithak installations. Run once after schema.sql.
begin;
create table public.baithak_playback (
  room_id uuid primary key references public.baithak_rooms on delete cascade,
  host_id uuid not null references auth.users(id) on delete cascade,
  host_epoch bigint not null default 1,
  video_epoch bigint not null default 0,
  revision bigint not null default 0,
  video_id text check (video_id ~ '^[A-Za-z0-9_-]{11}$'),
  video_title text not null default '',
  playback_state text not null default 'paused' check (playback_state in ('playing','paused')),
  position_seconds double precision not null default 0 check (position_seconds>=0 and position_seconds<=604800),
  playback_rate double precision not null default 1 check (playback_rate in (0.25,0.5,0.75,1,1.25,1.5,1.75,2)),
  updated_at timestamptz not null default clock_timestamp()
);
create table public.baithak_queue (
  id bigint generated always as identity primary key,
  room_id uuid not null references public.baithak_rooms on delete cascade,
  video_id text not null check (video_id ~ '^[A-Za-z0-9_-]{11}$'),
  title text not null check (length(title) between 1 and 180),
  added_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default clock_timestamp()
);
create index baithak_queue_room_idx on public.baithak_queue(room_id,id);
create index baithak_queue_added_by_idx on public.baithak_queue(added_by);
create index baithak_playback_host_idx on public.baithak_playback(host_id);
alter table public.baithak_playback enable row level security;
alter table public.baithak_queue enable row level security;
revoke all on public.baithak_playback,public.baithak_queue from anon,authenticated;
grant select on public.baithak_playback,public.baithak_queue to authenticated;
create policy baithak_playback_read on public.baithak_playback for select to authenticated using (baithak_private.is_member(room_id));
create policy baithak_queue_read on public.baithak_queue for select to authenticated using (baithak_private.is_member(room_id));

create function baithak_private.watch(p_code text,p_action text,p_payload jsonb,p_revision bigint,p_epoch bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid(); v_room public.baithak_rooms; v_state public.baithak_playback;
  v_next public.baithak_queue; v_host uuid; v_now timestamptz := clock_timestamp();
  v_position double precision; v_rate double precision; v_status text; v_delay double precision := 0;
begin
  if v_uid is null then raise exception 'Guest session required.'; end if;
  select * into v_room from public.baithak_rooms where invite_code=p_code for update;
  v_now:=clock_timestamp();
  if not found or v_room.closed or v_room.expires_at<=v_now then raise exception 'This room has ended.'; end if;
  if not baithak_private.is_member(v_room.id) then raise exception 'Your room session expired. Rejoin using the invitation link.'; end if;
  select m.user_id into v_host from public.baithak_members m where m.room_id=v_room.id and m.last_seen>v_now-interval '75 seconds'
    order by (m.user_id=v_room.owner_id) desc,m.last_seen desc,m.user_id limit 1;
  insert into public.baithak_playback(room_id,host_id) values(v_room.id,v_host) on conflict(room_id) do nothing;
  select * into v_state from public.baithak_playback where room_id=v_room.id for update;
  if not baithak_private.is_member(v_room.id,v_state.host_id) then
    update public.baithak_playback set host_id=v_host,host_epoch=host_epoch+1,revision=revision+1 where room_id=v_room.id returning * into v_state;
  end if;
  if p_action='read' then null;
  elsif p_action='enqueue' then
    if (select count(*) from public.baithak_queue where room_id=v_room.id)>=30 then raise exception 'The queue is full (30 videos).'; end if;
    insert into public.baithak_queue(room_id,video_id,title,added_by) values(v_room.id,p_payload->>'video_id',left(coalesce(nullif(trim(p_payload->>'title'),''),'YouTube video'),180),v_uid);
    update public.baithak_playback set revision=revision+1 where room_id=v_room.id returning * into v_state;
  elsif p_action='request_host' then
    update public.baithak_members set requested=true where room_id=v_room.id and user_id=v_uid;
  elsif p_action='remove' then
    delete from public.baithak_queue where room_id=v_room.id and id=(p_payload->>'id')::bigint and (added_by=v_uid or v_state.host_id=v_uid);
    if not found then raise exception 'Only the host or the person who added this video can remove it.'; end if;
    update public.baithak_playback set revision=revision+1 where room_id=v_room.id returning * into v_state;
  else
    if v_state.host_id<>v_uid then raise exception 'Only the current host can control playback.'; end if;
    if p_epoch is distinct from v_state.host_epoch then raise exception 'HOST_CHANGED'; end if;
    if p_revision is distinct from v_state.revision then raise exception 'STALE_REVISION'; end if;
    if p_action='transfer' then
      if not baithak_private.is_member(v_room.id,(p_payload->>'host_id')::uuid) then raise exception 'Choose someone who is still in the room.'; end if;
      update public.baithak_playback set host_id=(p_payload->>'host_id')::uuid,host_epoch=host_epoch+1,revision=revision+1 where room_id=v_room.id returning * into v_state;
      update public.baithak_members set requested=false where room_id=v_room.id;
    elsif p_action in ('load','play','pause','seek','rate','tick','next','play_item') then
      v_position := coalesce((p_payload->>'position')::double precision,v_state.position_seconds);
      v_rate := coalesce((p_payload->>'rate')::double precision,v_state.playback_rate);
      v_status := coalesce(p_payload->>'state',v_state.playback_state);
      if p_action='play' then v_status:='playing'; end if;
      if p_action='pause' then v_status:='paused'; end if;
      if p_action='load' then
        v_position:=0; v_status:='playing';
        update public.baithak_playback set video_epoch=video_epoch+1,video_id=p_payload->>'video_id',video_title=left(coalesce(p_payload->>'title','YouTube video'),180) where room_id=v_room.id;
      elsif p_action in ('next','play_item') then
        if p_action='play_item' then
          select * into v_next from public.baithak_queue where room_id=v_room.id and id=(p_payload->>'id')::bigint;
          if not found then raise exception 'This video is no longer in the queue.'; end if;
        else
          select * into v_next from public.baithak_queue where room_id=v_room.id order by id limit 1;
        end if;
        if not found then
          v_status:='paused';
        else
          update public.baithak_playback set video_epoch=video_epoch+1,video_id=v_next.video_id,video_title=v_next.title where room_id=v_room.id;
          delete from public.baithak_queue where id=v_next.id;
          v_position:=0;v_status:='playing';
        end if;
      end if;
      if v_status='playing' and p_payload ? 'sampled_at_ms' and p_action not in ('load','next','play_item') then
        v_delay:=greatest(0,least(3,extract(epoch from v_now)-((p_payload->>'sampled_at_ms')::double precision/1000)));
      end if;
      update public.baithak_playback set position_seconds=greatest(0,least(604800,v_position+v_delay*v_rate)),playback_state=v_status,
        playback_rate=v_rate,updated_at=v_now,video_title=case when p_action in ('load','next','play_item') then video_title else coalesce(nullif(left(p_payload->>'title',180),''),video_title) end,revision=revision+1 where room_id=v_room.id returning * into v_state;
    else raise exception 'Unknown playback action.';
    end if;
  end if;
  return jsonb_build_object('playback',to_jsonb(v_state),'queue',coalesce((select jsonb_agg(to_jsonb(q) order by q.id) from public.baithak_queue q where q.room_id=v_room.id),'[]'::jsonb),'server_now',clock_timestamp());
end;
$$;
revoke all on function baithak_private.watch(text,text,jsonb,bigint,bigint) from public,anon;
grant execute on function baithak_private.watch(text,text,jsonb,bigint,bigint) to authenticated;
create function public.baithak_watch(p_code text,p_action text default 'read',p_payload jsonb default '{}',p_revision bigint default null,p_epoch bigint default null)
returns jsonb language sql security invoker set search_path = '' as $$
 select baithak_private.watch(p_code,p_action,p_payload,p_revision,p_epoch);
$$;
revoke all on function public.baithak_watch(text,text,jsonb,bigint,bigint) from public,anon;
grant execute on function public.baithak_watch(text,text,jsonb,bigint,bigint) to authenticated;
alter publication supabase_realtime add table public.baithak_playback;
commit;

-- Run after youtube-sync.sql. Safe to rerun; existing rooms and queues are preserved.
begin;
alter table public.baithak_playback add column if not exists autoplay_enabled boolean not null default true;
alter table public.baithak_playback add column if not exists autoplay_next jsonb;
alter table public.baithak_playback add column if not exists recently_played jsonb not null default '[]';
alter table public.baithak_playback add column if not exists playlist_id text;
alter table public.baithak_playback add column if not exists playlist_page_token text;
-- App-generated recommendations are retired. YouTube renders suggestions in the host player.
update public.baithak_playback set autoplay_next=null;
do $$ begin
  if to_regprocedure('baithak_private.watch_core(text,text,jsonb,bigint,bigint)') is null then
    alter function baithak_private.watch(text,text,jsonb,bigint,bigint) rename to watch_core;
  end if;
end $$;
-- The core is callable only through this wrapper, preventing direct host writes from bypassing history updates.
revoke all on function baithak_private.watch_core(text,text,jsonb,bigint,bigint) from public,anon,authenticated;

create or replace function baithak_private.watch(p_code text,p_action text,p_payload jsonb,p_revision bigint,p_epoch bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_uid uuid:=auth.uid();v_room public.baithak_rooms;v_state public.baithak_playback;
  v_before public.baithak_playback;v_data jsonb;v_item jsonb;v_count integer;
begin
  if v_uid is null then raise exception 'Guest session required.'; end if;
  select * into v_room from public.baithak_rooms where invite_code=p_code for update;
  if not found or not baithak_private.is_member(v_room.id) then raise exception 'Your room session expired. Rejoin using the invitation link.'; end if;
  v_data:=baithak_private.watch_core(p_code,'read','{}',null,null);
  select * into v_state from public.baithak_playback where room_id=v_room.id;
  v_before:=v_state;
  if p_action in ('set_autoplay','set_playlist','playlist_page','next') then
    if v_state.host_id<>v_uid then raise exception 'Only the current host can control playback.'; end if;
    if p_epoch is distinct from v_state.host_epoch then raise exception 'HOST_CHANGED'; end if;
    -- A duplicate end/skip belongs to an old video, even after a revision retry.
    if p_action='next' and p_payload ? 'from_video_epoch' and (p_payload->>'from_video_epoch')::bigint<>v_state.video_epoch then return v_data; end if;
    if p_revision is distinct from v_state.revision then raise exception 'STALE_REVISION'; end if;
  end if;
  if p_action='set_autoplay' then
    update public.baithak_playback set autoplay_enabled=(p_payload->>'enabled')::boolean,revision=revision+1 where room_id=v_room.id;
  elsif p_action='set_playlist' then
    if not coalesce((p_payload->>'playlist_id') ~ '^[A-Za-z0-9_-]{10,120}$',false) then raise exception 'Enter a valid YouTube playlist link.'; end if;
    update public.baithak_playback set playlist_id=p_payload->>'playlist_id',playlist_page_token='',autoplay_next=null,revision=revision+1 where room_id=v_room.id;
  elsif p_action='playlist_page' then
    if p_payload->>'playlist_id' is distinct from v_state.playlist_id or p_payload->>'expected_token' is distinct from v_state.playlist_page_token then return v_data; end if;
    if jsonb_typeof(p_payload->'items')<>'array' or jsonb_array_length(p_payload->'items')>20 then raise exception 'A playlist page may contain at most 20 videos.'; end if;
    select count(*) into v_count from public.baithak_queue where room_id=v_room.id;
    if v_count+jsonb_array_length(p_payload->'items')>30 then raise exception 'The queue is full (30 videos).'; end if;
    for v_item in select value from jsonb_array_elements(p_payload->'items') loop
      insert into public.baithak_queue(room_id,video_id,title,added_by) values(v_room.id,v_item->>'id',left(coalesce(v_item->>'title','YouTube video'),180),v_uid);
    end loop;
    update public.baithak_playback set playlist_page_token=nullif(p_payload->>'next_token',''),revision=revision+1 where room_id=v_room.id;
  else
    v_data:=baithak_private.watch_core(p_code,p_action,p_payload,p_revision,p_epoch);
    select * into v_state from public.baithak_playback where room_id=v_room.id;
    if v_state.video_epoch<>v_before.video_epoch then
      update public.baithak_playback set autoplay_next=null,
        recently_played=(select coalesce(jsonb_agg(value order by ord),'[]') from jsonb_array_elements(
          recently_played || case when v_before.video_id is null then '[]'::jsonb else jsonb_build_array(v_before.video_id) end
        ) with ordinality as t(value,ord) where ord>greatest(0,jsonb_array_length(recently_played)+case when v_before.video_id is null then 0 else 1 end-100)),
        revision=revision+1 where room_id=v_room.id;
    end if;
  end if;
  return baithak_private.watch_core(p_code,'read','{}',null,null);
end;
$$;
revoke all on function baithak_private.watch(text,text,jsonb,bigint,bigint) from public,anon;
grant execute on function baithak_private.watch(text,text,jsonb,bigint,bigint) to authenticated;
create or replace function public.baithak_watch(p_code text,p_action text default 'read',p_payload jsonb default '{}',p_revision bigint default null,p_epoch bigint default null)
returns jsonb language sql security invoker set search_path='' as $$
 select baithak_private.watch(p_code,p_action,p_payload,p_revision,p_epoch);
$$;
revoke all on function public.baithak_watch(text,text,jsonb,bigint,bigint) from public,anon;
grant execute on function public.baithak_watch(text,text,jsonb,bigint,bigint) to authenticated;
commit;
