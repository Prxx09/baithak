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
