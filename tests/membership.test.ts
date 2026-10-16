// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ rpc }) }));
vi.mock('../src/lib/config', () => ({ getConfig: () => ({ url: 'https://example.supabase.co', key: 'public' }) }));
import { refreshMembership } from '../src/lib/backend';
beforeEach(() => rpc.mockReset());
it('renews a stale named guest using the invitation after a mobile suspension', async () => {
  rpc.mockResolvedValueOnce({ error: { message: 'Your room session expired. Rejoin using the invitation link.' } });
  rpc.mockResolvedValueOnce({ data: { members: [{ user_id: 'guest' }] } });
  const result = await refreshMembership('invitation', 'Prajwal');
  expect(result.members).toHaveLength(1);
  expect(rpc).toHaveBeenLastCalledWith('baithak_command', expect.objectContaining({ p_action: 'join', p_code: 'invitation', p_name: 'Prajwal' }));
});
it('does not try to reopen an expired room or invent an unnamed guest', async () => {
  rpc.mockResolvedValueOnce({ error: { message: 'This room has ended or the invitation is invalid.' } });
  await expect(refreshMembership('expired', 'Prajwal')).rejects.toMatchObject({ message: expect.stringContaining('ended') });
  expect(rpc).toHaveBeenCalledTimes(1);
  rpc.mockReset(); rpc.mockResolvedValueOnce({ error: { message: 'Your room session expired.' } });
  await expect(refreshMembership('invite', '')).rejects.toMatchObject({ message: expect.stringContaining('expired') });
  expect(rpc).toHaveBeenCalledTimes(1);
});
