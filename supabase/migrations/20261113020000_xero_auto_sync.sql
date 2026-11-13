-- Sync from Xero by itself every 30 minutes (13 Nov 2026), as well as the button. The database's own scheduler (pg_cron)
-- calls the xero function (pg_net) with a key kept in app_secrets, which only the database and the function can read.
create extension if not exists pg_cron;
create extension if not exists pg_net;
create table if not exists public.app_secrets (name text primary key, value text not null);
alter table public.app_secrets enable row level security;
revoke all on public.app_secrets from anon, authenticated;
insert into public.app_secrets (name, value) values ('xero_cron_key', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')) on conflict (name) do nothing;
select cron.unschedule(jobid) from cron.job where jobname = 'xero-items-sync';
select cron.schedule('xero-items-sync', '*/30 * * * *', $job$
  select net.http_post(
    url := 'https://qnfuifckyfhiuvqyvkvf.supabase.co/functions/v1/xero',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-key', (select value from public.app_secrets where name = 'xero_cron_key')),
    body := '{"action":"sync_items"}'::jsonb,
    timeout_milliseconds := 60000);
$job$);
select jobname, schedule, active from cron.job where jobname = 'xero-items-sync';
