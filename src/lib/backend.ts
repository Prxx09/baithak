import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getConfig } from './config';
import type { Snapshot } from './types';
let client: SupabaseClient | null = null;
export function backend() {
  if (client) return client;
  const config = getConfig();
  if (!config.key) throw new Error('Connect your Supabase project first using Connection settings.');
  client = createClient(config.url, config.key, { auth: { storage: sessionStorage, storageKey: 'baithak.auth.v1', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
  return client;
}
export async function guest() {
  const db = backend();
  const { data: existing, error: sessionError } = await db.auth.getSession();
  if (sessionError) throw sessionError;
  if (existing.session) return existing.session.user.id;
  const { data, error } = await db.auth.signInAnonymously();
  if (error) throw error;
  return data.user!.id;
}
export async function command(action: string, code = '', name = '', title = ''): Promise<Snapshot> {
  const { data, error } = await backend().rpc('baithak_command', { p_action: action, p_code: code, p_name: name, p_title: title });
  if (error) throw error;
  return data as Snapshot;
}
