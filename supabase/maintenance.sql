-- Project owner maintenance, e.g. daily via a free Supabase Cron job.
-- Cascades only through Baithak's own data. Never deletes unrelated auth users.
delete from public.baithak_rooms where expires_at < now()-interval '1 day';
delete from public.baithak_signals where created_at < now()-interval '5 minutes';
