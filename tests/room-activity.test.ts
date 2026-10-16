import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { RoomActivity, type ActivityRow } from '../src/lib/room-activity';
const members = [{ user_id: 'you', display_name: 'You', requested: false, last_seen: '' }, { user_id: 'friend', display_name: 'Friend', requested: false, last_seen: '' }];
let activity: RoomActivity, receive: (event: { new: ActivityRow }) => void, changed: ReturnType<typeof vi.fn>, insert: ReturnType<typeof vi.fn>, removed: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers(); changed = vi.fn(); insert = vi.fn().mockResolvedValue({ error: null }); removed = vi.fn();
  const channel = { on: vi.fn((_event, _filter, callback) => { receive = callback; return channel; }), subscribe: vi.fn(() => channel) };
  const query = { eq: () => query, gt: () => query, order: () => query, limit: async () => ({ data: [], error: null }) };
  const db = { channel: () => channel, removeChannel: removed, from: () => ({ select: () => query, insert }) } as unknown as SupabaseClient;
  activity = new RoomActivity(db, 'room', 'you', () => members, () => Date.now(), changed); activity.start();
});
afterEach(() => { activity.close(); vi.useRealTimers(); });
const row = (id: number, active = true): ActivityRow => ({ id, room_id: 'room', sender_id: 'friend', created_at: new Date().toISOString(), payload: { scope: 'activity', kind: 'typing', active } });
it('accepts current member activity, ignores duplicate, stale, and outsider events', () => {
  receive({ new: row(1) }); receive({ new: row(1) }); receive({ new: { ...row(2), sender_id: 'outsider' } }); receive({ new: { ...row(3), created_at: new Date(Date.now() - 10000).toISOString() } });
  expect(changed).toHaveBeenCalledTimes(1);
  receive({ new: row(5, false) }); receive({ new: row(4, true) });
  expect(changed).toHaveBeenCalledTimes(2); expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ payload: expect.objectContaining({ active: false }) }));
});
it('sends only typing state to other members and stops after closing', async () => {
  await activity.send({ scope: 'activity', kind: 'typing', active: true });
  expect(insert).toHaveBeenCalledExactlyOnceWith({ room_id: 'room', sender_id: 'you', receiver_id: 'friend', payload: { scope: 'activity', kind: 'typing', active: true } });
  activity.close(); await activity.send({ scope: 'activity', kind: 'reaction', emoji: '🔥' }); expect(insert).toHaveBeenCalledTimes(1); expect(removed).toHaveBeenCalledOnce();
});
