-- Run after youtube-sync.sql. Safe to rerun; existing rooms and queues are preserved.
begin;
alter table public.baithak_playback add column if not exists autoplay_enabled boolean not null default true;
alter table public.baithak_playback add column if not exists autoplay_next jsonb;
alter table public.baithak_playback add column if not exists recently_played jsonb not null default '[]';
alter table public.baithak_playback add column if not exists playlist_id text;
alter table public.baithak_playback add column if not exists playlist_page_token text;
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
  if p_action in ('set_autoplay','recommend','set_playlist','playlist_page','next') then
    if v_state.host_id<>v_uid then raise exception 'Only the current host can control playback.'; end if;
    if p_epoch is distinct from v_state.host_epoch then raise exception 'HOST_CHANGED'; end if;
    -- A duplicate end/skip belongs to an old video, even after a revision retry.
    if p_action='next' and p_payload ? 'from_video_epoch' and (p_payload->>'from_video_epoch')::bigint<>v_state.video_epoch then return v_data; end if;
    if p_revision is distinct from v_state.revision then raise exception 'STALE_REVISION'; end if;
  end if;
  if p_action='set_autoplay' then
    update public.baithak_playback set autoplay_enabled=(p_payload->>'enabled')::boolean,revision=revision+1 where room_id=v_room.id;
  elsif p_action='recommend' then
    if (p_payload->>'for_video_epoch')::bigint is distinct from v_state.video_epoch then return v_data; end if;
    if not coalesce((p_payload->>'video_id') ~ '^[A-Za-z0-9_-]{11}$',false) or p_payload->>'video_id'=v_state.video_id then raise exception 'Choose a different valid YouTube video.'; end if;
    update public.baithak_playback set autoplay_next=jsonb_build_object('video_id',p_payload->>'video_id','title',left(coalesce(p_payload->>'title','YouTube video'),180)),revision=revision+1 where room_id=v_room.id;
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
    if p_action='next' and not exists(select 1 from public.baithak_queue where room_id=v_room.id)
      and v_state.autoplay_enabled and v_state.autoplay_next is not null then
      insert into public.baithak_queue(room_id,video_id,title,added_by) values(v_room.id,v_state.autoplay_next->>'video_id',v_state.autoplay_next->>'title',v_uid);
    end if;
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
