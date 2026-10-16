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
