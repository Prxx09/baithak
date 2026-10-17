import { useEffect, useRef, useState } from 'react';
import { backend } from '../lib/backend';
import { REACTIONS, RoomActivity, type ActivityRow } from '../lib/room-activity';
import type { ChatMessage, Member } from '../lib/types';
import { LoaderCircle, Send } from 'lucide-react';

export function useRoomSocial(room: string, user: string, members: Member[], demo: boolean, enabled: boolean, now: () => number) {
  const [typing, setTyping] = useState<Record<string, number>>({});
  const [reactions, setReactions] = useState<{ id: string; user: string; emoji: string; until: number }[]>([]);
  const engine = useRef<RoomActivity | null>(null), latest = useRef({ members, now }); latest.current = { members, now };
  const lastTyping = useRef(0), wasTyping = useRef(false), idle = useRef<ReturnType<typeof setTimeout> | null>(null), lastReaction = useRef(0);
  useEffect(() => {
    if (!enabled) return;
    const receive = (row: ActivityRow) => {
      if (row.payload.kind === 'typing') { const active = row.payload.active; setTyping(previous => ({ ...previous, [row.sender_id]: active ? Date.now() + 5000 : 0 })); }
      else { const emoji = row.payload.emoji; setReactions(previous => [...previous.slice(-5), { id: `${row.id}`, user: row.sender_id, emoji, until: Date.now() + 4000 }]); }
    };
    if (!demo) { engine.current = new RoomActivity(backend(), room, user, () => latest.current.members, () => latest.current.now(), receive); engine.current.start(); }
    const timer = setInterval(() => {
      setTyping(previous => Object.values(previous).some(until => until <= Date.now()) ? Object.fromEntries(Object.entries(previous).filter(([, until]) => until > Date.now())) : previous);
      setReactions(previous => previous.some(reaction => reaction.until <= Date.now()) ? previous.filter(reaction => reaction.until > Date.now()) : previous);
    }, 1000);
    return () => { if (idle.current) clearTimeout(idle.current); if (wasTyping.current) void engine.current?.send({ scope: 'activity', kind: 'typing', active: false }); wasTyping.current = false; lastTyping.current = 0; engine.current?.close(); engine.current = null; clearInterval(timer); };
  }, [room, user, demo, enabled]);
  function announceTyping(active: boolean) {
    if (idle.current) clearTimeout(idle.current);
    if (active && (!wasTyping.current || Date.now() - lastTyping.current > 2500) || !active && wasTyping.current) {
      lastTyping.current = Date.now(); void engine.current?.send({ scope: 'activity', kind: 'typing', active });
    }
    wasTyping.current = active;
    if (active) idle.current = setTimeout(() => announceTyping(false), 3000);
  }
  function react(emoji: string) {
    if (Date.now() - lastReaction.current < 700 || !REACTIONS.some(value => value === emoji)) return;
    lastReaction.current = Date.now();
    setReactions(previous => [...previous.slice(-5), { id: `local-${Date.now()}`, user, emoji, until: Date.now() + 4000 }]);
    void engine.current?.send({ scope: 'activity', kind: 'reaction', emoji });
  }
  return { typingNames: members.filter(m => typing[m.user_id] > Date.now()).map(m => m.display_name), reactions, announceTyping, react };
}

export function RoomReactions({ reactions, members, user, onReact }: { reactions: { id: string; user: string; emoji: string }[]; members: Member[]; user: string; onReact: (emoji: string) => void }) {
  return <section className="room-reactions" aria-label="Room reactions"><div className="reaction-heading"><span className="eyebrow">THE ROOM’S ENERGY</span><span>Say it without interrupting.</span></div><div className="reaction-buttons">{REACTIONS.map(emoji => <button key={emoji} aria-label={`React ${emoji}`} onClick={() => onReact(emoji)}>{emoji}</button>)}</div><div className="reaction-feed" aria-live="polite">{reactions.map(reaction => <span key={reaction.id} className="reaction-bubble"><span>{reaction.emoji}</span>{reaction.user === user ? 'You' : members.find(m => m.user_id === reaction.user)?.display_name || 'A friend'}</span>)}</div></section>;
}

export function RoomChat({ messages, members, user, draft, sending, typingNames, onDraft, onSend, onTyping }: { messages: ChatMessage[]; members: Member[]; user: string; draft: string; sending: boolean; typingNames: string[]; onDraft: (value: string) => void; onSend: (event: React.FormEvent) => void; onTyping: (active: boolean) => void }) {
  const composer = useRef<HTMLInputElement>(null), scroller = useRef<HTMLDivElement>(null), atBottom = useRef(true), [unread, setUnread] = useState(0);
  const previous = useRef<number | null>(null);
  useEffect(() => {
    const el = scroller.current; if (!el) return;
    const last = messages.at(-1);
    if (last?.id === previous.current) return;
    const previousIndex = messages.findIndex(message => message.id === previous.current);
    const added = previous.current === null ? 0 : previousIndex >= 0 ? messages.length - previousIndex - 1 : 1;
    if (atBottom.current || messages.at(-1)?.sender_id === user) { el.scrollTop = el.scrollHeight; setUnread(0); }
    else if (added > 0) setUnread(value => value + added);
    previous.current = last?.id ?? null;
  }, [messages, user]);
  useEffect(() => () => onTyping(false), []);
  return <><div className="chat-messages" ref={scroller} onScroll={() => { const el = scroller.current!; atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60; if (atBottom.current) setUnread(0); }}><div className="chat-welcome"><span>✳</span><strong>The group chat, with a soundtrack.</strong><p>Song requests. Bad jokes. Good company.</p></div>{messages.map(message => <div className={`chat-message ${message.sender_id === user ? 'mine' : ''}`} key={message.id}><div><strong>{members.find(m => m.user_id === message.sender_id)?.display_name || 'A friend'}</strong><time>{new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div><p>{message.body}</p></div>)}</div>{unread > 0 && <button className="chat-unread" onClick={() => { const el = scroller.current!; el.scrollTop = el.scrollHeight; atBottom.current = true; setUnread(0); }}>{unread} new message{unread === 1 ? '' : 's'} ↓</button>}{!draft.trim() && <div className="chat-prompts" aria-label="Conversation starters">{[["🎵 Song request", "Next song: "], ["👀 One more?", "One more song? 👀"], ["🔥 Hostel anthem", "This is our hostel anthem 🔥"]].map(([label, text]) => <button key={label} type="button" onClick={() => { onDraft(text); onTyping(true); composer.current?.focus(); }}>{label}</button>)}</div>}<div className="typing-status" role="status">{typingNames.length > 0 && <><span className="typing-dots" aria-hidden="true"><i/><i/><i/></span>{typingNames.length === 1 ? `${typingNames[0]} is typing…` : `${typingNames.slice(0, 2).join(' and ')}${typingNames.length > 2 ? ' + more' : ''} are typing…`}</>}</div><form className="chat-composer" onSubmit={event => { onTyping(false); onSend(event); }}><input ref={composer} aria-label="Message the room" maxLength={1000} placeholder="Drop a song, a thought, a terrible joke…" value={draft} onChange={event => { onDraft(event.target.value); onTyping(!!event.target.value.trim()); }} onBlur={() => onTyping(false)}/><button aria-label="Send message" disabled={!draft.trim() || sending}>{sending ? <LoaderCircle className="spin" size={16}/> : <Send size={16}/>}</button></form></>;
}
