import type { SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';
import type { Member } from './types';
export const REACTIONS = ['🔥', '😂', '❤️', '🙌', '😭', '✨'] as const;
export type Activity = { scope: 'activity'; kind: 'typing'; active: boolean } | { scope: 'activity'; kind: 'reaction'; emoji: string };
export interface ActivityRow { id: number; room_id: string; sender_id: string; created_at: string; payload: Activity; }

/** Uses the existing recipient-only, membership-protected signaling table. */
export class RoomActivity {
  private channel: RealtimeChannel | null = null;
  private seen = new Set<number>();
  private stopped = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private pulling = false;
  private cursor = 0;
  private latestTyping = new Map<string, number>();
  constructor(private db: SupabaseClient, private room: string, private user: string, private members: () => Member[], private now: () => number, private receive: (row: ActivityRow) => void) {}
  start() {
    this.channel = this.db.channel(`activity:${this.room}:${this.user}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'baithak_signals', filter: `receiver_id=eq.${this.user}` }, event => this.accept(event.new as ActivityRow))
      .subscribe();
    void this.pull(); this.timer = setInterval(() => void this.pull(), 2500);
  }
  private accept(row: ActivityRow) {
    if (this.stopped || row.room_id !== this.room || row.payload?.scope !== 'activity' || this.seen.has(row.id) || !this.members().some(m => m.user_id === row.sender_id)) return;
    this.seen.add(row.id); if (this.seen.size > 1000) this.seen.delete(this.seen.values().next().value!);
    const age = this.now() - Date.parse(row.created_at);
    if (!Number.isFinite(age) || age > 6000 || age < -3000) return;
    const payload = row.payload;
    if (payload.kind === 'typing') { if (row.id <= (this.latestTyping.get(row.sender_id) || 0)) return; this.latestTyping.set(row.sender_id, row.id); }
    if (payload.kind === 'typing' && typeof payload.active === 'boolean' || payload.kind === 'reaction' && REACTIONS.some(emoji => emoji === payload.emoji)) this.receive(row);
  }
  private async pull() {
    if (this.stopped || this.pulling) return; this.pulling = true;
    try {
      const { data, error } = await this.db.from('baithak_signals').select('*').eq('room_id', this.room).eq('receiver_id', this.user).gt('id', this.cursor).order('id').limit(1000);
      if (!error) for (const row of data || []) { this.cursor = Math.max(this.cursor, row.id); this.accept(row as ActivityRow); }
    } catch { /* Ephemeral activity can recover on the next poll. */ }
    finally { this.pulling = false; }
  }
  async send(payload: Activity) {
    if (this.stopped) return;
    // No draft text or audio goes into activity messages. Failed ephemeral
    // events are discarded; room heartbeat handles membership recovery.
    const recipients = this.members().filter(m => m.user_id !== this.user);
    await Promise.allSettled(recipients.map(member => this.db.from('baithak_signals').insert({ room_id: this.room, sender_id: this.user, receiver_id: member.user_id, payload })));
  }
  close() { if (this.stopped) return; this.stopped = true; if (this.timer) clearInterval(this.timer); if (this.channel) void this.db.removeChannel(this.channel); }
}
