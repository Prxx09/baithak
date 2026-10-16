export const DEFAULT_URL = 'https://srdiobwssgiuwenbmxvd.supabase.co';
export function getConfig() {
  let saved: { url?: string; key?: string } = {};
  try { saved = JSON.parse(localStorage.getItem('baithak.connection.v1') || '{}'); } catch { /* Ignore corrupted local settings. */ }
  // Deployed settings are authoritative so guests never need to configure a connection.
  if (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY) return { url: import.meta.env.VITE_SUPABASE_URL || DEFAULT_URL, key: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY };
  return { url: saved.url || import.meta.env.VITE_SUPABASE_URL || DEFAULT_URL, key: saved.key || '' };
}
export function saveConfig(url: string, key: string) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || !parsed.hostname.endsWith('.supabase.co')) throw new Error('Enter your HTTPS Supabase project URL.');
  if (key.startsWith('sb_secret_')) throw new Error('Secret keys must never be used here. Use a publishable key.');
  if (!key.startsWith('sb_publishable_')) throw new Error('Use a modern sb_publishable_ key from Supabase Settings → API Keys.');
  localStorage.setItem('baithak.connection.v1', JSON.stringify({ url: parsed.origin, key }));
}
export function iceServers(): RTCIceServer[] {
  const defaults: RTCIceServer[] = [{ urls: 'stun:stun.cloudflare.com:3478' }];
  try { const custom = JSON.parse(import.meta.env.VITE_ICE_SERVERS || 'null'); return Array.isArray(custom) && custom.length ? custom : defaults; } catch { return defaults; }
}
export function parseRoomCode(value: string): string {
  const text = value.trim();
  if (!text) return '';
  try { return new URL(text).searchParams.get('room')?.trim() || ''; } catch { return text.replace(/\s/g, ''); }
}
export function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === 'object' && error && 'message' in error ? String(error.message) : 'Something went wrong. Please try again.';
  if (/anonymous.*disabled|anonymous.*not enabled/i.test(message)) return 'Rooms are not ready yet. The app owner needs to finish guest access setup. You do not need an account or password.';
  if (/schema cache|baithak_command.*not|does not exist/i.test(message)) return 'Rooms are not ready yet. The app owner needs to finish the room backend setup. Please try again later.';
  if (/permission denied|row-level security/i.test(message)) return 'Room access was denied. Rejoin using the invitation link.';
  if (/NotAllowedError|Permission denied/i.test(message)) return 'Permission was declined. Try again and allow the selected device or screen.';
  return message;
}
