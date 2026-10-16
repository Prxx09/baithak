-- Run after installation in Supabase SQL Editor.
select tablename, rowsecurity from pg_tables where schemaname='public' and tablename like 'baithak_%' order by tablename;
select schemaname,tablename,policyname,cmd from pg_policies where tablename like 'baithak_%' order by tablename,policyname;
select schemaname,tablename from pg_publication_tables where pubname='supabase_realtime' and tablename like 'baithak_%';
select n.nspname,p.proname,p.prosecdef,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='baithak_private' or (n.nspname='public' and p.proname in ('baithak_command','baithak_watch'));
